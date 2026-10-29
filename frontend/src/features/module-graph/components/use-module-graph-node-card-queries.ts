import { useQuery } from '@tanstack/react-query'
import { comfyUIServersQueryKey, getGenerationComfyUIServers, getGenerationWorkflowServers } from '@/lib/api-image-generation-workflows'
import { getLlmPresetOptions, LLM_PRESET_OPTIONS_QUERY_KEY } from '@/lib/api-settings-llm'

interface ModuleGraphNodeCardQueryEnablementOptions {
  canConfigureComfyTarget: boolean
  needsLlmPresetOptions: boolean
}

interface UseModuleGraphNodeCardQueriesOptions extends ModuleGraphNodeCardQueryEnablementOptions {
  comfyWorkflowId: number | null
}

export function resolveModuleGraphNodeCardQueryEnablement({
  canConfigureComfyTarget,
  needsLlmPresetOptions,
}: ModuleGraphNodeCardQueryEnablementOptions) {
  return {
    comfyServers: canConfigureComfyTarget,
    llmPresets: needsLlmPresetOptions,
    workflowServers: canConfigureComfyTarget,
  }
}

/** Keep node-card data fetching in one hook while preserving the existing query keys and enable gates. */
export function useModuleGraphNodeCardQueries({
  canConfigureComfyTarget,
  comfyWorkflowId,
  needsLlmPresetOptions,
}: UseModuleGraphNodeCardQueriesOptions) {
  const enabled = resolveModuleGraphNodeCardQueryEnablement({
    canConfigureComfyTarget,
    needsLlmPresetOptions,
  })
  const llmPresetsQuery = useQuery({
    queryKey: LLM_PRESET_OPTIONS_QUERY_KEY,
    queryFn: () => getLlmPresetOptions(),
    enabled: enabled.llmPresets,
    staleTime: 30_000,
  })
  const comfyServersQuery = useQuery({
    queryKey: comfyUIServersQueryKey(true),
    queryFn: () => getGenerationComfyUIServers(true),
    enabled: enabled.comfyServers,
    staleTime: 30_000,
  })
  const workflowServersQuery = useQuery({
    queryKey: ['generation-workflow-servers', comfyWorkflowId, 'module-graph-node-card'],
    queryFn: () => getGenerationWorkflowServers(comfyWorkflowId as number),
    enabled: enabled.workflowServers,
    staleTime: 30_000,
  })

  return {
    comfyServersQuery,
    llmPresetsQuery,
    workflowServersQuery,
  }
}
