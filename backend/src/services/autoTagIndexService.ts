import type Database from 'better-sqlite3';
import { db } from '../database/init';
import {
  AUTO_TAG_CHARACTER_JSON_PATHS,
  AUTO_TAG_GENERAL_JSON_PATHS,
  AUTO_TAG_MODEL_JSON_PATHS,
} from './autoTagSqlShared';
import { canonicalAutoTagSearchKey } from './autoTagSearch/autoTagSearchTerms';

type AutoTagIndexType = 'general' | 'character' | 'model';

type AutoTagIndexEntry = {
  compositeHash: string;
  tagType: AutoTagIndexType;
  sourcePath: string;
  tagKey: string;
  score: number | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function scoreOrNull(value: unknown): number | null {
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function readJsonPath(source: Record<string, unknown>, jsonPath: string): unknown {
  return jsonPath
    .replace(/^\$\.?/, '')
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((current, key) => isRecord(current) ? current[key] : undefined, source);
}

function addObjectEntries(
  entries: AutoTagIndexEntry[],
  compositeHash: string,
  tagType: AutoTagIndexType,
  sourcePath: string,
  value: unknown,
): void {
  if (!isRecord(value)) {
    return;
  }

  for (const [tagKey, score] of Object.entries(value)) {
    const normalized = normalizeKey(tagKey);
    if (!normalized) {
      continue;
    }

    entries.push({
      compositeHash,
      tagType,
      sourcePath,
      tagKey,
      score: scoreOrNull(score),
    });
  }
}

function addModelEntry(
  entries: AutoTagIndexEntry[],
  compositeHash: string,
  sourcePath: string,
  value: unknown,
): void {
  if (typeof value !== 'string') {
    return;
  }

  const normalized = normalizeKey(value);
  if (!normalized) {
    return;
  }

  entries.push({
    compositeHash,
    tagType: 'model',
    sourcePath,
    tagKey: value,
    score: null,
  });
}

function parseAutoTags(autoTagsJson: string | null | undefined): Record<string, unknown> | null {
  if (!autoTagsJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(autoTagsJson);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractEntries(compositeHash: string, autoTagsJson: string | null | undefined): AutoTagIndexEntry[] {
  const parsed = parseAutoTags(autoTagsJson);
  if (!parsed) {
    return [];
  }

  const entries: AutoTagIndexEntry[] = [];

  for (const sourcePath of AUTO_TAG_GENERAL_JSON_PATHS) {
    addObjectEntries(entries, compositeHash, 'general', sourcePath, readJsonPath(parsed, sourcePath));
  }
  for (const sourcePath of AUTO_TAG_CHARACTER_JSON_PATHS) {
    addObjectEntries(entries, compositeHash, 'character', sourcePath, readJsonPath(parsed, sourcePath));
  }
  for (const sourcePath of AUTO_TAG_MODEL_JSON_PATHS) {
    addModelEntry(entries, compositeHash, sourcePath, readJsonPath(parsed, sourcePath));
  }

  return entries;
}

/** Column that keys a media row in media_auto_tags (media_metadata's integer row id). */
export const MEDIA_ROW_ID_COLUMN = 'rowid';

export type IndexedMediaSubqueryOptions = {
  tagTypes: readonly string[];
  /** Raw tag text; matched through its canonical search key. Omit to match any tag of these types. */
  tag?: string;
  minScore?: number;
  maxScore?: number;
};

/**
 * `SELECT mat.media_id ...` over the auto-tag index for one tag filter, or null when the tag normalizes to nothing.
 * Callers wrap it as `<alias>.<MEDIA_ROW_ID_COLUMN> IN (...)`; the `t.` / `mat.` aliases are part of the contract
 * (AutoTagSearchService rewrites the IN form into a correlated EXISTS for ordered scans).
 */
export function buildIndexedMediaSubquery(options: IndexedMediaSubqueryOptions): { sql: string; params: unknown[] } | null {
  const params: unknown[] = [...options.tagTypes];
  const predicates = [`t.tag_type IN (${options.tagTypes.map(() => '?').join(', ')})`];

  if (options.tag !== undefined) {
    const searchKey = canonicalAutoTagSearchKey(options.tag);
    if (!searchKey) {
      return null;
    }
    predicates.push('t.search_key = ?');
    params.push(searchKey);
  }
  if (options.minScore !== undefined) {
    predicates.push('mat.score >= ?');
    params.push(options.minScore);
  }
  if (options.maxScore !== undefined) {
    predicates.push('mat.score <= ?');
    params.push(options.maxScore);
  }

  return {
    sql: `SELECT mat.media_id FROM media_auto_tags mat JOIN auto_tag_terms t ON t.term_id = mat.term_id WHERE ${predicates.join(' AND ')}`,
    params,
  };
}

let statements: {
  findMedia: Database.Statement;
  deleteForMedia: Database.Statement;
  findTerm: Database.Statement;
  insertTerm: Database.Statement;
  insertTag: Database.Statement;
} | null = null;

function prepared() {
  statements ??= {
    findMedia: db.prepare(`SELECT ${MEDIA_ROW_ID_COLUMN} AS media_id FROM media_metadata WHERE composite_hash = ?`),
    deleteForMedia: db.prepare('DELETE FROM media_auto_tags WHERE media_id = ?'),
    findTerm: db.prepare('SELECT term_id FROM auto_tag_terms WHERE tag_type = ? AND source_path = ? AND tag_key = ?'),
    insertTerm: db.prepare('INSERT INTO auto_tag_terms (tag_type, source_path, tag_key, search_key) VALUES (?, ?, ?, ?)'),
    insertTag: db.prepare('INSERT OR IGNORE INTO media_auto_tags (term_id, media_id, score) VALUES (?, ?, ?)'),
  };
  return statements;
}

function resolveTermId(entry: AutoTagIndexEntry, searchKey: string): number {
  const { findTerm, insertTerm } = prepared();
  const existing = findTerm.get(entry.tagType, entry.sourcePath, entry.tagKey) as { term_id: number } | undefined;
  if (existing) {
    return existing.term_id;
  }
  return Number(insertTerm.run(entry.tagType, entry.sourcePath, entry.tagKey, searchKey).lastInsertRowid);
}

export class AutoTagIndexService {
  static tableName = 'media_auto_tags';

  static hasIndexTable(): boolean {
    const row = db.prepare(`
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
      LIMIT 1
    `).get(this.tableName);

    return Boolean(row);
  }

  static syncForHash(compositeHash: string, autoTagsJson: string | null | undefined): void {
    if (!this.hasIndexTable()) {
      return;
    }

    const entries = extractEntries(compositeHash, autoTagsJson);
    const sync = db.transaction(() => {
      const { findMedia, deleteForMedia, insertTag } = prepared();
      const media = findMedia.get(compositeHash) as { media_id: number } | undefined;
      if (!media) {
        return;
      }

      deleteForMedia.run(media.media_id);
      for (const entry of entries) {
        const searchKey = canonicalAutoTagSearchKey(entry.tagKey);
        if (!searchKey) {
          continue;
        }
        insertTag.run(resolveTermId(entry, searchKey), media.media_id, entry.score);
      }
    });

    sync();
  }

  /** Move every tag row of one media row to another (hash regeneration). Rows the target already has are dropped. */
  static remapMedia(fromMediaId: number, toMediaId: number): void {
    if (fromMediaId === toMediaId || !this.hasIndexTable()) {
      return;
    }

    db.prepare('UPDATE OR IGNORE media_auto_tags SET media_id = ? WHERE media_id = ?').run(toMediaId, fromMediaId);
    prepared().deleteForMedia.run(fromMediaId);
  }

  static clearAll(): void {
    if (!this.hasIndexTable()) {
      return;
    }

    db.transaction(() => {
      db.prepare('DELETE FROM media_auto_tags').run();
      db.prepare('DELETE FROM auto_tag_terms').run();
    })();
  }
}

