import type { ChatChoiceProposal } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import type { ChatFlagSnapshot } from './chatFlags'
import { ChatProposalStore } from './chatProposals'

const CHOICE_ICON = 'lucide:list-checks'

/** The reply the chat's newest message belongs to, when that message is the model's. */
function latestReplyId(threadId: number): string | null {
  const row = getUserSettingsDb().prepare('SELECT role, routing FROM codex_chat_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 1').get(threadId) as { role: string; routing: string | null } | undefined
  if (row?.role !== 'assistant' || !row.routing) return null
  try {
    const routing = JSON.parse(row.routing) as { replyId?: unknown }
    return typeof routing.replyId === 'string' ? routing.replyId : null
  } catch {
    return null
  }
}

/**
 * A sent message's answer to the chat's question card (offer_choices), checked against the stored card: the card is the
 * newest reply's, and every label is one of its options (one at most when it takes a single answer). The answers ride on
 * the message as picks; `withoutPage` when one of them asks for this message to go without the connected page.
 */
export function readChoiceAnswer(threadId: number, value: unknown): { flags: ChatFlagSnapshot[]; withoutPage: boolean } | { error: string } | null {
  if (value === undefined || value === null) return null
  const input = value as { proposalId?: unknown; answers?: unknown }
  const proposalId = Number(input.proposalId)
  const proposal = Number.isSafeInteger(proposalId) && ChatProposalStore.threadIdOf(proposalId) === threadId ? ChatProposalStore.find(proposalId) : null
  if (proposal?.kind !== 'choice') return { error: '선택지를 찾을 수 없어.' }
  if (ChatProposalStore.replyIdOf(proposalId) !== latestReplyId(threadId)) return { error: '이 선택지는 이미 지나갔어. 새로 보내줘.' }
  const choice = proposal as ChatChoiceProposal & { id: number }
  const labels = Array.isArray(input.answers) ? [...new Set(input.answers.filter((label): label is string => typeof label === 'string'))] : []
  const options = labels.map((label) => choice.options.find((option) => option.label === label))
  if (labels.length === 0 || options.some((option) => !option) || (!choice.multiple && labels.length > 1)) return { error: '선택지에 없는 답이야.' }
  return {
    flags: labels.map((label) => ({ id: 0, icon: CHOICE_ICON, name: label, content: label, pick: true, choice: { id: choice.id, question: choice.question } })),
    withoutPage: options.some((option) => option?.withoutPage === true),
  }
}
