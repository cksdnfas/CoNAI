import fs from 'fs'
import pLimit from 'p-limit'
import { db } from '../../../database/init'
import { resolveUploadsPath } from '../../../config/runtimePaths'
import { BackgroundQueueService } from '../../backgroundQueue'
import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobRunner'

type MetadataReextractParams = Record<string, never>

export interface MetadataReextractResult {
  queuedCount: number
  skippedMissingCount: number
  totalCandidates: number
  processedCount: number
  failedCount: number
}

type Candidate = { id: number; scan_date: string | null; composite_hash: string; original_file_path: string }

const PAGE_SIZE = 200
const WINDOW_SIZE = 50
const QUEUE_CAPACITY = 100

/** Check both local aborts and cancel requests written by another process while waiting on queue work. */
function waitWithCancellation<T>(ctx: RuntimeJobContext, work: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (timer) clearTimeout(timer)
      ctx.signal.removeEventListener('abort', check)
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const check = () => {
      if (settled) return
      try {
        ctx.throwIfCancelled()
      } catch (error) {
        fail(error)
        return
      }
      timer = setTimeout(check, 500)
    }
    ctx.signal.addEventListener('abort', check)
    work.then((value) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(value)
    }, fail)
    check()
  })
}

/** Reserve room for a window, including prompt tasks produced by earlier extractions. */
async function waitForCapacity(ctx: RuntimeJobContext): Promise<void> {
  const hasCapacity = () => {
    const status = BackgroundQueueService.getQueueStatus()
    return status.queueLength + status.activeCount <= QUEUE_CAPACITY - WINDOW_SIZE
  }
  if (hasCapacity()) return
  let unsubscribe = () => {}
  const available = new Promise<void>((resolve) => {
    unsubscribe = BackgroundQueueService.onQueueChange(() => {
      if (hasCapacity()) resolve()
    })
    if (hasCapacity()) resolve()
  })
  try {
    await waitWithCancellation(ctx, available)
  } finally {
    unsubscribe()
  }
}

async function runMetadataReextract(ctx: RuntimeJobContext<MetadataReextractParams>): Promise<MetadataReextractResult> {
  // RuntimeJobRunner starts inline; yield before any library query so POST can return immediately.
  await ctx.yield()
  ctx.throwIfCancelled()
  const pageQuery = (cursorCondition: string) => db.prepare(`
    SELECT f.id, f.scan_date, f.composite_hash, f.original_file_path
    FROM image_files f INDEXED BY idx_files_scan_date
    WHERE f.file_status = 'active' AND f.file_type = 'image'
      AND f.composite_hash IS NOT NULL AND f.original_file_path IS NOT NULL
      AND ${cursorCondition}
      AND f.id = (
        SELECT f2.id FROM image_files f2
        WHERE f2.composite_hash = f.composite_hash AND f2.file_status = 'active'
          AND f2.file_type = 'image' AND f2.original_file_path IS NOT NULL
        ORDER BY f2.last_verified_date DESC, f2.id DESC LIMIT 1
      )
    ORDER BY f.scan_date DESC, f.id DESC LIMIT ?
  `)
  const firstPage = pageQuery('f.scan_date IS NOT NULL')
  const nextPage = pageQuery('(f.scan_date, f.id) < (?, ?)')
  const firstNullPage = pageQuery('f.scan_date IS NULL')
  const nextNullPage = pageQuery('f.scan_date IS NULL AND f.id < ?')
  const limit = pLimit(16)
  let cursor: Pick<Candidate, 'id' | 'scan_date'> | undefined
  let nullDates = false
  let totalCandidates = 0
  let queuedCount = 0
  let skippedMissingCount = 0
  let succeeded = 0
  let failedCount = 0
  let reporting = true
  const report = () => ctx.report({
    phase: 'processing',
    total: totalCandidates,
    processed: succeeded + failedCount + skippedMissingCount,
    succeeded,
    failed: failedCount,
    skipped: skippedMissingCount,
    currentLabel: null,
  })
  ctx.flush({ phase: 'processing', total: 0, processed: 0, succeeded: 0, failed: 0, skipped: 0, currentLabel: null })

  try {
    for (;;) {
      ctx.throwIfCancelled()
      await waitForCapacity(ctx)
      ctx.throwIfCancelled()
      const rows = (nullDates
        ? cursor ? nextNullPage.all(cursor.id, PAGE_SIZE) : firstNullPage.all(PAGE_SIZE)
        : cursor ? nextPage.all(cursor.scan_date, cursor.id, PAGE_SIZE) : firstPage.all(PAGE_SIZE)) as Candidate[]
      if (rows.length === 0) {
        if (nullDates) break
        nullDates = true
        cursor = undefined
        continue
      }
      const paths = await waitWithCancellation(ctx, Promise.all(rows.map((row) => limit(async () => {
        const filePath = resolveUploadsPath(row.original_file_path)
        try {
          await fs.promises.access(filePath)
          return filePath
        } catch {
          return null
        }
      }))))

      for (let start = 0; start < rows.length; start += WINDOW_SIZE) {
        ctx.throwIfCancelled()
        await waitForCapacity(ctx)
        ctx.throwIfCancelled()
        const pending: Promise<void>[] = []
        for (let index = start; index < Math.min(rows.length, start + WINDOW_SIZE); index++) {
          totalCandidates++
          const filePath = paths[index]
          if (!filePath) {
            skippedMissingCount++
            continue
          }
          queuedCount++
          pending.push(BackgroundQueueService.trackMetadataExtractionTask(filePath, rows[index].composite_hash).then((success) => {
            if (success) succeeded++
            else failedCount++
            if (reporting) report()
          }))
        }
        report()
        ctx.flush()
        await waitWithCancellation(ctx, Promise.all(pending))
        await ctx.yield()
      }
      cursor = rows.at(-1)!
      if (rows.length < PAGE_SIZE) {
        if (nullDates) break
        nullDates = true
        cursor = undefined
      }
    }
    ctx.throwIfCancelled()
    ctx.flush({ total: totalCandidates, processed: succeeded + failedCount + skippedMissingCount, succeeded, failed: failedCount, skipped: skippedMissingCount, currentLabel: null })
    return { queuedCount, skippedMissingCount, totalCandidates, processedCount: succeeded + failedCount, failedCount }
  } finally {
    // Already submitted work is shared with the normal queue and is allowed to finish after cancellation.
    reporting = false
  }
}

export function registerMetadataReextractJobHandler(): void {
  RuntimeJobRunner.register<MetadataReextractParams, MetadataReextractResult>({
    kind: 'metadata-reextract-all',
    singletonKey: () => 'metadata-reextract-all',
    handler: runMetadataReextract,
  })
}
