import { db } from '../database/init';
import {
  AUTO_TAG_CHARACTER_JSON_PATHS,
  AUTO_TAG_GENERAL_JSON_PATHS,
  AUTO_TAG_MODEL_JSON_PATHS,
} from './autoTagSqlShared';
import { normalizeAutoTagSearchTerm } from './autoTagSearch/autoTagSearchTerms';

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

function buildSearchKeys(tagKey: string): string[] {
  return normalizeAutoTagSearchTerm(tagKey, true);
}

export class AutoTagIndexService {
  static tableName = 'media_auto_tag_index';

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
      db.prepare(`DELETE FROM media_auto_tag_index WHERE composite_hash = ?`).run(compositeHash);

      if (entries.length === 0) {
        return;
      }

      const insert = db.prepare(`
        INSERT OR IGNORE INTO media_auto_tag_index (
          composite_hash,
          tag_type,
          source_path,
          tag_key,
          normalized_tag_key,
          search_key,
          score
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const entry of entries) {
        const normalizedTagKey = normalizeKey(entry.tagKey);
        for (const searchKey of buildSearchKeys(entry.tagKey)) {
          insert.run(
            entry.compositeHash,
            entry.tagType,
            entry.sourcePath,
            entry.tagKey,
            normalizedTagKey,
            searchKey,
            entry.score,
          );
        }
      }
    });

    sync();
  }

  static clearAll(): void {
    if (!this.hasIndexTable()) {
      return;
    }

    db.prepare('DELETE FROM media_auto_tag_index').run();
  }
}

