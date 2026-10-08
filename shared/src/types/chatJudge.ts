/**
 * Judge presets: a small decision model (TypeSafe Jev, or any LLM connection asked for JSON) reads the recent
 * conversation in its original words and answers fixed questions; each answer steers the API LLM chat turn
 * (tools offered or withheld, a directive added) or decides whether the character sends a follow-up message.
 * Profiles reference a preset; a profile without one behaves exactly as before.
 */

/** Before the reply: steers its tools and directive. After the reply: may trigger a follow-up message. */
export type ChatJudgeStage = 'before' | 'after'

/** `noul`: a yes/no question (probability of yes). `choice`: one of several options, some of which count as yes. */
export type ChatJudgeKind = 'noul' | 'choice'

/** What an answer between the two thresholds does: as if there were no judge, yes, no, or ask an LLM once more. */
export type ChatJudgeUncertain = 'default' | 'yes' | 'no' | 'llm'

export type ChatJudgeVerdict = 'yes' | 'no' | 'uncertain'

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

export type ChatJudgePreset = {
  id: number
  name: string
  /** The judge connection (TypeSafe or an LLM connection); null leaves it to each profile's override. */
  providerName: string | null
  /** Empty uses the connection's default model. */
  model: string
  /** The LLM asked again for uncertain answers set to `llm`; null asks the chat's own connection. */
  escalationProviderName: string | null
  escalationModel: string
  items: ChatJudgeItem[]
  followUp: ChatJudgeFollowUp
  /** Profiles that reference this preset. */
  profiles: Array<{ id: number; name: string }>
  createdDate: string
  updatedDate: string
}

export type ChatJudgePresetInput = Partial<Omit<ChatJudgePreset, 'id' | 'profiles' | 'createdDate' | 'updatedDate'>>

/** One item's answer in a run. */
export type ChatJudgeItemResult = {
  itemId: string
  name: string
  stage: ChatJudgeStage
  /** Probability of yes (choice: the summed probability of the yes options); null when the judge failed. */
  probability: number | null
  confidence: number | null
  /** choice: the option the judge picked. */
  choice: string | null
  verdict: ChatJudgeVerdict
  /** Who settled it: the judge, the escalation LLM, the uncertain setting, or nothing (judge failed). */
  decidedBy: 'judge' | 'llm' | 'setting' | 'fallback'
  /** What the turn did with it. */
  action: 'offered' | 'withheld' | 'none' | 'follow-up'
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
  threadId: number
  threadTitle: string
  profileId: number
  profileName: string
  presetId: number
  presetName: string
  stage: ChatJudgeStage
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
  stage: ChatJudgeStage
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
