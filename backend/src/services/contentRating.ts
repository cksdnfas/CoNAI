import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { db } from '../database/init';
import { getUserSettingsDb } from '../database/userSettingsDb';
import { MediaMetadataModel } from '../models/Image/MediaMetadataModel';
import { RatingScoreModel } from '../models/RatingScore';
import { EmoticonService } from './emoticonService';
import { storedFilePath } from './fileStorePaths';
import { FileStoreService } from './fileStoreService';
import { extractRatingData } from './hashTaggingService';
import { imageTaggerService, ImageTaggerService } from './imageTaggerService';
import { RatingScoreService } from './ratingScoreService';
import { settingsService } from './settingsService';

/**
 * Content rating ceilings for what a model is shown. Some models refuse (or error on) sensitive media, so a model row
 * or a chat profile can cap the rating tier of the images, videos and animations sent to it. A ceiling is one of the
 * rating tiers (rating_tiers.id, the tiers the feed uses): media whose weighted rating score falls in that tier or one
 * ordered before it passes; null is no ceiling. A ceiling whose tier was deleted lets nothing through.
 *
 * Media not rated yet (the auto-tagger has not reached it, or a private file) is rated on the spot with the tagger and
 * the score kept. Media that cannot be rated (tagger off, failed) never reaches a model with a ceiling.
 */
export type ContentRatingLimit = number | null;

/** What a tool or a request says about media held back by the ceiling. */
export const CONTENT_RATING_BLOCKED = 'above the content rating this model may be shown';

const TAG_TIMEOUT_MS = 90_000;

/** Whether `score` is within `limit`: true / false, or null when the score is unknown (not rated). */
export function scoreWithinLimit(score: number | null | undefined, limit: ContentRatingLimit): boolean | null {
  if (limit === null) return true;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  const ceiling = RatingScoreModel.getAllTiers().find((tier) => tier.id === limit);
  const tier = RatingScoreModel.getTierByScore(score);
  return ceiling !== undefined && tier !== null && tier.tier_order <= ceiling.tier_order;
}

function taggerEnabled() {
  try {
    return settingsService.loadSettings().tagger.enabled === true;
  } catch {
    return false;
  }
}

/** One rating run per item at a time: a second caller waits for the first. */
const inflight = new Map<string, Promise<number | null>>();
function once(key: string, run: () => Promise<number | null>) {
  const running = inflight.get(key);
  if (running) return running;
  const promise = run().catch(() => null).finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** A file's weighted rating score from the tagger, or null when it cannot be rated (tagger off, failed, timed out). */
async function rateFile(filePath: string, mimeType: string | null): Promise<number | null> {
  if (!taggerEnabled()) return null;
  const tagging = ImageTaggerService.isVideoFile(filePath, mimeType ?? undefined)
    ? imageTaggerService.tagVideo(filePath)
    : imageTaggerService.tagImage(filePath);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), TAG_TIMEOUT_MS); });
  try {
    const result = await Promise.race([tagging, timeout]);
    const rating = result?.success ? extractRatingData(result.rating) : null;
    return rating ? (await RatingScoreService.calculateScore(rating)).score : null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A library item's rating score, rated now when it has none. Only the score is written: the auto-tag pipeline still
 * tags the item in full later and settles the same score.
 */
export async function libraryRatingScore(compositeHash: string): Promise<number | null> {
  const score = MediaMetadataModel.findByHash(compositeHash)?.rating_score;
  if (typeof score === 'number') return score;
  const file = EmoticonService.activeFile(compositeHash);
  if (!file || !fs.existsSync(file.path)) return null;
  return once(`media:${compositeHash}`, async () => {
    const rated = await rateFile(file.path, file.mimeType);
    if (rated !== null) db.prepare('UPDATE media_metadata SET rating_score = ? WHERE composite_hash = ? AND rating_score IS NULL').run(rated, compositeHash);
    return rated;
  });
}

/** Whether a library item may be shown to a model with `limit`. */
export async function libraryMediaAllowed(compositeHash: string, limit: ContentRatingLimit): Promise<boolean> {
  if (limit === null) return true;
  const known = scoreWithinLimit(MediaMetadataModel.findByHash(compositeHash)?.rating_score, limit);
  return known ?? scoreWithinLimit(await libraryRatingScore(compositeHash), limit) === true;
}

type StoredRatingRow = { owner_key: string; kind: string; mime_type: string | null; rating_score: number | null };

function storedRatingRow(fileId: string) {
  return getUserSettingsDb().prepare('SELECT owner_key, kind, mime_type, rating_score FROM stored_file_entries WHERE id = ? AND deleted_at IS NULL').get(fileId) as StoredRatingRow | undefined;
}

function ratesAsMedia(mimeType: string | null) {
  return Boolean(mimeType && (mimeType.startsWith('image/') || mimeType.startsWith('video/')));
}

/** A private file's rating score (images and videos), rated now when it has none. */
export async function storedFileRatingScore(fileId: string): Promise<number | null> {
  const row = storedRatingRow(fileId);
  if (!row || row.kind !== 'file' || !ratesAsMedia(row.mime_type)) return null;
  if (typeof row.rating_score === 'number') return row.rating_score;
  const filePath = storedFilePath(row.owner_key, fileId);
  if (!fs.existsSync(filePath)) return null;
  return once(`file:${fileId}`, async () => {
    const rated = await rateFile(filePath, row.mime_type);
    if (rated !== null) getUserSettingsDb().prepare('UPDATE stored_file_entries SET rating_score = ? WHERE id = ?').run(rated, fileId);
    return rated;
  });
}

/** Whether a private file may be shown to a model with `limit` (the caller has already checked its owner). */
export async function storedFileAllowed(fileId: string, limit: ContentRatingLimit): Promise<boolean> {
  if (limit === null) return true;
  const known = scoreWithinLimit(storedRatingRow(fileId)?.rating_score, limit);
  return known ?? scoreWithinLimit(await storedFileRatingScore(fileId), limit) === true;
}

/** Scores of images that came as bytes (workflow inputs), by content hash; a workflow often sends the same image again. */
const bufferScores = new Map<string, number>();
const BUFFER_SCORES_MAX = 256;

/** Whether an image data URL (a workflow input, no library record) may be sent to a model with `limit`. */
export async function imageDataUrlAllowed(dataUrl: string, limit: ContentRatingLimit): Promise<boolean> {
  if (limit === null) return true;
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl);
  if (!match) return false;
  const bytes = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  const key = crypto.createHash('sha256').update(bytes).digest('hex');
  const cached = bufferScores.get(key);
  if (cached !== undefined) return scoreWithinLimit(cached, limit) === true;
  const score = await once(`bytes:${key}`, async () => {
    const tempPath = path.join(os.tmpdir(), `conai-rating-${crypto.randomBytes(8).toString('hex')}.${match[1].split('/')[1].replace(/[^a-z0-9]/gi, '') || 'img'}`);
    await fs.promises.writeFile(tempPath, bytes);
    try {
      return await rateFile(tempPath, match[1]);
    } finally {
      await fs.promises.rm(tempPath, { force: true });
    }
  });
  if (score !== null) {
    if (bufferScores.size >= BUFFER_SCORES_MAX) bufferScores.delete(bufferScores.keys().next().value as string);
    bufferScores.set(key, score);
  }
  return scoreWithinLimit(score, limit) === true;
}

/**
 * Written files are rated in the background as they land (upload, copy), so a model with a ceiling rarely waits. A
 * rewrite clears the old score first.
 */
let unsubscribeHook: (() => void) | null = null;
export function registerStoredFileRatingHook() {
  unsubscribeHook ??= FileStoreService.onChange((change) => {
    if (change.action !== 'write') return;
    for (const entry of change.entries) {
      if (entry.kind !== 'file') continue;
      getUserSettingsDb().prepare('UPDATE stored_file_entries SET rating_score = NULL WHERE id = ?').run(entry.id);
      if (ratesAsMedia(storedRatingRow(entry.id)?.mime_type ?? null) && taggerEnabled()) void storedFileRatingScore(entry.id);
    }
  });
}
registerStoredFileRatingHook();
