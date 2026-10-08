import type { ChatJudgeFollowUp, ChatJudgeItem } from '@conai/shared'

/**
 * The built-in judge presets, seeded once when the presets table is first made. Questions are in English (the
 * decision model reads English most reliably); the conversation it reads stays in its original words. Directives go
 * to the chat model with the user's message, in the chat's own bracketed Korean style.
 */

export const JUDGE_ITEM_DEFAULTS: Omit<ChatJudgeItem, 'id' | 'name' | 'stage' | 'instructions'> = {
  enabled: true,
  kind: 'noul',
  criteria: { yes: '', no: '' },
  options: [],
  window: 6,
  yesThreshold: 0.7,
  noThreshold: 0.3,
  uncertain: 'default',
  tools: [],
  directive: '',
}

export const DEFAULT_FOLLOW_UP_DIRECTIVE = '[후속] 사용자는 아직 답하지 않았어. 방금 네 메시지에 자연스럽게 이어지는 짧은 메시지를 하나 더 보내. 덧붙이고 싶은 생각, 행동, 질문 같은 거야. 방금 한 말을 되풀이하지 마.'

export const JUDGE_FOLLOW_UP_DEFAULTS: ChatJudgeFollowUp = { maxConsecutive: 1, delaySeconds: 8, directive: '' }

const LORE_TOOLS = ['save_lore']
const IMAGE_TOOLS = ['generate_image*', 'generate_nai', 'generate_comfyui*', 'submit_generation_job']

const loreItem: ChatJudgeItem = {
  ...JUDGE_ITEM_DEFAULTS,
  id: 'lore',
  name: '로어북',
  stage: 'before',
  instructions: 'Did the latest exchange bring up a lasting fact worth remembering for later conversations: a promise, a plan, a preference, a relationship, who someone is, or an explicit request to remember something?',
  criteria: {
    yes: 'A new durable fact about the user, the character or their relationship, or the user asks to remember or save something',
    no: 'Small talk, a passing mood, or something already known in the conversation',
  },
  window: 4,
  yesThreshold: 0.75,
  noThreshold: 0.35,
  tools: LORE_TOOLS,
  directive: '[판단] 방금 대화에 오래 기억해 둘 사실이 나왔어. 이번 답변에서 save_lore로 로어 항목을 제안해.',
}

const imageItem: ChatJudgeItem = {
  ...JUDGE_ITEM_DEFAULTS,
  id: 'image',
  name: '이미지 생성',
  stage: 'before',
  instructions: 'Is this a moment where showing an image would add to the conversation: the user asks to see something, or the scene just changed in a clearly visual way (a new outfit, place, pose or striking moment)?',
  criteria: {
    yes: 'The user asks for a picture or photo, or a distinctly visual new scene, look or moment just happened',
    no: 'Ordinary dialogue with nothing new to show',
  },
  window: 4,
  yesThreshold: 0.7,
  noThreshold: 0.3,
  tools: IMAGE_TOOLS,
  directive: '[판단] 지금은 장면을 이미지로 보여주기 좋은 순간이야. 이번 답변에서 이미지 생성 도구를 써.',
}

const followUpItem: ChatJudgeItem = {
  ...JUDGE_ITEM_DEFAULTS,
  id: 'follow-up',
  name: '후속 메시지',
  stage: 'after',
  instructions: 'Would this character naturally send one more message right now, before the user replies: the last message trails off, the character is clearly eager to add something, or a quick follow-up would feel natural in a chat?',
  criteria: {
    yes: 'The character would plausibly keep texting: an unfinished thought, an excited follow-up, a reaction to their own message',
    no: 'The message is complete and waits for the user, such as a question to the user or a natural pause',
  },
  window: 4,
  yesThreshold: 0.8,
  noThreshold: 0.4,
  tools: [],
  directive: '',
}

const clarifyItem: ChatJudgeItem = {
  ...JUDGE_ITEM_DEFAULTS,
  id: 'clarify',
  name: '확인 질문',
  stage: 'before',
  instructions: 'Is the user\'s latest request ambiguous enough that an assistant should ask one clarifying question before acting on it?',
  criteria: {
    yes: 'Key details are missing or the request can reasonably mean very different things',
    no: 'The request is clear enough to act on, or it is not a request',
  },
  window: 4,
  yesThreshold: 0.75,
  noThreshold: 0.35,
  tools: [],
  directive: '[판단] 요청이 모호해. 바로 작업하지 말고 필요한 점을 한 가지만 먼저 물어봐.',
}

const assistantLoreItem: ChatJudgeItem = {
  ...loreItem,
  name: '작업 기록',
  instructions: 'Did the user state a lasting preference, rule, setting or fact about their work that the assistant should remember for later sessions, or ask the assistant to remember something?',
  criteria: {
    yes: 'A durable preference, convention, project fact, or an explicit request to remember',
    no: 'A one-off task detail or ordinary conversation',
  },
  directive: '[판단] 사용자가 앞으로도 기억할 선호나 사실을 말했어. 이번 답변에서 save_lore로 기록을 제안해.',
}

export const DEFAULT_JUDGE_PRESETS: Array<{ name: string; items: ChatJudgeItem[]; followUp: ChatJudgeFollowUp }> = [
  { name: '캐릭터 롤플레이', items: [loreItem, imageItem, followUpItem], followUp: JUDGE_FOLLOW_UP_DEFAULTS },
  { name: '어시스턴트', items: [assistantLoreItem, clarifyItem], followUp: { ...JUDGE_FOLLOW_UP_DEFAULTS, maxConsecutive: 0 } },
]
