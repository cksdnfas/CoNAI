import zlib from 'zlib';
import type { Database } from 'better-sqlite3';

/**
 * Rebuild media_metadata with an explicit `media_id INTEGER PRIMARY KEY AUTOINCREMENT` (= the old implicit rowid,
 * value for value) and move `color_histogram` (~70% of the row, ~8KB of JSON) into `media_image_features` as a
 * compact BLOB.
 *
 * Why the explicit key: the FTS5 external-content index `media_prompt_fts` and `media_auto_tags` (040) both point at
 * media_metadata's rowid. On a table without an INTEGER PRIMARY KEY, VACUUM may renumber rowids, which would silently
 * detach both. An INTEGER PRIMARY KEY is the rowid and VACUUM keeps it. AUTOINCREMENT keeps ids from being reused
 * after deletes, so nothing keyed by media_id can ever point at a different image.
 *
 * Why it is a rebuild: SQLite cannot change a table's primary key in place. Migrations run inside one transaction with
 * foreign_keys ON (it cannot be turned off there), so DROP TABLE media_metadata would CASCADE-delete image_groups,
 * auto_folder_group_images and image_models and SET NULL image_files.composite_hash. Every FK child is therefore
 * copied to TEMP first and restored afterwards (the 036 pattern), with the children's triggers held off while their
 * rows go out and come back so no auto-tag state changes.
 *
 * Triggers and indexes on media_metadata are re-created from their exact stored SQL, so the FTS sync triggers keep the
 * byte-identical text expressions the index was built with. The FTS index itself is untouched: rowids do not change.
 *
 * Migration files cannot import project modules; the histogram encoder below is a copy of
 * services/imageSimilarity.ts encodeColorHistogram. Keep the byte layout identical.
 */

const BATCH_SIZE = 500;
const NEW_TABLE = 'media_metadata_v041';
const HIST_STAGE = '_mig041_histograms';

/** Final column list in order, without media_id and color_histogram. */
const COLUMNS: ReadonlyArray<[name: string, definition: string]> = [
  ['composite_hash', 'TEXT NOT NULL UNIQUE'],
  ['perceptual_hash', 'TEXT'],
  ['dhash', 'TEXT'],
  ['ahash', 'TEXT'],
  ['width', 'INTEGER'],
  ['height', 'INTEGER'],
  ['thumbnail_path', 'TEXT'],
  ['ai_tool', 'TEXT'],
  ['model_name', 'TEXT'],
  ['lora_models', 'TEXT'],
  ['steps', 'INTEGER'],
  ['cfg_scale', 'REAL'],
  ['sampler', 'TEXT'],
  ['seed', 'INTEGER'],
  ['scheduler', 'TEXT'],
  ['prompt', 'TEXT'],
  ['negative_prompt', 'TEXT'],
  ['denoise_strength', 'REAL'],
  ['generation_time', 'REAL'],
  ['batch_size', 'INTEGER'],
  ['batch_index', 'INTEGER'],
  ['auto_tags', 'TEXT'],
  ['duration', 'REAL'],
  ['fps', 'REAL'],
  ['video_codec', 'TEXT'],
  ['audio_codec', 'TEXT'],
  ['bitrate', 'INTEGER'],
  ['rating_score', 'INTEGER'],
  ['first_seen_date', 'DATETIME DEFAULT CURRENT_TIMESTAMP'],
  ['metadata_updated_date', 'DATETIME DEFAULT CURRENT_TIMESTAMP'],
  ['postprocess_status', "TEXT NOT NULL DEFAULT 'ready'"],
  ['postprocess_completed_at', 'DATETIME DEFAULT NULL'],
  ['raw_nai_parameters', 'TEXT DEFAULT NULL'],
  ['character_prompt_text', 'TEXT DEFAULT NULL'],
  ['auto_tag_state', 'TEXT DEFAULT NULL'],
  ['model_references', 'TEXT'],
  ['prompt_similarity_algorithm', 'TEXT DEFAULT NULL'],
  ['prompt_similarity_version', 'INTEGER DEFAULT NULL'],
  ['pos_prompt_normalized', 'TEXT DEFAULT NULL'],
  ['neg_prompt_normalized', 'TEXT DEFAULT NULL'],
  ['auto_prompt_normalized', 'TEXT DEFAULT NULL'],
  ['pos_prompt_fingerprint', 'TEXT DEFAULT NULL'],
  ['neg_prompt_fingerprint', 'TEXT DEFAULT NULL'],
  ['auto_prompt_fingerprint', 'TEXT DEFAULT NULL'],
  ['prompt_similarity_updated_date', 'DATETIME DEFAULT NULL'],
  ['pixel_hash', 'TEXT DEFAULT NULL'],
];

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function columnNames(db: Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string }>).map((column) => column.name);
}

function count(db: Database, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`).get() as { c: number }).c;
}

// ---- histogram encoder (copy of services/imageSimilarity.ts) ----
const HISTOGRAM_FORMAT_COUNTS = 1;
const HISTOGRAM_FORMAT_JSON = 2;
const HISTOGRAM_FLAG_DESCRIPTOR = 1;
const HISTOGRAM_BINS = 256;
const HISTOGRAM_CHANNELS = ['r', 'g', 'b'] as const;
const HISTOGRAM_DENOMINATOR = 32 * 32;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function descriptorValues(descriptor: any): number[] | null {
  if (!descriptor || typeof descriptor !== 'object') return null;
  const keys = Object.keys(descriptor).sort().join(',');
  if (keys !== 'averageRgb,dominantRgb,luminance,saturation'
    || !Array.isArray(descriptor.averageRgb) || descriptor.averageRgb.length !== 3
    || !Array.isArray(descriptor.dominantRgb) || descriptor.dominantRgb.length !== 3) {
    return null;
  }
  const values = [...descriptor.averageRgb, ...descriptor.dominantRgb, descriptor.luminance, descriptor.saturation];
  return values.every(isFiniteNumber) ? values : null;
}

function encodeHistogramCounts(histogram: any): Buffer | null {
  if (!histogram || typeof histogram !== 'object' || Array.isArray(histogram)) return null;
  const keys = Object.keys(histogram).filter((key) => key !== 'descriptor').sort().join(',');
  if (keys !== 'b,g,r') return null;
  const descriptor = histogram.descriptor === undefined ? null : descriptorValues(histogram.descriptor);
  if (histogram.descriptor !== undefined && !descriptor) return null;

  const counts = Buffer.alloc(HISTOGRAM_BINS * HISTOGRAM_CHANNELS.length * 2);
  for (let channel = 0; channel < HISTOGRAM_CHANNELS.length; channel += 1) {
    const bins = histogram[HISTOGRAM_CHANNELS[channel]];
    if (!Array.isArray(bins) || bins.length !== HISTOGRAM_BINS) return null;
    for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) {
      const value = bins[bin];
      const binCount = Math.round(value * HISTOGRAM_DENOMINATOR);
      if (!isFiniteNumber(value) || binCount < 0 || binCount > 0xffff || binCount / HISTOGRAM_DENOMINATOR !== value) return null;
      counts.writeUInt16LE(binCount, (channel * HISTOGRAM_BINS + bin) * 2);
    }
  }

  const header = Buffer.alloc(4 + (descriptor ? 8 * 8 : 0));
  header[0] = HISTOGRAM_FORMAT_COUNTS;
  header[1] = descriptor ? HISTOGRAM_FLAG_DESCRIPTOR : 0;
  header.writeUInt16LE(HISTOGRAM_DENOMINATOR, 2);
  descriptor?.forEach((value, index) => header.writeDoubleLE(value, 4 + index * 8));
  return Buffer.concat([header, zlib.deflateRawSync(counts)]);
}

/** Encode one stored JSON histogram; text that is not JSON is kept verbatim inside the JSON format. */
export function encodeStoredHistogram(json: string): Buffer {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    parsed = undefined;
  }
  return (parsed !== undefined ? encodeHistogramCounts(parsed) : null)
    ?? Buffer.concat([Buffer.from([HISTOGRAM_FORMAT_JSON]), zlib.deflateRawSync(Buffer.from(json, 'utf8'))]);
}
// ---- end of encoder copy ----

type ChildBackup = {
  table: string;
  column: string;
  onDelete: string;
  backup: string;
  hasIntegerPk: boolean;
  columns: string[];
  rows: number;
};

function rebuild(db: Database): void {
  const oldColumns = columnNames(db, 'media_metadata');
  const expected = new Set(['color_histogram', ...COLUMNS.map(([name]) => name)]);
  const unknown = oldColumns.filter((name) => !expected.has(name));
  const missing = [...expected].filter((name) => !oldColumns.includes(name));
  if (unknown.length > 0 || missing.length > 0) {
    throw new Error(`041: media_metadata 컬럼이 예상과 다릅니다 (모르는 컬럼: ${unknown.join(', ') || '없음'}, 빠진 컬럼: ${missing.join(', ') || '없음'})`);
  }
  if (count(db, 'media_metadata') > 0 && db.prepare('SELECT 1 FROM media_metadata WHERE composite_hash IS NULL LIMIT 1').get()) {
    throw new Error('041: composite_hash 가 NULL 인 media_metadata 행이 있어 재구성할 수 없습니다');
  }

  const mediaCount = count(db, 'media_metadata');

  // Exact SQL of everything that belongs to media_metadata, in creation order.
  const ownTriggers = db.prepare(`
    SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'media_metadata' ORDER BY rowid
  `).all() as Array<{ name: string; sql: string }>;
  const ownIndexes = db.prepare(`
    SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'media_metadata' AND sql IS NOT NULL ORDER BY rowid
  `).all() as Array<{ name: string; sql: string }>;
  const histogramIndex = ownIndexes.find((index) => /color_histogram/i.test(index.sql));
  if (histogramIndex) {
    throw new Error(`041: color_histogram 을 쓰는 인덱스가 있습니다: ${histogramIndex.name}`);
  }

  // FK children and their triggers.
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>)
    .map((row) => row.name);
  const children: ChildBackup[] = [];
  for (const table of tables) {
    const fks = db.prepare(`PRAGMA foreign_key_list(${quoteIdent(table)})`).all() as Array<{ table: string; from: string; to: string; on_delete: string }>;
    for (const fk of fks.filter((item) => item.table === 'media_metadata')) {
      if (fk.to !== 'composite_hash') {
        throw new Error(`041: ${table}.${fk.from} 가 media_metadata.${fk.to} 를 참조합니다 (composite_hash 만 지원)`);
      }
      const tableInfo = db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as Array<{ name: string; type: string; pk: number }>;
      const pkColumns = tableInfo.filter((column) => column.pk > 0);
      children.push({
        table,
        column: fk.from,
        onDelete: fk.on_delete.toUpperCase(),
        backup: `_mig041_child_${children.length}`,
        hasIntegerPk: pkColumns.length === 1 && pkColumns[0].type.toUpperCase() === 'INTEGER',
        columns: tableInfo.map((column) => column.name),
        rows: count(db, table),
      });
    }
  }
  // Emptying a child would cascade into its own children; none exist today, refuse rather than lose rows.
  const emptiedChildren = new Set(children.filter((child) => child.onDelete !== 'SET NULL').map((child) => child.table));
  for (const table of tables) {
    const fks = db.prepare(`PRAGMA foreign_key_list(${quoteIdent(table)})`).all() as Array<{ table: string }>;
    const parent = fks.find((fk) => emptiedChildren.has(fk.table));
    if (parent) {
      throw new Error(`041: ${table} 가 ${parent.table} 를 참조합니다 (재구성 중 함께 지워질 수 있음)`);
    }
  }

  const childTriggers = db.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND tbl_name IN (${children.map(() => '?').join(', ') || "''"}) ORDER BY rowid
  `).all(...children.map((child) => child.table)) as Array<{ name: string; sql: string }>;
  const otherTriggersReferencing = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type IN ('trigger', 'view') AND sql LIKE '%media_metadata%'
      AND tbl_name != 'media_metadata' AND tbl_name NOT IN (${children.map(() => '?').join(', ') || "''"})
  `).all(...children.map((child) => child.table)) as Array<{ name: string }>;
  if (otherTriggersReferencing.length > 0) {
    throw new Error(`041: media_metadata 를 참조하는 다른 트리거/뷰가 있습니다: ${otherTriggersReferencing.map((row) => row.name).join(', ')}`);
  }

  // 1. Stage the histograms in their new encoding (the old table is gone by the time media_image_features exists).
  db.exec(`DROP TABLE IF EXISTS temp.${HIST_STAGE}`);
  db.exec(`CREATE TEMP TABLE ${HIST_STAGE} (media_id INTEGER PRIMARY KEY, color_histogram BLOB NOT NULL)`);
  const selectHistograms = db.prepare(`
    SELECT rowid AS media_id, color_histogram FROM main.media_metadata
    WHERE rowid > ? AND color_histogram IS NOT NULL
    ORDER BY rowid LIMIT ${BATCH_SIZE}
  `);
  const stageHistogram = db.prepare(`INSERT INTO temp.${HIST_STAGE} (media_id, color_histogram) VALUES (?, ?)`);
  let cursor = 0;
  for (;;) {
    const rows = selectHistograms.all(cursor) as Array<{ media_id: number; color_histogram: string | Buffer }>;
    if (rows.length === 0) break;
    for (const row of rows) {
      const value = typeof row.color_histogram === 'string' ? encodeStoredHistogram(row.color_histogram) : row.color_histogram;
      stageHistogram.run(row.media_id, value);
    }
    cursor = rows[rows.length - 1].media_id;
  }

  // 2. Copy the FK children out, then empty the CASCADE ones with their triggers held off.
  for (const trigger of childTriggers) db.exec(`DROP TRIGGER ${quoteIdent(trigger.name)}`);
  for (const child of children) {
    db.exec(`DROP TABLE IF EXISTS temp.${child.backup}`);
    if (child.onDelete === 'SET NULL') {
      db.exec(`
        CREATE TEMP TABLE ${child.backup} AS
        SELECT rowid AS rid, ${quoteIdent(child.column)} AS hash FROM main.${quoteIdent(child.table)}
        WHERE ${quoteIdent(child.column)} IS NOT NULL
      `);
    } else {
      db.exec(`CREATE TEMP TABLE ${child.backup} AS SELECT rowid AS __rid, * FROM main.${quoteIdent(child.table)}`);
      db.exec(`DELETE FROM main.${quoteIdent(child.table)}`);
    }
  }

  // 3. New table, same rows and row ids.
  db.exec(`DROP TABLE IF EXISTS main.${NEW_TABLE}`);
  db.exec(`
    CREATE TABLE ${NEW_TABLE} (
      media_id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${COLUMNS.map(([name, definition]) => `${name} ${definition}`).join(',\n      ')}
    )
  `);
  const columnList = COLUMNS.map(([name]) => quoteIdent(name)).join(', ');
  db.exec(`INSERT INTO main.${NEW_TABLE} (media_id, ${columnList}) SELECT rowid, ${columnList} FROM main.media_metadata ORDER BY rowid`);

  // 4. Swap. The old table's own triggers go first so the drop fires nothing but the FK actions (SET NULL above).
  for (const trigger of ownTriggers) db.exec(`DROP TRIGGER ${quoteIdent(trigger.name)}`);
  db.exec('DROP TABLE main.media_metadata');
  db.exec(`ALTER TABLE main.${NEW_TABLE} RENAME TO media_metadata`);
  for (const index of ownIndexes) db.exec(index.sql);
  for (const trigger of ownTriggers) db.exec(trigger.sql);

  // 5. Side table for image-similarity features.
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_image_features (
      media_id INTEGER PRIMARY KEY REFERENCES media_metadata(media_id) ON DELETE CASCADE,
      color_histogram BLOB NOT NULL
    )
  `);
  db.exec(`INSERT INTO main.media_image_features (media_id, color_histogram) SELECT media_id, color_histogram FROM temp.${HIST_STAGE} ORDER BY media_id`);

  // 6. Children back, then their triggers.
  for (const child of children) {
    if (child.onDelete === 'SET NULL') {
      db.exec(`
        UPDATE main.${quoteIdent(child.table)}
        SET ${quoteIdent(child.column)} = b.hash
        FROM temp.${child.backup} b
        WHERE main.${quoteIdent(child.table)}.rowid = b.rid
          AND b.hash IN (SELECT composite_hash FROM main.media_metadata)
      `);
    } else {
      const list = child.columns.map(quoteIdent).join(', ');
      const targetList = child.hasIntegerPk ? list : `rowid, ${list}`;
      const sourceList = child.hasIntegerPk ? list : `__rid, ${list}`;
      db.exec(`INSERT INTO main.${quoteIdent(child.table)} (${targetList}) SELECT ${sourceList} FROM temp.${child.backup} ORDER BY __rid`);
    }
  }
  for (const trigger of childTriggers) db.exec(trigger.sql);

  // 7. Nothing may have been lost on the way.
  if (count(db, 'media_metadata') !== mediaCount) {
    throw new Error('041: media_metadata 행 수가 재구성 전후로 다릅니다');
  }
  for (const child of children) {
    if (count(db, child.table) !== child.rows) {
      throw new Error(`041: ${child.table} 행 수가 재구성 전후로 다릅니다`);
    }
    if (child.onDelete === 'SET NULL') {
      const restored = (db.prepare(`SELECT COUNT(*) AS c FROM main.${quoteIdent(child.table)} WHERE ${quoteIdent(child.column)} IS NOT NULL`).get() as { c: number }).c;
      if (restored !== count(db, child.backup)) {
        throw new Error(`041: ${child.table}.${child.column} 연결이 재구성 전후로 다릅니다`);
      }
    }
  }
  const staged = count(db, HIST_STAGE);
  if (count(db, 'media_image_features') !== staged) {
    throw new Error('041: 색상 히스토그램 이전 개수가 맞지 않습니다');
  }

  for (const child of children) db.exec(`DROP TABLE temp.${child.backup}`);
  db.exec(`DROP TABLE temp.${HIST_STAGE}`);
  console.log(`  ✅ media_metadata rebuilt with media_id (${mediaCount} rows, ${staged} histograms moved, ${children.length} FK children restored)`);
}

export const up = async (db: Database): Promise<void> => {
  if (columnNames(db, 'media_metadata').includes('media_id')) {
    return;
  }
  rebuild(db);
};

export const down = async (_db: Database): Promise<void> => {
  // Going back means another full rebuild of media_metadata (and decoding every histogram back to JSON); the explicit
  // media_id keeps the old row ids, so older code that only reads rowid still works against the new shape except
  // for color_histogram. Not supported.
  throw new Error('041 cannot be rolled back');
};
