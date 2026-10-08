import type { ChatJudgeContextSettings } from '@conai/shared'
import { yesNoQuestion, type JudgeAnswer, type JudgeQuestion } from '../judge/judgeEngine'
import type { JudgeLogItem } from './chatJudgeLogs'
import { booksForRequest, keyedLoreEntries } from './chatLoreContext'
import { loreEntryMatches, loreEntryTitle } from './chatLorebook'
import { ChatSummaryStore, recallTerms, selectRecall, splitSegments } from './chatMemory'
import type { ChatProfile } from './chatProfiles'
import type { CodexChatMessageRecord, CodexChatThreadRecord } from './codexChatStore'

/**
 * What a reply is given beyond keywords, decided by the judge before the reply (API LLM and Claude chats, direct and
 * group). Keywords stay the first gate; the judge only adds and filters:
 *   - lore: keyword entries no keyword named, ranked by the words they share with the latest exchange; the closest
 *     few are asked about, and a yes puts the entry in as if a keyword had matched (its delay, cooldown and group still
 *     apply, see selectLoreEntries)
 *   - recall: the past episodes term matching would bring back, and a few near misses; each is asked about, and only
 *     the ones the judge keeps come back
 */

export type JudgedContext = {
  /** Keyword lore entries (by key, see loreEntryKey) the judge put in although no keyword named them. */
  loreKeys: ReadonlySet<string>
  /** Past episodes (summary segment ids) the judge kept; null when recall was not judged (terms alone decide). */
  recallKeep: ReadonlySet<number> | null
}

/** Recent messages the candidates are ranked against: the latest exchange. */
const QUERY_MESSAGES = 2
/** Words in common below this are chance, not the same subject. */
const MIN_SHARED_TERMS = 2
const RECALL_CANDIDATES = 5
const EXCERPT_CHARS = 400

function excerpt(text: string) {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > EXCERPT_CHARS ? `${line.slice(0, EXCERPT_CHARS)}…` : line
}

function sharedTerms(query: Set<string>, text: string) {
  let shared = 0
  for (const term of recallTerms(text)) if (query.has(term)) shared += 1
  return shared
}

/** Keyword entries no keyword named, closest to the latest exchange first. */
function loreCandidates(profile: ChatProfile, thread: CodexChatThreadRecord, messages: CodexChatMessageRecord[], limit: number) {
  const entries = keyedLoreEntries(booksForRequest({ thread, profile }))
  if (entries.length === 0) return []
  const recent = messages.slice(-profile.loreScanDepth).map((message) => [message.content, message.display_content].filter(Boolean).join('\n')).join('\n')
  const folded = recent.toLowerCase()
  const query = recallTerms(messages.filter((message) => message.content.trim()).slice(-QUERY_MESSAGES).map((message) => [message.content, message.display_content].filter(Boolean).join('\n')).join('\n'))
  if (query.size === 0) return []
  return entries
    // A primary keyword that matched already decided the entry (its secondary condition included).
    .filter(({ entry }) => entry.enabled && !entry.constant && entry.content.trim() && !(entry.keys.length > 0 && loreEntryMatches({ ...entry, secondaryKeys: [] }, recent, folded)))
    .map((item) => ({ item, shared: sharedTerms(query, [loreEntryTitle(item.entry), ...item.entry.keys, item.entry.content.slice(0, 1200)].join('\n')) }))
    .filter(({ shared }) => shared >= MIN_SHARED_TERMS)
    .sort((a, b) => b.shared - a.shared || b.item.entry.order - a.item.entry.order)
    .slice(0, limit)
    .map(({ item }) => ({ key: item.key, title: loreEntryTitle(item.entry), content: item.entry.content }))
}

/** Past episodes term matching brings back, plus near misses (fewer words in common), best first. */
function recallCandidates(thread: CodexChatThreadRecord, messages: CodexChatMessageRecord[]) {
  const { folded } = splitSegments(ChatSummaryStore.list(thread.id))
  if (folded.length === 0) return []
  const query = messages.filter((message) => message.content.trim()).slice(-QUERY_MESSAGES).map((message) => message.content).join('\n')
  return selectRecall(folded, query, Number.MAX_SAFE_INTEGER, () => 0, RECALL_CANDIDATES, MIN_SHARED_TERMS)
}

/**
 * The context questions of one reply and how their answers settle into a JudgedContext (plus the log entries).
 * `questions` is empty when there is nothing to ask.
 */
export function contextQuestions(settings: ChatJudgeContextSettings, profile: ChatProfile, thread: CodexChatThreadRecord, messages: CodexChatMessageRecord[]) {
  const lore = settings.lore.enabled ? loreCandidates(profile, thread, messages, settings.lore.candidates) : []
  const recall = settings.recall.enabled ? recallCandidates(thread, messages) : []
  const questions: JudgeQuestion[] = [
    ...lore.map((entry, index) => yesNoQuestion(`lore-${index}`, `Does the latest exchange concern the subject of this reference entry, so the character should have it in mind when replying? Entry "${entry.title}": ${excerpt(entry.content)}`, {
      yes: 'The conversation is about this subject, or what is being said directly involves it',
      no: 'Unrelated, or only a word in common',
    })),
    ...recall.map((segment) => yesNoQuestion(`recall-${segment.id}`, `Does the latest exchange refer back to or continue this earlier episode of the conversation, so recalling it would help the reply? Episode: ${excerpt(segment.content)}`, {
      yes: 'The latest messages bring this episode up again or build on it',
      no: 'The latest messages are about something else',
    })),
  ]

  const settle = (answers: Map<string, JudgeAnswer>) => {
    const loreKeys = new Set<string>()
    const results: JudgeLogItem[] = []
    const result = (itemId: string, name: string, answer: JudgeAnswer | undefined, yes: boolean, action: JudgeLogItem['action']): JudgeLogItem => ({
      itemId, name: name.slice(0, 40), stage: 'before', tools: [],
      probability: answer?.probability ?? null, confidence: answer?.confidence ?? null, choice: null,
      verdict: !answer ? 'uncertain' : yes ? 'yes' : 'no', decidedBy: answer ? 'judge' : 'fallback', action: answer ? action : 'none',
    })
    lore.forEach((entry, index) => {
      const answer = answers.get(`lore-${index}`)
      const yes = Boolean(answer && answer.probability >= settings.lore.threshold)
      if (yes) loreKeys.add(entry.key)
      results.push(result(`lore:${entry.key.split(':').slice(0, 2).join(':')}`, `로어: ${entry.title}`, answer, yes, yes ? 'lore' : 'none'))
    })
    // Recall is judged only when every candidate was answered; otherwise terms alone decide, as without a judge.
    const recallAnswers = recall.map((segment) => answers.get(`recall-${segment.id}`))
    const recallJudged = recall.length > 0 && recallAnswers.every(Boolean)
    const recallKeep = new Set<number>()
    recall.forEach((segment, index) => {
      const answer = recallAnswers[index]
      const keep = Boolean(answer && answer.probability >= settings.recall.threshold)
      if (keep) recallKeep.add(segment.id)
      results.push(result(`recall:${segment.id}`, `회상 #${segment.id}`, answer, keep, keep ? 'recall' : 'drop'))
    })
    const context: JudgedContext = { loreKeys, recallKeep: recallJudged ? recallKeep : null }
    return { context, results }
  }
  return { questions, settle }
}
