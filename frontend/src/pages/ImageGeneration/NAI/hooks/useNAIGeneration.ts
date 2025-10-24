import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { naiApi } from '../../../../services/api';
import api from '../../../../services/api';
import { RESOLUTIONS } from '../constants/nai.constants';
import type { NAIParams, NAIUserData, NAIGenerationResponse } from '../types/nai.types';

/**
 * Anlas 비용 계산 함수 (SMEA 비활성화 버전)
 */
function calculateAnlasCost(params: {
  width: number;
  height: number;
  steps: number;
  n_samples: number;
  uncond_scale: number;
  strength?: number;
  is_opus?: boolean;
}): number {
  const {
    width,
    height,
    steps,
    n_samples,
    uncond_scale,
    strength = 1.0,
    is_opus = false
  } = params;

  // 해상도 계산
  let resolution = Math.max(width * height, 65536);

  // 일반 해상도 정규화
  const NORMAL_PORTRAIT = 832 * 1216;
  const NORMAL_SQUARE = 1024 * 1024;

  if (resolution > NORMAL_PORTRAIT && resolution <= NORMAL_SQUARE) {
    resolution = NORMAL_PORTRAIT;
  }

  // SMEA 비활성화 (배율 1.0)
  const smeaFactor = 1.0;

  // 기본 비용 계산
  let perSample = Math.ceil(
    2.951823174884865e-21 * resolution +
    5.753298233447344e-7 * resolution * steps
  ) * smeaFactor;

  // img2img strength 적용
  perSample = Math.max(Math.ceil(perSample * strength), 2);

  // Undesired Content Strength 보정
  if (uncond_scale !== 1.0) {
    perSample = Math.ceil(perSample * 1.3);
  }

  // Opus 무료 생성 (조건: steps≤28, 일반 해상도 이하)
  const opusDiscount =
    is_opus &&
    steps <= 28 &&
    resolution <= NORMAL_SQUARE ? 1 : 0;

  return perSample * (n_samples - opusDiscount);
}

interface UseNAIGenerationOptions {
  token: string;
  onLogout: () => void;
  onGenerationComplete?: (historyIds: number[]) => void;
}

export function useNAIGeneration({ token, onLogout, onGenerationComplete }: UseNAIGenerationOptions) {
  const { t } = useTranslation(['imageGeneration']);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userData, setUserData] = useState<NAIUserData | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const fetchUserData = async () => {
    if (!token) {
      return;
    }

    try {
      const response = await api.get('/api/nai/user/data', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      setUserData(response.data);
    } catch (err) {
      console.error('[NAI] Failed to fetch user data:', err);
    }
  };

  useEffect(() => {
    if (token) {
      fetchUserData();
    }
  }, [token]);

  const waitForUploadCompletion = async (historyIds: number[]) => {
    const maxAttempts = 30; // 최대 30초 대기
    const pollInterval = 1000; // 1초마다 체크
    let attempts = 0;

    const checkCompletion = async (): Promise<boolean> => {
      try {
        const statuses = await Promise.all(
          historyIds.map(async (id) => {
            try {
              const response = await api.get(`/api/generation-history/${id}`);
              return response.data.record.generation_status === 'completed';
            } catch {
              return false;
            }
          })
        );
        return statuses.every(status => status);
      } catch {
        return false;
      }
    };

    const poll = async () => {
      attempts++;
      const allCompleted = await checkCompletion();

      if (allCompleted) {
        setHistoryRefreshKey(prev => prev + 1);
      } else if (attempts < maxAttempts) {
        setTimeout(poll, pollInterval);
      } else {
        setHistoryRefreshKey(prev => prev + 1);
      }
    };

    poll();
  };

  const executeSingleGeneration = async (
    params: NAIParams,
    groupId: number | null
  ): Promise<NAIGenerationResponse | null> => {
    setGenerating(true);
    setError(null);

    try {
      const resolution = RESOLUTIONS[params.resolution as keyof typeof RESOLUTIONS];
      const response = await naiApi.generateImage(token, {
        ...params,
        width: resolution.width,
        height: resolution.height,
        model: params.model,
        cfg_rescale: params.cfg_rescale,
        noise_schedule: params.noise_schedule,
        uncond_scale: params.uncond_scale,
        groupId: groupId || undefined
      });

      if (response.historyIds && response.historyIds.length > 0) {
        fetchUserData();
        waitForUploadCompletion(response.historyIds);
        if (onGenerationComplete) {
          onGenerationComplete(response.historyIds);
        }
      }

      return response;
    } catch (err: any) {
      if (err.response?.status === 401) {
        onLogout();
        return null;
      } else if (err.response?.status === 402) {
        setError(t('imageGeneration:nai.generate.subscriptionRequired'));
      } else {
        setError(err.response?.data?.error || err.response?.data?.details || t('imageGeneration:nai.generate.error'));
      }
      throw err;
    } finally {
      setGenerating(false);
    }
  };

  // calculateCost를 useCallback으로 메모이제이션
  const calculateCost = useCallback(calculateAnlasCost, []);

  return {
    generating,
    error,
    userData,
    historyRefreshKey,
    setError,
    executeSingleGeneration,
    fetchUserData,
    calculateCost
  };
}
