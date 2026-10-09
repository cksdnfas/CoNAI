import { createContext, useContext, type KeyboardEvent } from 'react'
import { Check, CircleMinus, Square, SquareCheck, X } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { useI18n } from '@/i18n'
import type { CodexChatMessage, CodexChatToolCall } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import type { ChatChoiceCard } from './codex-chat-context'

/*
 * Question cards (offer_choices): the open one sits above the composer; once the chat moves on, the reply that asked
 * keeps one line saying what was answered, or that it was passed over.
 */

function choiceOf(call: CodexChatToolCall): ChatChoiceCard | null {
  return call.proposal?.kind === 'choice' ? call.proposal : null
}

/** The card the chat's newest message asks, when that message is a finished reply. */
export function findOpenChoice(messages: CodexChatMessage[]): ChatChoiceCard | null {
  const last = messages[messages.length - 1]
  if (last?.role !== 'assistant' || last.status !== 'completed') return null
  return last.tool_calls.map(choiceOf).filter((card) => card !== null).at(-1) ?? null
}

export type ChatChoiceState = { answers: string[] } | 'passed'

/** What became of each card: the labels the next message answered with, or passed over. Open cards are left out. */
export function chatChoiceStates(messages: CodexChatMessage[]) {
  const states = new Map<number, ChatChoiceState>()
  messages.forEach((message, index) => {
    if (message.role !== 'assistant') return
    const next = messages.slice(index + 1).find((entry) => entry.role === 'user')
    if (!next) return
    for (const card of message.tool_calls.map(choiceOf)) {
      if (!card) continue
      const answers = (next.flags ?? []).filter((flag) => flag.choice?.id === card.id).map((flag) => flag.name)
      states.set(card.id, answers.length ? { answers } : 'passed')
    }
  })
  return states
}

export const ChatChoiceStatesContext = createContext<Map<number, ChatChoiceState> | null>(null)

/** Under a reply that asked: what was answered, or that it was passed over (nothing while it is open). */
export function ChatChoiceLines({ calls }: { calls: CodexChatToolCall[] }) {
  const states = useContext(ChatChoiceStatesContext)
  const cards = calls.map(choiceOf).filter((card) => card !== null)
  if (!states || cards.length === 0) return null
  return cards.map((card) => {
    const state = states.get(card.id)
    if (!state) return null
    return state === 'passed' ? (
      <p key={card.id} className="flex items-center gap-1.5 text-xs text-muted-foreground/75">
        <CircleMinus className="size-3 shrink-0" /><span className="min-w-0 truncate line-through">{card.question}</span>
      </p>
    ) : (
      <p key={card.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Check className="size-3 shrink-0 text-success" /><span className="min-w-0 truncate">{card.question} · {state.answers.join(', ')}</span>
      </p>
    )
  })
}

/**
 * The open card above the composer. A single-answer card sends on click; a multiple-answer card collects picks (shown
 * as chips by the composer) for the send button. The person may type their own answer instead. Digits pick while the
 * card has focus.
 */
export function ChatChoiceDock({ card, selected, disabled, onPick, onClose }: { card: ChatChoiceCard; selected: string[]; disabled: boolean; onPick: (label: string) => void; onClose: () => void }) {
  const { t } = useI18n()
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = Number(event.key) - 1
    if (disabled || event.altKey || event.ctrlKey || event.metaKey || !Number.isInteger(index) || index < 0 || index >= card.options.length) return
    event.preventDefault()
    onPick(card.options[index].label)
  }
  return (
    <div role="group" aria-label={card.question} onKeyDown={handleKeyDown} className="mb-2 rounded-lg border border-line px-1.5 pb-1.5 pt-1.5">
      <div className="flex items-center justify-between gap-2 pb-0.5 pl-2">
        <span className="min-w-0 text-sm font-semibold">{card.question}</span>
        <IconButton variant="ghost" size="icon-xs" label={t({ ko: '닫기', en: 'Close' })} onClick={onClose}><X /></IconButton>
      </div>
      {card.options.map((option, index) => {
        const on = selected.includes(option.label)
        const leading = (
          <span className="flex items-center gap-2.5">
            <span className={cn('flex size-[1.375rem] items-center justify-center rounded-[5px] font-mono text-xs tabular-nums', on && !card.multiple ? 'bg-primary text-primary-foreground' : 'bg-fill text-muted-foreground')}>{index + 1}</span>
            {card.multiple ? (on ? <SquareCheck className="size-4 text-primary" /> : <Square className="size-4 text-muted-foreground" />) : null}
          </span>
        )
        return (
          <ListRow key={option.label} asChild interactive size="sm" leading={leading} className="gap-2.5 rounded-md border-b-0 disabled:cursor-default disabled:opacity-50">
            <button type="button" disabled={disabled} aria-pressed={card.multiple ? on : undefined} onClick={() => onPick(option.label)}>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
                <span className="font-semibold">{option.label}</span>
                {option.detail ? <span className="text-xs text-muted-foreground">{option.detail}</span> : null}
              </span>
            </button>
          </ListRow>
        )
      })}
    </div>
  )
}
