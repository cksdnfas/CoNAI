import path from 'path';
import { ingestAudioFile } from './audioStore';
import { ensureNamedAudioProjectInbox } from './audioMaintenance';
import { registerGeneratedAudioCandidate, type AudioCandidate } from './audioService';
import type { ComfyCollectedOutputFile } from '../comfyGenerationExecutor';

/** Audio project whose 받은 파일 collects the sounds of generation-tab (image workflow) runs. */
export const AUDIO_GENERATION_TAB_PROJECT_NAME = '생성 탭';

export interface GenerationTabAudioContext {
  queueJobId: number;
  promptId: string;
  historyId: number | null;
  accountId: number | null;
  serverId: number | null;
  serverName: string | null;
  workflow: { id: number; name: string; updated_date: string };
}

/** Shared sink; callers retain their destination, naming and failure policies. */
export async function ingestGeneratedAudioOutputs(
  outputs: ComfyCollectedOutputFile[],
  context: Pick<GenerationTabAudioContext, 'queueJobId' | 'promptId' | 'serverId' | 'serverName' | 'workflow'>,
  target: {
    groupId: string;
    accountId: number | null;
    orderId?: string;
    name: (index: number) => string;
    provenance: Record<string, unknown>;
  },
  onFailure?: (output: ComfyCollectedOutputFile, error: unknown) => void,
): Promise<{ candidates: AudioCandidate[]; failures: string[] }> {
  const candidates: AudioCandidate[] = [];
  const failures: string[] = [];
  for (const [index, output] of outputs.entries()) {
    try {
      const originalName = path.basename(output.filename || output.tempPath);
      const { file } = await ingestAudioFile(output.tempPath, originalName);
      candidates.push(registerGeneratedAudioCandidate({
        groupId: target.groupId, file, name: target.name(index), accountId: target.accountId,
        orderId: target.orderId, sourceKey: `gen:${context.queueJobId}:${output.nodeId}:${index}`, jobId: context.queueJobId,
        provenance: {
          ...target.provenance,
          queue_job_id: context.queueJobId, prompt_id: context.promptId,
          workflow_id: context.workflow.id, workflow_name: context.workflow.name,
          workflow_updated_date: context.workflow.updated_date,
          server_id: context.serverId, server_name: context.serverName,
          output_node_id: output.nodeId, output_filename: originalName,
        },
      }));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      onFailure?.(output, error);
    }
  }
  return { candidates, failures };
}

/**
 * Sounds an image workflow saved on a generation-tab run: each becomes a generated candidate in the 생성 탭 project's
 * 받은 파일, tied to the queue job (`job_id`) so history rows and chat replies find them. The temp files are consumed.
 * Outputs that fail to ingest are skipped; the ids of the stored ones are returned.
 */
export async function storeGenerationTabAudioOutputs(outputs: ComfyCollectedOutputFile[], context: GenerationTabAudioContext): Promise<string[]> {
  if (outputs.length === 0) return [];
  const groupId = ensureNamedAudioProjectInbox(AUDIO_GENERATION_TAB_PROJECT_NAME);
  const { candidates } = await ingestGeneratedAudioOutputs(outputs, context, {
    groupId, accountId: context.accountId,
    name: (index) => outputs.length > 1 ? `${context.workflow.name} · ${index + 1}` : context.workflow.name,
    provenance: { source: 'generation-tab', history_id: context.historyId },
  }, (output, error) => console.error(`❌ Failed to store audio output ${output.filename} of queue job ${context.queueJobId}:`, error));
  return candidates.map((candidate) => candidate.id);
}
