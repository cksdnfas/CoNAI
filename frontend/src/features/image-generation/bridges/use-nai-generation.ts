import { useCallback, useEffect, useState } from 'react'
import { parseWildcards } from '@/utils/wildcard-parser'
import { cleanPrompt, isPromptEmpty } from '@/utils/prompt-cleaner'
import { naiApi } from '@/services/nai-api'
import { RESOLUTIONS } from '../nai/constants/nai.constants'
import type { NAIParams, NAIUserData } from '@/features/image-generation/nai/types/nai.types'

interface UseNAIGenerationOptions {
  token: string
  onLogout: () => void
}

interface CostInput {
  width: number
  height: number
  steps: number
  n_samples: number
  uncond_scale: number
}

function getBaseCost(input: CostInput): number {
  const megapixels = Math.max((input.width * input.height) / 1_000_000, 0.1)
  const sampleMultiplier = Math.max(input.n_samples, 1)
  const stepMultiplier = Math.max(input.steps, 1) / 28
  const scaleMultiplier = Math.max(input.uncond_scale, 0.5)
  return Math.max(1, Math.ceil(megapixels * sampleMultiplier * stepMultiplier * scaleMultiplier * 4))
}

function getRandomInt(max: number): number {
  return Math.floor(Math.random() * Math.max(max, 1))
}

export function useNAIGeneration({ token, onLogout }: UseNAIGenerationOptions) {
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userData, setUserData] = useState<NAIUserData | null>(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  const getResolution = useCallback((params: NAIParams) => {
    const config = params.resolutionConfig

    const selectedKeys =
      config.mode === 'fixed'
        ? [config.fixed]
        : config.random.length > 0
          ? config.random
          : [params.resolution]

    const resolvedOptions = selectedKeys
      .flatMap((entryKey) => {
        if (entryKey in RESOLUTIONS) {
          return [RESOLUTIONS[entryKey as keyof typeof RESOLUTIONS]]
        }

        const match = entryKey.match(/^custom_(.+)$/)
        if (!match) {
          return []
        }

        const custom = config.customResolutions.find((item) => item.id === match[1])
        return custom ? [{ width: custom.width, height: custom.height }] : []
      })

    const withSwap =
      config.swapDimensions
        ? resolvedOptions.flatMap((item) => [
            item,
            {
              width: item.height,
              height: item.width,
            },
          ])
        : resolvedOptions

    const deduped = withSwap.filter((item, index, items) =>
      items.findIndex((candidate) => candidate.width === item.width && candidate.height === item.height) === index,
    )

    if (deduped.length === 0) {
      if ('832×1216' in RESOLUTIONS) {
        return RESOLUTIONS['832×1216']
      }
      return { width: 1024, height: 1024 }
    }

    if (config.mode === 'fixed') {
      return deduped[0]
    }

    return deduped[getRandomInt(deduped.length)]
  }, [])

  const fetchUserData = useCallback(async () => {
    try {
      const response = await naiApi.getUserData(token)
      setUserData(response)
      return response
    } catch (cause) {
      const maybeError = cause as {
        response?: {
          status?: number
          data?: {
            error?: string
          }
        }
        message?: string
      }

      if (maybeError.response?.status === 401) {
        onLogout()
        return null
      }

      console.error('Failed to fetch NAI user data:', maybeError.message || maybeError.response?.data?.error)
      return null
    }
  }, [onLogout, token])

  useEffect(() => {
    void fetchUserData()
  }, [fetchUserData])

  const executeSingleGeneration = useCallback(
    async (params: NAIParams, selectedGroupId: number | null) => {
      if (!token) {
        onLogout()
        return
      }

      setGenerating(true)
      setError(null)

      try {
        const [parsedPromptResult, parsedNegativeResult] = await Promise.all([
          parseWildcards(params.prompt, 'nai'),
          parseWildcards(params.negative_prompt, 'nai'),
        ])
        const emptyWildcards = new Set<string>([
          ...parsedPromptResult.emptyWildcards,
          ...parsedNegativeResult.emptyWildcards,
        ])

        const parsedPrompt = cleanPrompt(parsedPromptResult.text)
        const parsedNegativePrompt = cleanPrompt(parsedNegativeResult.text)

        if (isPromptEmpty(parsedPrompt)) {
          setError('Prompt cannot be empty.')
          return
        }

        if (emptyWildcards.size > 0) {
          console.warn(`Missing wildcards: ${[...emptyWildcards].join(', ')}`)
        }

        const resolution = getResolution(params)

        await naiApi.generateImage(token, {
          prompt: parsedPrompt,
          negative_prompt: parsedNegativePrompt,
          model: params.model,
          width: resolution.width,
          height: resolution.height,
          steps: params.steps,
          scale: params.scale,
          sampler: params.sampler,
          n_samples: params.n_samples,
          variety_plus: params.variety_plus,
          cfg_rescale: params.cfg_rescale,
          noise_schedule: params.noise_schedule,
          uncond_scale: params.uncond_scale,
          groupId: selectedGroupId || undefined,
        })

        await fetchUserData()
        setHistoryRefreshKey((previous) => previous + 1)
      } catch (cause) {
        const maybeError = cause as {
          response?: {
            status?: number
            data?: {
              error?: string
            }
          }
          message?: string
        }

        if (maybeError.response?.status === 401) {
          onLogout()
          return
        }

        if (maybeError.response?.status === 402) {
          setError('Active subscription required.')
          return
        }

        setError(maybeError.response?.data?.error || maybeError.message || 'Failed to run generation.')
      } finally {
        setGenerating(false)
      }
    },
    [fetchUserData, getResolution, onLogout, token],
  )

  const calculateCost = useCallback((input: CostInput) => {
    const fallbackCost = getBaseCost(input)
    if (!userData) {
      return fallbackCost
    }

    return fallbackCost
  }, [userData])

  return {
    generating,
    error,
    userData,
    historyRefreshKey,
    executeSingleGeneration,
    calculateCost,
  }
}
