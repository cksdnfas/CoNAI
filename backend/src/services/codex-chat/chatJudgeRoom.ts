import { choiceQuestion } from '../judge/judgeEngine'
import { askBuiltQuestions, judgeConversationOf, logJudgeRun, type JudgeSetup } from './chatJudge'
import { DEFAULT_NEXT_INSTRUCTIONS, DEFAULT_ROUTE_INSTRUCTIONS } from './chatJudgeDefaults'
import type { JudgeLogItem } from './chatJudgeLogs'
import { ChatJudgePresetStore } from './chatJudgePresets'
import { ChatProfileStore, type ChatProfile } from './chatProfiles'
import type { CodexChatMessageRecord, CodexChatThreadRecord } from './codexChatStore'

/**
 * The judge in a group room (rooms with a judge preset only), deciding who speaks:
 *   - route: a user message that names no one goes to the member the judge picks instead of always the representative
 *     (the representative still answers when the judge is unsure or cannot be reached)
 *   - next: when the room falls quiet and no one was called by name, the judge decides whether the exchange goes on —
 *     and who speaks — or the room waits for the user. Each such turn counts against the room's chain limit, like a
 *     member calling another by @mention.
 * Both are one choice question over the members (plus "wait"), so the probability of every member comes back at once.
 */

/** The judge a room asks: its preset with the preset's connection, else the representative's own judge connection. */
export function roomJudgeSetup(thread: Pick<CodexChatThreadRecord, 'kind' | 'judge_preset_id' | 'profile_id'>): JudgeSetup | null {
  if (thread.kind !== 'group' || !thread.judge_preset_id) return null
  const preset = ChatJudgePresetStore.find(thread.judge_preset_id)
  if (!preset) return null
  if (preset.providerName) return { preset, providerName: preset.providerName, model: preset.model }
  const representative = thread.profile_id ? ChatProfileStore.find(thread.profile_id) : null
  return representative?.judgeProviderName ? { preset, providerName: representative.judgeProviderName, model: representative.judgeModel } : null
}

const WAIT = 'wait'
const TAGLINE_CHARS = 160

function memberLabel(member: Pick<ChatProfile, 'id'>) {
  return `m${member.id}`
}

function memberOption(member: Pick<ChatProfile, 'id' | 'name' | 'tagline'>): [string, string, boolean] {
  const tagline = member.tagline.replace(/\s+/g, ' ').trim().slice(0, TAGLINE_CHARS)
  return [memberLabel(member), tagline ? `${member.name}: ${tagline}` : member.name, true]
}

function roomState(thread: CodexChatThreadRecord, members: Array<Pick<ChatProfile, 'name' | 'tagline'>>, messages: CodexChatMessageRecord[], window: number) {
  const { user, conversation } = judgeConversationOf(thread, messages, window)
  return { room: { members: members.map((member) => member.name), user }, conversation }
}

function logItem(itemId: 'route' | 'next', name: string, answer: { probability: number; confidence: number | null } | undefined, choice: string | null, verdict: JudgeLogItem['verdict'], action: JudgeLogItem['action']): JudgeLogItem {
  return {
    itemId, name, stage: itemId, tools: [], choice, verdict, action: answer ? action : 'none',
    probability: answer?.probability ?? null, confidence: answer?.confidence ?? null, decidedBy: answer ? 'judge' : 'fallback',
  }
}

/**
 * The member who answers the user's message `messageId` (the latest one) that names no one, among `members` (those
 * who can answer now); null leaves it to the representative.
 */
export async function judgeRoute(params: { thread: CodexChatThreadRecord; members: ChatProfile[]; messages: CodexChatMessageRecord[]; messageId: number; signal?: AbortSignal }): Promise<number | null> {
  const setup = roomJudgeSetup(params.thread)
  if (!setup || !setup.preset.room.route.enabled || params.members.length < 2) return null
  const settings = setup.preset.room.route
  const question = choiceQuestion('route', settings.instructions || DEFAULT_ROUTE_INSTRUCTIONS, params.members.map(memberOption))
  const asked = await askBuiltQuestions(setup, roomState(params.thread, params.members, params.messages, setup.preset.room.window), [question], params.signal)
  const answer = asked.answers.get('route')
  const picked = answer?.choice ? params.members.find((member) => memberLabel(member) === answer.choice) ?? null : null
  const probability = answer?.choice ? answer.distribution?.[answer.choice] ?? 0 : 0
  const chosen = picked && probability >= settings.minProbability ? picked : null
  logJudgeRun({ setup, threadId: params.thread.id, profileId: null, stage: 'route', messageId: params.messageId, replyId: null, run: {
    connection: asked.connection, request: asked.request, latencyMs: asked.latencyMs, error: asked.error,
    results: [{ ...logItem('route', '답할 사람', answer, picked?.name ?? null, chosen ? 'yes' : 'uncertain', chosen ? 'route' : 'none'), probability: answer ? probability : null }],
  } })
  return chosen?.id ?? null
}

/**
 * Whether the room goes on after its latest reply `message` (by `message.speaker_profile_id`): the member who speaks
 * next among `members` (the speaker left out), or null when the room waits for the user.
 */
export async function judgeNext(params: { thread: CodexChatThreadRecord; members: ChatProfile[]; messages: CodexChatMessageRecord[]; message: CodexChatMessageRecord; signal?: AbortSignal }): Promise<number | null> {
  const setup = roomJudgeSetup(params.thread)
  const candidates = params.members.filter((member) => member.id !== params.message.speaker_profile_id)
  if (!setup || !setup.preset.room.next.enabled || candidates.length === 0) return null
  const settings = setup.preset.room.next
  const speaker = params.message.speaker_profile_id === null ? null : ChatProfileStore.find(params.message.speaker_profile_id)
  const all = speaker && !params.members.some((member) => member.id === speaker.id) ? [...params.members, speaker] : params.members
  const state = roomState(params.thread, all, params.messages, setup.preset.room.window)
  const user = state.room.user
  const question = choiceQuestion('next', settings.instructions || DEFAULT_NEXT_INSTRUCTIONS, [
    ...candidates.map(memberOption),
    [WAIT, `No one speaks now; the room waits for ${user}`, false],
  ])
  const asked = await askBuiltQuestions(setup, state, [question], params.signal)
  const answer = asked.answers.get('next')
  // Going on is the sum over the members; who goes on is the member with the highest probability.
  const goesOn = Boolean(answer && answer.probability >= settings.continueThreshold)
  const best = answer?.distribution
    ? candidates.reduce<ChatProfile | null>((top, member) => (!top || (answer.distribution?.[memberLabel(member)] ?? 0) > (answer.distribution?.[memberLabel(top)] ?? 0) ? member : top), null)
    : null
  const next = goesOn ? best : null
  logJudgeRun({ setup, threadId: params.thread.id, profileId: null, stage: 'next', messageId: params.message.id, replyId: null, run: {
    connection: asked.connection, request: asked.request, latencyMs: asked.latencyMs, error: asked.error,
    results: [logItem('next', '이어 말하기', answer, next?.name ?? (answer ? '(사용자 차례)' : null), !answer ? 'uncertain' : next ? 'yes' : 'no', next ? 'next' : 'wait')],
  } })
  return next?.id ?? null
}
