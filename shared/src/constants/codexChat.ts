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
  return GENERATION_TOOL_SET.has(tool);
}
