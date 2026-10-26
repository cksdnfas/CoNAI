import { CATALOG_RUN_TOOL } from '../../mcp/toolCatalog'
import type { ChatCompletionTool, ChatCompletionToolCall } from './llmChatCompletion'

/**
 * Tool calls a model wrote into its reply text because its server did not turn them into `tool_calls` (a server
 * without the model's tool-call parser, or one that drops calls to tools missing from the request): the Hermes form
 * `<tool_call>{"name": …, "arguments": {…}}</tool_call>` and the Qwen XML form
 * `<tool_call><function=name><parameter=key>value</parameter></function></tool_call>`, also with `&lt;` written for `<`.
 * Only calls to tools this request offers are recovered: a direct tool by name, a catalogued one through run_tool.
 */
export type TextToolCallTools = { tools: ChatCompletionTool[]; catalogued: ReadonlySet<string> }

const LT = '(?:<|&lt;)'
const GT = '(?:>|&gt;)'
const BLOCK = new RegExp(`${LT}tool_call${GT}([\\s\\S]*?)(?:${LT}/tool_call${GT}|$)`, 'g')
const FUNCTION = new RegExp(`${LT}function=([\\w.-]+)${GT}([\\s\\S]*?)(?:${LT}/function${GT}|$)`, 'g')
const PARAMETER = new RegExp(`${LT}parameter=([\\w.-]+)${GT}([\\s\\S]*?)(?=${LT}/parameter${GT}|${LT}parameter=|$)(?:${LT}/parameter${GT})?`, 'g')
/** Where a written tool call starts; the stream holds text back from the first of these. */
const MARKERS = ['<tool_call>', '&lt;tool_call>', '&lt;tool_call&gt;', '<function=', '&lt;function=']

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const unescapeHtml = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

/** Fenced code blocks of `text` as [start, end) offsets: a call written inside one is an example, not a call. */
function fencedRanges(text: string) {
  const ranges: Array<[number, number]> = []
  let open: { at: number; fence: string } | null = null
  let at = 0
  for (const line of text.split('\n')) {
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1]
    if (fence && !open) open = { at, fence }
    else if (fence && open && fence[0] === open.fence[0] && fence.length >= open.fence.length && line.trim() === fence) {
      ranges.push([open.at, at + line.length])
      open = null
    }
    at += line.length + 1
  }
  if (open) ranges.push([open.at, text.length])
  return ranges
}

function readCall(body: string, coerce: (tool: string, key: string, value: string) => unknown): { name: string; args: Record<string, unknown> } | null {
  const trimmed = body.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/, '$1')
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      if (!isObject(parsed) || typeof parsed.name !== 'string') return null
      const raw = parsed.arguments ?? parsed.parameters ?? {}
      const args: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
      return isObject(args) ? { name: parsed.name, args } : null
    } catch {
      return null
    }
  }
  const functions = [...trimmed.matchAll(FUNCTION)]
  if (functions.length !== 1) return null
  const [, name, inner] = functions[0]
  const args = Object.fromEntries([...inner.matchAll(PARAMETER)].map(([, key, value]) => [key, coerce(name, key, value.replace(/^\r?\n/, '').replace(/\r?\n$/, ''))]))
  return { name, args }
}

/**
 * The calls written in `text` (outside code blocks) and the text from `from` on without them, or null unless every
 * written call is a usable one. `from`: where the part of the text not yet shown to the reader starts.
 */
function readTextToolCalls(text: string, available: TextToolCallTools | null, from = 0): { text: string; calls: ChatCompletionToolCall[] } | null {
  const direct = new Map((available?.tools ?? []).map((tool) => [tool.function.name, tool]))
  // A string parameter stays as written; anything else is read as JSON when it is JSON (numbers, objects, booleans).
  const coerce = (tool: string, key: string, value: string) => {
    const properties = (direct.get(tool)?.function.parameters as { properties?: Record<string, { type?: unknown }> } | undefined)?.properties
    if (properties?.[key]?.type === 'string') return value
    try { return JSON.parse(value.trim()) } catch { return value }
  }
  const fences = fencedRanges(text)
  const usable = (match: RegExpMatchArray) => match.index! >= from && !fences.some(([start, end]) => match.index! >= start && match.index! < end)
  const spanOf = (match: RegExpMatchArray, body: string) => ({ start: match.index!, end: match.index! + match[0].length, body: match[0].startsWith('&lt;') ? unescapeHtml(body) : body })
  let spans = [...text.matchAll(BLOCK)].filter(usable).map((match) => spanOf(match, match[1]))
  if (spans.length === 0) spans = [...text.matchAll(FUNCTION)].filter(usable).map((match) => spanOf(match, match[0]))
  if (spans.length === 0) return null
  const calls: ChatCompletionToolCall[] = []
  for (const [index, span] of spans.entries()) {
    const call = readCall(span.body, coerce)
    if (!call) return null
    const name = !available || direct.has(call.name) ? call.name : available.catalogued.has(call.name) && direct.has(CATALOG_RUN_TOOL) ? CATALOG_RUN_TOOL : null
    if (!name) return null
    calls.push({
      id: `call_text_${index}_${Date.now().toString(36)}`,
      type: 'function',
      function: { name, arguments: JSON.stringify(name === call.name ? call.args : { tool: call.name, arguments: call.args }) },
    })
  }
  let rest = ''
  let at = from
  for (const span of spans) {
    rest += text.slice(at, span.start)
    at = span.end
  }
  rest += text.slice(at)
  return { text: rest.replace(/\n{3,}/g, '\n\n').trim(), calls }
}

/** Recover executable calls only when every named tool is offered by this request. */
export function parseTextToolCalls(text: string, available: TextToolCallTools, from = 0) {
  return readTextToolCalls(text, available, from)
}

/**
 * Passes streamed text on, but holds it back from the first written tool call on (and a tail that may still become
 * one), so markup that turns into a real call never reaches the reader. `end()` ends a message and returns the held
 * text, always the end of what was pushed (`marked`: it starts with a written call): the caller shows it, or what is
 * left of it once its calls are recovered.
 */
export function textToolCallFilter(onText: (text: string) => void) {
  let held = ''
  let holding = false
  return {
    push(text: string) {
      if (!text) return
      if (holding) {
        held += text
        return
      }
      const buffer = held + text
      const at = Math.min(...MARKERS.map((marker) => { const index = buffer.indexOf(marker); return index < 0 ? Infinity : index }))
      if (at !== Infinity) {
        holding = true
        held = buffer.slice(at)
        if (at > 0) onText(buffer.slice(0, at))
        return
      }
      let keep = 0
      for (const marker of MARKERS) {
        for (let length = Math.min(marker.length - 1, buffer.length); length > keep; length -= 1) {
          if (buffer.endsWith(marker.slice(0, length))) { keep = length; break }
        }
      }
      held = buffer.slice(buffer.length - keep)
      if (buffer.length > keep) onText(buffer.slice(0, buffer.length - keep))
    },
    end() {
      const rest = { text: held, marked: holding }
      held = ''
      holding = false
      return rest
    },
  }
}

/**
 * The calls written in the `held` tail of a message's `text` (what textToolCallFilter kept back): `text` without them,
 * `tail` the part of it still to show, set off from what was already shown. `stripUnavailable`: also remove valid
 * markup for unavailable tools without executing it. Null when no recoverable call syntax was recognized.
 */
export function recoverTextToolCalls(text: string, held: { text: string; marked: boolean }, available: TextToolCallTools, stripUnavailable = false) {
  if (!held.marked || !text.endsWith(held.text)) return null
  const shown = text.slice(0, text.length - held.text.length)
  const executable = parseTextToolCalls(text, available, shown.length)
  const parsed = executable ?? (stripUnavailable ? readTextToolCalls(text, null, shown.length) : null)
  if (!parsed) return null
  const tail = parsed.text ? `${shown && !shown.endsWith('\n\n') ? (shown.endsWith('\n') ? '\n' : '\n\n') : ''}${parsed.text}` : ''
  return { text: shown + tail, tail, calls: executable?.calls ?? [] }
}

const warned = new Map<string, number>()
/** Recovery works around the server; its log says once an hour per model what would fix the cause. */
export function noteTextToolCalls(target: { displayName: string; model: string }) {
  const key = `${target.displayName}\u0000${target.model}`
  if ((warned.get(key) ?? 0) > Date.now()) return
  warned.set(key, Date.now() + 60 * 60_000)
  console.warn(`[llm-chat] ${target.displayName} (${target.model}): tool calls came back as reply text and were recovered; enable the model's tool-call parser on the server (vLLM --enable-auto-tool-choice --tool-call-parser <parser>, llama.cpp --jinja)`)
}
