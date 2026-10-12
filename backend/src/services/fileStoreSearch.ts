import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { FileSearchStatus, StoredFileSearchResult, StoredFileText } from '@conai/shared';
import { getUserSettingsDb } from '../database/userSettingsDb';
import { storedFilePath } from './fileStorePaths';
import { FileStoreError, FileStoreService, TEXT_EXTENSIONS, toEntry, type FileRow } from './fileStoreService';
import { EMBEDDING_MODEL_KEY, embedQuery, embeddingFeatureOn } from './aiWorker/textEmbeddingService';
import { fuseRanks, SEMANTIC_SPACES, standouts } from './embeddings/rankFusion';
import { vectorStore } from './vectors/vectorStore';
import { notifySemanticChange } from './embeddings/semanticSignal';
import { DOCUMENT_EXTENSIONS, MAX_EXTRACTED_CHARS, extractDocument, type ExtractedDocument, type DocumentSection } from './fileDocumentExtraction';

/** Bounded extraction; any cutoff is reported as partial rather than silently claiming full coverage. */
const MAX_INDEXED_BYTES = 32 * 1024 * 1024;
const MAX_TERMS = 8;
const MAX_TERM_LENGTH = 200;
const SNIPPET_BEFORE = 60;
const SNIPPET_LENGTH = 200;
const HTML_EXTENSIONS = new Set(['.html', '.htm']);

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** The visible text of an HTML document: no tags, scripts, styles or comments; common entities decoded. */
export function htmlToText(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (all, code: string) => {
      if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? all;
      const value = code[1] === 'x' || code[1] === 'X' ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : all;
    })
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n[\s]*/g, '\n')
    .trim();
}

/** SQLite's lower() folds ASCII only; terms are folded the same way so instr() positions agree. */
function asciiLower(value: string) {
  return value.replace(/[A-Z]/g, (char) => char.toLowerCase());
}

/** Space-separated words, all required; a "quoted phrase" is one term. */
export function parseSearchTerms(query: unknown, options: { allowLong?: boolean } = {}): string[] {
  if (typeof query !== 'string') throw new FileStoreError('검색어를 입력해줘.');
  if (query.length > 2000) throw new FileStoreError('검색 문장은 2000자까지 넣을 수 있어.');
  const terms: string[] = [];
  for (const match of query.normalize('NFC').matchAll(/"([^"]*)"|(\S+)/g)) {
    const term = asciiLower((match[1] ?? match[2]).replace(/\s+/g, ' ').trim()).slice(0, MAX_TERM_LENGTH);
    if (term && !terms.includes(term)) terms.push(term);
  }
  if (terms.length === 0) throw new FileStoreError('검색어를 입력해줘.');
  if (!options.allowLong && terms.length > MAX_TERMS) throw new FileStoreError(`검색어는 ${MAX_TERMS}개까지 넣을 수 있어.`);
  return terms;
}

async function readIndexText(owner: string, row: Pick<FileRow, 'id' | 'name'>): Promise<ExtractedDocument> {
  const extension = path.extname(row.name).toLowerCase();
  const empty = (state: ExtractedDocument['state'], note: string | null): ExtractedDocument => ({ body: '', sections: [], state, note });
  if (DOCUMENT_EXTENSIONS.has(extension)) return extractDocument(storedFilePath(owner, row.id), row.name);
  if (!TEXT_EXTENSIONS.has(extension)) return empty('unsupported', 'Content search is not supported for this file type.');
  try {
    const handle = await fs.promises.open(storedFilePath(owner, row.id), 'r');
    let data: Buffer;
    let partial: boolean;
    try {
      const size = (await handle.stat()).size;
      const buffer = Buffer.alloc(Math.min(size, MAX_INDEXED_BYTES));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      data = buffer.subarray(0, bytesRead);
      partial = bytesRead < size;
    } finally { await handle.close(); }
    if (data.includes(0)) return empty('unsupported', 'Binary content cannot be searched as UTF-8 text.');
    const text = new TextDecoder('utf-8').decode(data).replace(/^\uFEFF/, '').normalize('NFC');
    const body = HTML_EXTENSIONS.has(extension) ? htmlToText(text) : text;
    partial ||= body.length > MAX_EXTRACTED_CHARS;
    return { body: body.slice(0, MAX_EXTRACTED_CHARS), sections: [], state: partial ? 'partial' : body.trim() ? 'ready' : 'empty',
      note: partial ? 'Only the first 32 MB / 8,000,000 characters were extracted.' : null };
  } catch { return { ...empty('error', 'File could not be read.'), retryable: true }; }
}

const refreshing = new Map<string, Promise<void>>();
const FILE_READ_CHUNK_BYTES = 16 * 1024;
const RETRY_DELAYS_MS = [30_000, 120_000, 600_000];
const scheduledOwners = new Map<string, number>();
let maintenanceTimer: NodeJS.Timeout | null = null;
let maintenanceRunning = false;
let maintenanceStopped = false;

/** Bump when extracted text or byte-chunk layout changes. */
export const FILE_REVISION = "'document-v4|' || e.name || '|' || e.size || '|' || e.updated_at";
type PendingFile = Pick<FileRow, 'id' | 'name'> & { owner_key: string; revision: string; cached_revision: string | null; retry_count: number; last_attempt: number | null };

function pendingExtractions(owner: string, onlyId?: string, limit = 8, force = false): PendingFile[] {
  return getUserSettingsDb().prepare(`SELECT e.id, e.name, e.owner_key, ${FILE_REVISION} AS revision,
    t.revision AS cached_revision, COALESCE(t.retry_count, 0) AS retry_count, t.last_attempt
    FROM stored_file_entries e LEFT JOIN search_db.search_documents t ON t.source = 'file' AND t.source_id = e.id
    WHERE e.owner_key = @owner AND e.kind = 'file' AND e.deleted_at IS NULL ${onlyId ? 'AND e.id = @id' : ''}
      ${force ? '' : `AND (t.source_id IS NULL OR t.revision <> ${FILE_REVISION}
        OR (t.extraction_state = 'error' AND t.retryable = 1 AND t.retry_after <= @now))`}
    ORDER BY e.updated_at ASC, e.id LIMIT @limit`).all({ owner, now: Date.now(), limit, ...(onlyId ? { id: onlyId } : {}) }) as PendingFile[];
}

function armMaintenance() {
  if (maintenanceStopped || maintenanceRunning || scheduledOwners.size === 0) return;
  if (maintenanceTimer) clearTimeout(maintenanceTimer);
  const at = Math.min(...scheduledOwners.values());
  maintenanceTimer = setTimeout(() => {
    maintenanceTimer = null;
    const next = [...scheduledOwners].sort((a, b) => a[1] - b[1])[0];
    if (!next) return;
    const [owner] = next;
    scheduledOwners.delete(owner);
    maintenanceRunning = true;
    void refreshFileSearchIndex(owner, undefined, { limit: 1 }).catch(() => undefined).finally(() => {
      maintenanceRunning = false;
      armMaintenance();
    });
  }, Math.max(10, at - Date.now()));
  maintenanceTimer.unref();
}

/** A small extraction pass runs independently of vector work; owners take turns. */
export function queueFileSearchRefresh(owner: string, at = Date.now()) {
  if (maintenanceStopped) return;
  scheduledOwners.set(owner, Math.min(scheduledOwners.get(owner) ?? Infinity, at));
  armMaintenance();
}

/** Retry deadlines are persisted so a restart does not forget transient failures. */
export function startFileSearchMaintenance() {
  maintenanceStopped = false;
  const rows = getUserSettingsDb().prepare(`SELECT owner_key, MIN(retry_after) AS due FROM search_db.search_documents
    WHERE source = 'file' AND retryable = 1 AND retry_after IS NOT NULL GROUP BY owner_key`).all() as Array<{ owner_key: string; due: number }>;
  for (const row of rows) queueFileSearchRefresh(row.owner_key, row.due);
}

export function stopFileSearchMaintenance() {
  maintenanceStopped = true;
  if (maintenanceTimer) clearTimeout(maintenanceTimer);
  maintenanceTimer = null;
  scheduledOwners.clear();
}

async function refreshOne(row: PendingFile, force: boolean) {
  const key = `${row.owner_key}\u0000${row.id}`;
  const running = refreshing.get(key);
  if (running) return running;
  // A foreground read may already have handled a row from this batch.
  const latest = pendingExtractions(row.owner_key, row.id, 1, force)[0];
  if (!latest) return;
  row = latest;
  if (force && row.last_attempt && Date.now() - row.last_attempt < 5000) throw new FileStoreError('방금 추출했어. 잠시 뒤 다시 시도해줘.', 429);
  const task = (async () => {
    const db = getUserSettingsDb();
    const signature = async () => {
      try { const stat = await fs.promises.stat(storedFilePath(row.owner_key, row.id)); return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`; }
      catch { return null; }
    };
    const before = await signature();
    const doc = await readIndexText(row.owner_key, row);
    if (before !== await signature() || !db.open) return;
    const current = db.prepare(`SELECT ${FILE_REVISION} AS revision FROM stored_file_entries e WHERE e.id = ? AND e.owner_key = ? AND e.deleted_at IS NULL`).get(row.id, row.owner_key) as { revision: string } | undefined;
    if (current?.revision !== row.revision) return;
    const attempt = force || row.cached_revision !== row.revision ? 0 : row.retry_count + 1;
    const retryAt = doc.state === 'error' && doc.retryable && attempt < RETRY_DELAYS_MS.length ? Date.now() + RETRY_DELAYS_MS[attempt] : null;
    const bytes = Buffer.from(doc.body, 'utf8');
    db.transaction(() => {
      db.prepare(`INSERT INTO search_db.search_documents
        (source, source_id, owner_key, revision, body, extraction_state, extraction_note, sections, content_hash, body_bytes, retry_count, retry_after, retryable, last_attempt)
        VALUES ('file', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, source_id) DO UPDATE SET owner_key = excluded.owner_key, revision = excluded.revision,
        body = excluded.body, extraction_state = excluded.extraction_state, extraction_note = excluded.extraction_note,
        sections = excluded.sections, content_hash = excluded.content_hash, body_bytes = excluded.body_bytes,
        retry_count = excluded.retry_count, retry_after = excluded.retry_after, retryable = excluded.retryable, last_attempt = excluded.last_attempt`)
        .run(row.id, row.owner_key, row.revision, doc.body, doc.state, doc.note, JSON.stringify(doc.sections),
          createHash('sha1').update(doc.body).digest('hex'), bytes.length, attempt, retryAt, Number(Boolean(doc.retryable)), Date.now());
      db.prepare("DELETE FROM search_db.document_chunks WHERE source = 'file' AND source_id = ?").run(row.id);
      const insert = db.prepare("INSERT INTO search_db.document_chunks (source, source_id, chunk, body) VALUES ('file', ?, ?, ?)");
      for (let start = 0; start < bytes.length; start += FILE_READ_CHUNK_BYTES) insert.run(row.id, start / FILE_READ_CHUNK_BYTES, bytes.subarray(start, start + FILE_READ_CHUNK_BYTES));
    })();
    if (retryAt !== null) queueFileSearchRefresh(row.owner_key, retryAt);
    notifySemanticChange('file');
  })().finally(() => refreshing.delete(key));
  refreshing.set(key, task);
  return task;
}

/** Each call handles a bounded batch; the remaining files continue in background passes. */
export async function refreshFileSearchIndex(owner: string, onlyId?: string, options: { limit?: number; force?: boolean } = {}): Promise<void> {
  const db = getUserSettingsDb();
  if (!db.open) return;
  const limit = options.limit ?? 8;
  const rows = pendingExtractions(owner, onlyId, limit, options.force);
  for (const row of rows) await refreshOne(row, Boolean(options.force));
  if (!onlyId && db.open && rows.length === limit) queueFileSearchRefresh(owner);
  if (db.open) {
    // Immediate passes must not consume this owner's later retry deadline.
    const retry = db.prepare(`SELECT MIN(t.retry_after) AS due FROM search_db.search_documents t
      JOIN stored_file_entries e ON e.id = t.source_id AND e.owner_key = t.owner_key
      WHERE t.source = 'file' AND t.owner_key = ? AND e.deleted_at IS NULL
        AND t.extraction_state = 'error' AND t.retryable = 1 AND t.retry_after IS NOT NULL`).get(owner) as { due: number | null };
    if (retry.due !== null) queueFileSearchRefresh(owner, retry.due);
  }
}

/** Rebuild derived data only; ownership is checked even when the original file is unchanged. */
export async function retryFileSearchIndex(owner: string, id: string) {
  const file = FileStoreService.resolveFile(owner, id).entry;
  if (!TEXT_EXTENSIONS.has(path.extname(file.name).toLowerCase()) && !DOCUMENT_EXTENSIONS.has(path.extname(file.name).toLowerCase())) throw new FileStoreError('본문 추출을 지원하지 않는 파일이야.', 415);
  await refreshFileSearchIndex(owner, id, { force: true });
  return { fileId: id };
}

type SearchRow = FileRow & { hit_at: number; body_length: number | null; excerpt: string | null; extraction_state?: string; extraction_note?: string | null; sections?: string; semantic_start?: number; read_offset?: number; read_revision?: string; read_size?: number };

/** A search may wait for the embedding model to load (a tool call, not a reply in progress). */
const SEMANTIC_QUERY_WAIT_MS = 20_000;
const SEMANTIC_MIN_SCORE = 0.6;
const SEMANTIC_MIN_LEAD = 0.04;

/**
 * The lexical rows fused with files close in meaning to the query (text embeddings, see semanticIndex), best first;
 * null when embeddings are off or not answering. A file found by meaning shows the part of its text that matched.
 */
async function withSemanticRows(owner: string, query: string, limit: number, scopeSql: string, params: Record<string, string | number>, lexical: SearchRow[], status: FileSearchStatus): Promise<SearchRow[] | null> {
  if (!embeddingFeatureOn('fileSearch')) { status.semantic = 'disabled'; return null; }
  const vector = await embedQuery(query, { waitMs: SEMANTIC_QUERY_WAIT_MS });
  if (!vector) { status.semantic = 'unavailable'; return null; }
  status.mode = 'hybrid';
  status.semantic = status.indexedFiles === 0 && status.searchableFiles > 0 ? 'not_indexed' : status.indexedFiles < status.searchableFiles || status.pendingDocuments > 0 ? 'partial' : 'ready';
  const db = getUserSettingsDb();
  const scope = scopeSql
    ? new Set((db.prepare(`SELECT e.id FROM stored_file_entries e WHERE e.owner_key = @owner ${scopeSql}`).all({ owner, within: params.within }) as Array<{ id: string }>).map((row) => row.id))
    : null;
  const revisions = new Map((db.prepare(`SELECT e.id, (t.revision || ':' || t.content_hash) AS revision FROM stored_file_entries e JOIN search_db.search_documents t ON t.source = 'file' AND t.source_id = e.id WHERE e.owner_key = ? AND e.deleted_at IS NULL AND t.revision = ${FILE_REVISION}`).all(owner) as Array<{ id: string; revision: string }>).map(row => [row.id, row.revision]));
  const best = new Map<string, { score: number; spanStart: number | null }>();
  for (const hit of vectorStore.search(SEMANTIC_SPACES.file, EMBEDDING_MODEL_KEY, vector, { ownerKeys: [owner] })) {
    if ((scope && !scope.has(hit.sourceKey)) || hit.contentHash !== revisions.get(hit.sourceKey)) continue;
    const known = best.get(hit.sourceKey);
    if (!known || known.score < hit.score) best.set(hit.sourceKey, { score: hit.score, spanStart: hit.spanStart });
  }
  const close = standouts(new Map([...best].map(([id, value]) => [id, value.score])), SEMANTIC_MIN_SCORE, SEMANTIC_MIN_LEAD).slice(0, limit).map(([id]) => id);
  if (close.length === 0) return null;
  const rows = new Map(lexical.map((row) => [row.id, row]));
  const missing = close.filter((id) => !rows.has(id));
  if (missing.length > 0) {
    const found = db.prepare(`SELECT e.*, t.body, t.extraction_state, t.extraction_note, t.sections, (t.revision || ':' || t.content_hash) AS read_revision, t.body_bytes AS read_size FROM stored_file_entries e LEFT JOIN search_db.search_documents t ON t.source = 'file' AND t.source_id = e.id
      WHERE e.owner_key = ? AND e.deleted_at IS NULL AND e.id IN (${missing.map(() => '?').join(', ')})`).all(owner, ...missing) as Array<FileRow & { body: string | null }>;
    for (const { body, ...row } of found) {
      const byteOffset = best.get(row.id)?.spanStart ?? 0;
      const start = body ? Buffer.from(body, 'utf8').subarray(0, byteOffset).toString('utf8').length : 0;
      rows.set(row.id, { ...row, semantic_start: start, read_offset: byteOffset, hit_at: body ? start + SNIPPET_BEFORE + 1 : 0, body_length: body?.length ?? null, excerpt: body ? body.slice(start, start + SNIPPET_LENGTH) : null });
    }
  }
  const fused = fuseRanks([lexical.map((row) => row.id), close]);
  return [...fused.entries()].sort((a, b) => b[1] - a[1]).flatMap(([id]) => rows.get(id) ?? []);
}

/**
 * Files and folders of one store whose name or text contains every term (case-insensitive for ASCII), name hits
 * first, then the most recently changed. `within`: only these entries and everything under them (the limit then
 * counts hits inside them, not in the whole store). `semantic`: files close in meaning come in too, ranked together
 * with the word matches (when text embeddings are on for file search).
 */
export async function searchStoredFiles(owner: string, query: unknown, limit = 50, within?: readonly string[], options: { semantic?: boolean } = {}): Promise<StoredFileSearchResult> {
  const allTerms = parseSearchTerms(query, { allowLong: options.semantic });
  const terms = allTerms.slice(0, MAX_TERMS);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new FileStoreError('잘못된 검색 개수야.');
  let timer: NodeJS.Timeout | undefined;
  try { await Promise.race([refreshFileSearchIndex(owner), new Promise<void>(resolve => { timer = setTimeout(resolve, 1500); })]); }
  finally { clearTimeout(timer); }
  const db = getUserSettingsDb();
  const params: Record<string, string | number> = { owner, limit: limit + 1 };
  terms.forEach((term, index) => { params[`t${index}`] = term; });
  if (within) params.within = JSON.stringify(within);
  const scope = within ? `AND e.id IN (WITH RECURSIVE tree(id, depth) AS (
      SELECT value, 0 FROM json_each(@within) UNION ALL
      SELECT c.id, tree.depth + 1 FROM stored_file_entries c JOIN tree ON c.parent_id = tree.id WHERE c.deleted_at IS NULL AND tree.depth < 64
    ) SELECT id FROM tree)` : '';
  const inName = (index: number) => `instr(lower(e.name), @t${index}) > 0`;
  const inBody = (index: number) => `instr(lower(t.body), @t${index}) > 0`;
  const every = terms.map((_, index) => `(${inName(index)} OR ${inBody(index)})`).join(' AND ');
  const nameOnly = terms.map((_, index) => inName(index)).join(' AND ');
  // The excerpt starts a little before the first term that occurs in the text.
  const position = `CASE ${terms.map((_, index) => `WHEN ${inBody(index)} THEN instr(lower(t.body), @t${index})`).join(' ')} ELSE 0 END`;
  const rows = db.prepare(`SELECT e.*, t.extraction_state, t.extraction_note, t.sections, (t.revision || ':' || t.content_hash) AS read_revision, t.body_bytes AS read_size,
      length(CAST(substr(t.body, 1, MAX(${position} - ${SNIPPET_BEFORE}, 1) - 1) AS BLOB)) AS read_offset, ${position} AS hit_at, length(t.body) AS body_length,
      CASE WHEN ${position} > 0 THEN substr(t.body, max(${position} - ${SNIPPET_BEFORE}, 1), ${SNIPPET_LENGTH}) END AS excerpt
    FROM stored_file_entries e LEFT JOIN search_db.search_documents t ON t.source = 'file' AND t.source_id = e.id AND t.revision = ${FILE_REVISION}
    WHERE e.owner_key = @owner AND e.deleted_at IS NULL AND ${every} ${scope}
    ORDER BY CASE WHEN ${nameOnly} THEN 0 ELSE 1 END, e.updated_at DESC, e.name_key
    LIMIT @limit`).all(params) as SearchRow[];
  const totals = db.prepare(`SELECT
    SUM(CASE WHEN length(trim(t.body)) > 0 THEN 1 ELSE 0 END) AS searchableFiles,
    SUM(CASE WHEN p.complete = 1 AND p.revision = (t.revision || ':' || t.content_hash) AND p.model_key = @model THEN 1 ELSE 0 END) AS indexedFiles,
    SUM(CASE WHEN t.extraction_state IN ('partial', 'empty') THEN 1 ELSE 0 END) AS partialDocuments,
    SUM(CASE WHEN t.extraction_state = 'error' THEN 1 ELSE 0 END) AS failedDocuments,
    SUM(CASE WHEN t.extraction_state = 'unsupported' THEN 1 ELSE 0 END) AS unsupportedFiles,
    SUM(CASE WHEN t.source_id IS NULL OR t.revision != ${FILE_REVISION} THEN 1 ELSE 0 END) AS pendingDocuments
    FROM stored_file_entries e LEFT JOIN search_db.search_documents t ON t.source = 'file' AND t.source_id = e.id
    LEFT JOIN vector_db.file_progress p ON p.source_key = e.id
    WHERE e.owner_key = @owner AND e.kind = 'file' AND e.deleted_at IS NULL ${scope}`)
    .get({ owner, model: EMBEDDING_MODEL_KEY, ...(within ? { within: params.within } : {}) }) as Record<string, number | null>;
  const search: FileSearchStatus = { mode: 'keyword', semantic: 'not_requested', keywordTermsLimited: allTerms.length > MAX_TERMS, indexedFiles: totals.indexedFiles ?? 0,
    searchableFiles: totals.searchableFiles ?? 0, partialDocuments: totals.partialDocuments ?? 0,
    failedDocuments: totals.failedDocuments ?? 0, unsupportedFiles: totals.unsupportedFiles ?? 0, pendingDocuments: totals.pendingDocuments ?? 0 };
  const ranked = (options.semantic ? await withSemanticRows(owner, String(query), limit, scope, params, rows, search) : null) ?? rows;

  const folders = new Map((db.prepare(`SELECT id, parent_id, name FROM stored_file_entries WHERE owner_key = ? AND kind = 'folder' AND deleted_at IS NULL`)
    .all(owner) as Array<{ id: string; parent_id: string | null; name: string }>).map((folder) => [folder.id, folder]));
  const paths = new Map<string | null, string>([[null, '/']]);
  const folderPath = (id: string | null): string => {
    const known = paths.get(id);
    if (known !== undefined) return known;
    const names: string[] = [];
    for (let current = id, depth = 0; current !== null && depth < 64; depth++) {
      const folder = folders.get(current);
      if (!folder) break;
      names.unshift(folder.name);
      current = folder.parent_id;
    }
    const value = `/${names.join('/')}`;
    paths.set(id, value);
    return value;
  };

  const hits = ranked.slice(0, limit).map((row) => {
    let snippet: string | null = null;
    if (row.excerpt) {
      const start = Math.max(row.hit_at - SNIPPET_BEFORE, 1);
      snippet = `${start > 1 ? '…' : ''}${row.excerpt.replace(/\s+/g, ' ').trim()}${start + SNIPPET_LENGTH <= (row.body_length ?? 0) ? '…' : ''}`;
    }
    const sections = JSON.parse(row.sections || '[]') as DocumentSection[];
    // SQLite instr() counts code points, while stored embedding spans count UTF-16 code units.
    const position = row.semantic_start ?? Math.max(0, row.hit_at - 1);
    const location = sections.find(section => row.semantic_start === undefined
      ? section.textStart <= position && section.textEnd > position
      : section.start <= position && section.end > position)?.label ?? null;
    return { entry: toEntry(row), path: folderPath(row.parent_id), snippet, location, extractionState: row.extraction_state, extractionNote: row.extraction_note,
      ...(row.read_size && row.read_revision ? { read: { source: 'extracted' as const, offset: row.read_offset ?? 0, limit: 8000, revision: row.read_revision } } : {}) };
  });
  return { terms, hits, truncated: ranked.length > limit, search };
}

/** Internal bounded byte read; ownership is still checked against the derived document. */
export function readCachedFileBytes(owner: string, id: string, offset: number, count: number): Buffer {
  const first = Math.floor(offset / FILE_READ_CHUNK_BYTES);
  const last = Math.floor((offset + count - 1) / FILE_READ_CHUNK_BYTES);
  const parts = getUserSettingsDb().prepare(`SELECT c.body FROM search_db.document_chunks c
    JOIN search_db.search_documents d ON d.source = c.source AND d.source_id = c.source_id
    WHERE c.source = 'file' AND c.source_id = ? AND d.owner_key = ? AND c.chunk BETWEEN ? AND ? ORDER BY c.chunk`)
    .all(id, owner, first, last) as Array<{ body: Buffer }>;
  const bytes = Buffer.concat(parts.map(part => part.body));
  return bytes.subarray(offset - first * FILE_READ_CHUNK_BYTES, offset - first * FILE_READ_CHUNK_BYTES + count);
}

/** Binary documents expose the same paginated UTF-8 contract as text files. */
export async function readExtractedDocument(owner: string, id: string, offset: number, limit: number, expectedRevision?: string): Promise<StoredFileText> {
  await refreshFileSearchIndex(owner, id);
  const db = getUserSettingsDb();
  const row = db.prepare(`SELECT t.body_bytes, t.extraction_state, t.extraction_note, (t.revision || ':' || t.content_hash) AS revision
    FROM stored_file_entries e JOIN search_db.search_documents t ON t.source = 'file' AND t.source_id = e.id
    WHERE e.id = ? AND e.owner_key = ? AND e.deleted_at IS NULL AND t.revision = ${FILE_REVISION}`).get(id, owner) as
    { body_bytes: number; extraction_state: string; extraction_note: string | null; revision: string } | undefined;
  if (!row || (expectedRevision !== undefined && expectedRevision !== row.revision)) throw new FileStoreError('검색 후 문서가 변경됐어. 다시 검색해줘.', 409);
  if (row.extraction_state === 'error' || row.extraction_state === 'unsupported') throw new FileStoreError(row.extraction_note || '문서 추출에 실패했어.', 415);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > row.body_bytes || !Number.isSafeInteger(limit) || limit < 4 || limit > 32000) throw new FileStoreError('잘못된 읽기 범위야.');
  const bytes = readCachedFileBytes(owner, id, offset, limit + 3);
  if (offset < row.body_bytes && bytes.length === 0) throw new FileStoreError('추출 본문이 없어. 다시 추출해줘.', 409);
  const base = offset;
  let start = offset - base;
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  let end = Math.min(start + limit, bytes.length);
  while (end < bytes.length && end > start && (bytes[end] & 0xc0) === 0x80) end--;
  return { text: bytes.toString('utf8', start, end), offset: base + start, nextOffset: base + end < row.body_bytes ? base + end : null,
    size: row.body_bytes, extracted: true, extractionState: row.extraction_state, note: row.extraction_note, revision: row.revision };
}
