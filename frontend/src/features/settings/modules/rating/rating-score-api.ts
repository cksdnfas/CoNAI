import { apiClient } from '@/lib/api/client'

export interface RatingWeights {
  id: number
  general_weight: number
  sensitive_weight: number
  questionable_weight: number
  explicit_weight: number
  created_at: string
  updated_at: string
}

export interface RatingWeightsUpdate {
  general_weight?: number
  sensitive_weight?: number
  questionable_weight?: number
  explicit_weight?: number
}

export interface RatingTier {
  id: number
  tier_name: string
  min_score: number
  max_score: number | null
  tier_order: number
  color: string | null
  created_at: string
  updated_at: string
}

export interface RatingTierInput {
  tier_name: string
  min_score: number
  max_score: number | null
  tier_order: number
  color?: string | null
}

export interface RatingData {
  general: number
  sensitive: number
  questionable: number
  explicit: number
}

export interface RatingScoreResult {
  score: number
  tier: RatingTier | null
  breakdown: {
    general: number
    sensitive: number
    questionable: number
    explicit: number
  }
  rawRating: RatingData
}

const DEFAULT_WEIGHTS: RatingWeights = {
  id: 0,
  general_weight: 25,
  sensitive_weight: 25,
  questionable_weight: 25,
  explicit_weight: 25,
  created_at: '',
  updated_at: '',
}

export async function getRatingWeights(): Promise<RatingWeights> {
  try {
    const response = await apiClient.get<{ success: boolean; data: RatingWeights }>('/api/settings/rating/weights')
    return response.data.data
  } catch {
    return DEFAULT_WEIGHTS
  }
}

export async function saveRatingWeights(weights: RatingWeightsUpdate): Promise<RatingWeights> {
  const response = await apiClient.put<{ success: boolean; data: RatingWeights; message: string }>('/api/settings/rating/weights', weights)
  return response.data.data
}

export async function getAllRatingTiers(): Promise<RatingTier[]> {
  const response = await apiClient.get<{ success: boolean; data: RatingTier[] }>('/api/settings/rating/tiers')
  return response.data.data
}

export async function createRatingTier(tier: RatingTierInput): Promise<RatingTier> {
  const response = await apiClient.post<{ success: boolean; data: RatingTier; message: string }>('/api/settings/rating/tiers', tier)
  return response.data.data
}

export async function updateRatingTier(id: number, tier: Partial<RatingTierInput>): Promise<RatingTier> {
  const response = await apiClient.put<{ success: boolean; data: RatingTier; message: string }>(`/api/settings/rating/tiers/${id}`, tier)
  return response.data.data
}

export async function deleteRatingTier(id: number): Promise<void> {
  await apiClient.delete<{ success: boolean; message: string }>(`/api/settings/rating/tiers/${id}`)
}

export async function calculateRatingScore(ratingData: RatingData): Promise<RatingScoreResult> {
  const response = await apiClient.post<{ success: boolean; data: RatingScoreResult }>('/api/settings/rating/calculate', ratingData)
  return response.data.data
}
