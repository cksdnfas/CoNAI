import { ImageMetadataRecord } from '../../types/image'
import {
  SimilarImage,
  SimilarityComponentScores,
  SimilarityMatchType,
  SimilaritySearchOptions,
} from '../../types/similarity'
import { ImageSimilarityService } from '../../services/imageSimilarity'
import type { SimilarityCandidateRecord } from './ImageSimilarityQueryBuilder'

export type SimilarityWeights = {
  perceptualHash: number;
  dHash: number;
  aHash: number;
  color: number;
}

export type SimilarityThresholds = {
  perceptualHash: number;
  dHash: number;
  aHash: number;
  color: number;
}

/** Build the initial per-component score state for one candidate. */
function buildSimilarityComponentScores(
  targetImage: ImageMetadataRecord,
  candidate: SimilarityCandidateRecord,
  weights: SimilarityWeights,
  thresholds: SimilarityThresholds,
  targetHistogram: ReturnType<typeof ImageSimilarityService.deserializeHistogram> | null,
): SimilarityComponentScores {
  return {
    perceptualHash: {
      available: Boolean(targetImage.perceptual_hash && candidate.perceptual_hash),
      used: false,
      weight: weights.perceptualHash,
      threshold: thresholds.perceptualHash,
      passed: true,
    },
    dHash: {
      available: Boolean(targetImage.dhash && candidate.dhash),
      used: false,
      weight: weights.dHash,
      threshold: thresholds.dHash,
      passed: true,
    },
    aHash: {
      available: Boolean(targetImage.ahash && candidate.ahash),
      used: false,
      weight: weights.aHash,
      threshold: thresholds.aHash,
      passed: true,
    },
    color: {
      available: Boolean(targetHistogram && candidate.color_histogram),
      used: false,
      weight: weights.color,
      threshold: thresholds.color,
      passed: true,
    },
  }
}

/** Score one hash component and report whether the candidate should be filtered out. */
function scoreHashComponent(
  componentScore: SimilarityComponentScores['perceptualHash'],
  targetHash: string | null | undefined,
  candidateHash: string | null | undefined,
  weight: number,
  threshold: number,
) {
  if (!targetHash || !candidateHash) {
    return {
      componentScore: {
        ...componentScore,
        passed: false,
      },
      shouldSkip: false,
      distance: undefined as number | undefined,
      weightedScore: 0,
      activeWeight: 0,
    }
  }

  const distance = ImageSimilarityService.calculateHammingDistance(targetHash, candidateHash)
  const similarity = ImageSimilarityService.hammingDistanceToSimilarity(distance)
  const nextComponentScore = {
    ...componentScore,
    used: weight > 0,
    passed: distance <= threshold,
    distance,
    similarity,
  }

  if (weight <= 0) {
    return {
      componentScore: nextComponentScore,
      shouldSkip: false,
      distance,
      weightedScore: 0,
      activeWeight: 0,
    }
  }

  if (distance > threshold) {
    return {
      componentScore: nextComponentScore,
      shouldSkip: true,
      distance,
      weightedScore: 0,
      activeWeight: 0,
    }
  }

  return {
    componentScore: nextComponentScore,
    shouldSkip: false,
    distance,
    weightedScore: similarity * weight,
    activeWeight: weight,
  }
}

/** Load the target histogram only when the current search actually needs it. */
export function loadTargetHistogram(
  targetImage: ImageMetadataRecord,
  includeColorSimilarity: boolean,
) {
  if (!includeColorSimilarity || !targetImage.color_histogram) {
    return null
  }

  try {
    return ImageSimilarityService.deserializeHistogram(targetImage.color_histogram)
  } catch (error) {
    console.warn('Failed to deserialize target color histogram:', error)
    return null
  }
}

/** Build one duplicate-search result using pHash, dHash, and aHash together. */
export function buildDuplicateMatch(
  targetImage: ImageMetadataRecord,
  candidate: SimilarityCandidateRecord,
  weights: SimilarityWeights,
  thresholds: SimilarityThresholds,
): SimilarImage | null {
  if (!candidate.perceptual_hash) {
    return null
  }

  const componentScores = buildSimilarityComponentScores(targetImage, candidate, weights, thresholds, null)
  let weightedScoreSum = 0
  let activeWeightSum = 0
  const distanceSamples: number[] = []

  const perceptualScore = scoreHashComponent(
    componentScores.perceptualHash,
    targetImage.perceptual_hash,
    candidate.perceptual_hash,
    weights.perceptualHash,
    thresholds.perceptualHash,
  )
  componentScores.perceptualHash = perceptualScore.componentScore
  if (perceptualScore.shouldSkip) {
    return null
  }
  if (perceptualScore.distance !== undefined && weights.perceptualHash > 0) {
    distanceSamples.push(perceptualScore.distance)
    weightedScoreSum += perceptualScore.weightedScore
    activeWeightSum += perceptualScore.activeWeight
  }

  const dHashScore = scoreHashComponent(
    componentScores.dHash,
    targetImage.dhash,
    candidate.dhash,
    weights.dHash,
    thresholds.dHash,
  )
  componentScores.dHash = dHashScore.componentScore
  if (dHashScore.shouldSkip) {
    return null
  }
  if (dHashScore.distance !== undefined && weights.dHash > 0) {
    distanceSamples.push(dHashScore.distance)
    weightedScoreSum += dHashScore.weightedScore
    activeWeightSum += dHashScore.activeWeight
  }

  const aHashScore = scoreHashComponent(
    componentScores.aHash,
    targetImage.ahash,
    candidate.ahash,
    weights.aHash,
    thresholds.aHash,
  )
  componentScores.aHash = aHashScore.componentScore
  if (aHashScore.shouldSkip) {
    return null
  }
  if (aHashScore.distance !== undefined && weights.aHash > 0) {
    distanceSamples.push(aHashScore.distance)
    weightedScoreSum += aHashScore.weightedScore
    activeWeightSum += aHashScore.activeWeight
  }

  if (activeWeightSum <= 0 || distanceSamples.length === 0) {
    return null
  }

  const averageDistance = distanceSamples.reduce((sum, value) => sum + value, 0) / distanceSamples.length
  const similarity = Math.round((weightedScoreSum / activeWeightSum) * 100) / 100
  const hammingDistance = Math.round(averageDistance * 100) / 100
  const matchType: SimilarityMatchType = ImageSimilarityService.determineMatchType(Math.round(averageDistance))

  return {
    image: candidate as any,
    similarity,
    hammingDistance,
    matchType,
    componentScores,
  }
}

/** Build one hybrid similarity result without changing the public payload shape. */
export function buildSimilarMatch(
  targetImage: ImageMetadataRecord,
  candidate: SimilarityCandidateRecord,
  weights: SimilarityWeights,
  thresholds: SimilarityThresholds,
  targetHistogram: ReturnType<typeof ImageSimilarityService.deserializeHistogram> | null,
): SimilarImage | null {
  if (!candidate.perceptual_hash) {
    return null
  }

  let weightedScoreSum = 0
  let activeWeightSum = 0
  const distanceSamples: number[] = []
  let colorSimilarity: number | undefined
  const componentScores = buildSimilarityComponentScores(targetImage, candidate, weights, thresholds, targetHistogram)

  const perceptualScore = scoreHashComponent(
    componentScores.perceptualHash,
    targetImage.perceptual_hash,
    candidate.perceptual_hash,
    weights.perceptualHash,
    thresholds.perceptualHash,
  )
  componentScores.perceptualHash = perceptualScore.componentScore
  if (perceptualScore.shouldSkip) {
    return null
  }
  if (perceptualScore.distance !== undefined && weights.perceptualHash > 0) {
    distanceSamples.push(perceptualScore.distance)
    weightedScoreSum += perceptualScore.weightedScore
    activeWeightSum += perceptualScore.activeWeight
  }

  const dHashScore = scoreHashComponent(
    componentScores.dHash,
    targetImage.dhash,
    candidate.dhash,
    weights.dHash,
    thresholds.dHash,
  )
  componentScores.dHash = dHashScore.componentScore
  if (dHashScore.shouldSkip) {
    return null
  }
  if (dHashScore.distance !== undefined && weights.dHash > 0) {
    distanceSamples.push(dHashScore.distance)
    weightedScoreSum += dHashScore.weightedScore
    activeWeightSum += dHashScore.activeWeight
  }

  const aHashScore = scoreHashComponent(
    componentScores.aHash,
    targetImage.ahash,
    candidate.ahash,
    weights.aHash,
    thresholds.aHash,
  )
  componentScores.aHash = aHashScore.componentScore
  if (aHashScore.shouldSkip) {
    return null
  }
  if (aHashScore.distance !== undefined && weights.aHash > 0) {
    distanceSamples.push(aHashScore.distance)
    weightedScoreSum += aHashScore.weightedScore
    activeWeightSum += aHashScore.activeWeight
  }

  if (targetHistogram && candidate.color_histogram) {
    try {
      const candidateHistogram = ImageSimilarityService.deserializeHistogram(candidate.color_histogram)
      colorSimilarity = ImageSimilarityService.calculateColorSimilarity(targetHistogram, candidateHistogram)
      componentScores.color = {
        ...componentScores.color,
        used: weights.color > 0,
        passed: colorSimilarity >= thresholds.color,
        similarity: colorSimilarity,
      }

      if (weights.color > 0) {
        if (colorSimilarity < thresholds.color) {
          return null
        }
        weightedScoreSum += colorSimilarity * weights.color
        activeWeightSum += weights.color
      }
    } catch (error) {
      componentScores.color.passed = false
      console.warn('Failed to calculate color similarity:', error)
    }
  }

  if (activeWeightSum <= 0) {
    const fallbackDistance = ImageSimilarityService.calculateHammingDistance(
      targetImage.perceptual_hash!,
      candidate.perceptual_hash,
    )
    if (fallbackDistance > thresholds.perceptualHash) {
      return null
    }
    distanceSamples.push(fallbackDistance)
    weightedScoreSum = ImageSimilarityService.hammingDistanceToSimilarity(fallbackDistance)
    activeWeightSum = 1
  }

  const averageDistance = distanceSamples.length > 0
    ? distanceSamples.reduce((sum, value) => sum + value, 0) / distanceSamples.length
    : 64
  const similarity = Math.round((weightedScoreSum / activeWeightSum) * 100) / 100
  const hammingDistance = Math.round(averageDistance * 100) / 100
  const matchType: SimilarityMatchType = distanceSamples.length > 0
    ? ImageSimilarityService.determineMatchType(Math.round(averageDistance))
    : 'color-similar'

  return {
    image: candidate as any,
    similarity,
    hammingDistance,
    matchType,
    ...(colorSimilarity !== undefined ? { colorSimilarity } : {}),
    componentScores,
  }
}

/** Sort hybrid similarity results using the existing API contract. */
export function sortSimilarResults(
  results: SimilarImage[],
  sortBy: NonNullable<SimilaritySearchOptions['sortBy']>,
  sortOrder: NonNullable<SimilaritySearchOptions['sortOrder']>,
) {
  results.sort((a, b) => {
    let comparison = 0

    if (sortBy === 'similarity') {
      comparison = a.similarity - b.similarity
    } else if (sortBy === 'upload_date') {
      const aDate = (a.image as any).first_seen_date || (a.image as any).upload_date
      const bDate = (b.image as any).first_seen_date || (b.image as any).upload_date
      comparison = new Date(aDate).getTime() - new Date(bDate).getTime()
    } else if (sortBy === 'file_size') {
      const aSize = Number((a.image as any).file_size || 0)
      const bSize = Number((b.image as any).file_size || 0)
      comparison = aSize - bSize
    }

    return sortOrder === 'ASC' ? comparison : -comparison
  })
}

/** Sort duplicate results by similarity first, then by hamming distance. */
export function sortDuplicateResults(results: SimilarImage[]) {
  return results.sort((a, b) => {
    const similarityDiff = b.similarity - a.similarity
    if (similarityDiff !== 0) {
      return similarityDiff
    }
    return a.hammingDistance - b.hammingDistance
  })
}

/** Build one color-search result while preserving the fallback hamming behavior. */
export function buildColorSimilarMatch(
  targetImage: ImageMetadataRecord,
  targetHistogram: ReturnType<typeof ImageSimilarityService.deserializeHistogram>,
  candidate: SimilarityCandidateRecord,
  threshold: number,
): SimilarImage | null {
  if (!candidate.color_histogram) {
    return null
  }

  try {
    const candidateHistogram = ImageSimilarityService.deserializeHistogram(candidate.color_histogram)
    const colorSimilarity = ImageSimilarityService.calculateColorSimilarity(targetHistogram, candidateHistogram)

    if (colorSimilarity < threshold) {
      return null
    }

    let hammingDistance = 64
    if (targetImage.perceptual_hash && candidate.perceptual_hash) {
      hammingDistance = ImageSimilarityService.calculateHammingDistance(
        targetImage.perceptual_hash,
        candidate.perceptual_hash,
      )
    }

    return {
      image: candidate as any,
      similarity: colorSimilarity,
      hammingDistance,
      matchType: 'color-similar',
      colorSimilarity,
    }
  } catch (error) {
    console.warn('Failed to process color histogram:', error)
    return null
  }
}

/** Sort color-only results by descending color similarity. */
export function sortColorSimilarResults(results: SimilarImage[]) {
  results.sort((a, b) => (b.colorSimilarity || 0) - (a.colorSimilarity || 0))
}
