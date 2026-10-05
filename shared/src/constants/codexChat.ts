import type { ChatToolCall } from '../types/chat';

/**
 * Chat MCP tools whose results are images the chat itself made: submitting/polling a job and reading its outputs.
 * Everything else (search, metadata, history listing, groups…) only looked images up. Shared so the transcript
 * (generated: large, found: compact grid) and the thread media list (generated / found tabs) agree.
 */
export const CODEX_CHAT_GENERATION_TOOLS: readonly string[] = [
  'submit_generation_job',
  'get_generation_job',
  'wait_generation_job',
  'get_generation_artifacts',
  'generate_nai',
  'generate_comfyui',
  'generate_comfyui_all_servers',
  'execute_graph_workflow',
  'get_graph_workflow_execution',
];

const GENERATION_TOOL_SET = new Set(CODEX_CHAT_GENERATION_TOOLS);

export function isCodexChatGenerationTool(tool: string): boolean {
  return GENERATION_TOOL_SET.has(tool) || /^generate_image(_\d+)?$/.test(tool) || tool === 'generation_result';
}

/** Creation is distinct from reading another member's generation job. */
export function isCodexChatCreationTool(tool: string): boolean {
  return isCodexChatGenerationTool(tool) && !['get_generation_job', 'wait_generation_job', 'get_generation_artifacts', 'get_graph_workflow_execution'].includes(tool);
}

/** While streaming, a later poll updates the submitting call in the same reply, never another speaker's reply. */
export function withChatGenerationProgress(calls: ChatToolCall[]): ChatToolCall[] {
  return calls.map((call) => {
    if (!(call.generated ?? isCodexChatCreationTool(call.tool)) || !call.jobIds?.length) return call;
    const readers = calls.filter((other) => other !== call && other.jobIds?.some((id) => call.jobIds!.includes(id)));
    if (!readers.length) return call;
    const pending = new Set(call.pendingJobIds ?? []);
    for (const reader of readers) {
      if (reader.pendingJobIds === undefined) continue;
      for (const id of reader.jobIds ?? []) {
        if (!call.jobIds.includes(id)) continue;
        if (reader.pendingJobIds.includes(id)) pending.add(id);
        else pending.delete(id);
      }
    }
    return { ...call, historyIds: [...new Set([...call.historyIds, ...readers.flatMap((reader) => reader.historyIds)])], compositeHashes: [...new Set([...call.compositeHashes, ...readers.flatMap((reader) => reader.compositeHashes)])], pendingJobIds: [...pending] };
  });
}
