import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { isChatMcpSource, type McpRequestContext } from '../context';
import { McpArtifactService } from '../../services/mcpArtifactService';
import { saveAudioEdit } from '../../services/audio/audioEdit';
import { AudioServiceError, deleteAudioGroupCandidates } from '../../services/audio/audioService';
import {
  AUDIO_EXPORT_INLINE_MAX_FILES,
  audioExportPlan,
  buildAudioExport,
  resolveAudioExportOptions,
  type AudioExportOwner,
} from '../../services/audio/audioExport';
import { getAudioExportJob, startAudioExportJob } from '../../services/audio/audioExportJob';
import { waitForRuntimeJob } from '../../services/sprite/spriteService';
import { candidateSummary } from './audioTools';

/**
 * Audio edits, cleanup of unselected takes and exports for agents. Review (selected / rejected) stays with people;
 * the cleanup tool can never remove a selected take.
 */

function textResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value) }] };
}

function errorResult(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] };
}

async function run(action: () => unknown) {
  try { return textResult(await action()); } catch (error) { return errorResult(error); }
}

const id = z.string().trim().min(1).max(64);

const exportOptionShape = {
  format: z.enum(['wav', 'ogg']).optional().describe('Default: the saved export setting (ogg unless changed)'),
  quality: z.number().int().min(0).max(10).optional().describe('OGG Vorbis quality 0-10'),
  normalize: z.boolean().optional().describe('Per-file loudness normalisation (EBU R128)'),
  target_lufs: z.number().min(-70).max(-5).optional(),
  peak_db: z.number().min(-9).max(0).optional().describe('True-peak ceiling in dBTP'),
  loudness_range: z.number().min(1).max(50).optional(),
  sample_rate: z.union([z.literal(0), z.literal(22050), z.literal(44100), z.literal(48000)]).optional().describe('0 keeps the source rate'),
  channels: z.number().int().min(0).max(2).optional().describe('0 keeps the source channels'),
};

function ownerOf(context: McpRequestContext): AudioExportOwner {
  return { accountId: context.requester?.accountId ?? null, accountType: context.requester?.accountType ?? null };
}

/** A download for the caller: signed artifact over HTTP MCP, the session route path for the in-app chat. */
async function exportDownload(context: McpRequestContext, exportId: string, downloadPath: string) {
  if (!context.baseUrl) return { download_path: downloadPath };
  return { artifact: await McpArtifactService.createAudioExportDescriptor(exportId, context.baseUrl, context.requester) };
}

function waitBudgetMs(context: McpRequestContext, seconds: number | undefined) {
  const requested = seconds ?? 60;
  return Math.max(0, Math.min(requested, isChatMcpSource(context.source) ? 30 : 120)) * 1000;
}

async function describeExportJob(context: McpRequestContext, jobId: string) {
  const job = getAudioExportJob(jobId, ownerOf(context));
  if (!job) throw new AudioServiceError(`Audio export job not found: ${jobId}`, 404);
  const result = job.result as { export_id?: string; file_name?: string; count?: number; download_path?: string } | null;
  const base = { export_job_id: job.jobId, status: job.status, progress: job.progress, error: job.failureMessage ?? null };
  if (job.status !== 'completed' || !result?.export_id) return base;
  return { ...base, file_name: result.file_name, count: result.count, ...(await exportDownload(context, result.export_id, result.download_path ?? '')) };
}

export function registerAudioEditExportTools(server: McpServer, context: McpRequestContext): void {
  const accountId = context.requester?.accountId ?? null;

  server.tool('edit_audio_candidate', 'Save a non-destructive edit of an audio candidate as a new candidate (origin "edited", child of the source, review pending). Trim uses source seconds, fades the result after speed. The source file is never changed.', {
    candidate_id: id,
    end: z.number().positive().describe('Trim end in source seconds'),
    start: z.number().min(0).optional().describe('Trim start in source seconds (default 0)'),
    gain_db: z.number().min(-60).max(24).optional(),
    pitch_semitones: z.number().min(-24).max(24).optional().describe('Pitch shift that keeps the length'),
    speed: z.number().min(0.25).max(4).optional().describe('Tempo factor; changes the length'),
    fade_in: z.number().min(0).max(5).optional().describe('Seconds (default 0.005)'),
    fade_out: z.number().min(0).max(5).optional().describe('Seconds (default 0.01)'),
    request_key: z.string().min(8).max(128).optional().describe('Repeat-safe key: the same key returns the edit already saved'),
  }, ({ candidate_id, request_key, ...params }) => run(async () => candidateSummary(await saveAudioEdit(candidate_id, params, { accountId, requestKey: request_key }))));

  server.tool('delete_unselected_audio_candidates', 'Move unselected candidates of one audio group to the trash (restorable). Selected takes are never deleted: if any listed candidate is selected the whole call fails.', {
    group_id: id,
    candidate_ids: z.array(id).min(1).max(500),
  }, ({ group_id, candidate_ids }) => run(() => deleteAudioGroupCandidates(group_id, candidate_ids, false)));

  server.tool('export_audio_selected', `Export the selected takes of an audio project (or one group) with the group label file names: one file stays a WAV/OGG, several become a ZIP. Options default to the saved export settings. More than ${AUDIO_EXPORT_INLINE_MAX_FILES} files run as a background job; the reply then carries export_job_id for get_audio_download.`, {
    project_id: id,
    audio_group_id: id.optional().describe('Only this group of the project'),
    ...exportOptionShape,
    wait_seconds: z.number().min(0).max(120).optional().describe('Seconds to wait for a background export (default 60; chat max 30)'),
  }, ({ project_id, audio_group_id, wait_seconds, ...options }) => run(async () => {
    const resolved = resolveAudioExportOptions(options);
    const plan = audioExportPlan(project_id, audio_group_id ?? null, resolved);
    const manifest = { project_name: plan.project_name, count: plan.count, files: plan.files.map(({ id: candidateId, group_name, filename }) => ({ candidate_id: candidateId, group_name, filename })), options: resolved };
    if (plan.count <= AUDIO_EXPORT_INLINE_MAX_FILES) {
      const result = await buildAudioExport(project_id, audio_group_id ?? null, resolved, ownerOf(context));
      return { manifest, file_name: result.file_name, size_bytes: result.size_bytes, ...(await exportDownload(context, result.export_id, result.download_path)) };
    }
    const job = startAudioExportJob({ projectId: project_id, groupId: audio_group_id ?? null, options: resolved, owner: ownerOf(context) }, plan.count);
    await waitForRuntimeJob(job.jobId, waitBudgetMs(context, wait_seconds));
    return { manifest, ...(await describeExportJob(context, job.jobId)) };
  }));

  server.tool('get_audio_download', 'Get a download for one audio candidate\'s stored file (candidate_id), or the status and download of a background export (export_job_id).', {
    candidate_id: id.optional(),
    export_job_id: id.optional(),
  }, ({ candidate_id, export_job_id }) => run(async () => {
    if (Boolean(candidate_id) === Boolean(export_job_id)) throw new AudioServiceError('candidate_id 또는 export_job_id 중 하나만 줘.');
    if (export_job_id) return describeExportJob(context, export_job_id);
    if (!context.baseUrl) return { download_path: `/api/audio/candidates/${candidate_id}/file?download=1` };
    const artifact = await McpArtifactService.createAudioDescriptor(candidate_id!, context.baseUrl, context.requester);
    if (!artifact) throw new AudioServiceError('후보 파일을 찾을 수 없어.', 404);
    return { artifact };
  }));
}
