import type { ImageRecord } from '@/types/image'

export interface SimilarImage {
  image: ImageRecord
  similarity: number
  hammingDistance: number
  matchType: 'exact' | 'near-duplicate' | 'similar' | 'color-similar'
  colorSimilarity?: number
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
