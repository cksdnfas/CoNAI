/**
 * NovelAI API
 *
 * NovelAI integration for image generation:
 * - Authentication (login with credentials or token)
 * - Image generation with comprehensive parameters
 * - Support for img2img, inpaint, and Vibe Transfer
 */

import apiClient from './apiClient';

export const naiApi = {
  /**
   * Login to NovelAI with email and password
   */
  login: async (
    username: string,
    password: string
  ): Promise<{ accessToken: string; expiresAt: string }> => {
    const response = await apiClient.post('/api/nai/auth/login', { username, password });
    return response.data;
  },

  /**
   * Login to NovelAI with token
   */
  loginWithToken: async (token: string): Promise<{ accessToken: string; expiresAt: string }> => {
    const response = await apiClient.post('/api/nai/auth/login-with-token', { token });
    return response.data;
  },

  /**
   * Generate image with NovelAI
   */
  generateImage: async (
    token: string,
    params: {
      prompt: string;
      negative_prompt?: string;
      model?: string;
      width?: number;
      height?: number;
      steps?: number;
      scale?: number;
      sampler?: string;
      n_samples?: number;
      sm?: boolean;
      sm_dyn?: boolean;
      cfg_rescale?: number;
      noise_schedule?: string;
      uncond_scale?: number;
      qualityToggle?: boolean;
      seed?: number;
      groupId?: number;
      // img2img/inpaint related
      image?: string;
      strength?: number;
      noise?: number;
      mask?: string;
      // Vibe Transfer
      reference_image_multiple?: string[];
      reference_strength_multiple?: number[];
    }
  ): Promise<{
    historyIds: number[];
    count: number;
    metadata: {
      prompt: string;
      negative_prompt: string;
      seed: number;
      resolution: string;
      steps: number;
      scale: number;
      sampler: string;
      model: string;
    };
  }> => {
    const response = await apiClient.post('/api/nai/generate/image', params, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return response.data;
  },
};
