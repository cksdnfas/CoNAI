import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { enqueueSnackbar } from 'notistack';
import { naiApi, generationHistoryApi } from '../../../../services/api';
import api from '../../../../services/api';
import { RESOLUTIONS } from '../constants/nai.constants';
import type { NAIParams, NAIUserData, NAIGenerationResponse, ResolutionConfig } from '../types/nai.types';
import { parseWildcards } from '../../../../utils/wildcardParser';
import { cleanPrompt, isPromptEmpty } from '../../../../utils/promptCleaner';

/**
 * 해상도 설정에서 실제 width/height 선택
 */
function selectResolution(config: ResolutionConfig): { width: number; height: number } {
  let selected: { width: number; height: number };

  if (config.mode === 'fixed') {
    // 고정 모드: 선택된 해상도 사용
    if (config.fixed in RESOLUTIONS) {
      selected = RESOLUTIONS[config.fixed as keyof typeof RESOLUTIONS];
    } else if (config.fixed.startsWith('custom_')) {
      const customId = config.fixed.replace('custom_', '');
      const custom = config.customResolutions.find(r => r.id === customId);
      if (custom) {
        selected = { width: custom.width, height: custom.height };
      } else {
        // 폴백: 기본 해상도
        selected = { width: 832, height: 1216 };
      }
    } else {
      // 폴백: 기본 해상도
      selected = { width: 832, height: 1216 };
    }
  } else {
    // 랜덤 모드: 선택된 해상도들 중 무작위
    if (config.random.length === 0) {
      // 선택된 해상도가 없으면 기본값
      selected = { width: 832, height: 1216 };
    } else {
      const randomKey = config.random[Math.floor(Math.random() * config.random.length)];

      if (randomKey in RESOLUTIONS) {
        selected = RESOLUTIONS[randomKey as keyof typeof RESOLUTIONS];
      } else if (randomKey.startsWith('custom_')) {
        const customId = randomKey.replace('custom_', '');
        const custom = config.customResolutions.find(r => r.id === customId);
        if (custom) {
          selected = { width: custom.width, height: custom.height };
        } else {
          selected = { width: 832, height: 1216 };
        }
      } else {
        selected = { width: 832, height: 1216 };
      }
    }
  }

  // 가로세로 전환 적용
  if (config.swapDimensions) {
    if (config.mode === 'random') {
      // 랜덤 모드 + 전환: 50% 확률로 전환
      if (Math.random() < 0.5) {
        return { width: selected.height, height: selected.width };
      }
    } else {
      // 고정 모드 + 전환: 항상 전환
      return { width: selected.height, height: selected.width };
    }
  }

  return selected;
}

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
}): number {
  const {
    width,
    height,
    steps,
    n_samples,
    uncond_scale,
    strength = 1.0
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

  // 실제 Anlas 비용 계산 (Opus 무료 생성 로직 제거)
  return perSample * n_samples;
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
    const maxAttempts = 30; // 최대 15초 대기 (500ms * 30)
    const pollInterval = 500;

    console.log(`[NAI] Starting upload completion polling for ${historyIds.length} images...`);

    return new Promise<void>((resolve) => {
      let attempts = 0;
      let timeoutId: NodeJS.Timeout | null = null;

      const checkStatus = async () => {
        attempts++;

        try {
          // 캐시 무효화를 위한 타임스탬프 추가
          const statuses = await Promise.all(
            historyIds.map(async (id) => {
              try {
                const response = await generationHistoryApi.getById(id, true);
                console.log(`[NAI] History ${id} response:`, {
                  success: response.success,
                  hasRecord: !!response.record,
                  status: response.record?.generation_status
                });

                if (!response || !response.record) {
                  console.error(`[NAI] Invalid response for history ${id}:`, response);
                  return false;
                }

                const status = response.record.generation_status;
                const isCompleted = status === 'completed';
                console.log(`[NAI] History ${id}: status="${status}", completed=${isCompleted}`);
                return isCompleted;
              } catch (error) {
                console.error(`[NAI] Failed to check history ${id}:`, error);
                return false;
              }
            })
          );

          const completedCount = statuses.filter(s => s).length;
          console.log(`[NAI] Polling ${attempts}/${maxAttempts}: ${completedCount}/${statuses.length} completed`);

          // All images saved
          if (statuses.every(status => status)) {
            console.log('[NAI] All images saved! Refreshing history...');
            if (timeoutId) clearTimeout(timeoutId);

            // refreshKey 업데이트 후 resolve
            setHistoryRefreshKey(prev => {
              const newKey = prev + 1;
              console.log(`[NAI] historyRefreshKey: ${prev} → ${newKey}`);

              // setState는 비동기이므로 다음 틱에 resolve
              setTimeout(() => resolve(), 0);

              return newKey;
            });
            return;
          }

          // Timeout check
          if (attempts >= maxAttempts) {
            console.warn(`[NAI] Polling timeout. Forcing refresh...`);
            if (timeoutId) clearTimeout(timeoutId);

            setHistoryRefreshKey(prev => {
              const newKey = prev + 1;
              setTimeout(() => resolve(), 0);
              return newKey;
            });
            return;
          }

          // Continue polling
          timeoutId = setTimeout(checkStatus, pollInterval);
        } catch (error) {
          console.error('[NAI] Completion check failed:', error);

          if (attempts >= maxAttempts) {
            if (timeoutId) clearTimeout(timeoutId);
            setHistoryRefreshKey(prev => prev + 1);
            resolve();
            return;
          }

          timeoutId = setTimeout(checkStatus, pollInterval);
        }
      };

      checkStatus();
    });
  };

  const executeSingleGeneration = async (
    params: NAIParams,
    groupId: number | null
  ): Promise<NAIGenerationResponse | null> => {
    setGenerating(true);
    setError(null);

    try {
      // 해상도 선택 (고정/랜덤 모드 + 가로세로 전환 적용)
      const resolution = selectResolution(params.resolutionConfig);

      // 와일드카드 파싱
      const promptParseResult = await parseWildcards(params.prompt, 'nai');
      const negativePromptParseResult = params.negative_prompt
        ? await parseWildcards(params.negative_prompt, 'nai')
        : { text: params.negative_prompt || '', emptyWildcards: [] };

      // 빈 와일드카드 수집
      const allEmptyWildcards = [
        ...promptParseResult.emptyWildcards,
        ...negativePromptParseResult.emptyWildcards
      ];

      // 빈 와일드카드 경고
      if (allEmptyWildcards.length > 0) {
        const uniqueEmpty = Array.from(new Set(allEmptyWildcards));
        enqueueSnackbar(
          `다음 와일드카드에 NAI 항목이 없습니다: ${uniqueEmpty.join(', ')}`,
          { variant: 'warning', autoHideDuration: 5000 }
        );
      }

      // 프롬프트 전처리: 빈 문자열과 중복 쉼표 제거
      const cleanedPrompt = cleanPrompt(promptParseResult.text);
      const cleanedNegativePrompt = cleanPrompt(negativePromptParseResult.text);

      // 최종 프롬프트가 완전히 비어있는지 확인
      if (isPromptEmpty(cleanedPrompt)) {
        enqueueSnackbar(
          t('imageGeneration:nai.errors.emptyPrompt'),
          { variant: 'error', autoHideDuration: 5000 }
        );
        setError(t('imageGeneration:nai.errors.emptyPrompt'));
        setGenerating(false);
        return null;
      }

      console.log(`[NAI Wildcard] Parsing complete:`, {
        originalPrompt: params.prompt.substring(0, 100),
        parsedPrompt: promptParseResult.text.substring(0, 100),
        cleanedPrompt: cleanedPrompt.substring(0, 100),
        originalNegative: params.negative_prompt?.substring(0, 100),
        parsedNegative: negativePromptParseResult.text?.substring(0, 100),
        cleanedNegative: cleanedNegativePrompt?.substring(0, 100),
        wasChanged: params.prompt !== cleanedPrompt || params.negative_prompt !== cleanedNegativePrompt,
        emptyWildcards: allEmptyWildcards
      });

      console.log(`[NAI] Selected resolution: ${resolution.width}×${resolution.height}`, {
        mode: params.resolutionConfig.mode,
        swap: params.resolutionConfig.swapDimensions
      });

      const response = await naiApi.generateImage(token, {
        ...params,
        prompt: cleanedPrompt,
        negative_prompt: cleanedNegativePrompt,
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
