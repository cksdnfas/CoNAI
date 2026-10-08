import type { ChatJudgeAssetSettings, ChatJudgeContextSettings, ChatJudgeFieldSettings, ChatJudgeRoomSettings } from '../types/chatJudge'

/** Group rooms: the questions asked when a message names no one, and when the room falls quiet (a preset's empty instructions use these). */
export const DEFAULT_ROUTE_INSTRUCTIONS = 'The user just wrote to the group chat without naming anyone. Which member would most naturally answer this message, given what it is about and who was just talking?'
export const DEFAULT_NEXT_INSTRUCTIONS = 'The group chat just heard the latest message and no one was called by name. Would another member naturally speak up now (to react, answer, or add something), and who? Or has the exchange reached a point where everyone waits for the user?'

export type ChatJudgeOptions = { room: ChatJudgeRoomSettings; context: ChatJudgeContextSettings; fields: ChatJudgeFieldSettings; assets: ChatJudgeAssetSettings }

/** A judge preset's sections beyond its items; a preset without them (or a field of them) reads these. */
export const JUDGE_OPTION_DEFAULTS: ChatJudgeOptions = {
  room: {
    window: 8,
    route: { enabled: true, instructions: '', minProbability: 0.4 },
    next: { enabled: true, instructions: '', continueThreshold: 0.6 },
  },
  context: {
    window: 4,
    lore: { enabled: true, candidates: 6, threshold: 0.65 },
    recall: { enabled: true, threshold: 0.35 },
  },
  fields: { enabled: true, window: 4, threshold: 0.6 },
  assets: { enabled: true },
}
