/** Protocol values; each model advertises the subset it supports. */
export const CODEX_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const
export type CodexReasoningEffort = typeof CODEX_REASONING_EFFORTS[number]

export function isCodexReasoningEffort(value: unknown): value is CodexReasoningEffort {
  return typeof value === 'string' && (CODEX_REASONING_EFFORTS as readonly string[]).includes(value)
}

export interface CodexModelOption {
  id: string
  label: string
  isDefault?: boolean
  supportedReasoningEfforts?: CodexReasoningEffort[]
  defaultReasoningEffort?: CodexReasoningEffort
}
