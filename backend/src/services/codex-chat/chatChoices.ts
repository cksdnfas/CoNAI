import { chatFormAnswerLines, chatFormLayout, normalizeChatFormValues, type ChatChoiceProposal, type ChatFormProposal } from '@conai/shared'
import { getUserSettingsDb } from '../../database/userSettingsDb'
import type { ChatFlagSnapshot } from './chatFlags'
import { ChatProposalStore } from './chatProposals'
import type { ChatProfile } from './chatProfiles'
import { translateDisplayFields } from './chatTranslation'
import type { LlmUsageTag } from '../llmUsage'

type BilingualChoice = ChatChoiceProposal & { modelQuestion?: string; modelLabels?: string[] }

/** One translation for the whole card, with the model's originals kept outside its display prose. */
export async function translateChoice(profile: ChatProfile, choice: ChatChoiceProposal, signal: AbortSignal, attribution?: Omit<LlmUsageTag, 'purpose'>): Promise<BilingualChoice> {
  const display = await translateDisplayFields(profile, choice, ['question', 'options.*.label', 'options.*.detail'], signal, attribution)
  signal.throwIfAborted()
  if (!display || new Set(display.options.map(option => option.label)).size !== display.options.length) return choice
  return { ...display, modelQuestion: choice.question, modelLabels: choice.options.map(option => option.label) }
}

type BilingualForm = ChatFormProposal & { model?: Pick<ChatFormProposal, 'title' | 'components'> }

/** The card's words in the display language (title, labels, notes, option and button labels); ids, option values and paths stay the model's. */
export async function translateForm(profile: ChatProfile, form: ChatFormProposal, signal: AbortSignal, attribution?: Omit<LlmUsageTag, 'purpose'>): Promise<BilingualForm> {
  const display = await translateDisplayFields(profile, form, ['title', 'components.*.label', 'components.*.text', 'components.*.placeholder', 'components.*.options.*.label'], signal, attribution)
  signal.throwIfAborted()
  return display ? { ...display, model: { title: form.title, components: form.components } } : form
}

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
 * An input form's answer (show_form): the pressed button is one of the card's, and every value fits its input. Each
 * filled input rides on the message as a pick under the card's title, as a question card's answers do.
 */
function readFormAnswer(form: BilingualForm & { id: number }, input: { action?: unknown; values?: unknown }): { flags: ChatFlagSnapshot[]; withoutPage: boolean } | { error: string } {
  const action = typeof input.action === 'string' && chatFormLayout(form).buttons.some((button) => button.event === input.action) ? input.action : null
  const checked = action ? normalizeChatFormValues(form, input.values) : null
  if (!action || !checked || 'error' in checked) return { error: '카드에 없는 값이야. 다시 골라줘.' }
  // A translated card answers the model in the words it wrote; the person's message shows the words they saw.
  const written = form.model ? chatFormAnswerLines({ ...form, ...form.model }, checked.values, action) : null
  return {
    flags: chatFormAnswerLines(form, checked.values, action).map((line, index) => ({ id: 0, icon: CHOICE_ICON, name: line.name, content: written?.[index]?.content ?? line.content, ...(written ? { displayContent: line.content } : {}), pick: true, choice: { id: form.id, question: form.model?.title ?? form.title, form: true } })),
    withoutPage: false,
  }
}

/**
 * A sent message's answer to the chat's question card (offer_choices), checked against the stored card: the card is the
 * newest reply's, and every label is one of its options (one at most when it takes a single answer). The answers ride on
 * the message as picks; `withoutPage` when one of them asks for this message to go without the connected page. An
 * input form (show_form) is answered the same way, with its button and values (readFormAnswer).
 */
export function readChoiceAnswer(threadId: number, value: unknown): { flags: ChatFlagSnapshot[]; withoutPage: boolean } | { error: string } | null {
  if (value === undefined || value === null) return null
  const input = value as { proposalId?: unknown; answers?: unknown; action?: unknown; values?: unknown }
  const proposalId = Number(input.proposalId)
  const proposal = Number.isSafeInteger(proposalId) && ChatProposalStore.threadIdOf(proposalId) === threadId ? ChatProposalStore.find(proposalId) : null
  if (proposal?.kind !== 'choice' && proposal?.kind !== 'form') return { error: '선택지를 찾을 수 없어.' }
  if (ChatProposalStore.replyIdOf(proposalId) !== latestReplyId(threadId)) return { error: '이 선택지는 이미 지나갔어. 새로 보내줘.' }
  if (proposal.kind === 'form') return readFormAnswer(proposal, input)
  const choice = proposal as BilingualChoice & { id: number }
  const labels = Array.isArray(input.answers) ? [...new Set(input.answers.filter((label): label is string => typeof label === 'string'))] : []
  const options = labels.map((label) => choice.options.find((option) => option.label === label))
  if (labels.length === 0 || options.some((option) => !option) || (!choice.multiple && labels.length > 1)) return { error: '선택지에 없는 답이야.' }
  return {
    flags: labels.map((label) => ({ id: 0, icon: CHOICE_ICON, name: label, content: choice.modelLabels?.[choice.options.findIndex(option => option.label === label)] ?? label, ...(choice.modelLabels ? { displayContent: label } : {}), pick: true, choice: { id: choice.id, question: choice.modelQuestion ?? choice.question } })),
    withoutPage: options.some((option) => option?.withoutPage === true),
  }
}
