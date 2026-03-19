import { useEffect, useState } from 'react'
import { DEFAULT_PARAMS, DEFAULT_RESOLUTION_CONFIG, PARAMS_STORAGE_KEY } from '../constants/nai.constants'
import type { NAIParams } from '../types/nai.types'

function getInitialParams(): NAIParams {
  try {
    const saved = localStorage.getItem(PARAMS_STORAGE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<NAIParams>
      const { prompt, negative_prompt, ...savedParams } = parsed
      void prompt
      void negative_prompt

      if (!savedParams.resolutionConfig && savedParams.resolution) {
        savedParams.resolutionConfig = {
          ...DEFAULT_RESOLUTION_CONFIG,
          fixed: savedParams.resolution,
        }
      }

      return {
        ...DEFAULT_PARAMS,
        ...savedParams,
        action: savedParams.action ?? DEFAULT_PARAMS.action,
        auto_quality_tags: savedParams.auto_quality_tags ?? DEFAULT_PARAMS.auto_quality_tags,
        uc_preset: savedParams.uc_preset ?? DEFAULT_PARAMS.uc_preset,
        rating_preset: savedParams.rating_preset ?? DEFAULT_PARAMS.rating_preset,
        seed: savedParams.seed ?? DEFAULT_PARAMS.seed,
        strength: savedParams.strength ?? DEFAULT_PARAMS.strength,
        noise: savedParams.noise ?? DEFAULT_PARAMS.noise,
        source_image: savedParams.source_image ?? DEFAULT_PARAMS.source_image,
        mask_image: savedParams.mask_image ?? DEFAULT_PARAMS.mask_image,
        resolutionConfig: savedParams.resolutionConfig || DEFAULT_RESOLUTION_CONFIG,
        prompt: '',
        negative_prompt: '',
      }
    }
  } catch (error) {
    console.error('Failed to load saved params:', error)
  }

  return { ...DEFAULT_PARAMS }
}

export function useNAIParams() {
  const [params, setParams] = useState<NAIParams>(getInitialParams)

  useEffect(() => {
    try {
      const { prompt, negative_prompt, ...paramsToSave } = params
      void prompt
      void negative_prompt
      localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(paramsToSave))
    } catch (error) {
      console.error('Failed to save params:', error)
    }
  }, [params])

  return {
    params,
    setParams,
    updateParam: <K extends keyof NAIParams>(key: K, value: NAIParams[K]) => {
      setParams((previous) => ({ ...previous, [key]: value }))
    },
  }
}
