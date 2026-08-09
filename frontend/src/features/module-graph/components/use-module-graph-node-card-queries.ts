import { useQuery } from '@tanstack/react-query'
import { getExternalApiLlmOptions } from '@/lib/api-external-api'
import { getGenerationComfyUIServers, getGenerationWorkflowServers } from '@/lib/api-image-generation-workflows'
import { getLlmPresetOptions } from '@/lib/api-settings-llm'

interface ModuleGraphNodeCardQueryEnablementOptions {
  canConfigureComfyTarget: boolean
  needsLlmModelOptions: boolean
  needsLlmPresetOptions: boolean
}

interface UseModuleGraphNodeCardQueriesOptions extends ModuleGraphNodeCardQueryEnablementOptions {
  comfyWorkflowId: number | null
}

export function resolveModuleGraphNodeCardQueryEnablement({
  canConfigureComfyTarget,
  needsLlmModelOptions,
  needsLlmPresetOptions,
}: ModuleGraphNodeCardQueryEnablementOptions) {
  return {
    comfyServers: canConfigureComfyTarget,
    llmPresets: needsLlmPresetOptions,
    llmProviders: needsLlmModelOptions,
    workflowServers: canConfigureComfyTarget,
  }
}

/** Keep node-card data fetching in one hook while preserving the existing query keys and enable gates. */
export function useModuleGraphNodeCardQueries({
  canConfigureComfyTarget,
  comfyWorkflowId,
  needsLlmModelOptions,
  needsLlmPresetOptions,
}: UseModuleGraphNodeCardQueriesOptions) {
  const enabled = resolveModuleGraphNodeCardQueryEnablement({
    canConfigureComfyTarget,
    needsLlmModelOptions,
    needsLlmPresetOptions,
  })
  const llmProvidersQuery = useQuery({
    queryKey: ['external-api-llm-options', 'module-graph-node-card'],
    queryFn: () => getExternalApiLlmOptions(),
    enabled: enabled.llmProviders,
    staleTime: 30_000,
  })
  const llmPresetsQuery = useQuery({
    queryKey: ['llm-preset-options', 'module-graph-node-card'],
    queryFn: () => getLlmPresetOptions(),
    enabled: enabled.llmPresets,
    staleTime: 30_000,
  })
  const comfyServersQuery = useQuery({
    queryKey: ['generation-comfyui-servers', 'module-graph-node-card'],
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
    llmProvidersQuery,
    workflowServersQuery,
  }
}
