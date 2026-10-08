import type { ChatAssetReview } from '@conai/shared'
import { db as imagesDb } from '../../database/init'
import { imageTaggerService } from '../imageTaggerService'
import { ImageSimilarityService } from '../imageSimilarity'
import { settingsService } from '../settingsService'
import { activeMediaFile } from './chatCardAssets'

/** Danbooru general tags; custom emotions have no assumed expectation. */
export const EXPRESSION_EXPECTED_TAGS: Record<string, string[]> = {
  중립: ['neutral_expression', 'expressionless', 'closed_mouth'],
  기쁨: ['smile', 'happy', 'open_mouth'],
  슬픔: ['sad', 'tears', 'crying'],
  분노: ['angry', 'frown'],
  두려움: ['scared', 'trembling'],
  놀람: ['surprised', 'wide-eyed', 'open_mouth'],
  애정: ['smile', 'blush', 'heart'],
  부끄러움: ['blush', 'embarrassed'],
}
export type AssetTagCache = { general: string[]; rating: Record<string, number> }

export function assetTaggerEnabled() { return settingsService.loadSettings().tagger.enabled }

export async function tagAsset(hash: string): Promise<AssetTagCache | null> {
  if (!assetTaggerEnabled()) return null
  const file = activeMediaFile(hash)
  if (!file?.mimeType.startsWith('image/')) return null
  const result = await imageTaggerService.tagImage(file.path)
  return result.success ? { general: Object.keys(result.general ?? {}).map((tag) => tag.replace(/ /g, '_')), rating: result.rating ?? {} } : null
}

const HAIR = new Set(['black_hair', 'blonde_hair', 'brown_hair', 'red_hair', 'blue_hair', 'green_hair', 'purple_hair', 'pink_hair', 'white_hair', 'grey_hair', 'orange_hair', 'silver_hair', 'multicolored_hair'])
const EYES = new Set(['black_eyes', 'blue_eyes', 'brown_eyes', 'red_eyes', 'green_eyes', 'purple_eyes', 'pink_eyes', 'yellow_eyes', 'grey_eyes', 'orange_eyes', 'white_eyes', 'aqua_eyes', 'heterochromia'])
function colorCheck(reference: AssetTagCache | undefined, candidate: AssetTagCache, colors: Set<string>) {
  const before = reference?.general.filter((tag) => colors.has(tag)) ?? []
  const after = candidate.general.filter((tag) => colors.has(tag))
  return { reference: before, candidate: after, matches: before.length && after.length ? before.length === after.length && before.every((tag) => after.includes(tag)) : null }
}

/**
 * Uses the library's already computed hashes, never runs another image analysis on reads. `judged`: the judge's
 * cached reading of an expression candidate (see chatJudgeAssets), when there is one.
 */
export function reviewAsset(kind: string, emotion: string, hash: string, tags: AssetTagCache, reference: AssetTagCache | undefined, others: Array<{ slotKey: string; compositeHash: string }>, judged?: { picked: string; probability: number } | null): ChatAssetReview {
  const expected = kind === 'expression' ? EXPRESSION_EXPECTED_TAGS[emotion] ?? [] : []
  const matched = expected.filter((tag) => tags.general.includes(tag))
  type Hashes = { perceptual_hash: string | null; dhash: string | null; ahash: string | null }
  const read = (id: string) => imagesDb.prepare('SELECT perceptual_hash, dhash, ahash FROM media_metadata WHERE composite_hash = ?').get(id) as Hashes | undefined
  const own = read(hash)
  const similarSlots = others.flatMap((other) => {
    if (other.compositeHash === hash) return [{ ...other, confidence: 100 }]
    const next = read(other.compositeHash)
    if (!own?.perceptual_hash || !own.dhash || !own.ahash || !next?.perceptual_hash || !next.dhash || !next.ahash) return []
    const result = ImageSimilarityService.isSameImage(
      { perceptualHash: own.perceptual_hash, dHash: own.dhash, aHash: own.ahash },
      { perceptualHash: next.perceptual_hash, dHash: next.dhash, aHash: next.ahash },
    )
    return result.isSame ? [{ ...other, confidence: result.confidence }] : []
  })
  return {
    expression: kind === 'expression' ? { expected, matched, matches: expected.length ? matched.length > 0 : null } : null,
    hair: colorCheck(reference, tags, HAIR), eyes: colorCheck(reference, tags, EYES), rating: tags.rating,
    similarSlots,
    judge: kind === 'expression' ? judged ?? null : null,
  }
}
