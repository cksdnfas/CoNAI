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

/**
 * Sounds an image workflow saved on a generation-tab run: each becomes a generated candidate in the 생성 탭 project's
 * 받은 파일, tied to the queue job (`job_id`) so history rows and chat replies find them. The temp files are consumed.
 * Outputs that fail to ingest are skipped; the ids of the stored ones are returned.
 */
export async function storeGenerationTabAudioOutputs(outputs: ComfyCollectedOutputFile[], context: GenerationTabAudioContext): Promise<string[]> {
  if (outputs.length === 0) return [];
  const groupId = ensureNamedAudioProjectInbox(AUDIO_GENERATION_TAB_PROJECT_NAME);
  const candidates: AudioCandidate[] = [];
  for (const [index, output] of outputs.entries()) {
    try {
      const originalName = path.basename(output.filename || output.tempPath);
      const { file } = await ingestAudioFile(output.tempPath, originalName);
      candidates.push(registerGeneratedAudioCandidate({
        groupId,
        file,
        name: outputs.length > 1 ? `${context.workflow.name} · ${index + 1}` : context.workflow.name,
        accountId: context.accountId,
        sourceKey: `gen:${context.queueJobId}:${output.nodeId}:${index}`,
        jobId: context.queueJobId,
        provenance: {
          source: 'generation-tab',
          queue_job_id: context.queueJobId,
          history_id: context.historyId,
          prompt_id: context.promptId,
          workflow_id: context.workflow.id,
          workflow_name: context.workflow.name,
          workflow_updated_date: context.workflow.updated_date,
          server_id: context.serverId,
          server_name: context.serverName,
          output_node_id: output.nodeId,
          output_filename: originalName,
        },
      }));
    } catch (error) {
      console.error(`❌ Failed to store audio output ${output.filename} of queue job ${context.queueJobId}:`, error);
    }
  }
  return candidates.map((candidate) => candidate.id);
}
