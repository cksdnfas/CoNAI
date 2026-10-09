import fs from 'fs';
import path from 'path';
import { DEFAULT_POSTS_SETTINGS, POSTS_SAFETY_LIMITS, type PostListLayout, type PostsSafetySettings, type PostsSettings } from '@conai/shared';
import { runtimePaths } from '../../config/runtimePaths';

const POSTS_SETTINGS_FILE_PATH = path.join(runtimePaths.basePath, 'config', 'posts.json');
const LAYOUTS: readonly PostListLayout[] = ['feed', 'cards', 'sns'];

function clampInt(value: unknown, limit: { min: number; max: number }, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(limit.min, Math.min(limit.max, Math.round(value))) : fallback;
}

/** Any partial or stale input made whole: unknown fields drop, numbers clamp to their limits. */
export function normalizePostsSettings(value: unknown, fallback: PostsSettings = DEFAULT_POSTS_SETTINGS): PostsSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const safetyInput = input.safety && typeof input.safety === 'object' ? input.safety as Record<string, unknown> : {};
  const safety = { summonEnabled: typeof safetyInput.summonEnabled === 'boolean' ? safetyInput.summonEnabled : fallback.safety.summonEnabled } as PostsSafetySettings;
  for (const [key, limit] of Object.entries(POSTS_SAFETY_LIMITS) as Array<[Exclude<keyof PostsSafetySettings, 'summonEnabled'>, { min: number; max: number }]>) {
    safety[key] = clampInt(safetyInput[key], limit, fallback.safety[key]);
  }
  return {
    layout: LAYOUTS.includes(input.layout as PostListLayout) ? input.layout as PostListLayout : fallback.layout,
    botPostStatus: input.botPostStatus === 'draft' || input.botPostStatus === 'published' ? input.botPostStatus : fallback.botPostStatus,
    safety,
  };
}

let cached: PostsSettings | null = null;

export function loadPostsSettings(): PostsSettings {
  if (!cached) {
    let stored: unknown = null;
    try { stored = JSON.parse(fs.readFileSync(POSTS_SETTINGS_FILE_PATH, 'utf8')); } catch { /* first run */ }
    cached = normalizePostsSettings(stored);
  }
  return structuredClone(cached);
}

/** Merge a partial patch (safety merges field by field) and save. */
export function updatePostsSettings(patch: unknown): PostsSettings {
  const current = loadPostsSettings();
  const input = patch && typeof patch === 'object' ? patch as Record<string, unknown> : {};
  const merged = { ...current, ...input, safety: { ...current.safety, ...(input.safety && typeof input.safety === 'object' ? input.safety : {}) } };
  const next = normalizePostsSettings(merged, current);
  fs.mkdirSync(path.dirname(POSTS_SETTINGS_FILE_PATH), { recursive: true });
  fs.writeFileSync(POSTS_SETTINGS_FILE_PATH, JSON.stringify(next, null, 2), 'utf8');
  cached = next;
  return loadPostsSettings();
}
