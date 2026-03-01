import { apiClient } from '@/lib/api/client'
import type { ImageRecord } from '@/types/image'

export interface SimilarityThresholds {
  duplicateThreshold: number
  similarThreshold: number
  colorThreshold: number
  searchLimit: number
}

export interface SimilarityStats {
  totalImages: number
  imagesWithHash: number
  imagesWithoutHash: number
  completionPercentage: number
}

export interface SimilaritySettingsSnapshot {
  autoGenerateHashOnUpload: boolean
}

export type SimilaritySearchMode = 'duplicates' | 'similar' | 'color'

export interface SimilaritySearchResult {
  image: ImageRecord
  similarity: number
  hammingDistance?: number
  matchType?: string
  colorSimilarity?: number
}

export interface DuplicateGroup {
  groupId: string
  images: Array<{
    id?: number
    file_id?: number
    composite_hash?: string
    thumbnail_url?: string | null
    original_file_path?: string | null
    width?: number
    height?: number
    filename?: string
  }>
  similarity: number
  matchType: string
}

export async function updateAutoGenerateHashOnUpload(enabled: boolean): Promise<boolean> {
  const response = await apiClient.put<{ success: boolean; data: { similarity: { autoGenerateHashOnUpload: boolean } } }>(
    '/api/settings/similarity',
    { autoGenerateHashOnUpload: enabled },
  )
  return response.data.data.similarity.autoGenerateHashOnUpload
}

export async function getSimilaritySettings(): Promise<SimilaritySettingsSnapshot> {
  const response = await apiClient.get<{ success: boolean; data: { similarity: SimilaritySettingsSnapshot } }>('/api/settings')
  return response.data.data.similarity
}

export async function getSimilarityQueryImage(compositeHash: string): Promise<ImageRecord | null> {
  try {
    const response = await apiClient.get<{ success: boolean; data?: ImageRecord }>(`/api/images/${compositeHash}`)
    return response.data.data ?? null
  } catch {
    return null
  }
}

export async function testSimilaritySearch(
  imageId: string,
  mode: SimilaritySearchMode,
  options: { duplicateThreshold: number; similarThreshold: number; colorThreshold: number; limit: number },
): Promise<SimilaritySearchResult[]> {
  if (mode === 'duplicates') {
    const response = await apiClient.get<{ success: boolean; data: { similar: SimilaritySearchResult[] } }>(`/api/images/${imageId}/duplicates`, {
      params: { threshold: options.duplicateThreshold, includeMetadata: true },
    })
    return response.data.data.similar ?? []
  }

  if (mode === 'color') {
    const response = await apiClient.get<{ success: boolean; data: { similar: SimilaritySearchResult[] } }>(`/api/images/${imageId}/similar-color`, {
      params: { threshold: options.colorThreshold, limit: options.limit },
    })
    return response.data.data.similar ?? []
  }

  const response = await apiClient.get<{ success: boolean; data: { similar: SimilaritySearchResult[] } }>(`/api/images/${imageId}/similar`, {
    params: {
      threshold: options.similarThreshold,
      limit: options.limit,
      includeColorSimilarity: true,
      sortBy: 'similarity',
      sortOrder: 'DESC',
    },
  })
  return response.data.data.similar ?? []
}

export async function getSimilarityThresholds(): Promise<SimilarityThresholds> {
  return {
    duplicateThreshold: 5,
    similarThreshold: 15,
    colorThreshold: 85,
    searchLimit: 20,
  }
}

export async function getSimilarityStats(): Promise<SimilarityStats | null> {
  try {
    const response = await apiClient.get<{ success: boolean; data: SimilarityStats }>('/api/images/similarity/stats')
    return response.data.data
  } catch {
    return null
  }
}

export async function rebuildSimilarityHashes(limit = 50): Promise<{ processed: number; total: number; failed: number; remaining: number } | null> {
  try {
    const response = await apiClient.post<{ success: boolean; data: { processed: number; total: number; failed?: number; remaining?: number } }>(
      '/api/images/similarity/rebuild',
      null,
      { params: { limit } },
    )
    return {
      processed: response.data.data.processed,
      total: response.data.data.total,
      failed: response.data.data.failed ?? 0,
      remaining: response.data.data.remaining ?? 0,
    }
  } catch {
    return null
  }
}

export async function findDuplicateGroups(threshold = 5, minGroupSize = 2): Promise<DuplicateGroup[]> {
  const response = await apiClient.get<{ success: boolean; data: { groups: DuplicateGroup[] } }>('/api/images/duplicates/all', {
    params: { threshold, minGroupSize },
  })
  return response.data.data.groups ?? []
}
