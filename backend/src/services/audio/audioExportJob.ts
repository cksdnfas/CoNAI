import { RuntimeJobRunner, type RuntimeJobContext } from '../runtimeJobs/runtimeJobRunner';
import { RuntimeJobStore } from '../runtimeJobs/runtimeJobStore';
import type { RuntimeJobRecord } from '../../types/runtimeJob';
import { buildAudioExport, type AudioExportOptions, type AudioExportOwner, type AudioExportResult } from './audioExport';

/** Large exports (more than AUDIO_EXPORT_INLINE_MAX_FILES files) run as a runtime job; the result names the workspace. */

export interface AudioExportJobParams {
  projectId: string;
  groupId: string | null;
  options: AudioExportOptions;
  owner: AudioExportOwner;
}

export type AudioExportJobResult = Omit<AudioExportResult, 'plan'> & { files: number };

async function runAudioExportJob(ctx: RuntimeJobContext<AudioExportJobParams>): Promise<AudioExportJobResult> {
  const result = await buildAudioExport(ctx.params.projectId, ctx.params.groupId, ctx.params.options, ctx.params.owner, {
    signal: ctx.signal,
    progress: (processed, total) => ctx.report({ processed, total }),
  });
  const { plan, ...rest } = result;
  return { ...rest, files: plan.count };
}

export function registerAudioExportJobHandlers(): void {
  RuntimeJobRunner.register<AudioExportJobParams, AudioExportJobResult>({
    kind: 'audio-export',
    singletonKey: () => null,
    handler: runAudioExportJob,
  });
}

export function startAudioExportJob(params: AudioExportJobParams, total: number): RuntimeJobRecord {
  return RuntimeJobRunner.start('audio-export', params, { requestedByAccountId: params.owner.accountId, total });
}

/** The job, if it is an audio export the requester may see (starter or admin). */
export function getAudioExportJob(jobId: string, requester: AudioExportOwner): RuntimeJobRecord | null {
  const ownership = RuntimeJobStore.getOwnership(jobId);
  const job = ownership ? RuntimeJobStore.get(jobId) : null;
  if (!ownership || !job || job.kind !== 'audio-export') return null;
  if (requester.accountType !== 'admin' && ownership.requestedByAccountId !== requester.accountId) return null;
  return job;
}
