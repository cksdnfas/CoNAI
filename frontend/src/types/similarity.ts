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
