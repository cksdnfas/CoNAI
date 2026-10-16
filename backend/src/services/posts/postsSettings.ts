import fs from 'fs';
import path from 'path';
import { DEFAULT_POSTS_SETTINGS, DEFAULT_POSTS_KNOWLEDGE_SETTINGS, POSTS_SAFETY_LIMITS, type PostListLayout, type PostsSafetySettings, type PostsSettings, type PostsKnowledgeSettings, type PostsTopicEvaluationSettings } from '@conai/shared';
import { runtimePaths } from '../../config/runtimePaths';
import { writeJsonFileAtomic } from '../../utils/jsonFile';

const POSTS_SETTINGS_FILE_PATH = path.join(runtimePaths.basePath, 'config', 'posts.json');
const LAYOUTS: readonly PostListLayout[] = ['feed', 'cards', 'sns'];

function clampInt(value: unknown, limit: { min: number; max: number }, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(limit.min, Math.min(limit.max, Math.round(value))) : fallback;
}

function normalizeKnowledgeSettings(value: unknown, fallback: PostsKnowledgeSettings = DEFAULT_POSTS_KNOWLEDGE_SETTINGS): PostsKnowledgeSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result = { ...fallback };
  for (const key of ['enabled', 'rankingEnabled', 'autoEvaluationEnabled'] as const) if (typeof input[key] === 'boolean') result[key] = input[key];
  if (input.judgeSlotId === null) result.judgeSlotId = null;
  else if (typeof input.judgeSlotId === 'number' && Number.isSafeInteger(input.judgeSlotId) && input.judgeSlotId > 0) result.judgeSlotId = input.judgeSlotId;
  for (const key of ['judgeProvider', 'judgeModel'] as const) {
    if (input[key] === null) result[key] = null;
    else if (typeof input[key] === 'string') result[key] = input[key].trim().slice(0, 200) || null;
  }
  for (const key of ['humanWeight', 'useAiWeight', 'judgeWeight', 'aiBundleCap', 'aiGlobalMinimumCap', 'aiGlobalHumanRatio', 'historyWeight', 'historyCap'] as const) {
    if (typeof input[key] === 'number' && Number.isFinite(input[key])) result[key] = Math.max(0, Math.min(10, input[key]));
  }
  const limits = { aiDailyFamilyLimit: 100, dailyCallLimit: 10000, dailyTokenLimit: 100000000, maxDocumentsPerExecution: 50,
    maxSegmentsPerDocument: 20, maxInputCharacters: 200000, maxRetries: 10, privateRetentionDays: 3650, diagnosticRetentionDays: 365 } as const;
  for (const [key, max] of Object.entries(limits) as Array<[keyof typeof limits, number]>) result[key] = clampInt(input[key], { min: 0, max }, fallback[key]);
  result.policyVersion = 'v1';
  return result;
}

function normalizeTopicSettings(value: unknown, fallback: PostsTopicEvaluationSettings): PostsTopicEvaluationSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result = { ...fallback };
  for (const key of ['autoEnabled', 'reevaluateOnEdit'] as const) if (typeof input[key] === 'boolean') result[key] = input[key];
  const limits = { minimumScore: [0,100], maximumTopics: [1,20], dailyCallLimit: [0,10000],
    dailyTokenLimit: [0,100000000], maxInputCharacters: [1000,200000], maxRetries: [0,10] } as const;
  for (const key of Object.keys(limits) as Array<keyof typeof limits>) result[key] = clampInt(input[key], { min: limits[key][0], max: limits[key][1] }, fallback[key]);
  return result;
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
    knowledge: normalizeKnowledgeSettings(input.knowledge, fallback.knowledge),
    topicEvaluation: normalizeTopicSettings(input.topicEvaluation, fallback.topicEvaluation),
  };
}

let cached: PostsSettings | null = null;
let cachedStamp: string | null = null;
function settingsStamp(): string | null {
  try {
    const stat = fs.statSync(POSTS_SETTINGS_FILE_PATH);
    return [stat.mtimeMs,stat.ctimeMs,stat.size].join(':');
  } catch { return null; }
}

export function loadPostsSettings(): PostsSettings {
  const stamp = settingsStamp();
  if (!cached || stamp !== cachedStamp) {
    let stored: unknown = null;
    try { stored = JSON.parse(fs.readFileSync(POSTS_SETTINGS_FILE_PATH, 'utf8')); } catch { /* first run */ }
    cached = normalizePostsSettings(stored);
    cachedStamp = stamp;
  }
  return structuredClone(cached);
}

/** Merge a partial patch (safety merges field by field) and save. */
export function updatePostsSettings(patch: unknown): PostsSettings {
  const current = loadPostsSettings();
  const input = patch && typeof patch === 'object' ? patch as Record<string, unknown> : {};
  const merged = { ...current, ...input, safety: { ...current.safety, ...(input.safety && typeof input.safety === 'object' ? input.safety : {}) },
    knowledge: { ...current.knowledge, ...(input.knowledge && typeof input.knowledge === 'object' ? input.knowledge : {}) },
    topicEvaluation: { ...current.topicEvaluation, ...(input.topicEvaluation && typeof input.topicEvaluation === 'object' ? input.topicEvaluation : {}) } };
  const next = normalizePostsSettings(merged, current);
  writeJsonFileAtomic(POSTS_SETTINGS_FILE_PATH, next);
  cached = next;
  cachedStamp = settingsStamp();
  return loadPostsSettings();
}
