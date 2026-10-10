import crypto from 'crypto';
import { getAuthDb } from '../database/authDb';

const TOKEN_PREFIX = 'wpk_';
/** last_used_at is a hint for the token list; writing it on every poll would churn auth.db. */
const TOUCH_INTERVAL_MS = 60_000;

export interface WallpaperRuntimeTokenRecord {
  id: number;
  name: string;
  token_prefix: string;
  account_id: number | null;
  preset_id: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const RECORD_COLUMNS = 'id, name, token_prefix, account_id, preset_id, created_at, last_used_at, revoked_at';
const lastTouchedAt = new Map<number, number>();

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Read-only wallpaper runtime keys; the plaintext is returned once at creation and never stored. */
export class WallpaperRuntimeToken {
  static create(input: { name: string; accountId: number | null; presetId: string | null }): { record: WallpaperRuntimeTokenRecord; token: string } {
    const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString('base64url')}`;
    const result = getAuthDb().prepare(`
      INSERT INTO wallpaper_runtime_tokens (name, token_prefix, token_hash, account_id, preset_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(input.name, token.slice(0, TOKEN_PREFIX.length + 6), hashToken(token), input.accountId, input.presetId);
    return { record: this.findById(Number(result.lastInsertRowid)) as WallpaperRuntimeTokenRecord, token };
  }

  static list(): WallpaperRuntimeTokenRecord[] {
    return getAuthDb().prepare(`SELECT ${RECORD_COLUMNS} FROM wallpaper_runtime_tokens WHERE revoked_at IS NULL ORDER BY id DESC`).all() as WallpaperRuntimeTokenRecord[];
  }

  static findById(id: number): WallpaperRuntimeTokenRecord | null {
    return (getAuthDb().prepare(`SELECT ${RECORD_COLUMNS} FROM wallpaper_runtime_tokens WHERE id = ?`).get(id) as WallpaperRuntimeTokenRecord | undefined) ?? null;
  }

  /** Resolve a presented key; the lookup is by digest, so the plaintext never meets a stored value. */
  static findActiveByToken(token: unknown): WallpaperRuntimeTokenRecord | null {
    if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX) || token.length > 128) {
      return null;
    }
    return (getAuthDb().prepare(`SELECT ${RECORD_COLUMNS} FROM wallpaper_runtime_tokens WHERE token_hash = ? AND revoked_at IS NULL`).get(hashToken(token)) as WallpaperRuntimeTokenRecord | undefined) ?? null;
  }

  static findActiveById(id: unknown): WallpaperRuntimeTokenRecord | null {
    if (typeof id !== 'number' || !Number.isInteger(id)) {
      return null;
    }
    const record = this.findById(id);
    return record && record.revoked_at === null ? record : null;
  }

  static revoke(id: number): boolean {
    lastTouchedAt.delete(id);
    return getAuthDb().prepare(`UPDATE wallpaper_runtime_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL`).run(id).changes > 0;
  }

  static touch(id: number, now = Date.now()): void {
    if (now - (lastTouchedAt.get(id) ?? 0) < TOUCH_INTERVAL_MS) {
      return;
    }
    lastTouchedAt.set(id, now);
    getAuthDb().prepare(`UPDATE wallpaper_runtime_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  }
}
