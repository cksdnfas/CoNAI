import path from 'path'
import fs from 'fs'
import { runtimePaths } from '../../../config/runtimePaths'
import { MediaMetadataModel } from '../../../models/Image/MediaMetadataModel'
import { ThumbnailGenerator } from '../../../utils/thumbnailGenerator'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobRunner'
import { RuntimeJobConflictError } from '../runtimeJobStore'

export type ThumbnailRepairJobParams = Record<string, never>

export interface ThumbnailRepairJobResult {
  repaired: number
  failed: number
}

interface PendingRepair {
  compositeHash: string
  originalPath: string
}

/**
 * Opportunistic thumbnail repair.
 *
 * Serving `GET /api/images/:hash/thumbnail` used to regenerate a missing thumbnail
 * inline: a sharp resize plus a synchronous `media_metadata` UPDATE, on the request
 * path, while every other user's request waited behind it. A gallery page full of
 * missing thumbnails stalled the whole process.
 *
 * The route now answers immediately from the original file and drops the hash here.
 * One coalescing background job drains the queue, so N missing thumbnails on a page
 * cost one job row instead of N inline regenerations.
 */
const pending = new Map<string, PendingRepair>()
const recentlyRequested = new Map<string, number>()

/** Bound the queue so a broken library cannot grow it without limit. */
const MAX_PENDING = 500
/** Do not re-queue the same hash for a while — a permanently broken file must not spin. */
const REQUEUE_COOLDOWN_MS = 10 * 60 * 1000
const MAX_COOLDOWN_ENTRIES = 5000

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

/**
 * Queue one missing thumbnail for background regeneration.
 *
 * Safe to call from a request handler: it never throws, never blocks on image work,
 * and writes at most one `runtime_jobs` row per drain cycle (a live job picks up
 * everything queued after it started).
 */
export function requestThumbnailRepair(compositeHash: string, originalPath: string): void {
  try {
    const now = Date.now()
    const lastRequestedAt = recentlyRequested.get(compositeHash)
    if (lastRequestedAt !== undefined && now - lastRequestedAt < REQUEUE_COOLDOWN_MS) {
      return
    }

    if (pending.size >= MAX_PENDING) {
      return
    }

    pruneCooldown(now)
    recentlyRequested.set(compositeHash, now)
    pending.set(compositeHash, { compositeHash, originalPath })

    try {
      RuntimeJobRunner.start<ThumbnailRepairJobParams>('thumbnail-repair', {} as ThumbnailRepairJobParams, {
        requestedByAccountId: null,
      })
    } catch (error) {
      // A live repair job already owns the singleton key and will drain the queue.
      if (!(error instanceof RuntimeJobConflictError)) {
        throw error
      }
    }
  } catch (error) {
    console.warn('[ThumbnailRepair] Failed to queue repair:', error instanceof Error ? error.message : error)
  }
}

/** Exposed for diagnostics/tests: how many hashes are waiting for repair. */
export function getPendingThumbnailRepairCount(): number {
  return pending.size
}

function takeNextPendingRepair(): PendingRepair | null {
  const next = pending.values().next()
  if (next.done) {
    return null
  }

  pending.delete(next.value.compositeHash)
  return next.value
}

async function runThumbnailRepair(ctx: RuntimeJobContext<ThumbnailRepairJobParams>): Promise<ThumbnailRepairJobResult> {
  let repaired = 0
  let failed = 0
  let processed = 0

  ctx.flush({ total: pending.size, processed: 0, currentLabel: null, phase: 'repair' })

  for (;;) {
    ctx.throwIfCancelled()

    const next = takeNextPendingRepair()
    if (!next) {
      break
    }

    processed++
    try {
      if (!fs.existsSync(next.originalPath)) {
        failed++
      } else {
        const relativeThumbPath = await ThumbnailGenerator.generateThumbnail(next.originalPath, next.compositeHash)
        MediaMetadataModel.update(next.compositeHash, { thumbnail_path: relativeThumbPath })

        if (fs.existsSync(path.join(runtimePaths.tempDir, relativeThumbPath))) {
          repaired++
        } else {
          failed++
        }
      }
    } catch (error) {
      failed++
      ctx.recordError(next.compositeHash, error)
    }

    ctx.report({
      total: processed + pending.size,
      processed,
      succeeded: repaired,
      failed,
      currentLabel: next.compositeHash,
    })
    await ctx.yield()
  }

  ctx.flush({ total: processed, processed, succeeded: repaired, failed, currentLabel: null })

  return { repaired, failed }
}

export function registerThumbnailRepairJobHandlers(): void {
  RuntimeJobRunner.register<ThumbnailRepairJobParams, ThumbnailRepairJobResult>({
    kind: 'thumbnail-repair',
    // One drain loop for the whole process: the queue is shared module state, so a
    // second job would only fight the first one over the same hashes.
    singletonKey: () => 'thumbnail-repair',
    handler: runThumbnailRepair,
  })
}
