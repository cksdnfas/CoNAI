export type McpSideEffectClass = 'read-only' | 'local-mutation' | 'generation-external-service' | 'safety-prerequisite' | 'unknown';

export interface McpDryRunEvidenceToolReview {
  name: string;
  sideEffectClass: McpSideEffectClass;
  approvalRequired: boolean;
}

export interface McpDryRunEvidencePacket {
  schemaVersion: 1;
  backendHealth: 'operator-check-required';
  mcpHttpOptIn: 'operator-check-required';
  targetUrl: string;
  client: string;
  toolsReviewed: McpDryRunEvidenceToolReview[];
  mutationApproved: false;
  generationApproved: false;
  backupRequiredBeforeMutation: boolean;
  dryRunOnly: true;
  externalSideEffects: false;
  approvalBoundary: string[];
  exportNotes: string[];
}

const TOOL_CLASS_BY_NAME: Record<string, McpSideEffectClass> = {
  search_prompts: 'read-only',
  get_most_used_prompts: 'read-only',
  list_prompt_groups: 'read-only',
  list_workflows: 'read-only',
  list_comfyui_servers: 'read-only',
  get_workflow_details: 'read-only',
  search_images: 'read-only',
  get_image_metadata: 'read-only',
  get_generation_history: 'read-only',
  list_custom_dropdown_lists: 'read-only',
  search_custom_dropdown_items: 'read-only',
  search_wildcards: 'read-only',
  backup_prompt_data: 'safety-prerequisite',
  create_prompt_group: 'local-mutation',
  batch_create_groups: 'local-mutation',
  assign_prompts_to_group: 'local-mutation',
  move_prompts_between_groups: 'local-mutation',
  restore_prompt_data: 'local-mutation',
  generate_comfyui: 'generation-external-service',
  generate_comfyui_all_servers: 'generation-external-service',
  generate_nai: 'generation-external-service',
};

export const MCP_DRY_RUN_APPROVAL_BOUNDARY = [
  'push',
  'deploy',
  'server restart',
  'schema/data/auth/security changes',
  'public API changes',
  'destructive cleanup',
  'external service side effects',
  'credential/secret changes',
  'package/app version changes',
  'mutating MCP tools without explicit operator approval',
  'generation MCP tools without explicit operator approval',
] as const;

export function classifyMcpToolForDryRunEvidence(toolName: string): McpSideEffectClass {
  return TOOL_CLASS_BY_NAME[toolName] ?? 'unknown';
}

export function buildMcpDryRunEvidencePacket(options: {
  targetUrl?: string;
  client?: string;
  tools?: string[];
} = {}): McpDryRunEvidencePacket {
  const tools = options.tools?.length ? options.tools : ['search_prompts', 'search_images', 'get_generation_history'];
  const toolsReviewed = tools.map((name) => {
    const sideEffectClass = classifyMcpToolForDryRunEvidence(name);
    return {
      name,
      sideEffectClass,
      approvalRequired: sideEffectClass !== 'read-only' && sideEffectClass !== 'safety-prerequisite',
    };
  });

  return {
    schemaVersion: 1,
    backendHealth: 'operator-check-required',
    mcpHttpOptIn: 'operator-check-required',
    targetUrl: options.targetUrl ?? 'http://localhost:1666/mcp',
    client: options.client ?? 'hermes',
    toolsReviewed,
    mutationApproved: false,
    generationApproved: false,
    backupRequiredBeforeMutation: toolsReviewed.some((tool) => tool.sideEffectClass === 'local-mutation'),
    dryRunOnly: true,
    externalSideEffects: false,
    approvalBoundary: [...MCP_DRY_RUN_APPROVAL_BOUNDARY],
    exportNotes: [
      'This packet is local review evidence only; it does not call MCP tools.',
      'Confirm backend health and CONAI_MCP_HTTP_ENABLED in the operator environment before live use.',
      'Stop for approval before mutation, generation, external services, destructive cleanup, or deployment work.',
    ],
  };
}
