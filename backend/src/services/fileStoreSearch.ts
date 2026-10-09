import fs from 'fs';
import path from 'path';
import type { StoredFileSearchResult } from '@conai/shared';
import { getUserSettingsDb } from '../database/userSettingsDb';
import { storedFilePath } from './fileStorePaths';
import { FileStoreError, TEXT_EXTENSIONS, toEntry, type FileRow } from './fileStoreService';

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

/**
 * Files and folders of one store whose name or text contains every term (case-insensitive for ASCII), name hits
 * first, then the most recently changed.
 */
export async function searchStoredFiles(owner: string, query: unknown, limit = 50): Promise<StoredFileSearchResult> {
  const terms = parseSearchTerms(query);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new FileStoreError('잘못된 검색 개수야.');
  await refreshFileSearchIndex(owner);
  const db = getUserSettingsDb();
  const params: Record<string, string | number> = { owner, limit: limit + 1 };
  terms.forEach((term, index) => { params[`t${index}`] = term; });
  const inName = (index: number) => `instr(lower(e.name), @t${index}) > 0`;
  const inBody = (index: number) => `instr(lower(t.body), @t${index}) > 0`;
  const every = terms.map((_, index) => `(${inName(index)} OR ${inBody(index)})`).join(' AND ');
  const nameOnly = terms.map((_, index) => inName(index)).join(' AND ');
  // The excerpt starts a little before the first term that occurs in the text.
  const position = `CASE ${terms.map((_, index) => `WHEN ${inBody(index)} THEN instr(lower(t.body), @t${index})`).join(' ')} ELSE 0 END`;
  const rows = db.prepare(`SELECT e.*, ${position} AS hit_at, length(t.body) AS body_length,
      CASE WHEN ${position} > 0 THEN substr(t.body, max(${position} - ${SNIPPET_BEFORE}, 1), ${SNIPPET_LENGTH}) END AS excerpt
    FROM stored_file_entries e LEFT JOIN search_db.search_documents t ON t.source = 'file' AND t.source_id = e.id
    WHERE e.owner_key = @owner AND e.deleted_at IS NULL AND ${every}
    ORDER BY CASE WHEN ${nameOnly} THEN 0 ELSE 1 END, e.updated_at DESC, e.name_key
    LIMIT @limit`).all(params) as Array<FileRow & { hit_at: number; body_length: number | null; excerpt: string | null }>;

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

  const hits = rows.slice(0, limit).map((row) => {
    let snippet: string | null = null;
    if (row.excerpt) {
      const start = Math.max(row.hit_at - SNIPPET_BEFORE, 1);
      snippet = `${start > 1 ? '…' : ''}${row.excerpt.replace(/\s+/g, ' ').trim()}${start + SNIPPET_LENGTH <= (row.body_length ?? 0) ? '…' : ''}`;
    }
    return { entry: toEntry(row), path: folderPath(row.parent_id), snippet };
  });
  return { terms, hits, truncated: rows.length > limit };
}
