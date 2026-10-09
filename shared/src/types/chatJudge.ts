/**
 * Judge presets: a small decision model (TypeSafe Jev, or any LLM connection asked for JSON) reads the recent
 * conversation in its original words and answers questions about it. The preset's items steer a chat turn (tools
 * offered or withheld, a directive added) or decide whether the character sends a follow-up message; its other
 * sections decide who speaks in a group room and whether the room goes on, which status fields changed, which lore
 * and past episodes the reply needs, and whether a generated expression image shows its emotion.
 * Profiles and group rooms reference a preset; without one everything behaves exactly as before.
 */

/** Before the reply: steers its tools and directive. After the reply: may trigger a follow-up message. */
export type ChatJudgeStage = 'before' | 'after'

/** `noul`: a yes/no question (probability of yes). `choice`: one of several options, some of which count as yes. */
export type ChatJudgeKind = 'noul' | 'choice'

/** What an answer between the two thresholds does: as if there were no judge, yes, no, or ask an LLM once more. */
export type ChatJudgeUncertain = 'default' | 'yes' | 'no' | 'llm'

export type ChatJudgeVerdict = 'yes' | 'no' | 'uncertain'

/**
 * What a logged run judged: a turn's items (`before` / `after`), who answers an unaddressed message in a group room
 * (`route`), whether the room goes on after a reply (`next`), status fields after a reply (`fields`), or an expression
 * image (`asset`).
 */
export type ChatJudgeRunStage = ChatJudgeStage | 'route' | 'next' | 'fields' | 'asset'

export type ChatJudgeChoiceOption = { label: string; description: string; yes: boolean }

export type ChatJudgeItem = {
  /** Stable within the preset (logs and stats key on it). */
  id: string
  name: string
  enabled: boolean
  stage: ChatJudgeStage
  kind: ChatJudgeKind
  /** The question, best written in English (the judge reads English most reliably). */
  instructions: string
  /** noul: what a yes / a no looks like (optional). */
  criteria: { yes: string; no: string }
  /** choice: the options. */
  options: ChatJudgeChoiceOption[]
  /** Recent messages the judge reads. */
  window: number
  /** Yes at or above; no at or below; between is uncertain. */
  yesThreshold: number
  noThreshold: number
  uncertain: ChatJudgeUncertain
  /**
   * Before the reply: on yes the listed tools stay offered and `directive` is added to the request; on no they are
   * withheld. A trailing `*` matches a prefix (generate_image*). After the reply: yes sends a follow-up message.
   */
  tools: string[]
  directive: string
}

export type ChatJudgeFollowUp = {
  /** Follow-up messages in a row without the user answering. */
  maxConsecutive: number
  /** Seconds to wait before writing one (the user sending a message cancels it). */
  delaySeconds: number
  /** What the chat model is told when it writes the follow-up; empty uses the default. */
  directive: string
}

/** Group rooms that use the preset: who speaks, and when the room goes quiet. */
export type ChatJudgeRoomSettings = {
  /** Recent messages the judge reads. */
  window: number
  /** A user message that names no one: the member the judge picks answers (below `minProbability`: the representative). */
  route: { enabled: boolean; instructions: string; minProbability: number }
  /**
   * The room fell quiet with no one called: another member speaks when the judge's probability that the exchange goes
   * on reaches `continueThreshold` (within the room's chain limit); otherwise the room waits for the user.
   */
  next: { enabled: boolean; instructions: string; continueThreshold: number }
}

/** What a reply is given beyond keywords (API LLM and Claude chats). */
export type ChatJudgeContextSettings = {
  window: number
  /** Keyword lore entries no keyword named: up to `candidates` closest ones are asked about; a yes puts one in. */
  lore: { enabled: boolean; candidates: number; threshold: number }
  /** Recalled past episodes: each candidate is asked about; a no leaves it out. */
  recall: { enabled: boolean; threshold: number }
}

/** Status block fields with a fixed list of values, settled after each reply when the reply left them alone. */
export type ChatJudgeFieldSettings = { enabled: boolean; window: number; threshold: number }

/** Character asset batches: each expression candidate's image tags are asked which emotion they show. */
export type ChatJudgeAssetSettings = { enabled: boolean }

export type ChatJudgePreset = {
  id: number
  name: string
  /** The judge model (a model row of a TypeSafe or LLM connection); null leaves it to each profile's override. */
  modelSlotId: number | null
  /** The LLM model asked again for uncertain answers set to `llm`; null asks the chat's own model. */
  escalationSlotId: number | null
  items: ChatJudgeItem[]
  followUp: ChatJudgeFollowUp
  room: ChatJudgeRoomSettings
  context: ChatJudgeContextSettings
  fields: ChatJudgeFieldSettings
  assets: ChatJudgeAssetSettings
  /** Profiles that reference this preset. */
  profiles: Array<{ id: number; name: string }>
  /** Group rooms that reference this preset. */
  rooms: Array<{ id: number; title: string }>
  createdDate: string
  updatedDate: string
}

/**
 * Older inputs named the judge and escalation models as a connection + model pair (empty model: the connection's
 * primary model); saving lands them on that connection's model row.
 */
export type ChatJudgePresetInput = Partial<Omit<ChatJudgePreset, 'id' | 'profiles' | 'rooms' | 'createdDate' | 'updatedDate'>> & {
  providerName?: string | null
  model?: string | null
  escalationProviderName?: string | null
  escalationModel?: string | null
}

/** One item's answer in a run. */
export type ChatJudgeItemResult = {
  itemId: string
  name: string
  stage: ChatJudgeRunStage
  /** Probability of yes (choice: the summed probability of the yes options); null when the judge failed. */
  probability: number | null
  confidence: number | null
  /** choice: the option the judge picked. */
  choice: string | null
  verdict: ChatJudgeVerdict
  /** Who settled it: the judge, the escalation LLM, the uncertain setting, or nothing (judge failed). */
  decidedBy: 'judge' | 'llm' | 'setting' | 'fallback'
  /**
   * What came of it: tools offered / withheld, a follow-up, the member picked to answer (`route`) or to speak next
   * (`next`), the room waiting for the user (`wait`), a status field set (`set`), a lore entry put in (`lore`), a past
   * episode kept or dropped (`recall` / `drop`).
   */
  action: 'offered' | 'withheld' | 'none' | 'follow-up' | 'route' | 'next' | 'wait' | 'set' | 'lore' | 'recall' | 'drop'
}

/** The per-reply diagnostics record of a judge run (metadata only, never conversation text). */
export type ChatJudgeDiagnostics = {
  runId: number
  presetId: number
  engine: 'typesafe' | 'llm'
  latencyMs: number
  error: string | null
  items: ChatJudgeItemResult[]
}

export type ChatJudgeOutcome = {
  /** Before-stage items with tools: whether the reply called one of them. */
  toolUsed: boolean | null
  /** Items that offer save_lore: the reply's lore proposal and what the user did with it. */
  lore: 'none' | 'proposed' | 'saved' | 'dismissed' | null
  /** After-stage items: whether the follow-up was sent and the user answered after it. */
  followUp: 'none' | 'sent' | 'answered' | null
}

export type ChatJudgeLogItem = ChatJudgeItemResult & { outcome: ChatJudgeOutcome }

export type ChatJudgeLogRun = {
  id: number
  createdAt: string
  /** Null for a run outside a chat (an asset review). */
  threadId: number | null
  threadTitle: string
  /** Null for a group room's own runs (route / next). */
  profileId: number | null
  profileName: string
  presetId: number
  presetName: string
  stage: ChatJudgeRunStage
  engine: 'typesafe' | 'llm'
  providerName: string
  model: string
  latencyMs: number
  error: string | null
  /** The state the judge read (original messages) and the questions, as sent. */
  request: unknown
  items: ChatJudgeLogItem[]
}

export type ChatJudgeItemStats = {
  presetId: number
  itemId: string
  name: string
  stage: ChatJudgeRunStage
  runs: number
  yes: number
  no: number
  uncertain: number
  failed: number
  averageProbability: number | null
  /** Of the yes verdicts with tools: share where the reply used one (null: none to count). */
  toolUseRate: number | null
  /** Of the lore proposals made after a yes: share the user saved. */
  loreSaveRate: number | null
  /** Of the follow-ups sent: share the user answered. */
  followUpAnswerRate: number | null
  averageLatencyMs: number | null
}

export type ChatJudgeTestTurn = {
  messageId: number
  role: 'user' | 'assistant'
  /** The message, cut short, as the tester sees it. */
  excerpt: string
  error: string | null
  items: ChatJudgeItemResult[]
}
