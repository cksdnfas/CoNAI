import { requestApiData } from '@/lib/api-request'

export type LlmUsagePurpose = 'chat' | 'summary' | 'judge' | 'translation' | 'suggestion' | 'asset_vision' | 'appearance' | 'image_prompt' | 'workflow' | 'other'
export type LlmUsageEngine = 'api' | 'claude-code' | 'codex' | 'typesafe'

export type LlmUsageTotals = {
  requests: number
  failed: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  /** Requests whose counts are our estimate (the server reported none). */
  estimatedRequests: number
  averageLatencyMs: number | null
}

export type LlmUsageSummary = {
  days: number
  totals: LlmUsageTotals
  /** Every local day of the period, oldest first. */
  daily: Array<{ date: string; requests: number; failed: number; inputTokens: number; outputTokens: number; averageLatencyMs: number | null }>
  byPurpose: Array<{ date: string; purpose: LlmUsagePurpose; requests: number; tokens: number }>
  byModel: Array<{ date: string; providerName: string; model: string; requests: number; tokens: number }>
  models: Array<LlmUsageTotals & { providerName: string; model: string; engine: LlmUsageEngine }>
}

export const LLM_USAGE_QUERY_KEY = ['llm-usage'] as const

/** Days are cut at the viewer's midnight: the server is told the viewer's UTC offset. */
export function getLlmUsage(days: number) {
  const offset = -new Date().getTimezoneOffset()
  return requestApiData<LlmUsageSummary>(`/api/codex-chat/admin/llm-usage?days=${days}&offset=${offset}`, { cache: 'no-store' })
}
