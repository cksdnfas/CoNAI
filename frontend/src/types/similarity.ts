import type { ImageRecord } from '@/types/image'

export interface SimilarityHashComponentScore {
  available: boolean
  used: boolean
  weight: number
  threshold: number
  passed: boolean
  distance?: number
  similarity?: number
}

export interface SimilarityColorComponentScore {
  available: boolean
  used: boolean
  weight: number
  threshold: number
  passed: boolean
  similarity?: number
}

export interface SimilarityComponentScores {
  perceptualHash: SimilarityHashComponentScore
  dHash: SimilarityHashComponentScore
  aHash: SimilarityHashComponentScore
  color: SimilarityColorComponentScore
}

export interface SimilarImage {
  image: ImageRecord
  similarity: number
  hammingDistance: number
  matchType: 'exact' | 'near-duplicate' | 'similar' | 'color-similar'
  colorSimilarity?: number
  componentScores?: SimilarityComponentScores
}

export interface SimilarityQueryResult {
  similar: SimilarImage[]
  total: number
  query: {
    imageId: string | number
    threshold: number
    limit: number
  }
}

export interface PromptSimilarityFieldScore {
  similarity: number
  threshold: number
  passed: boolean
  exact: boolean
  hasSource: boolean
  hasTarget: boolean
}

export interface PromptSimilarImage {
  image: ImageRecord
  combinedSimilarity: number
  positive: PromptSimilarityFieldScore
  negative: PromptSimilarityFieldScore
  auto: PromptSimilarityFieldScore
}

export interface PromptSimilarityQueryResult {
  items: PromptSimilarImage[]
  total: number
  source: {
    compositeHash: string
  }
}
