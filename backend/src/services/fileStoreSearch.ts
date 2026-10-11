import fs from 'fs';
import path from 'path';
import type { StoredFileSearchResult } from '@conai/shared';
import { getUserSettingsDb } from '../database/userSettingsDb';
import { storedFilePath } from './fileStorePaths';
import { FileStoreError, TEXT_EXTENSIONS, toEntry, type FileRow } from './fileStoreService';
import { EMBEDDING_MODEL_KEY, embedQuery, embeddingFeatureOn } from './aiWorker/textEmbeddingService';
import { fuseRanks, SEMANTIC_SPACES, standouts } from './embeddings/rankFusion';
import { vectorStore } from './vectors/vectorStore';

/** Only the start of a big file is searchable; documents fit, logs and backups are cut. */
const MAX_INDEXED_BYTES = 2 * 1024 * 1024;
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
export function parseSearchTerms(query: unknown): string[] {
  if (typeof query !== 'string') throw new FileStoreError('검색어를 입력해줘.');
  const terms: string[] = [];
  for (const match of query.normalize('NFC').matchAll(/"([^"]*)"|(\S+)/g)) {
    const term = asciiLower((match[1] ?? match[2]).replace(/\s+/g, ' ').trim()).slice(0, MAX_TERM_LENGTH);
    if (term && !terms.includes(term)) terms.push(term);
  }
  if (terms.length === 0) throw new FileStoreError('검색어를 입력해줘.');
  if (terms.length > MAX_TERMS) throw new FileStoreError(`검색어는 ${MAX_TERMS}개까지 넣을 수 있어.`);
  return terms;
}

async function readIndexText(owner: string, row: Pick<FileRow, 'id' | 'name'>): Promise<string> {
  const extension = path.extname(row.name).toLowerCase();
  if (!TEXT_EXTENSIONS.has(extension)) return '';
  let data: Buffer;
  try {
    const handle = await fs.promises.open(storedFilePath(owner, row.id), 'r');
    try {
      const buffer = Buffer.alloc(MAX_INDEXED_BYTES);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      data = buffer.subarray(0, bytesRead);
    } finally { await handle.close(); }
  } catch { return ''; }
  if (data.includes(0)) return '';
  // A cut at MAX_INDEXED_BYTES may split the last character; the decoder replaces it.
  const text = new TextDecoder('utf-8').decode(data).replace(/^﻿/, '').normalize('NFC');
  return HTML_EXTENSIONS.has(extension) ? htmlToText(text) : text;
}

const refreshing = new Map<string, Promise<void>>();

/** A file's text is re-read when its size or modification time differs from the cached revision. */
const FILE_REVISION = "e.size || '|' || e.updated_at";

/** Bring the owner's cached texts up to date: files new or changed since they were cached. */
export function refreshFileSearchIndex(owner: string): Promise<void> {
  const running = refreshing.get(owner);
  if (running) return running;
  const task = (async () => {
    const db = getUserSettingsDb();
    const stale = db.prepare(`SELECT e.id, e.name, ${FILE_REVISION} AS revision FROM stored_file_entries e
      LEFT JOIN search_db.search_documents t ON t.source = 'file' AND t.source_id = e.id
      WHERE e.owner_key = ? AND e.kind = 'file' AND e.deleted_at IS NULL
        AND (t.source_id IS NULL OR t.revision <> ${FILE_REVISION})`).all(owner) as Array<Pick<FileRow, 'id' | 'name'> & { revision: string }>;
    const save = db.prepare(`INSERT INTO search_db.search_documents (source, source_id, owner_key, revision, body) VALUES ('file', ?, ?, ?, ?)
      ON CONFLICT(source, source_id) DO UPDATE SET owner_key = excluded.owner_key, revision = excluded.revision, body = excluded.body`);
    // Read in batches and write each batch in one transaction, so a first search over many files commits a few times, not once per file.
    for (let start = 0; start < stale.length; start += 50) {
      const batch = stale.slice(start, start + 50);
      const bodies: string[] = [];
      for (const row of batch) bodies.push(await readIndexText(owner, row));
      // A file may change while it is read; the next search catches that by its revision again.
      db.transaction(() => batch.forEach((row, index) => save.run(row.id, owner, row.revision, bodies[index])))();
    }
  })().finally(() => refreshing.delete(owner));
  refreshing.set(owner, task);
  return task;
}

type SearchRow = FileRow & { hit_at: number; body_length: number | null; excerpt: string | null };

/** A search may wait for the embedding model to load (a tool call, not a reply in progress). */
const SEMANTIC_QUERY_WAIT_MS = 20_000;
const SEMANTIC_MIN_SCORE = 0.6;
const SEMANTIC_MIN_LEAD = 0.04;

/**
 * The lexical rows fused with files close in meaning to the query (text embeddings, see semanticIndex), best first;
 * null when embeddings are off or not answering. A file found by meaning shows the part of its text that matched.
 */
async function withSemanticRows(owner: string, query: string, limit: number, scopeSql: string, params: Record<string, string | number>, lexical: SearchRow[]): Promise<SearchRow[] | null> {
  if (!embeddingFeatureOn('fileSearch')) return null;
  const vector = await embedQuery(query, { waitMs: SEMANTIC_QUERY_WAIT_MS });
  if (!vector) return null;
  const db = getUserSettingsDb();
  const scope = scopeSql
    ? new Set((db.prepare(`SELECT e.id FROM stored_file_entries e WHERE e.owner_key = @owner ${scopeSql}`).all({ owner, within: params.within }) as Array<{ id: string }>).map((row) => row.id))
    : null;
  const best = new Map<string, { score: number; spanStart: number | null }>();
  for (const hit of vectorStore.search(SEMANTIC_SPACES.file, EMBEDDING_MODEL_KEY, vector, { ownerKeys: [owner] })) {
    if (scope && !scope.has(hit.sourceKey)) continue;
    const known = best.get(hit.sourceKey);
    if (!known || known.score < hit.score) best.set(hit.sourceKey, { score: hit.score, spanStart: hit.spanStart });
  }
  const close = standouts(new Map([...best].map(([id, value]) => [id, value.score])), SEMANTIC_MIN_SCORE, SEMANTIC_MIN_LEAD).slice(0, limit).map(([id]) => id);
  if (close.length === 0) return null;
  const rows = new Map(lexical.map((row) => [row.id, row]));
  const missing = close.filter((id) => !rows.has(id));
  if (missing.length > 0) {
    const found = db.prepare(`SELECT e.*, t.body FROM stored_file_entries e LEFT JOIN search_db.search_documents t ON t.source = 'file' AND t.source_id = e.id
      WHERE e.owner_key = ? AND e.deleted_at IS NULL AND e.id IN (${missing.map(() => '?').join(', ')})`).all(owner, ...missing) as Array<FileRow & { body: string | null }>;
    for (const { body, ...row } of found) {
      const start = best.get(row.id)?.spanStart ?? 0;
      rows.set(row.id, { ...row, hit_at: body ? start + SNIPPET_BEFORE + 1 : 0, body_length: body?.length ?? null, excerpt: body ? body.slice(start, start + SNIPPET_LENGTH) : null });
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
  const terms = parseSearchTerms(query);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new FileStoreError('잘못된 검색 개수야.');
  await refreshFileSearchIndex(owner);
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
  const rows = db.prepare(`SELECT e.*, ${position} AS hit_at, length(t.body) AS body_length,
      CASE WHEN ${position} > 0 THEN substr(t.body, max(${position} - ${SNIPPET_BEFORE}, 1), ${SNIPPET_LENGTH}) END AS excerpt
    FROM stored_file_entries e LEFT JOIN search_db.search_documents t ON t.source = 'file' AND t.source_id = e.id
    WHERE e.owner_key = @owner AND e.deleted_at IS NULL AND ${every} ${scope}
    ORDER BY CASE WHEN ${nameOnly} THEN 0 ELSE 1 END, e.updated_at DESC, e.name_key
    LIMIT @limit`).all(params) as SearchRow[];
  const ranked = (options.semantic ? await withSemanticRows(owner, String(query), limit, scope, params, rows) : null) ?? rows;

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
    return { entry: toEntry(row), path: folderPath(row.parent_id), snippet };
  });
  return { terms, hits, truncated: rows.length > limit };
}
