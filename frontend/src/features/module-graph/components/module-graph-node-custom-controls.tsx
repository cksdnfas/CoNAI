import type { ModulePortDefinition, ModuleUiFieldDefinition } from '@/lib/api-module-graph'
import type { ComfyUIServer } from '@/lib/api-image-generation-types'
import type { LlmPresetOptionCollections, LlmPresetOptionRecord } from '@/lib/api-settings-llm'
import { useI18n } from '@/i18n'
import type { ModuleGraphNode } from '../module-graph-shared'
import { normalizeOptionalString, parsePositiveIntegerish } from '../module-graph-shared'
import {
  getSelectOptionValue,
  normalizeSelectOptions,
  resolveModelSelectValue,
} from './module-graph-node-card-options'
import { useModuleGraphNodeActions } from './module-graph-canvas-context'
import { NodeSelectControl } from './module-graph-node-controls'
import { NodeRow } from './module-graph-node-rows'
import { resolveModuleGraphNodeCustomControls } from './module-graph-node-card-operation-registry'
import { useModuleGraphNodeCardQueries } from './use-module-graph-node-card-queries'

export const GRAPH_COMFY_TARGET_MODE_KEY = 'execution_target_mode'
export const GRAPH_COMFY_TARGET_TAG_KEY = 'execution_target_tag'
export const GRAPH_COMFY_TARGET_SERVER_ID_KEY = 'execution_target_server_id'

type LlmPresetCollectionKey = keyof LlmPresetOptionCollections
type ComfyWorkflowServerCandidate = ComfyUIServer & { is_enabled?: boolean | number }

function getLlmPresetTypeOptions(t: ReturnType<typeof useI18n>['t']): Array<{ value: LlmPresetCollectionKey; label: string }> {
  return [
    { value: 'systemPromptPresets', label: t({ ko: '시스템 프롬프트', en: 'System prompt' }) },
    { value: 'promptPresets', label: t({ ko: '프롬프트', en: 'Prompt' }) },
    { value: 'structuredOutputJsonPresets', label: t({ ko: '구조화 출력 JSON', en: 'Structured output JSON' }) },
  ]
}

export function resolveComfyTargetMode(inputValues: Record<string, unknown> | undefined) {
  const rawMode = normalizeOptionalString(inputValues?.[GRAPH_COMFY_TARGET_MODE_KEY])?.toLowerCase()
  return rawMode === 'tag' || rawMode === 'server' ? rawMode : 'auto'
}

export function resolveComfyTargetValue(inputValues: Record<string, unknown> | undefined) {
  const mode = resolveComfyTargetMode(inputValues)
  const tag = normalizeOptionalString(inputValues?.[GRAPH_COMFY_TARGET_TAG_KEY])
  const serverId = parsePositiveIntegerish(inputValues?.[GRAPH_COMFY_TARGET_SERVER_ID_KEY])

  if (mode === 'tag' && tag) return `tag:${tag}`
  if (mode === 'server' && serverId) return `server:${serverId}`
  return 'auto'
}

function resolveComfyTargetBadgeLabel(t: ReturnType<typeof useI18n>['t'], inputValues: Record<string, unknown> | undefined) {
  const mode = resolveComfyTargetMode(inputValues)
  const tag = normalizeOptionalString(inputValues?.[GRAPH_COMFY_TARGET_TAG_KEY])
  const serverId = parsePositiveIntegerish(inputValues?.[GRAPH_COMFY_TARGET_SERVER_ID_KEY])

  if (mode === 'tag' && tag) return `#${tag}`
  if (mode === 'server' && serverId) return t({ ko: '서버 #{id}', en: 'Server #{id}' }, { id: serverId })
  return t({ ko: '자동 분산', en: 'Auto routing' })
}

export function isActiveComfyWorkflowServerCandidate(server: ComfyWorkflowServerCandidate) {
  return server.is_active !== false && server.is_enabled !== false && server.is_enabled !== 0
}

function normalizeLlmPresetType(value: unknown): LlmPresetCollectionKey {
  return value === 'systemPromptPresets' || value === 'structuredOutputJsonPresets' ? value : 'promptPresets'
}

function getLlmPresetEntries(collections: LlmPresetOptionCollections | undefined, presetType: LlmPresetCollectionKey) {
  return [...(collections?.[presetType] ?? [])]
    .filter((preset): preset is LlmPresetOptionRecord => Boolean(preset?.name?.trim()))
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'))
}

function summarizeLlmPresetContent(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 140 ? `${normalized.slice(0, 139)}…` : normalized
}

interface UseModuleGraphNodeCustomControlsOptions {
  connectedInputKeys: Set<string>
  data: ModuleGraphNode['data']
  id: string
  inputPorts: ModulePortDefinition[]
  uiFieldByKey: Map<string, ModuleUiFieldDefinition>
}

/** Build the custom-control view model and isolate all node-card queries behind enable-gated hooks. */
export function useModuleGraphNodeCustomControls({
  connectedInputKeys,
  data,
  id,
  inputPorts,
  uiFieldByKey,
}: UseModuleGraphNodeCustomControlsOptions) {
  const { module } = data
  const controlKeys = resolveModuleGraphNodeCustomControls(module)
  const needsLlmPresetOptions = controlKeys.has('llm-preset')
  const comfyWorkflowId = module.engine_type === 'comfyui'
    ? parsePositiveIntegerish(module.source_workflow_id ?? module.template_defaults?.workflow_id)
    : null
  const canConfigureComfyTarget = Boolean(controlKeys.has('comfy-target') && comfyWorkflowId)
  const queries = useModuleGraphNodeCardQueries({
    canConfigureComfyTarget,
    comfyWorkflowId,
    needsLlmPresetOptions,
  })

  const naiModelPort = controlKeys.has('nai-model') ? inputPorts.find((port) => port.key === 'model') : null
  const naiModelUiField = controlKeys.has('nai-model') ? uiFieldByKey.get('model') ?? null : null
  const naiModelOptions = normalizeSelectOptions(naiModelUiField?.data_type === 'select' ? naiModelUiField.options : null)
  const naiModelValue = resolveModelSelectValue({
    currentValue: normalizeOptionalString(data.inputValues?.model),
    port: naiModelPort,
    uiField: naiModelUiField,
    options: naiModelOptions,
  })
  const canConfigureNaiModel = controlKeys.has('nai-model') && naiModelOptions.length > 0 && !connectedInputKeys.has('model')
  const canConfigureLlmPreset = needsLlmPresetOptions
  const llmPresetType = normalizeLlmPresetType(data.inputValues?.preset_type)
  const llmPresetEntries = getLlmPresetEntries(queries.llmPresetsQuery.data, llmPresetType)
  const llmPresetName = normalizeOptionalString(data.inputValues?.preset_name) ?? ''
  const selectedLlmPreset = llmPresetName ? llmPresetEntries.find((preset) => preset.name === llmPresetName) ?? null : null

  const linkedComfyServers = (queries.workflowServersQuery.data ?? []) as ComfyWorkflowServerCandidate[]
  const activeLinkedComfyServers = linkedComfyServers.filter(isActiveComfyWorkflowServerCandidate)
  const activeGlobalComfyServers = ((queries.comfyServersQuery.data ?? []) as ComfyWorkflowServerCandidate[]).filter(isActiveComfyWorkflowServerCandidate)
  const candidateComfyServers: ComfyUIServer[] = linkedComfyServers.length > 0 ? activeLinkedComfyServers : activeGlobalComfyServers
  const comfyRoutingTags = Array.from(new Set(candidateComfyServers.flatMap((server) => server.routing_tags ?? []))).sort((left, right) => left.localeCompare(right))
  const comfyTargetValue = resolveComfyTargetValue(data.inputValues)
  const knownComfyTargetValues = new Set<string>([
    'auto',
    ...comfyRoutingTags.map((tag) => `tag:${tag}`),
    ...candidateComfyServers.map((server) => `server:${server.id}`),
  ])

  const hiddenInputPortKeys = new Set<string>()
  if (canConfigureLlmPreset) {
    hiddenInputPortKeys.add('preset_type')
    hiddenInputPortKeys.add('preset_name')
  }
  if (canConfigureNaiModel) {
    hiddenInputPortKeys.add('model')
  }

  return {
    canConfigureComfyTarget,
    canConfigureLlmPreset,
    canConfigureNaiModel,
    candidateComfyServers,
    comfyRoutingTags,
    comfyTargetValue,
    hasKnownComfyTargetValue: knownComfyTargetValues.has(comfyTargetValue),
    hiddenInputPortKeys,
    id,
    llmPresetEntries,
    llmPresetName,
    llmPresetType,
    llmPresetsLoading: queries.llmPresetsQuery.isLoading,
    naiModelOptions,
    naiModelValue,
    selectedLlmPreset,
  }
}

type ModuleGraphNodeCustomControlsState = ReturnType<typeof useModuleGraphNodeCustomControls>

/** Node-specific choices (ComfyUI server, NovelAI model, LLM preset) as ordinary node rows. */
export function ModuleGraphNodeCustomControls({ data, state }: { data: ModuleGraphNode['data']; state: ModuleGraphNodeCustomControlsState }) {
  const { t } = useI18n()
  const actions = useModuleGraphNodeActions()
  const change = (key: string, value: unknown) => actions.changeValue(state.id, key, value)
  const applyComfyTargetValue = (nextValue: string) => {
    if (nextValue === 'auto') {
      change(GRAPH_COMFY_TARGET_MODE_KEY, 'auto')
      change(GRAPH_COMFY_TARGET_TAG_KEY, '')
      change(GRAPH_COMFY_TARGET_SERVER_ID_KEY, '')
      return
    }
    if (nextValue.startsWith('tag:')) {
      change(GRAPH_COMFY_TARGET_MODE_KEY, 'tag')
      change(GRAPH_COMFY_TARGET_TAG_KEY, nextValue.slice('tag:'.length))
      change(GRAPH_COMFY_TARGET_SERVER_ID_KEY, '')
      return
    }
    if (nextValue.startsWith('server:')) {
      change(GRAPH_COMFY_TARGET_MODE_KEY, 'server')
      change(GRAPH_COMFY_TARGET_TAG_KEY, '')
      change(GRAPH_COMFY_TARGET_SERVER_ID_KEY, nextValue.slice('server:'.length))
    }
  }

  const comfyTargetOptions = [
    ...(!state.hasKnownComfyTargetValue ? [{ value: state.comfyTargetValue, label: t({ ko: '찾을 수 없음 ({label})', en: 'Not found ({label})' }, { label: resolveComfyTargetBadgeLabel(t, data.inputValues) }) }] : []),
    { value: 'auto', label: t({ ko: '자동 분산', en: 'Auto routing' }) },
    ...state.comfyRoutingTags.map((tag) => ({ value: `tag:${tag}`, label: `#${tag}` })),
    ...state.candidateComfyServers.map((server) => ({ value: `server:${server.id}`, label: server.name })),
  ]
  const toModelOptions = (options: ReturnType<typeof normalizeSelectOptions>) => options.map((option) => ({ value: getSelectOptionValue(option), label: typeof option === 'string' ? option : option.label }))

  return (
    <>
      {state.canConfigureComfyTarget ? (
        <NodeRow label={t({ ko: '서버', en: 'Server' })}>
          <NodeSelectControl ariaLabel={t({ ko: 'ComfyUI 서버', en: 'ComfyUI server' })} value={state.comfyTargetValue} options={comfyTargetOptions} onChange={applyComfyTargetValue} className="w-full" />
        </NodeRow>
      ) : null}

      {state.canConfigureNaiModel ? (
        <NodeRow label={t({ ko: '모델', en: 'Model' })}>
          <NodeSelectControl ariaLabel={t({ ko: '모델', en: 'Model' })} value={state.naiModelValue} options={toModelOptions(state.naiModelOptions)} onChange={(value) => change('model', value)} className="w-full" />
        </NodeRow>
      ) : null}

      {state.canConfigureLlmPreset ? (
        <>
          <NodeRow label={t({ ko: '종류', en: 'Kind' })}>
            <NodeSelectControl
              ariaLabel={t({ ko: '프리셋 종류', en: 'Preset kind' })}
              value={state.llmPresetType}
              options={getLlmPresetTypeOptions(t)}
              onChange={(value) => {
                change('preset_type', value)
                change('preset_name', '')
              }}
              className="w-full"
            />
          </NodeRow>
          <NodeRow label={t({ ko: '프리셋', en: 'Preset' })} missing={!state.llmPresetName}>
            <NodeSelectControl
              ariaLabel={t({ ko: '프리셋', en: 'Preset' })}
              value={state.llmPresetName}
              options={state.llmPresetEntries.map((preset) => preset.name)}
              onChange={(value) => change('preset_name', value)}
              emptyLabel={state.llmPresetsLoading ? t({ ko: '불러오는 중', en: 'Loading' }) : t({ ko: '선택', en: 'Select' })}
              className="w-full"
            />
          </NodeRow>
          {state.selectedLlmPreset ? (
            <div className="px-3 pb-1.5">
              <div className="line-clamp-3 rounded-[5px] bg-surface-high px-2 py-1.5 text-xs leading-[1.45] break-words whitespace-pre-wrap text-muted-foreground">{summarizeLlmPresetContent(state.selectedLlmPreset.content)}</div>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  )
}
