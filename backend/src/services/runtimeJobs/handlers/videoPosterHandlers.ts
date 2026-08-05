import fs from 'fs'
import path from 'path'
import { db } from '../../../database/init'
import { resolveUploadsPath, runtimePaths } from '../../../config/runtimePaths'
import { MediaMetadataModel } from '../../../models/Image/MediaMetadataModel'
import { ThumbnailGenerator } from '../../../utils/thumbnailGenerator'
import { VideoFrameExtractor } from '../../videoFrameExtractor'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobRunner'
import { RuntimeJobConflictError } from '../runtimeJobStore'

/**
 * Video poster frames (HEAVY-2).
 *
 * Video rows never got a `thumbnail_path`, so every "thumbnail" of a video was the
 * **original video file**: one gallery page of video results streamed hundreds of
 * megabytes and pinned the process on range requests. Generating a webp poster and
 * storing it in the normal `thumbnail_path` slot turns those requests into ordinary
 * few-KB image reads, with no special casing anywhere downstream.
 *
 * Two scopes share one handler:
 *  - `queued`: drains hashes dropped by request paths (a viewer hit a poster-less
 *    video). Bounded and cooldown-guarded so a broken file cannot spin.
 *  - `all`: one sweep over every video/animated row still missing a poster. Kicked
 *    once per process the first time a poster miss is observed, which is exactly
 *    when a library has pre-existing videos to backfill.
 */

export type VideoPosterJobScope = 'queued' | 'all'

export interface VideoPosterJobParams {
  scope: VideoPosterJobScope
}

export interface VideoPosterJobResult {
  generated: number
  failed: number
  skipped: number
}

interface PendingPoster {
  compositeHash: string
  originalPath: string
}

const pending = new Map<string, PendingPoster>()
const recentlyRequested = new Map<string, number>()

/** Bound the queue so a library full of unreadable videos cannot grow it forever. */
const MAX_PENDING = 200
/** A permanently broken video must not be retried on every page view. */
const REQUEUE_COOLDOWN_MS = 30 * 60 * 1000
const MAX_COOLDOWN_ENTRIES = 5000
/** Full sweep batch size — poster work is ffmpeg-bound, so keep DB reads small. */
const SWEEP_BATCH_SIZE = 50

let fullSweepRequested = false

function isFullSweepEnabled(): boolean {
  return process.env.CONAI_VIDEO_POSTER_BACKFILL !== '0'
}

function pruneCooldown(now: number): void {
  if (recentlyRequested.size < MAX_COOLDOWN_ENTRIES) {
    return
  }

  for (const [hash, requestedAt] of recentlyRequested) {
    if (now - requestedAt >= REQUEUE_COOLDOWN_MS) {
      recentlyRequested.delete(hash)
    }
  }
}

function startJob(scope: VideoPosterJobScope): void {
  try {
    RuntimeJobRunner.start<VideoPosterJobParams>('video-poster-backfill', { scope }, {
      requestedByAccountId: null,
    })
  } catch (error) {
    // A live job already owns this scope and will pick the work up.
    if (!(error instanceof RuntimeJobConflictError)) {
      throw error
    }
  }
}

/**
 * Queue one missing video poster for background generation.
 *
 * Safe to call from a request handler: it never throws, never runs ffmpeg inline,
 * and writes at most one `runtime_jobs` row per drain cycle. The first miss in a
 * process also starts the one-off sweep over pre-existing videos.
 */
export function requestVideoPoster(compositeHash: string, originalPath: string): void {
  try {
    const now = Date.now()
    const lastRequestedAt = recentlyRequested.get(compositeHash)
    if (lastRequestedAt !== undefined && now - lastRequestedAt < REQUEUE_COOLDOWN_MS) {
      return
    }

    if (pending.size < MAX_PENDING) {
      pruneCooldown(now)
      recentlyRequested.set(compositeHash, now)
      pending.set(compositeHash, { compositeHash, originalPath })
      startJob('queued')
    }

    if (!fullSweepRequested && isFullSweepEnabled()) {
      fullSweepRequested = true
      startJob('all')
    }
  } catch (error) {
    console.warn('[VideoPoster] Failed to queue poster generation:', error instanceof Error ? error.message : error)
  }
}

/** Exposed for diagnostics/tests: how many hashes are waiting for a poster. */
export function getPendingVideoPosterCount(): number {
  return pending.size
}

function takeNextPendingPoster(): PendingPoster | null {
  const next = pending.values().next()
  if (next.done) {
    return null
  }

  pending.delete(next.value.compositeHash)
  return next.value
}

/**
 * Produce the poster for one media file and persist it as its thumbnail.
 *
 * Animated images (GIF/APNG) are decoded straight by sharp — spawning ffmpeg for
 * them would be pure overhead.
 */
async function generatePoster(compositeHash: string, originalPath: string, fileType: string | null): Promise<boolean> {
  if (!fs.existsSync(originalPath)) {
    return false
  }

  const relativeThumbPath = fileType === 'animated'
    ? await ThumbnailGenerator.generateThumbnail(originalPath, compositeHash)
    : await VideoFrameExtractor.generatePosterThumbnail(originalPath, compositeHash)

  if (!fs.existsSync(path.join(runtimePaths.tempDir, relativeThumbPath))) {
    return false
  }

  MediaMetadataModel.update(compositeHash, { thumbnail_path: relativeThumbPath })
  return true
}

/** Video/animated rows that still have no poster, oldest first. */
function selectPosterlessMedia(afterHash: string | null, limit: number): Array<{
  composite_hash: string
  original_file_path: string
  file_type: string | null
}> {
  return db.prepare(`
    SELECT mm.composite_hash, f.original_file_path, f.file_type
    FROM media_metadata mm
    JOIN image_files f ON f.composite_hash = mm.composite_hash
    WHERE (mm.thumbnail_path IS NULL OR mm.thumbnail_path = '')
      AND f.file_status = 'active'
      AND f.original_file_path IS NOT NULL
      AND (f.file_type IN ('video', 'animated') OR f.mime_type LIKE 'video/%')
      AND (? IS NULL OR mm.composite_hash > ?)
    GROUP BY mm.composite_hash
    ORDER BY mm.composite_hash ASC
    LIMIT ?
  `).all(afterHash, afterHash, limit) as Array<{
    composite_hash: string
    original_file_path: string
    file_type: string | null
  }>
}

async function runQueuedPosters(ctx: RuntimeJobContext<VideoPosterJobParams>): Promise<VideoPosterJobResult> {
  let generated = 0
  let failed = 0
  let processed = 0

  ctx.flush({ total: pending.size, processed: 0, currentLabel: null, phase: 'poster' })

  for (;;) {
    ctx.throwIfCancelled()

    const next = takeNextPendingPoster()
    if (!next) {
      break
    }

    processed++
    try {
      const fileType = (db.prepare(`
        SELECT file_type FROM image_files
        WHERE composite_hash = ? AND file_status = 'active'
        LIMIT 1
      `).get(next.compositeHash) as { file_type: string | null } | undefined)?.file_type ?? null

      if (await generatePoster(next.compositeHash, next.originalPath, fileType)) {
        generated++
      } else {
        failed++
      }
    } catch (error) {
      failed++
      ctx.recordError(next.compositeHash, error)
    }

    ctx.report({
      total: processed + pending.size,
      processed,
      succeeded: generated,
      failed,
      currentLabel: next.compositeHash,
    })
    await ctx.yield()
  }

  ctx.flush({ total: processed, processed, succeeded: generated, failed, currentLabel: null })
  return { generated, failed, skipped: 0 }
}

async function runFullSweep(ctx: RuntimeJobContext<VideoPosterJobParams>): Promise<VideoPosterJobResult> {
  let generated = 0
  let failed = 0
  let processed = 0
  let cursor: string | null = null

  const total = (db.prepare(`
    SELECT COUNT(*) AS pending_count
    FROM media_metadata mm
    WHERE (mm.thumbnail_path IS NULL OR mm.thumbnail_path = '')
      AND EXISTS (
        SELECT 1 FROM image_files f
        WHERE f.composite_hash = mm.composite_hash
          AND f.file_status = 'active'
          AND (f.file_type IN ('video', 'animated') OR f.mime_type LIKE 'video/%')
      )
  `).get() as { pending_count: number }).pending_count

  ctx.flush({ total, processed: 0, currentLabel: null, phase: 'poster-backfill' })
  if (total === 0) {
    return { generated: 0, failed: 0, skipped: 0 }
  }

  console.log(`🎞️  Video poster backfill starting for ${total} media file(s)`)

  for (;;) {
    ctx.throwIfCancelled()

    const batch: Array<{ composite_hash: string; original_file_path: string; file_type: string | null }> =
      selectPosterlessMedia(cursor, SWEEP_BATCH_SIZE)
    if (batch.length === 0) {
      break
    }

    for (const row of batch) {
      ctx.throwIfCancelled()
      cursor = row.composite_hash
      processed++

      try {
        if (await generatePoster(row.composite_hash, resolveUploadsPath(row.original_file_path), row.file_type)) {
          generated++
        } else {
          failed++
        }
      } catch (error) {
        failed++
        ctx.recordError(row.composite_hash, error)
      }

      ctx.report({ total, processed, succeeded: generated, failed, currentLabel: row.composite_hash })
      await ctx.yield()
    }
  }

  ctx.flush({ total, processed, succeeded: generated, failed, currentLabel: null })
  console.log(`✅ Video poster backfill complete (${generated} generated, ${failed} failed)`)

  return { generated, failed, skipped: 0 }
}

export function registerVideoPosterJobHandlers(): void {
  RuntimeJobRunner.register<VideoPosterJobParams, VideoPosterJobResult>({
    kind: 'video-poster-backfill',
    // The opportunistic drain and the full sweep are independent workloads, so they
    // get separate singleton keys and may run side by side.
    singletonKey: (params) => `video-poster-backfill:${params?.scope === 'all' ? 'all' : 'queued'}`,
    handler: (ctx) => (ctx.params?.scope === 'all' ? runFullSweep(ctx) : runQueuedPosters(ctx)),
  })
}
