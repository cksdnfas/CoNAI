import { Database } from 'better-sqlite3';

const GENERAL_PATHS = [
  '$.general',
  '$.tagger.general',
  '$.kaloscope.general',
  '$.kaloscope.artists',
  '$.kaloscope.artist',
] as const;

const CHARACTER_PATHS = [
  '$.character',
  '$.tagger.character',
] as const;

const MODEL_PATHS = [
  '$.model',
  '$.tagger.model',
  '$.kaloscope.model',
] as const;

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

function normalizeAutoTagSearchTerm(term: string): string[] {
  const variants: Set<string> = new Set();
  const normalized = term.trim().toLowerCase();

  if (!normalized) return [];

  variants.add(normalized);

  if (normalized.includes('_')) {
    variants.add(normalized.replace(/_/g, ' '));
    variants.add(normalized.replace(/_/g, ''));
  }

  if (normalized.includes(' ')) {
    variants.add(normalized.replace(/ /g, '_'));
    variants.add(normalized.replace(/ /g, ''));
  }

  if (normalized.includes('-')) {
    variants.add(normalized.replace(/-/g, '_'));
    variants.add(normalized.replace(/-/g, ' '));
    variants.add(normalized.replace(/-/g, ''));
  }

  return Array.from(variants);
}

function readJsonPath(source: Record<string, unknown>, jsonPath: string): unknown {
  return jsonPath
    .replace(/^\$\.?/, '')
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((current, key) => isRecord(current) ? current[key] : undefined, source);
}

function scoreOrNull(value: unknown): number | null {
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
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
    if (!normalizeKey(tagKey)) {
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
  if (typeof value !== 'string' || !normalizeKey(value)) {
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

function parseAutoTags(autoTagsJson: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(autoTagsJson);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractEntries(compositeHash: string, autoTagsJson: string): AutoTagIndexEntry[] {
  const parsed = parseAutoTags(autoTagsJson);
  if (!parsed) {
    return [];
  }

  const entries: AutoTagIndexEntry[] = [];

  for (const sourcePath of GENERAL_PATHS) {
    addObjectEntries(entries, compositeHash, 'general', sourcePath, readJsonPath(parsed, sourcePath));
  }
  for (const sourcePath of CHARACTER_PATHS) {
    addObjectEntries(entries, compositeHash, 'character', sourcePath, readJsonPath(parsed, sourcePath));
  }
  for (const sourcePath of MODEL_PATHS) {
    addModelEntry(entries, compositeHash, sourcePath, readJsonPath(parsed, sourcePath));
  }

  return entries;
}

function createSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_auto_tag_index (
      composite_hash TEXT NOT NULL,
      tag_type TEXT NOT NULL CHECK (tag_type IN ('general', 'character', 'model')),
      source_path TEXT NOT NULL,
      tag_key TEXT NOT NULL,
      normalized_tag_key TEXT NOT NULL,
      search_key TEXT NOT NULL,
      score REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (composite_hash, tag_type, source_path, search_key),
      FOREIGN KEY (composite_hash) REFERENCES media_metadata(composite_hash) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_media_auto_tag_lookup
      ON media_auto_tag_index(tag_type, search_key, score, composite_hash);

    CREATE INDEX IF NOT EXISTS idx_media_auto_tag_hash_type
      ON media_auto_tag_index(composite_hash, tag_type);
  `);
}

function backfill(db: Database): number {
  const rows = db.prepare(`
    SELECT composite_hash, auto_tags
    FROM media_metadata
    WHERE auto_tags IS NOT NULL
  `).all() as Array<{ composite_hash: string; auto_tags: string }>;

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

  let inserted = 0;
  const runBackfill = db.transaction(() => {
    for (const row of rows) {
      for (const entry of extractEntries(row.composite_hash, row.auto_tags)) {
        const normalizedTagKey = normalizeKey(entry.tagKey);
        for (const searchKey of normalizeAutoTagSearchTerm(entry.tagKey)) {
          const result = insert.run(
            entry.compositeHash,
            entry.tagType,
            entry.sourcePath,
            entry.tagKey,
            normalizedTagKey,
            searchKey,
            entry.score,
          );
          inserted += Number(result.changes || 0);
        }
      }
    }
  });

  runBackfill();
  return inserted;
}

export const up = async (db: Database): Promise<void> => {
  console.log('🔄 Running migration: 022_add_media_auto_tag_index.ts');

  createSchema(db);
  const existing = db.prepare('SELECT COUNT(*) AS count FROM media_auto_tag_index').get() as { count: number };
  if (existing.count === 0) {
    const inserted = backfill(db);
    console.log(`✅ Backfilled media_auto_tag_index rows: ${inserted}`);
  } else {
    console.log(`✓ media_auto_tag_index already has ${existing.count} rows; skipping backfill`);
  }
};

export const down = async (db: Database): Promise<void> => {
  console.log('🔄 Rolling back migration: 022_add_media_auto_tag_index.ts');
  db.exec(`
    DROP INDEX IF EXISTS idx_media_auto_tag_hash_type;
    DROP INDEX IF EXISTS idx_media_auto_tag_lookup;
    DROP TABLE IF EXISTS media_auto_tag_index;
  `);
};

