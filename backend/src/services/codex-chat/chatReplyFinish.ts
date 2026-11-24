import { stripEchoedAddresses, type ChatExecutionContext } from '@conai/shared'
import { stripThinking } from './llmChatContext'
import { trimForeignSpeakerLines } from './groupChatContext'

/** Where a reply's text is being finished: by the engine that wrote it, or by the room on top of that engine's result. */
export type ReplyTextSource = 'llm' | 'codex' | 'room'

export type ReplyTextContext = {
  source: ReplyTextSource
  /** The reply this text belongs to, when the caller has it (a step that must store something for the reply needs it). */
  chat?: ChatExecutionContext
  /** `room` only: the member's own name and the other speakers' names. */
  speakers?: { self: string; others: string[] }
}

type ReplyTextStep = { id: string; sources: readonly ReplyTextSource[]; run(text: string, context: ReplyTextContext): string }

/** The steps every stored reply's text passes, in order. A new reply-text feature is one more step here. */
export const REPLY_TEXT_STEPS: readonly ReplyTextStep[] = [
  // Some servers inline reasoning as `<think>…</think>`; Codex reports it apart, so its text keeps a literal tag.
  { id: 'thinking', sources: ['llm'], run: (text) => stripThinking(text) },
  { id: 'echoed-addresses', sources: ['llm', 'codex', 'room'], run: (text) => stripEchoedAddresses(text) },
  // The member's own lines only; the reply as written when cutting would leave nothing.
  {
    id: 'other-speakers',
    sources: ['room'],
    run: (text, { speakers }) => speakers ? trimForeignSpeakerLines(text, speakers.self, speakers.others) || text.trim() : text,
  },
]

/** The reply's text as stored: each step for `context.source` in order, then trimmed. */
export function finishReplyText(text: string, context: ReplyTextContext): string {
  return REPLY_TEXT_STEPS.reduce((current, step) => step.sources.includes(context.source) ? step.run(current, context) : current, text).trim()
}
