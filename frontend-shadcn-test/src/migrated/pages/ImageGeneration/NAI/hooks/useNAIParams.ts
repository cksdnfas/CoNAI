import { useState, useEffect } from 'react';
import { DEFAULT_PARAMS, DEFAULT_RESOLUTION_CONFIG, PARAMS_STORAGE_KEY } from '../constants/nai.constants';
import type { NAIParams } from '../types/nai.types';

export function useNAIParams() {
  const [params, setParams] = useState<NAIParams>(getInitialParams);

  // LocalStorage에서 저장된 파라미터 불러오기
  function getInitialParams(): NAIParams {
    try {
      const saved = localStorage.getItem(PARAMS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // 프롬프트는 저장하지 않으므로 제외
        const { prompt: _, negative_prompt: __, ...savedParams } = parsed;

        // 하위 호환성: resolutionConfig가 없으면 기존 resolution에서 마이그레이션
        if (!savedParams.resolutionConfig && savedParams.resolution) {
          savedParams.resolutionConfig = {
            ...DEFAULT_RESOLUTION_CONFIG,
            fixed: savedParams.resolution
          };
        }

        // 기본값과 병합 (새로운 파라미터가 추가될 경우를 대비)
        return {
          ...DEFAULT_PARAMS,
          ...savedParams,
          resolutionConfig: savedParams.resolutionConfig || DEFAULT_RESOLUTION_CONFIG,
          prompt: '',
          negative_prompt: ''
        };
      }
    } catch (e) {
      console.error('Failed to load saved params:', e);
    }
    // 기본값
    return { ...DEFAULT_PARAMS };
  }

  // 파라미터 변경 시 LocalStorage에 저장 (프롬프트 제외)
  useEffect(() => {
    try {
      const { prompt, negative_prompt, ...paramsToSave } = params;
      localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(paramsToSave));
    } catch (e) {
      console.error('Failed to save params:', e);
    }
  }, [params]);

  return {
    params,
    setParams,
    updateParam: <K extends keyof NAIParams>(key: K, value: NAIParams[K]) => {
      setParams((prev) => ({ ...prev, [key]: value }));
    }
  };
}
