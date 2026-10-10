import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { McpArtifactService } from '../../services/mcpArtifactService';
import { mediaWithinContextRating } from '../../services/codex-chat/chatContentRating';
import { RuntimeJobStore } from '../../services/runtimeJobs/runtimeJobStore';
import { findLibraryMedia, ingestVideoDataUrl, type SpriteGroupTarget } from '../../services/sprite/spriteLibrary';
import {
  buildFramesZip,
  isSpriteJobKind,
  probeLibraryVideo,
  startAnimationJob,
  startExtractBatchJob,
  startExtractJob,
  startNormalizeJob,
  waitForRuntimeJob,
  type ExtractBatchItem,
  type SpriteRequester,
} from '../../services/sprite/spriteService';
import type { SpriteExtractOptionsInput } from '../../services/sprite/spriteOptions';
import type { RuntimeJobRecord } from '../../types/runtimeJob';
import { isChatMcpSource, type McpRequestContext } from '../context';
import { refreshMcpRequester } from '../toolAccess';

/**
 * Sprite sheets from library videos (the video-sprite-extractor port): extract, batch extract, normalise sheets and
 * turn a sheet into an animation. Everything runs as a runtime job; outputs are saved to the library (group
 * "스프라이트" unless the caller picks one) so results come back as composite hashes.
 */

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function errorResult(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
}

function requesterOf(context: McpRequestContext): SpriteRequester {
  if (!context.requester) return { accountId: null, accountType: null };
  refreshMcpRequester(context.requester);
  return { accountId: context.requester.accountId, accountType: context.requester.accountType };
}

/** Chat replies must not hang on a long job: their inline wait is shorter. */
function waitBudgetMs(context: McpRequestContext, seconds: number | undefined) {
  const requested = seconds ?? 60;
  return Math.max(0, Math.min(requested, isChatMcpSource(context.source) ? 30 : 120)) * 1000;
}

const hashSchema = z.string().trim().regex(/^[0-9a-f]{32,48}$/i, 'composite_hash must be a library media hash');
const groupIdSchema = z.number().int().positive().optional().describe('Save into this custom image group (default: group "스프라이트")');
const groupPathSchema = z.string().trim().min(1).max(1024).optional().describe("Save into this group path, created when missing, e.g. '스프라이트/Kona'. Use instead of group_id.");
const waitSchema = z.number().min(0).max(120).optional().describe('Seconds to wait for the result before returning the job id (default 60; chat max 30)');

const extractOptionShape = {
  start_time: z.number().min(0).optional().describe('Start time in seconds (default 0)'),
  end_time: z.number().positive().nullable().optional().describe('End time in seconds (default: end of video)'),
  interval_seconds: z.number().positive().optional().describe('Take one frame every N seconds (default 0.1); used when sample_count is 0'),
  sample_count: z.number().int().min(0).max(256).optional().describe('0 = interval sampling, 2..256 = this many evenly spread frames'),
  background_mode: z.enum(['none', 'key']).optional().describe("'key' removes a key-colour background (default), 'none' keeps it"),
  key_colors: z.array(z.string().regex(/^#?[0-9a-fA-F]{6}$/)).min(1).max(8).optional().describe("Background colours as #RRGGBB (default ['#FF00FF'] magenta). Despill takes exactly one."),
  despill: z.boolean().optional().describe('Remove key-colour spill from edges (default true with one key colour)'),
  tolerance: z.number().min(0).max(1).optional().describe('Key tolerance 0..1 (default 0.10, or 0.08 with despill)'),
  softness: z.number().min(0).max(1).optional().describe('Edge softness 0..1 (default 0.05, or 0.92 with despill)'),
  edge_cleanup: z.boolean().optional().describe('Despill edge refinement (default true)'),
  auto_crop: z.boolean().optional().describe('Crop every frame to the union of visible pixels (default true)'),
  alpha_threshold: z.number().int().min(0).max(255).optional().describe('Alpha counted as visible for auto crop (default 20)'),
  crop: z.object({ x: z.number().int().min(0), y: z.number().int().min(0), width: z.number().int().positive(), height: z.number().int().positive() }).optional()
    .describe('Pre-crop in source video pixels'),
  resize_mode: z.enum(['none', 'contain', 'cover', 'stretch']).optional().describe('Frame resize mode (default none)'),
  output_width: z.number().int().min(0).max(4096).optional().describe('Frame width for resize (0 = keep aspect)'),
  output_height: z.number().int().min(0).max(4096).optional().describe('Frame height for resize (0 = keep aspect)'),
  remove_duplicate_frames: z.boolean().optional().describe('Drop near-identical consecutive frames (default false)'),
  frame_similarity_threshold: z.number().min(0).max(1).optional().describe('Similarity treated as duplicate (default 0.99)'),
  columns: z.number().int().min(0).max(64).optional().describe('Sheet columns 1..64 (0 = most square layout)'),
  spacing: z.number().int().min(0).max(64).optional().describe('Pixels between cells (default 0)'),
  output_format: z.enum(['png', 'webp']).optional().describe('Sheet format (default png)'),
  output_quality: z.number().int().min(1).max(100).optional().describe('WebP quality (default 90)'),
};
const extractOptionsSchema = z.object(extractOptionShape).optional().describe('Extraction options; omit for the web defaults');

type ExtractOptionsArgs = z.infer<z.ZodObject<typeof extractOptionShape>>;

function toExtractOptions(args: ExtractOptionsArgs | undefined): SpriteExtractOptionsInput {
  if (!args) return {};
  const options: SpriteExtractOptionsInput = {
    startTime: args.start_time,
    endTime: args.end_time,
    intervalSeconds: args.interval_seconds,
    sampleCount: args.sample_count,
    backgroundMode: args.background_mode,
    keyColors: args.key_colors,
    despill: args.despill,
    tolerance: args.tolerance,
    softness: args.softness,
    edgeCleanup: args.edge_cleanup,
    autoCrop: args.auto_crop,
    alphaThreshold: args.alpha_threshold,
    cropX: args.crop?.x,
    cropY: args.crop?.y,
    cropWidth: args.crop?.width,
    cropHeight: args.crop?.height,
    resizeMode: args.resize_mode,
    outputWidth: args.output_width,
    outputHeight: args.output_height,
    removeDuplicateFrames: args.remove_duplicate_frames,
    frameSimilarityThreshold: args.frame_similarity_threshold,
    columns: args.columns,
    spacing: args.spacing,
    outputFormat: args.output_format,
    outputQuality: args.output_quality,
  };
  return Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined)) as SpriteExtractOptionsInput;
}

function groupTarget(groupId: number | undefined, groupPath: string | undefined): SpriteGroupTarget {
  if (groupId !== undefined && groupPath !== undefined) throw new Error('Specify at most one of group_id or group_path');
  return { groupId, groupPath };
}

/** Output hashes of a finished sprite job (sheets, normalised sheets, animation). */
function outputHashes(result: unknown): string[] {
  if (!result || typeof result !== 'object') return [];
  const record = result as { saved?: { compositeHash?: string } | null; items?: Array<{ compositeHash?: string }>; sheets?: Array<{ compositeHash?: string }> };
  return [record.saved?.compositeHash, ...(record.items ?? []).map((item) => item.compositeHash), ...(record.sheets ?? []).map((sheet) => sheet.compositeHash)]
    .filter((hash): hash is string => typeof hash === 'string');
}

/** A download descriptor for a saved library file; null without the HTTP transport (no URL to give) or when it is gone. */
async function mediaDownload(context: McpRequestContext, compositeHash: string) {
  if (!context.baseUrl || !await mediaWithinContextRating(context, compositeHash)) return null;
  return McpArtifactService.createMediaDescriptor(compositeHash, context.baseUrl, context.requester).catch(() => null);
}

/**
 * Downloads for a finished job's outputs. A batch pairs every source video with its sheet (or why it has none), in
 * request order, with the video's library file name, so callers can match sheets to their own files.
 */
async function jobDownloads(context: McpRequestContext, job: RuntimeJobRecord, result: Record<string, unknown> | null) {
  if (!result) return {};
  if (job.kind === 'sprite-extract-batch') {
    const items = Array.isArray(result.items) ? result.items as ExtractBatchItem[] : [];
    const zip = result.zip as { workspaceId: string; fileName: string } | null | undefined;
    return {
      items: await Promise.all(items.map(async (item) => ({
        video_hash: item.videoHash,
        video_name: findLibraryMedia(item.videoHash)?.name ?? null,
        status: item.status,
        sheet_hash: item.compositeHash ?? null,
        ...(item.frameCount !== undefined ? { frame_count: item.frameCount } : {}),
        ...(item.error ? { error: item.error } : {}),
        ...(item.compositeHash ? { download: await mediaDownload(context, item.compositeHash) } : {}),
      }))),
      ...(zip && context.baseUrl ? { zip_download: await McpArtifactService.createSpriteFramesDescriptor(zip.workspaceId, zip.fileName, context.baseUrl, context.requester).catch(() => null) } : {}),
    };
  }
  const hashes = outputHashes(result);
  return hashes.length ? { downloads: await Promise.all(hashes.map(async (hash) => ({ composite_hash: hash, download: await mediaDownload(context, hash) }))) } : {};
}

async function describeJob(context: McpRequestContext, job: RuntimeJobRecord) {
  const done = job.status === 'completed';
  const result = done ? job.result as Record<string, unknown> | null : null;
  return {
    job_id: job.jobId,
    kind: job.kind,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    ...(job.message ? { message: job.message } : {}),
    ...(job.failureMessage ? { error: job.failureMessage } : {}),
    ...(job.errors.length > 0 ? { item_errors: job.errors } : {}),
    ...(done ? { composite_hashes: outputHashes(result), ...(await jobDownloads(context, job, result)), result } : { next: 'Call get_sprite_job with job_id and wait_seconds (it waits for the job, up to 30 in chat) until status is completed.' }),
    ...(done && job.kind === 'sprite-extract' && result?.buildId ? { build_id: result.buildId, frames_download: 'download_sprite_frames with build_id (kept about 1 hour)' } : {}),
  };
}

function requireSpriteJob(jobId: string, requester: SpriteRequester): RuntimeJobRecord {
  const ownership = RuntimeJobStore.getOwnership(jobId);
  const job = ownership ? RuntimeJobStore.get(jobId) : null;
  if (!ownership || !job || !isSpriteJobKind(job.kind)) throw new Error(`Sprite job not found: ${jobId}`);
  if (requester.accountType !== 'admin' && ownership.requestedByAccountId !== requester.accountId) throw new Error('Resource is not accessible to this account.');
  return job;
}

async function startAndWait(context: McpRequestContext, start: () => RuntimeJobRecord | Promise<RuntimeJobRecord>, waitSeconds: number | undefined) {
  const job = await start();
  const finished = await waitForRuntimeJob(job.jobId, waitBudgetMs(context, waitSeconds));
  return textResult(await describeJob(context, finished ?? job));
}

export function registerSpriteTools(server: McpServer, context: McpRequestContext): void {
  server.registerTool(
    'get_video_info',
    { description: 'Probe a library video (or animated GIF/WebP) for sprite extraction: size, fps, duration, frame count.', inputSchema: z.object({ composite_hash: hashSchema }) },
    async ({ composite_hash }) => {
      try {
        return textResult(await probeLibraryVideo(composite_hash));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'extract_sprite_sheet',
    { description: 'Extract frames from a library video into a sprite sheet: pick frames by interval or count, remove a key-colour background (magenta by default, optional despill), auto crop, resize and lay out. Saves the sheet to the library by default and returns its composite_hash with a download link; long runs return a job_id for get_sprite_job.', inputSchema: z.object({
      composite_hash: hashSchema.optional().describe('Library video hash'),
      data_url: z.string().optional().describe('Video as a base64 data URL (video/*, image/gif, image/webp) when it is not in the library yet; it is uploaded to group "스프라이트/원본 영상" first'),
      options: extractOptionsSchema,
      frame_indices: z.array(z.number().int().min(0)).min(1).max(256).optional().describe('Exact source frame numbers (strictly increasing); overrides interval/count sampling'),
      save: z.boolean().optional().describe('Save the sheet to the library (default true)'),
      group_id: groupIdSchema,
      group_path: groupPathSchema,
      wait_seconds: waitSchema,
    }) },
    async ({ composite_hash, data_url, options, frame_indices, save, group_id, group_path, wait_seconds }) => {
      try {
        if ((composite_hash === undefined) === (data_url === undefined)) throw new Error('Specify exactly one of composite_hash or data_url');
        const target = groupTarget(group_id, group_path);
        const requester = requesterOf(context);
        const videoHash = composite_hash ?? await ingestVideoDataUrl(data_url as string);
        return await startAndWait(context, () => startExtractJob({
          videoHash,
          options: toExtractOptions(options),
          frameIndices: frame_indices,
          save: save === false ? null : target,
          requester,
        }), wait_seconds);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'extract_sprite_sheets_batch',
    { description: 'Extract one sprite sheet per library video with the same options and save each to the library. Returns a job_id; poll get_sprite_job. The finished job lists items in request order, each pairing video_hash (and its library video_name) with sheet_hash and a download link, or with the error; zip_download holds every sheet plus a manifest.', inputSchema: z.object({
      composite_hashes: z.array(hashSchema).min(1).max(100).describe('Library video hashes (1..100, no duplicates)'),
      options: extractOptionsSchema,
      group_id: groupIdSchema,
      group_path: groupPathSchema,
      wait_seconds: waitSchema,
    }) },
    async ({ composite_hashes, options, group_id, group_path, wait_seconds }) => {
      try {
        const target = groupTarget(group_id, group_path);
        const requester = requesterOf(context);
        return await startAndWait(context, () => startExtractBatchJob({ videoHashes: composite_hashes, options: toExtractOptions(options), save: target, requester }), wait_seconds ?? 0);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'normalize_sprite_sheets',
    { description: 'Normalise library sprite sheets: re-cut each frame to a common cell size around an anchor (bottom center by default) so frames line up. per_sheet sizes each sheet on its own, group gives all sheets one cell size. Saves the sheets to the library by default.', inputSchema: z.object({
      sheets: z.array(z.object({
        composite_hash: hashSchema,
        columns: z.number().int().min(1).max(256),
        rows: z.number().int().min(1).max(256),
        frame_count: z.number().int().min(1).max(256).describe('Frames actually used (the last row may be partial)'),
        input_spacing: z.number().int().min(0).max(64).optional().describe('Pixels between input cells (default 0)'),
        output_columns: z.number().int().min(1).max(256).optional().describe('Output columns (default: same as input, at most frame_count)'),
        read_order: z.enum(['row_major', 'column_major']).optional(),
        custom_anchor_x: z.number().min(0).optional().describe("Anchor X in input cell pixels (anchor_policy 'custom')"),
        custom_anchor_y: z.number().min(0).optional().describe("Anchor Y in input cell pixels (anchor_policy 'custom')"),
      })).min(1).max(500),
      mode: z.enum(['per_sheet', 'group']).optional().describe('Default per_sheet'),
      alpha_threshold: z.number().int().min(0).max(255).optional().describe('Alpha counted as visible (default 20)'),
      padding: z.number().int().min(0).max(256).optional().describe('Transparent padding around the content (default 2)'),
      output_spacing: z.number().int().min(0).max(64).optional().describe('Pixels between output cells (default 0)'),
      anchor_policy: z.enum(['center', 'bottom_center', 'custom']).optional().describe('Default bottom_center'),
      output_format: z.enum(['png', 'webp']).optional(),
      output_quality: z.number().int().min(1).max(100).optional(),
      save: z.boolean().optional().describe('Save the normalised sheets to the library (default true)'),
      group_id: groupIdSchema,
      group_path: groupPathSchema,
      wait_seconds: waitSchema,
    }) },
    async (args) => {
      try {
        const target = groupTarget(args.group_id, args.group_path);
        const requester = requesterOf(context);
        const options = Object.fromEntries(Object.entries({
          mode: args.mode,
          alphaThreshold: args.alpha_threshold,
          padding: args.padding,
          outputSpacing: args.output_spacing,
          anchorPolicy: args.anchor_policy,
          outputFormat: args.output_format,
          outputQuality: args.output_quality,
        }).filter(([, value]) => value !== undefined));
        return await startAndWait(context, () => startNormalizeJob({
          sheets: args.sheets.map((sheet) => ({
            imageHash: sheet.composite_hash,
            options: Object.fromEntries(Object.entries({
              columns: sheet.columns,
              rows: sheet.rows,
              frameCount: sheet.frame_count,
              inputSpacing: sheet.input_spacing,
              outputColumns: sheet.output_columns,
              readOrder: sheet.read_order,
              customAnchorX: sheet.custom_anchor_x,
              customAnchorY: sheet.custom_anchor_y,
            }).filter(([, value]) => value !== undefined)) as never,
          })),
          options,
          save: args.save === false ? null : target,
          requester,
        }), args.wait_seconds);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'create_sprite_animation',
    { description: 'Turn a library sprite sheet into an animation (WebP by default, GIF or MP4) by playing its cells in row order. Saves it to the library by default.', inputSchema: z.object({
      composite_hash: hashSchema.describe('Library sprite sheet hash'),
      columns: z.number().int().min(1).max(256),
      rows: z.number().int().min(1).max(256),
      frame_count: z.number().int().min(1).max(256).describe('Frames to play (the last row may be partial)'),
      spacing: z.number().int().min(0).max(64).optional().describe('Pixels between cells (default 0)'),
      fps: z.number().min(1).max(60).optional().describe('Frames per second (default 12)'),
      output_format: z.enum(['webp', 'gif', 'mp4']).optional().describe('Default webp'),
      background_color: z.string().regex(/^#?[0-9a-fA-F]{6}$/).optional().describe('MP4 only: colour behind transparent pixels'),
      save: z.boolean().optional().describe('Save the animation to the library (default true)'),
      group_id: groupIdSchema,
      group_path: groupPathSchema,
      wait_seconds: waitSchema,
    }) },
    async (args) => {
      try {
        const target = groupTarget(args.group_id, args.group_path);
        const requester = requesterOf(context);
        const options = Object.fromEntries(Object.entries({
          columns: args.columns,
          rows: args.rows,
          frameCount: args.frame_count,
          spacing: args.spacing,
          fps: args.fps,
          outputFormat: args.output_format,
          backgroundColor: args.background_color,
        }).filter(([, value]) => value !== undefined)) as Parameters<typeof startAnimationJob>[0]['options'];
        return await startAndWait(context, () => startAnimationJob({ sheetHash: args.composite_hash, options, save: args.save === false ? null : target, requester }), args.wait_seconds);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'get_sprite_job',
    { description: 'Get the status of a sprite job (extract, batch, normalise, animation). A completed job lists its saved composite_hashes. With wait_seconds it waits for the job to finish first (up to 30 in chat), so one call replaces repeated checks.', inputSchema: z.object({ job_id: z.string().uuid(), wait_seconds: z.number().min(0).max(120).optional().describe('Seconds to wait for the job to finish before answering (default 0; chat max 30)') }) },
    async ({ job_id, wait_seconds }) => {
      try {
        const job = requireSpriteJob(job_id, requesterOf(context));
        if (!wait_seconds) return textResult(await describeJob(context, job));
        return textResult(await describeJob(context, (await waitForRuntimeJob(job_id, waitBudgetMs(context, wait_seconds))) ?? job));
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'wait_sprite_job',
    { description: 'Wait up to timeout_seconds for a sprite job to finish, then return its status.', inputSchema: z.object({ job_id: z.string().uuid(), timeout_seconds: z.number().min(1).max(600).optional().describe('Default 120') }) },
    async ({ job_id, timeout_seconds }) => {
      try {
        requireSpriteJob(job_id, requesterOf(context));
        const job = await waitForRuntimeJob(job_id, (timeout_seconds ?? 120) * 1000);
        return job ? textResult(await describeJob(context, job)) : errorResult(`Sprite job not found: ${job_id}`);
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    'download_sprite_frames',
    { description: 'Package the frames of a finished extract_sprite_sheet build (build_id, kept about 1 hour) as a ZIP of single-frame images and return a download link.', inputSchema: z.object({
      build_id: z.string().uuid(),
      format: z.enum(['png', 'webp']).optional().describe('Frame image format (default png)'),
      quality: z.number().int().min(1).max(100).optional().describe('WebP quality (default 90)'),
      crop: z.object({ x: z.number().int().min(0), y: z.number().int().min(0), width: z.number().int().positive(), height: z.number().int().positive() }).optional()
        .describe('Crop inside each frame cell'),
    }) },
    async ({ build_id, format, quality, crop }) => {
      try {
        if (!context.baseUrl) throw new Error('Artifact downloads require the Streamable HTTP transport');
        const zip = await buildFramesZip(build_id, { format, quality, crop }, requesterOf(context));
        const artifact = await McpArtifactService.createSpriteFramesDescriptor(zip.workspaceId, zip.file.split(/[\\/]/).pop() as string, context.baseUrl, context.requester);
        if (!artifact) throw new Error('Frames ZIP is not available');
        return textResult({ build_id, frame_count: zip.frameCount, artifact });
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}
