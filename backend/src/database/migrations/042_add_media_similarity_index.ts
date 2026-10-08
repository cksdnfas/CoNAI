import zlib from 'zlib';
import type { Database } from 'better-sqlite3';

/**
 * `media_similarity_index`: a narrow, integer-only copy of what similarity search compares, one row per media row.
 *
 * - pHash / dHash / aHash as two unsigned 32-bit halves each, so SQL computes Hamming distances without loading rows
 *   into JS, plus the pHash split into four indexed 16-bit bands. Multi-index hashing: two hashes within distance t
 *   share a band within distance floor(t / 4), so a duplicate/similar search probes a few thousand band values
 *   instead of reading the whole library.
 * - SimHash prompt fingerprints (positive / negative / auto) as halves for the same reason (prompt similarity).
 * - The colour descriptor that colour similarity scores (average / dominant RGB, luminance, saturation), so the
 *   colour search filters in SQL and decodes histograms only for real candidates.
 *
 * Hash and fingerprint columns are kept in sync by triggers on media_metadata written in plain SQL (no JS functions),
 * so every writer and every connection (user.db attaches images.db) keeps the index right. The descriptor comes from
 * the histogram BLOB, which only MediaImageFeaturesModel.setHistogram writes; it updates these columns too.
 *
 * Migration files cannot import project modules: the histogram decoding and descriptor maths below are copies of
 * services/imageSimilarity.ts (decodeColorHistogram / buildColorDescriptor). Keep them identical.
 *
 * A future rebuild of media_metadata (the 041 pattern: DROP, then RENAME the copy) must drop the view
 * media_similarity_source and the three triggers first and re-create them afterwards: RENAME re-checks every view
 * and trigger, and this view points at the dropped table in between. The index rows themselves survive (they key on
 * media_id, which a rebuild keeps).
 */

const BATCH_SIZE = 500;

const HEX_DIGITS = '0123456789abcdef';

/** SQL: integer value of `length` hex digits of `column` starting at 1-based `start` (validity checked separately). */
function hexValueSql(column: string, start: number, length: number): string {
  const terms: string[] = [];
  for (let index = 0; index < length; index += 1) {
    const weight = 16 ** (length - 1 - index);
    terms.push(`(instr('${HEX_DIGITS}', lower(substr(${column}, ${start + index}, 1))) - 1) * ${weight}`);
  }
  return `(${terms.join(' + ')})`;
}

/** SQL: TRUE when `column` is exactly 16 hex digits. */
function isHex16Sql(column: string): string {
  return `(length(${column}) = 16 AND ${column} NOT GLOB '*[^0-9a-fA-F]*')`;
}

function whenHex16(column: string, value: string, extraCondition?: string): string {
  return `CASE WHEN ${extraCondition ? `${extraCondition} AND ` : ''}${isHex16Sql(column)} THEN ${value} END`;
}

/** Stored hash columns of media_similarity_index → SQL over a media_metadata row aliased `mm`. */
function similarityIndexHashColumns(): Array<[string, string]> {
  const hash = (column: string) => `mm.${column}`;
  const simhash = `mm.prompt_similarity_algorithm = 'simhash'`;
  const pairs: Array<[string, string]> = [];
  const halves = (prefix: string, column: string, condition?: string) => {
    pairs.push([`${prefix}_hi`, whenHex16(hash(column), hexValueSql(hash(column), 1, 8), condition)]);
    pairs.push([`${prefix}_lo`, whenHex16(hash(column), hexValueSql(hash(column), 9, 8), condition)]);
  };
  halves('p', 'perceptual_hash');
  halves('d', 'dhash');
  halves('a', 'ahash');
  halves('pos', 'pos_prompt_fingerprint', simhash);
  halves('neg', 'neg_prompt_fingerprint', simhash);
  halves('auto', 'auto_prompt_fingerprint', simhash);
  // 1 when a SimHash row carries a fingerprint the halves cannot represent: those rows are always scored in JS.
  const unparsable = ['pos_prompt_fingerprint', 'neg_prompt_fingerprint', 'auto_prompt_fingerprint']
    .map((column) => `(${hash(column)} IS NOT NULL AND NOT ${isHex16Sql(hash(column))})`)
    .join(' OR ');
  pairs.push(['prompt_unparsed', `CASE WHEN ${simhash} AND (${unparsable}) THEN 1 ELSE 0 END`]);
  return pairs;
}

const HASH_COLUMN_NAMES = similarityIndexHashColumns().map(([name]) => name);

/**
 * The hex parsing lives once in a view; the triggers and the backfill copy rows out of it, which keeps the schema
 * that every connection parses small.
 */
function sourceViewSql(): string {
  return `
    CREATE VIEW media_similarity_source AS
    SELECT mm.media_id AS media_id,
      ${similarityIndexHashColumns().map(([name, value]) => `${value} AS ${name}`).join(',\n      ')}
    FROM media_metadata mm
  `;
}

function upsertFromSourceSql(where: string): string {
  const columns = HASH_COLUMN_NAMES.join(', ');
  return `
    INSERT INTO media_similarity_index (media_id, ${columns})
    SELECT media_id, ${columns} FROM media_similarity_source WHERE ${where}
    ON CONFLICT(media_id) DO UPDATE SET ${HASH_COLUMN_NAMES.map((name) => `${name} = excluded.${name}`).join(', ')}
  `;
}

// ---- histogram descriptor (copy of services/imageSimilarity.ts) ----
const HISTOGRAM_FORMAT_COUNTS = 1;
const HISTOGRAM_FORMAT_JSON = 2;
const HISTOGRAM_FLAG_DESCRIPTOR = 1;
const HISTOGRAM_BINS = 256;
const HISTOGRAM_CHANNELS = ['r', 'g', 'b'] as const;

type Descriptor = { averageRgb: number[]; dominantRgb: number[]; luminance: number; saturation: number };

function round(value: number, decimals = 2): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

function weightedAverageChannel(channel: number[]): number {
  let weightedSum = 0;
  let total = 0;
  for (let i = 0; i < 256; i++) {
    const weight = Number(channel[i] ?? 0);
    weightedSum += i * weight;
    total += weight;
  }
  return total > 0 ? weightedSum / total : 0;
}

function dominantChannelBin(channel: number[]): number {
  let dominantBin = 0;
  let dominantWeight = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < 256; i++) {
    const weight = Number(channel[i] ?? 0);
    if (weight > dominantWeight) {
      dominantWeight = weight;
      dominantBin = i;
    }
  }
  return dominantBin;
}

function buildColorDescriptor(histogram: Record<string, number[]>): Descriptor {
  const averageRgb = [
    round(weightedAverageChannel(histogram.r)),
    round(weightedAverageChannel(histogram.g)),
    round(weightedAverageChannel(histogram.b)),
  ];
  const dominantRgb = [dominantChannelBin(histogram.r), dominantChannelBin(histogram.g), dominantChannelBin(histogram.b)];
  const normalizedRgb = averageRgb.map(value => value / 255);
  const maxChannel = Math.max(...normalizedRgb);
  const minChannel = Math.min(...normalizedRgb);
  return {
    averageRgb,
    dominantRgb,
    luminance: round(0.2126 * normalizedRgb[0] + 0.7152 * normalizedRgb[1] + 0.0722 * normalizedRgb[2], 4),
    saturation: round(maxChannel === 0 ? 0 : (maxChannel - minChannel) / maxChannel, 4),
  };
}

/** The descriptor the colour score uses for a stored histogram: the embedded one, else computed from the bins. */
export function descriptorFromStoredHistogram(value: Buffer | string): Descriptor | null {
  let histogram: any;
  if (typeof value === 'string') {
    histogram = JSON.parse(value);
  } else if (value[0] === HISTOGRAM_FORMAT_JSON) {
    histogram = JSON.parse(zlib.inflateRawSync(value.subarray(1)).toString('utf8'));
  } else if (value[0] === HISTOGRAM_FORMAT_COUNTS) {
    const hasDescriptor = (value[1] & HISTOGRAM_FLAG_DESCRIPTOR) !== 0;
    if (hasDescriptor) {
      const at = (index: number) => value.readDoubleLE(4 + index * 8);
      return { averageRgb: [at(0), at(1), at(2)], dominantRgb: [at(3), at(4), at(5)], luminance: at(6), saturation: at(7) };
    }
    const denominator = value.readUInt16LE(2);
    const counts = zlib.inflateRawSync(value.subarray(4));
    histogram = {};
    HISTOGRAM_CHANNELS.forEach((channel, channelIndex) => {
      const bins = new Array<number>(HISTOGRAM_BINS);
      for (let bin = 0; bin < HISTOGRAM_BINS; bin += 1) {
        bins[bin] = counts.readUInt16LE((channelIndex * HISTOGRAM_BINS + bin) * 2) / denominator;
      }
      histogram[channel] = bins;
    });
  } else {
    return null;
  }
  if (!histogram || typeof histogram !== 'object') return null;
  return histogram.descriptor ?? buildColorDescriptor(histogram);
}

/** Descriptor columns in table order; null when any value is not a finite number (such rows are scored in JS). */
export function descriptorColumnValues(descriptor: Descriptor | null): number[] | null {
  if (!descriptor || !Array.isArray(descriptor.averageRgb) || !Array.isArray(descriptor.dominantRgb)) return null;
  const values = [...descriptor.averageRgb.slice(0, 3), ...descriptor.dominantRgb.slice(0, 3), descriptor.luminance, descriptor.saturation];
  return values.length === 8 && values.every((item) => typeof item === 'number' && Number.isFinite(item)) ? values : null;
}
// ---- end of copy ----

const TRIGGERS = ['trg_media_similarity_index_insert', 'trg_media_similarity_index_update', 'trg_media_similarity_index_delete'];

export const up = async (db: Database): Promise<void> => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_similarity_index (
      media_id INTEGER PRIMARY KEY REFERENCES media_metadata(media_id) ON DELETE CASCADE,
      p_hi INTEGER, p_lo INTEGER,
      p_b0 INTEGER GENERATED ALWAYS AS (p_hi >> 16) VIRTUAL,
      p_b1 INTEGER GENERATED ALWAYS AS (p_hi & 65535) VIRTUAL,
      p_b2 INTEGER GENERATED ALWAYS AS (p_lo >> 16) VIRTUAL,
      p_b3 INTEGER GENERATED ALWAYS AS (p_lo & 65535) VIRTUAL,
      d_hi INTEGER, d_lo INTEGER,
      a_hi INTEGER, a_lo INTEGER,
      pos_hi INTEGER, pos_lo INTEGER,
      neg_hi INTEGER, neg_lo INTEGER,
      auto_hi INTEGER, auto_lo INTEGER,
      prompt_unparsed INTEGER NOT NULL DEFAULT 0,
      avg_r REAL, avg_g REAL, avg_b REAL,
      dom_r REAL, dom_g REAL, dom_b REAL,
      luminance REAL, saturation REAL
    );
    CREATE INDEX IF NOT EXISTS idx_media_similarity_p_b0 ON media_similarity_index(p_b0);
    CREATE INDEX IF NOT EXISTS idx_media_similarity_p_b1 ON media_similarity_index(p_b1);
    CREATE INDEX IF NOT EXISTS idx_media_similarity_p_b2 ON media_similarity_index(p_b2);
    CREATE INDEX IF NOT EXISTS idx_media_similarity_p_b3 ON media_similarity_index(p_b3);
    -- Covering index for the colour prefilter: a luminance range scan that never touches the table rows.
    CREATE INDEX IF NOT EXISTS idx_media_similarity_color
      ON media_similarity_index(luminance, avg_r, avg_g, avg_b, dom_r, dom_g, dom_b, saturation)
      WHERE luminance IS NOT NULL;
  `);

  for (const name of TRIGGERS) db.exec(`DROP TRIGGER IF EXISTS ${name}`);
  db.exec('DROP VIEW IF EXISTS media_similarity_source');
  db.exec(sourceViewSql());
  db.exec(`
    CREATE TRIGGER trg_media_similarity_index_insert
    AFTER INSERT ON media_metadata
    BEGIN
      ${upsertFromSourceSql('media_id = NEW.media_id')};
    END;

    CREATE TRIGGER trg_media_similarity_index_update
    AFTER UPDATE OF perceptual_hash, dhash, ahash, pos_prompt_fingerprint, neg_prompt_fingerprint, auto_prompt_fingerprint,
      prompt_similarity_algorithm ON media_metadata
    BEGIN
      ${upsertFromSourceSql('media_id = NEW.media_id')};
    END;

    CREATE TRIGGER trg_media_similarity_index_delete
    AFTER DELETE ON media_metadata
    BEGIN
      DELETE FROM media_similarity_index WHERE media_id = OLD.media_id;
    END;
  `);

  // Backfill the hash columns for every existing row in one statement (pure SQL).
  db.exec(upsertFromSourceSql('true'));

  // Descriptor columns from the stored histograms, in media_id order.
  const select = db.prepare(`
    SELECT media_id, color_histogram FROM media_image_features
    WHERE media_id > ? ORDER BY media_id LIMIT ${BATCH_SIZE}
  `);
  const update = db.prepare(`
    UPDATE media_similarity_index
    SET avg_r = ?, avg_g = ?, avg_b = ?, dom_r = ?, dom_g = ?, dom_b = ?, luminance = ?, saturation = ?
    WHERE media_id = ?
  `);
  let cursor = 0;
  for (;;) {
    const rows = select.all(cursor) as Array<{ media_id: number; color_histogram: Buffer | string }>;
    if (rows.length === 0) break;
    for (const row of rows) {
      let values: number[] | null = null;
      try {
        values = descriptorColumnValues(descriptorFromStoredHistogram(row.color_histogram));
      } catch {
        values = null; // Undecodable histogram: left NULL, the colour search scores such rows in JS.
      }
      if (values) update.run(...values, row.media_id);
    }
    cursor = rows[rows.length - 1].media_id;
  }
};

export const down = async (db: Database): Promise<void> => {
  for (const name of TRIGGERS) db.exec(`DROP TRIGGER IF EXISTS ${name}`);
  db.exec('DROP VIEW IF EXISTS media_similarity_source');
  db.exec('DROP TABLE IF EXISTS media_similarity_index');
};
