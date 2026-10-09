import { choiceQuestion } from '../judge/judgeEngine'
import { EXPRESSION_EXPECTED_TAGS, type AssetTagCache } from './chatAssetReview'
import { askBuiltQuestions, judgeSetupOf, logJudgeRun } from './chatJudge'
import type { ChatProfile } from './chatProfiles'

/**
 * Expression candidates read by the judge: the tagger's tags of one generated image, and the batch's emotions as the
 * options — which one does the face show? The probability it gives the slot's own emotion goes with the candidate's
 * review (`judge`), so a custom emotion (no expected tags) is checked too. Profiles whose judge preset reviews assets
 * only; nothing here throws.
 */

/** Tags the judge reads, at most (the tagger lists the surest first). */
const TAGS_MAX = 60

export type ExpressionJudgement = { picked: string; probability: number }

/** Whether this profile's judge reviews assets (and with which setup). */
export function assetJudgeSetup(profile: ChatProfile | null | undefined) {
  if (!profile) return null
  const setup = judgeSetupOf(profile)
  return setup?.preset.assets.enabled ? setup : null
}

export async function judgeExpression(params: { profile: ChatProfile; emotions: string[]; emotion: string; tags: AssetTagCache; signal?: AbortSignal }): Promise<ExpressionJudgement | null> {
  const setup = assetJudgeSetup(params.profile)
  const emotions = [...new Set(params.emotions)]
  if (!setup || emotions.length < 2 || !emotions.includes(params.emotion) || params.tags.general.length === 0) return null
  const options = emotions.map((emotion, index): [string, string, boolean] => {
    const expected = EXPRESSION_EXPECTED_TAGS[emotion]
    return [`e${index + 1}`, expected?.length ? `${emotion} (typical tags: ${expected.join(', ')})` : emotion, emotion === params.emotion]
  })
  const question = choiceQuestion('emotion', `Judging from the image tags of this character portrait, which facial expression or emotion does it show?`, options)
  const state = { character: params.profile.name, imageTags: params.tags.general.slice(0, TAGS_MAX) }
  try {
    const asked = await askBuiltQuestions(setup, state, [question], params.signal)
    const answer = asked.answers.get('emotion')
    const picked = answer?.choice ? emotions[Number(answer.choice.slice(1)) - 1] ?? null : null
    logJudgeRun({ setup, threadId: null, profileId: params.profile.id, stage: 'asset', messageId: null, replyId: null, run: {
      connection: asked.connection, request: asked.request, latencyMs: asked.latencyMs, tokens: asked.tokens, error: asked.error,
      results: [{
        itemId: 'emotion', name: `표정: ${params.emotion}`.slice(0, 40), stage: 'asset', tools: [],
        probability: answer?.probability ?? null, confidence: answer?.confidence ?? null, choice: picked,
        verdict: !answer ? 'uncertain' : picked === params.emotion ? 'yes' : 'no', decidedBy: answer ? 'judge' : 'fallback', action: 'none',
      }],
    } })
    return answer && picked ? { picked, probability: answer.probability } : null
  } catch (error) {
    console.warn('[chat-judge] expression review failed:', error instanceof Error ? error.message : error)
    return null
  }
}
