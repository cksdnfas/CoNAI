import axios from 'axios';
import { API_BASE_URL } from './api';
import type {
  RatingWeights,
  RatingWeightsUpdate,
  RatingTier,
  RatingTierInput,
  RatingScoreResult,
  RatingData,
} from '../types/rating';

const api = axios.create({
  baseURL: `${API_BASE_URL}/api/settings/rating`,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const ratingApi = {
  /**
   * Get current rating weight configuration
   */
  getWeights: async (): Promise<RatingWeights> => {
    const response = await api.get<{ success: boolean; data: RatingWeights }>('/weights');
    return response.data.data;
  },

  /**
   * Update rating weight configuration
   */
  updateWeights: async (weights: RatingWeightsUpdate): Promise<RatingWeights> => {
    const response = await api.put<{ success: boolean; data: RatingWeights; message: string }>(
      '/weights',
      weights
    );
    return response.data.data;
  },

  /**
   * Get all rating tiers
   */
  getAllTiers: async (): Promise<RatingTier[]> => {
    const response = await api.get<{ success: boolean; data: RatingTier[] }>('/tiers');
    return response.data.data;
  },

  /**
   * Create a new rating tier
   */
  createTier: async (tier: RatingTierInput): Promise<RatingTier> => {
    const response = await api.post<{ success: boolean; data: RatingTier; message: string }>(
      '/tiers',
      tier
    );
    return response.data.data;
  },

  /**
   * Update a specific rating tier
   */
  updateTier: async (id: number, tier: Partial<RatingTierInput>): Promise<RatingTier> => {
    const response = await api.put<{ success: boolean; data: RatingTier; message: string }>(
      `/tiers/${id}`,
      tier
    );
    return response.data.data;
  },

  /**
   * Delete a specific rating tier
   */
  deleteTier: async (id: number): Promise<void> => {
    await api.delete<{ success: boolean; message: string }>(`/tiers/${id}`);
  },

  /**
   * Update all rating tiers at once (bulk update)
   */
  updateAllTiers: async (tiers: RatingTierInput[]): Promise<RatingTier[]> => {
    const response = await api.put<{ success: boolean; data: RatingTier[]; message: string }>(
      '/tiers',
      tiers
    );
    return response.data.data;
  },

  /**
   * Calculate rating score from rating data (for testing)
   */
  calculateScore: async (ratingData: RatingData): Promise<RatingScoreResult> => {
    const response = await api.post<{ success: boolean; data: RatingScoreResult }>(
      '/calculate',
      ratingData
    );
    return response.data.data;
  },
};
