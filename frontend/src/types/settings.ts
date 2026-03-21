export type SimilaritySortBy = 'similarity' | 'upload_date' | 'file_size'
export type SimilaritySortOrder = 'ASC' | 'DESC'

export interface SimilaritySettings {
  autoGenerateHashOnUpload: boolean
  detailSimilarThreshold: number
  detailSimilarLimit: number
  detailSimilarIncludeColorSimilarity: boolean
  detailSimilarSortBy: SimilaritySortBy
  detailSimilarSortOrder: SimilaritySortOrder
}

export interface AppSettings {
  similarity: SimilaritySettings
}
