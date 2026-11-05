import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'
import { db } from '../../database/init'
import { requireContextPermission } from '../../middleware/featureAccess'
import { placeholdersFor, sortedUniqueChunks } from '../../utils/sqlInChunks'
import { contextContentLimit, ratingRestrictedHashes } from '../../services/codex-chat/chatContentRating'
import { ImageSafetyService } from '../../services/imageSafetyService'
import { MediaPostprocessVisibilityService } from '../../services/mediaPostprocessVisibilityService'
import { McpArtifactService } from '../../services/mcpArtifactService'
import { startMediaEditJob, type MediaEditParams, type MediaEditResult } from '../../services/mediaEdit/mediaEditService'
import { RuntimeJobRunner } from '../../services/runtimeJobs/runtimeJobRunner'
import { RUNTIME_JOB_TTL_MS, RuntimeJobStore } from '../../services/runtimeJobs/runtimeJobStore'
import { waitForRuntimeJob } from '../../services/sprite/spriteService'
import type { RuntimeJobRecord } from '../../types/runtimeJob'
import { resolveMcpInlineWaitMs, type McpRequestContext } from '../context'
import { refreshMcpRequester, requireMcpResourceOwner } from '../toolAccess'
import { errorResult, textResult } from '../toolResults'

const hash = z.string().trim().regex(/^(?:[0-9a-f]{32}|[0-9a-f]{48})$/, 'Use a library composite_hash, not a file path')
const hashes = z.array(hash).min(1).max(500).refine((items) => new Set(items).size === items.length, 'Duplicate hashes are not allowed')
const target = {
  group_id: z.number().int().positive().optional().describe('Existing custom group ID; use instead of group_path'),
  group_path: z.string().trim().min(1).max(1024).optional().describe('Custom group path; created if missing; use instead of group_id'),
  wait_seconds: z.number().min(0).max(120).optional().describe('Inline wait (default 60 seconds; chat maximum 30); otherwise use get_media_edit_job'),
}
const onlyOneGroup = (input: { group_id?: number; group_path?: string }) => input.group_id === undefined || input.group_path === undefined
type WithoutLimit<T> = T extends unknown ? Omit<T, 'contentRatingLimit'> : never

type Download = Awaited<ReturnType<typeof McpArtifactService.createMediaDescriptor>>
const jobDownloads = new Map<string, { expires: number; items: Map<string, Promise<Download>> }>()

async function downloadsFor(context: McpRequestContext, job: RuntimeJobRecord, result: MediaEditResult): Promise<Map<string, Download>> {
  const downloads = new Map<string, Download>()
  if (!context.baseUrl) return downloads
  try { requireContextPermission(context, 'images.view') } catch { return downloads }
  const hashes = result.saved.map((item) => item.compositeHash)
  const restricted = ratingRestrictedHashes(context, hashes)
  const visible = new Set<string>()
  for (const chunk of sortedUniqueChunks(hashes)) {
    const rows = db.prepare(`SELECT m.composite_hash FROM media_metadata m
      WHERE m.composite_hash IN (${placeholdersFor(chunk)})
        AND ${MediaPostprocessVisibilityService.buildReadyCondition('m')}
        AND ${ImageSafetyService.buildVisibleScoreCondition('m.rating_score')}`).all(...chunk) as Array<{ composite_hash: string }>
    for (const row of rows) if (!restricted.has(row.composite_hash)) visible.add(row.composite_hash)
  }
  const now = Date.now()
  for (const [key, value] of jobDownloads) if (value.expires <= now) jobDownloads.delete(key)
  const key = JSON.stringify([job.jobId, context.baseUrl, context.requester?.accountId, context.requester?.accountType, context.keyId])
  let cached = jobDownloads.get(key)
  if (!cached) {
    cached = { expires: now + RUNTIME_JOB_TTL_MS, items: new Map() }
    jobDownloads.set(key, cached)
  }
  // Lazy, serial hashing; simultaneous status requests share the same promise. Stored scores never invoke the tagger.
  for (const compositeHash of visible) {
    let descriptor = cached.items.get(compositeHash)
    if (!descriptor) {
      descriptor = McpArtifactService.createMediaDescriptor(compositeHash, context.baseUrl, context.requester).catch(() => null)
      cached.items.set(compositeHash, descriptor)
    }
    downloads.set(compositeHash, await descriptor)
  }
  return downloads
}

async function describeJob(context: McpRequestContext, job: RuntimeJobRecord) {
  if (job.status === 'completed') job = RuntimeJobStore.get(job.jobId, { includeResultFile: true }) ?? job
  const result = job.result as MediaEditResult | null
  const downloads = result ? await downloadsFor(context, job, result) : new Map<string, Download>()
  return {
    job_id: job.jobId, status: job.status, progress: job.progress,
    ...(job.failureMessage ? { error: job.failureMessage } : {}),
    ...(result ? {
      group_id: result.groupId,
      saved: result.saved.map((item) => ({
        source_composite_hash: item.source, composite_hash: item.compositeHash,
        ...(item.seconds !== undefined ? { seconds: item.seconds } : {}),
        download: downloads.get(item.compositeHash) ?? null,
      })),
      identical: (result.identical ?? []).map((item) => ({ source_composite_hash: item.source, composite_hash: item.compositeHash })),
      skipped: result.skipped, failed: result.failed,
      ...(result.streamCopy !== undefined ? { stream_copy: result.streamCopy } : {}),
    } : {}),
    ...(!['completed', 'failed', 'cancelled'].includes(job.status) ? { next: 'Call get_media_edit_job with job_id and wait_seconds; do not restart the edit.' } : {}),
  }
}

export function registerMediaEditTools(server: McpServer, context: McpRequestContext): void {
  const run = async (params: WithoutLimit<MediaEditParams>, waitSeconds?: number) => {
    try {
      if (context.requester) refreshMcpRequester(context.requester)
      const job = startMediaEditJob({ ...params, requestedByAccountId: context.requester?.accountId ?? null, contentRatingLimit: contextContentLimit(context) } as MediaEditParams)
      const budget = resolveMcpInlineWaitMs(context.source, waitSeconds)
      return textResult(await describeJob(context, budget > 0 ? (await waitForRuntimeJob(job.jobId, budget)) ?? job : job))
    } catch (error) { return errorResult(error) }
  }
  server.registerTool('save_video_frame', {
    description: 'Capture full-resolution frames of a library video or animated GIF/WebP and save NEW PNG (default) or WebP library images in group "영상 캡처". Choose up to 16 timestamps and/or first, middle, last, or a zero-based frame_index (default first). Last seeks near EOF and decodes the final frames. Returns saved entries with seconds, composite_hash and download; long runs return job_id for get_media_edit_job. On failure choose an available source or an earlier time/index; do not restart a pending job.',
    inputSchema: z.object({
      composite_hash: hash, at_seconds: z.array(z.number().min(0)).min(1).max(16).optional(),
      position: z.enum(['first', 'middle', 'last']).optional(),
      frame_index: z.number().int().min(0).optional().describe('Zero-based decoded frame index'),
      format: z.enum(['png', 'webp']).default('png'), ...target,
    }).refine(onlyOneGroup, 'Use group_id or group_path, not both'),
  }, ({ composite_hash, at_seconds, position, frame_index, format, group_id, group_path, wait_seconds }) =>
    run({ operation: 'save_video_frame', compositeHash: composite_hash, atSeconds: at_seconds, position, frameIndex: frame_index, format, groupId: group_id, groupPath: group_path }, wait_seconds))

  server.registerTool('crop_images', {
    description: 'Crop 1..500 library still images using rect {x,y,width,height} in EXIF-oriented source pixels and save NEW PNG library images in group "이미지 자르기". Originals are untouched; videos and animations are skipped. Pixel-identical outputs are reported in identical with the source hash, without duplicate files or group changes. Returns saved hashes/downloads and per-source skips/errors, or a job_id for get_media_edit_job. Rectangles must fit each oriented source; fix a reported rectangle or source before retrying only failed items.',
    inputSchema: z.object({
      composite_hashes: hashes,
      rect: z.object({ x: z.number().int().min(0), y: z.number().int().min(0), width: z.number().int().positive(), height: z.number().int().positive() }),
      ...target,
    }).refine(onlyOneGroup, 'Use group_id or group_path, not both'),
  }, ({ composite_hashes, rect, group_id, group_path, wait_seconds }) =>
    run({ operation: 'crop_images', compositeHashes: composite_hashes, rect, groupId: group_id, groupPath: group_path }, wait_seconds))

  server.registerTool('convert_images', {
    description: 'Convert 1..500 EXIF-oriented library still images to PNG, WebP or JPEG, saving NEW items in group "이미지 변환"; originals are untouched and videos/animations are skipped. quality is 1..100 (default 90; lossless PNG ignores it). JPEG flattens transparency onto background (#RRGGBB, default white #ffffff); PNG/WebP retain alpha. Pixel-identical outputs are reported in identical with the source hash, without duplicate files or group changes. Returns saved hashes/downloads and per-source skips/errors, or job_id for get_media_edit_job. Correct unsupported or unavailable inputs and retry only failed items.',
    inputSchema: z.object({
      composite_hashes: hashes, format: z.enum(['png', 'webp', 'jpeg']),
      quality: z.number().int().min(1).max(100).default(90),
      background: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffffff'), ...target,
    }).refine(onlyOneGroup, 'Use group_id or group_path, not both'),
  }, ({ composite_hashes, format, quality, background, group_id, group_path, wait_seconds }) =>
    run({ operation: 'convert_images', compositeHashes: composite_hashes, format, quality, background, groupId: group_id, groupPath: group_path }, wait_seconds))

  server.registerTool('clip_video', {
    description: 'Save a library video range start_seconds..end_seconds as a NEW library item in group "영상 편집". format is mp4/webm/gif/webp (default source container); optional fps and width preserve aspect. Same-container range-only video edits stream-copy (keyframe-aligned boundaries); other edits re-encode. GIF/WebP are animated images without audio. Returns hashes/downloads and stream_copy, or job_id for get_media_edit_job. If the range is invalid, use get_video_info and correct it; wait on pending jobs instead of restarting.',
    inputSchema: z.object({
      composite_hash: hash, start_seconds: z.number().min(0), end_seconds: z.number().positive(),
      format: z.enum(['mp4', 'webm', 'gif', 'webp']).optional(),
      fps: z.number().positive().optional(), width: z.number().int().min(1).max(16384).optional(),
      ...target,
    }).refine(onlyOneGroup, 'Use group_id or group_path, not both')
      .refine((input) => input.end_seconds > input.start_seconds, 'end_seconds must be greater than start_seconds'),
  }, ({ composite_hash, start_seconds, end_seconds, format, fps, width, group_id, group_path, wait_seconds }) =>
    run({ operation: 'clip_video', compositeHash: composite_hash, startSeconds: start_seconds, endSeconds: end_seconds, format, fps, width, groupId: group_id, groupPath: group_path }, wait_seconds))

  server.registerTool('get_media_edit_job', {
    description: 'Read or wait for your save_video_frame, crop_images, convert_images or clip_video runtime job. Returns progress, saved hashes/downloads and per-item failures. Set cancel=true to request cancellation; completed saves remain. On failure correct the reported input and retry only failed items; do not restart running jobs.',
    inputSchema: z.object({ job_id: z.string().uuid(), wait_seconds: z.number().min(0).max(120).default(0), cancel: z.boolean().default(false) }),
  }, async ({ job_id, wait_seconds, cancel }) => {
    try {
      const ownership = RuntimeJobStore.getOwnership(job_id)
      const job = ownership ? RuntimeJobStore.get(job_id) : null
      if (!job || job.kind !== 'media-edit') throw new Error('Media edit job not found.')
      requireMcpResourceOwner(context, { requested_by_account_id: ownership!.requestedByAccountId })
      if (cancel) return textResult(await describeJob(context, RuntimeJobRunner.cancel(job_id) ?? job))
      const budget = resolveMcpInlineWaitMs(context.source, wait_seconds)
      return textResult(await describeJob(context, budget > 0 ? (await waitForRuntimeJob(job_id, budget)) ?? job : job))
    } catch (error) { return errorResult(error) }
  })
}
