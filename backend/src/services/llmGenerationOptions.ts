/**
 * One place for what an LLM connection holds (how to reach it) and what a request asks for (how to generate). Chat and
 * the workflow LLM node both build their requests from here, so the same profile behaves the same in both.
 *
 * A connection keeps: default model, request timeout, concurrent requests, how its server turns thinking off. Generation options (temperature, output limit, reasoning, extra
 * provider parameters) belong to the chat profile or the workflow node; an unset option is not sent at all, so the
 * server's own default applies.
 */

export const LLM_REASONING_EFFORTS = ['none', 'low', 'medium', 'high'] as const
export type LlmReasoningEffort = typeof LLM_REASONING_EFFORTS[number]
/** Claude Code `--effort` levels; each model lists the ones it takes. */
export const CLAUDE_REASONING_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type ClaudeReasoningEffort = typeof CLAUDE_REASONING_EFFORTS[number]

export type LlmGenerationOptions = {
  temperature?: number | null
  /** Whole output (reasoning + answer). */
  maxTokens?: number | null
  /** The Claude levels reach only the Claude Code transport; API connections never get them from a profile. */
  reasoningEffort?: LlmReasoningEffort | ClaudeReasoningEffort | null
  /** Reasoning budget; the server wraps up thinking when it is reached. */
  reasoningBudgetTokens?: number | null
  /** Provider-specific fields merged into the request body (e.g. chat_template_kwargs). */
  extraParams?: Record<string, unknown> | null
}

/** Fields the request itself owns; extra parameters may not replace them. */
const RESERVED_BODY_FIELDS = new Set(['model', 'messages', 'stream', 'tools', 'tool_choice', 'prompt', 'system', 'images'])

export function isLlmReasoningEffort(value: unknown): value is LlmReasoningEffort {
  return typeof value === 'string' && (LLM_REASONING_EFFORTS as readonly string[]).includes(value)
}

export function isClaudeReasoningEffort(value: unknown): value is ClaudeReasoningEffort {
  return typeof value === 'string' && (CLAUDE_REASONING_EFFORTS as readonly string[]).includes(value)
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function optionalPositiveNumber(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(number) && number > 0 ? number : null
}

function parseConfig(additionalConfig: unknown): Record<string, unknown> {
  if (additionalConfig && typeof additionalConfig === 'object' && !Array.isArray(additionalConfig)) return additionalConfig as Record<string, unknown>
  if (typeof additionalConfig === 'string') {
    try {
      const parsed: unknown = JSON.parse(additionalConfig)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
    } catch {
      return {}
    }
  }
  return {}
}

export const LLM_MAX_CONCURRENT_REQUESTS = 8

/**
 * How a connection's server turns thinking off when a request asks for no reasoning (`reasoningEffort: 'none'`):
 * `reasoning_effort: "none"` (OpenAI and most proxies), `chat_template_kwargs.enable_thinking: false` (llama.cpp, vLLM
 * and the like with Qwen-style templates, which ignore or reject reasoning_effort "none"), or nothing at all.
 */
export const LLM_THINKING_SWITCHES = ['none', 'reasoning_effort', 'enable_thinking'] as const
export type LlmThinkingSwitch = typeof LLM_THINKING_SWITCHES[number]
export const DEFAULT_LLM_THINKING_SWITCH: LlmThinkingSwitch = 'reasoning_effort'

function readThinkingSwitch(value: unknown): LlmThinkingSwitch {
  return typeof value === 'string' && (LLM_THINKING_SWITCHES as readonly string[]).includes(value) ? value as LlmThinkingSwitch : DEFAULT_LLM_THINKING_SWITCH
}

/** What a connection says about itself, reading the older key names too. */
export function readLlmConnectionConfig(additionalConfig: unknown) {
  const config = parseConfig(additionalConfig)
  const timeoutMs = optionalPositiveNumber(config.request_timeout_ms) ?? optionalPositiveNumber(config.timeout_ms)
  const concurrent = optionalPositiveNumber(config.max_concurrent_requests)
  return {
    defaultModel: optionalString(config.default_model) ?? optionalString(config.model),
    timeoutMs: timeoutMs === null ? null : Math.floor(timeoutMs),
    /** Requests the server answers at once (a proxy over several servers takes more); group rooms run that many members together. */
    maxConcurrentRequests: concurrent === null ? 1 : Math.min(Math.floor(concurrent), LLM_MAX_CONCURRENT_REQUESTS),
    /** Mark cache breakpoints (`cache_control`) on the stable parts of each request — for Anthropic models behind a proxy such as LiteLLM. */
    promptCacheMarks: config.prompt_cache_marks === true,
    /** How a request without reasoning turns thinking off on this server (see LLM_THINKING_SWITCHES). */
    thinkingSwitch: readThinkingSwitch(config.thinking_switch),
  }
}

/** Extra parameters from a profile/node: a JSON object, without the fields the request owns. Throws on bad JSON. */
export function parseLlmExtraParams(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null
  let parsed: unknown = value
  if (typeof value === 'string') {
    if (!value.trim()) return null
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error('추가 파라미터는 JSON 객체여야 해.')
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('추가 파라미터는 JSON 객체여야 해.')
  const entries = Object.entries(parsed as Record<string, unknown>).filter(([key]) => !RESERVED_BODY_FIELDS.has(key))
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

/**
 * Body fields for an OpenAI-compatible /chat/completions request (also LiteLLM). Unset options are left out. No
 * reasoning (`reasoningEffort: 'none'`) goes out the way the connection's `thinkingSwitch` says; other efforts as is.
 */
export function buildOpenAiGenerationFields(options: LlmGenerationOptions, thinkingSwitch: LlmThinkingSwitch = DEFAULT_LLM_THINKING_SWITCH): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...(options.extraParams ?? {}) }
  if (typeof options.temperature === 'number') fields.temperature = options.temperature
  if (typeof options.maxTokens === 'number') fields.max_tokens = options.maxTokens
  if (options.reasoningEffort === 'none') {
    if (thinkingSwitch === 'reasoning_effort') fields.reasoning_effort = 'none'
    else if (thinkingSwitch === 'enable_thinking') {
      const kwargs = fields.chat_template_kwargs
      fields.chat_template_kwargs = { ...(kwargs && typeof kwargs === 'object' && !Array.isArray(kwargs) ? kwargs : {}), enable_thinking: false }
    }
  } else if (options.reasoningEffort) fields.reasoning_effort = options.reasoningEffort
  if (typeof options.reasoningBudgetTokens === 'number') fields.reasoning_budget_tokens = options.reasoningBudgetTokens
  return fields
}

/** Body fields for Ollama's native /api/generate: sampling goes in `options`, reasoning in `think`. */
export function buildOllamaGenerationFields(options: LlmGenerationOptions): Record<string, unknown> {
  const { options: extraOptions, ...extra } = (options.extraParams ?? {}) as { options?: Record<string, unknown> } & Record<string, unknown>
  const sampling: Record<string, unknown> = { ...(extraOptions && typeof extraOptions === 'object' ? extraOptions : {}) }
  if (typeof options.temperature === 'number') sampling.temperature = options.temperature
  if (typeof options.maxTokens === 'number') sampling.num_predict = options.maxTokens
  const fields: Record<string, unknown> = { ...extra }
  if (Object.keys(sampling).length > 0) fields.options = sampling
  // Ollama takes think: false to turn reasoning off, or a level for models that grade it.
  if (options.reasoningEffort) fields.think = options.reasoningEffort === 'none' ? false : options.reasoningEffort
  return fields
}

/**
 * The options a summary request uses: no sampling surprises, and no long thinking when the profile reasons — or, on a
 * connection that turns thinking off with `enable_thinking` (a model that thinks unless told not to), always.
 */
export function summaryGenerationOptions(options: LlmGenerationOptions, thinkingSwitch: LlmThinkingSwitch = DEFAULT_LLM_THINKING_SWITCH): LlmGenerationOptions {
  return {
    temperature: 0.3,
    reasoningEffort: options.reasoningEffort || thinkingSwitch === 'enable_thinking' ? 'none' : null,
    extraParams: options.extraParams ?? null,
  }
}

/** Whether a request with these options actually runs without thinking on a connection with this switch. */
export function thinkingIsOff(options: Pick<LlmGenerationOptions, 'reasoningEffort'>, thinkingSwitch: LlmThinkingSwitch = DEFAULT_LLM_THINKING_SWITCH) {
  return options.reasoningEffort === 'none' && thinkingSwitch !== 'none'
}
