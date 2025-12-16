import apiClient from './api/apiClient';
import type {
  RatingWeights,
  RatingWeightsUpdate,
  RatingTier,
  RatingTierInput,
  RatingScoreResult,
  RatingData,
} from '../types/rating';

// Base URL for rating settings endpoints
const BASE_URL = '/api/settings/rating';

export const ratingApi = {
  /**
   * Get current rating weight configuration
   */
  getWeights: async (): Promise<RatingWeights> => {
    const response = await apiClient.get<{ success: boolean; data: RatingWeights }>(`${BASE_URL}/weights`);
    return response.data.data;
  },

  /**
   * Update rating weight configuration
   */
  updateWeights: async (weights: RatingWeightsUpdate): Promise<RatingWeights> => {
    const response = await apiClient.put<{ success: boolean; data: RatingWeights; message: string }>(
      `${BASE_URL}/weights`,
      weights
    );
    return response.data.data;
  },

  /**
   * Get all rating tiers
   */
  getAllTiers: async (): Promise<RatingTier[]> => {
    const response = await apiClient.get<{ success: boolean; data: RatingTier[] }>(`${BASE_URL}/tiers`);
    return response.data.data;
  },

  /**
   * Create a new rating tier
   */
  createTier: async (tier: RatingTierInput): Promise<RatingTier> => {
    const response = await apiClient.post<{ success: boolean; data: RatingTier; message: string }>(
      `${BASE_URL}/tiers`,
      tier
    );
    return response.data.data;
  },

  /**
   * Update a specific rating tier
   */
  updateTier: async (id: number, tier: Partial<RatingTierInput>): Promise<RatingTier> => {
    const response = await apiClient.put<{ success: boolean; data: RatingTier; message: string }>(
      `${BASE_URL}/tiers/${id}`,
      tier
    );
    return response.data.data;
  },

  /**
   * Delete a specific rating tier
   */
  deleteTier: async (id: number): Promise<void> => {
    await apiClient.delete<{ success: boolean; message: string }>(`${BASE_URL}/tiers/${id}`);
  },

  /**
   * Update all rating tiers at once (bulk update)
   */
  updateAllTiers: async (tiers: RatingTierInput[]): Promise<RatingTier[]> => {
    const response = await apiClient.put<{ success: boolean; data: RatingTier[]; message: string }>(
      `${BASE_URL}/tiers`,
      tiers
    );
    return response.data.data;
  },

  /**
   * Calculate rating score from rating data (for testing)
   */
  calculateScore: async (ratingData: RatingData): Promise<RatingScoreResult> => {
    const response = await apiClient.post<{ success: boolean; data: RatingScoreResult }>(
      `${BASE_URL}/calculate`,
      ratingData
    );
    return response.data.data;
  },
};
