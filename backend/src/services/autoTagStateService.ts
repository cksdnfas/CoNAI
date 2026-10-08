import { db } from '../database/init';

/**
 * Auto-tag pending state (ATAG-1/ATAG-2).
 *
 * `media_metadata.auto_tag_state` + the partial index
 * `idx_media_metadata_auto_tag_pending` (migration 028) replace the unindexable
 * `json_extract` OR chain the scheduler used to scan on every poll.
 *
 * The SQL fragments below intentionally mirror migration 028 one-for-one; the
 * migration cannot import this module because portable/SEA builds ship the
 * compiled migrations directory standalone.
 */

export interface AutoTagStateCapabilities {
  taggerAutoEnabled: boolean;
  kaloscopeAutoEnabled: boolean;
}

const STATE_COLUMN = 'auto_tag_state';
const META_TABLE = 'auto_tag_state_meta';
const PENDING_STATE = 'pending';
const DEFAULT_PRUNE_LIMIT = 500;

// Keep the literal table name so these expressions stay character-for-character
// identical to migration 028.
const CAPABILITY_TAGGER_SQL = `COALESCE((SELECT tagger_enabled FROM auto_tag_state_meta WHERE id = 1), 1) = 1`;
const CAPABILITY_KALOSCOPE_SQL = `COALESCE((SELECT kaloscope_enabled FROM auto_tag_state_meta WHERE id = 1), 1) = 1`;

/** Same meaning as the scheduler's json_extract OR chain, guarded against malformed JSON. */
function needsAutoTagWorkSql(autoTagsExpr: string): string {
  return `(
    ${autoTagsExpr} IS NULL
    OR json_valid(${autoTagsExpr}) = 0
    OR (${CAPABILITY_TAGGER_SQL} AND json_extract(${autoTagsExpr}, '$.tagger') IS NULL)
    OR (${CAPABILITY_KALOSCOPE_SQL} AND json_extract(${autoTagsExpr}, '$.kaloscope') IS NULL)
  )`;
}

/** Same meaning as the scheduler's `image_files` join filter. */
function hasTaggableFileSql(hashExpr: string): string {
  return `EXISTS (
    SELECT 1 FROM image_files f
    WHERE f.composite_hash = ${hashExpr}
      AND f.original_file_path IS NOT NULL
      AND f.file_status = 'active'
  )`;
}

function assertSafeSqlAlias(alias: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error(`Unsafe SQL alias: ${alias}`);
  }
}

// undefined = not probed yet; false = probed and unavailable (legacy/test databases
// without migration 028 keep working through the scheduler's fallback query).
let hasIndexedStateCache: boolean | undefined;
let syncedCapabilitySignature: string | null = null;

function hasMediaMetadataColumn(columnName: string): boolean {
  try {
    const columns = db.prepare(`PRAGMA table_info(media_metadata)`).all() as Array<{ name: string }>;
    return columns.some((column) => column.name === columnName);
  } catch {
    return false;
  }
}

function hasMetaTable(): boolean {
  try {
    return !!db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?
    `).get(META_TABLE);
  } catch {
    return false;
  }
}

function capabilitySignature(capabilities: AutoTagStateCapabilities): string {
  return `${capabilities.taggerAutoEnabled ? 1 : 0}:${capabilities.kaloscopeAutoEnabled ? 1 : 0}`;
}

const COMPLETED_SIGNATURE_KEY = 'auto_tag_state_synced_capabilities';
/** Rows per recompute range; each range is one short write transaction. */
const RECOMPUTE_RANGE_SIZE = 500;
let recomputeInFlight: Promise<void> | null = null;

function readStoredSignature(): string | null {
  const stored = db.prepare(`
    SELECT tagger_enabled, kaloscope_enabled FROM ${META_TABLE} WHERE id = 1
  `).get() as { tagger_enabled: number | null; kaloscope_enabled: number | null } | undefined;
  return stored && stored.tagger_enabled !== null && stored.kaloscope_enabled !== null
    ? `${stored.tagger_enabled ? 1 : 0}:${stored.kaloscope_enabled ? 1 : 0}`
    : null;
}

function readCompletedSignature(): string | null {
  try {
    const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(COMPLETED_SIGNATURE_KEY) as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

function writeCompletedSignature(signature: string): void {
  db.prepare(`
    INSERT INTO system_settings (key, value, description, updated_at)
    VALUES (?, ?, 'auto_tag_state recompute finished for these tagger capabilities', CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `).run(COMPLETED_SIGNATURE_KEY, signature);
}

/**
 * Bring every row's auto_tag_state in line with the capabilities in the meta row, one rowid range per transaction.
 * The SQL reads the capabilities from the meta row itself (CAPABILITY_*_SQL), so a change made mid-run applies to
 * the remaining ranges; the outer loop then repeats the pass for the ranges already done.
 */
async function runCapabilityRecompute(): Promise<void> {
  const rangeEnd = db.prepare(`SELECT rowid AS id FROM media_metadata WHERE rowid > ? ORDER BY rowid LIMIT 1 OFFSET ${RECOMPUTE_RANGE_SIZE - 1}`);
  const promote = db.prepare(`
    UPDATE media_metadata
    SET ${STATE_COLUMN} = 'pending'
    WHERE rowid > ? AND rowid <= ?
      AND ${STATE_COLUMN} IS NOT 'pending'
      AND ${needsAutoTagWorkSql('auto_tags')}
      AND ${hasTaggableFileSql('media_metadata.composite_hash')}
  `);
  const settle = db.prepare(`
    UPDATE media_metadata
    SET ${STATE_COLUMN} = 'done'
    WHERE rowid > ? AND rowid <= ?
      AND ${STATE_COLUMN} = 'pending'
      AND NOT ${needsAutoTagWorkSql('auto_tags')}
  `);
  const recomputeRange = db.transaction((from: number, to: number) => ({
    promoted: promote.run(from, to).changes,
    settled: settle.run(from, to).changes,
  }));

  try {
    for (;;) {
      const signature = readStoredSignature();
      if (signature === null) {
        return;
      }

      let promoted = 0;
      let settled = 0;
      let cursor = 0;
      for (;;) {
        const end = rangeEnd.get(cursor) as { id: number } | undefined;
        const to = end ? end.id : Number.MAX_SAFE_INTEGER;
        const changes = recomputeRange(cursor, to);
        promoted += changes.promoted;
        settled += changes.settled;
        if (!end) {
          break;
        }
        cursor = to;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      if (readStoredSignature() !== signature) {
        continue;
      }

      writeCompletedSignature(signature);
      syncedCapabilitySignature = signature;
      if (promoted > 0 || settled > 0) {
        console.log(`[AutoTagState] Recomputed auto_tag_state for capabilities ${signature} (+${promoted} pending, -${settled} settled)`);
      }
      return;
    }
  } catch (error) {
    console.warn('[AutoTagState] Failed to recompute auto-tag states:', error instanceof Error ? error.message : error);
  }
}

export class AutoTagStateService {
  /** True when migration 028 is applied and the partial index can drive lookups. */
  static isIndexedStateAvailable(): boolean {
    if (hasIndexedStateCache === undefined) {
      hasIndexedStateCache = hasMediaMetadataColumn(STATE_COLUMN) && hasMetaTable();
    }

    return hasIndexedStateCache;
  }

  /**
   * `"<alias>.auto_tag_state = 'pending' AND "` when the indexed state exists,
   * otherwise an empty string so the original condition still stands alone.
   */
  static buildPendingStatePrefix(alias: string): string {
    if (!this.isIndexedStateAvailable()) {
      return '';
    }

    assertSafeSqlAlias(alias);
    return `${alias}.${STATE_COLUMN} = '${PENDING_STATE}' AND `;
  }

  /**
   * Recompute the stored state when the enabled tagger set changes.
   *
   * The recorded capabilities also feed the migration 028 triggers, so they are persisted first (one tiny write).
   * The recompute itself walks media_metadata one rowid range at a time in the background, one short transaction
   * per range, instead of two full-table UPDATEs inside one transaction on the caller's stack. Until it finishes a
   * row may still carry its old state; the scheduler's residual json_extract filter keeps the rows it picks correct,
   * and rows that just became pending are picked up on a later poll.
   *
   * Completion is recorded separately (`system_settings.auto_tag_state_synced_capabilities`), so a recompute that a
   * restart interrupted runs again instead of being taken as done because the meta row already matches.
   */
  static syncCapabilityState(capabilities: AutoTagStateCapabilities): void {
    if (!this.isIndexedStateAvailable()) {
      return;
    }

    const signature = capabilitySignature(capabilities);
    if (syncedCapabilitySignature === signature) {
      return;
    }

    try {
      const storedSignature = readStoredSignature();
      // Databases from before the marker recomputed atomically with the meta write, so a matching meta row there
      // means the states are current.
      const completedSignature = readCompletedSignature() ?? storedSignature;

      if (storedSignature === signature && completedSignature === signature) {
        syncedCapabilitySignature = signature;
        return;
      }

      if (storedSignature !== signature) {
        db.prepare(`
          INSERT INTO ${META_TABLE} (id, tagger_enabled, kaloscope_enabled, updated_at)
          VALUES (1, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(id) DO UPDATE SET
            tagger_enabled = excluded.tagger_enabled,
            kaloscope_enabled = excluded.kaloscope_enabled,
            updated_at = CURRENT_TIMESTAMP
        `).run(capabilities.taggerAutoEnabled ? 1 : 0, capabilities.kaloscopeAutoEnabled ? 1 : 0);
      }

      if (!recomputeInFlight) {
        recomputeInFlight = runCapabilityRecompute().finally(() => {
          recomputeInFlight = null;
        });
      }
    } catch (error) {
      console.warn('[AutoTagState] Failed to sync auto-tag state capabilities:', error instanceof Error ? error.message : error);
    }
  }

  /** Resolve once the background capability recompute (if any) has finished. Tests and benchmarks wait on it. */
  static async waitForCapabilitySync(): Promise<void> {
    while (recomputeInFlight) {
      await recomputeInFlight;
    }
  }

  /**
   * Re-evaluate one row (tagging finished, or media just registered/linked).
   * No-op write when the state already matches, so the migration 028 triggers and
   * this call never fight over the same row.
   */
  static refreshForHash(compositeHash: string): void {
    if (!this.isIndexedStateAvailable()) {
      return;
    }

    try {
      const resolvedState = `CASE WHEN ${needsAutoTagWorkSql('auto_tags')} THEN 'pending' ELSE 'done' END`;
      db.prepare(`
        UPDATE media_metadata
        SET ${STATE_COLUMN} = ${resolvedState}
        WHERE composite_hash = ?
          AND ${STATE_COLUMN} IS NOT (${resolvedState})
      `).run(compositeHash);
    } catch (error) {
      console.warn(
        `[AutoTagState] Failed to refresh auto_tag_state for ${compositeHash.substring(0, 12)}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  /**
   * Park pending rows whose media file disappeared so an idle poll keeps hitting an
   * empty partial index. Bounded so a large cleanup never blocks the event loop; the
   * migration 028 `image_files` triggers move rows back to 'pending' if a file returns.
   */
  static pruneIneligiblePending(limit: number = DEFAULT_PRUNE_LIMIT): number {
    if (!this.isIndexedStateAvailable()) {
      return 0;
    }

    try {
      return db.prepare(`
        UPDATE media_metadata
        SET ${STATE_COLUMN} = 'skip'
        WHERE composite_hash IN (
          SELECT mm.composite_hash
          FROM media_metadata mm
          WHERE mm.${STATE_COLUMN} = '${PENDING_STATE}'
            AND NOT ${hasTaggableFileSql('mm.composite_hash')}
          LIMIT ?
        )
      `).run(limit).changes;
    } catch (error) {
      console.warn('[AutoTagState] Failed to prune ineligible pending rows:', error instanceof Error ? error.message : error);
      return 0;
    }
  }
}
