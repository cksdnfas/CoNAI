import type { ModulePortDefinition, ModuleUiFieldDefinition } from '@/lib/api-module-graph'
import type { ComfyUIServer } from '@/lib/api-image-generation-types'
import type { LlmPresetOptionCollections, LlmPresetOptionRecord } from '@/lib/api-settings-llm'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import type { ModuleGraphNode } from '../module-graph-shared'
import { normalizeOptionalString, parsePositiveIntegerish } from '../module-graph-shared'
import {
  getLlmModelBindings,
  getLlmModelOptions,
  getSelectOptionValue,
  normalizeSelectOptions,
  resolveModelSelectValue,
} from './module-graph-node-card-options'
import { MODULE_GRAPH_INLINE_CONTROL_CLASS, stopNodeInteraction } from './module-graph-port-cells'
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
  const needsLlmModelOptions = controlKeys.has('llm-model')
  const needsLlmPresetOptions = controlKeys.has('llm-preset')
  const comfyWorkflowId = module.engine_type === 'comfyui'
    ? parsePositiveIntegerish(module.source_workflow_id ?? module.template_defaults?.workflow_id)
    : null
  const canConfigureComfyTarget = Boolean(controlKeys.has('comfy-target') && comfyWorkflowId && data.onNodeValueChange)
  const queries = useModuleGraphNodeCardQueries({
    canConfigureComfyTarget,
    comfyWorkflowId,
    needsLlmModelOptions,
    needsLlmPresetOptions,
  })

  const llmModelBindings = needsLlmModelOptions ? getLlmModelBindings(queries.llmProvidersQuery.data) : []
  const llmModelOptions = getLlmModelOptions(llmModelBindings)
  const llmSelectedProviderName = normalizeOptionalString(data.inputValues?.provider_name) ?? ''
  const codexModelPort = controlKeys.has('codex-model') ? inputPorts.find((port) => port.key === 'model') : null
  const codexModelUiField = controlKeys.has('codex-model') ? uiFieldByKey.get('model') ?? null : null
  const codexModelOptions = normalizeSelectOptions(codexModelUiField?.data_type === 'select' ? codexModelUiField.options : null)
  const codexModelValue = resolveModelSelectValue({
    currentValue: normalizeOptionalString(data.inputValues?.model),
    port: codexModelPort,
    uiField: codexModelUiField,
    options: codexModelOptions,
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
  const canConfigureLlmModel = Boolean(needsLlmModelOptions && llmModelOptions.length > 0 && data.onNodeValueChange)
  const canConfigureCodexModel = Boolean(controlKeys.has('codex-model') && codexModelOptions.length > 0 && data.onNodeValueChange)
  const canConfigureNaiModel = Boolean(controlKeys.has('nai-model') && naiModelOptions.length > 0 && data.onNodeValueChange && !connectedInputKeys.has('model'))
  const canConfigureLlmPreset = Boolean(needsLlmPresetOptions && data.onNodeValueChange)
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
  if (needsLlmModelOptions) {
    hiddenInputPortKeys.add('provider_name')
    hiddenInputPortKeys.add('system_prompt_preset_name')
    hiddenInputPortKeys.add('prompt_preset_name')
    hiddenInputPortKeys.add('structured_output_json_preset_name')
    hiddenInputPortKeys.add('response_mode')
  }
  if (controlKeys.has('codex-model')) {
    hiddenInputPortKeys.add('response_mode')
  }
  if (canConfigureLlmModel || canConfigureCodexModel || canConfigureNaiModel) {
    hiddenInputPortKeys.add('model')
  }

  return {
    canConfigureCodexModel,
    canConfigureComfyTarget,
    canConfigureLlmModel,
    canConfigureLlmPreset,
    canConfigureNaiModel,
    candidateComfyServers,
    codexModelOptions,
    codexModelValue,
    comfyRoutingTags,
    comfyTargetValue,
    hasKnownComfyTargetValue: knownComfyTargetValues.has(comfyTargetValue),
    hiddenInputPortKeys,
    id,
    llmModelBindings,
    llmModelOptions,
    llmPresetEntries,
    llmPresetName,
    llmPresetType,
    llmPresetsLoading: queries.llmPresetsQuery.isLoading,
    llmSelectedProviderName,
    naiModelOptions,
    naiModelValue,
    selectedLlmPreset,
  }
}

type ModuleGraphNodeCustomControlsState = ReturnType<typeof useModuleGraphNodeCustomControls>

export function ModuleGraphNodeCustomControls({ data, state }: { data: ModuleGraphNode['data']; state: ModuleGraphNodeCustomControlsState }) {
  const { t } = useI18n()
  const applyLlmModelBinding = (providerName: string) => {
    const selectedBinding = state.llmModelBindings.find((entry) => entry.provider_name === providerName)
    if (!selectedBinding || !data.onNodeValueChange) return
    data.onNodeValueChange(state.id, 'provider_name', selectedBinding.provider_name)
    data.onNodeValueChange(state.id, 'model', '')
    data.onNodeValueChange(state.id, 'temperature', typeof selectedBinding.default_temperature === 'number' ? selectedBinding.default_temperature : '')
    data.onNodeValueChange(state.id, 'max_tokens', typeof selectedBinding.default_max_tokens === 'number' ? selectedBinding.default_max_tokens : 1024)
  }
  const applyComfyTargetValue = (nextValue: string) => {
    if (!data.onNodeValueChange) return
    if (nextValue === 'auto') {
      data.onNodeValueChange(state.id, GRAPH_COMFY_TARGET_MODE_KEY, 'auto')
      data.onNodeValueChange(state.id, GRAPH_COMFY_TARGET_TAG_KEY, '')
      data.onNodeValueChange(state.id, GRAPH_COMFY_TARGET_SERVER_ID_KEY, '')
      return
    }
    if (nextValue.startsWith('tag:')) {
      data.onNodeValueChange(state.id, GRAPH_COMFY_TARGET_MODE_KEY, 'tag')
      data.onNodeValueChange(state.id, GRAPH_COMFY_TARGET_TAG_KEY, nextValue.slice('tag:'.length))
      data.onNodeValueChange(state.id, GRAPH_COMFY_TARGET_SERVER_ID_KEY, '')
      return
    }
    if (nextValue.startsWith('server:')) {
      data.onNodeValueChange(state.id, GRAPH_COMFY_TARGET_MODE_KEY, 'server')
      data.onNodeValueChange(state.id, GRAPH_COMFY_TARGET_TAG_KEY, '')
      data.onNodeValueChange(state.id, GRAPH_COMFY_TARGET_SERVER_ID_KEY, nextValue.slice('server:'.length))
    }
  }

  return (
    <>
      {state.canConfigureComfyTarget ? (
        <div className="nodrag nowheel mt-2">
          <Select value={state.comfyTargetValue} onMouseDown={stopNodeInteraction} onClick={stopNodeInteraction} onChange={(event) => { stopNodeInteraction(event); applyComfyTargetValue(event.target.value) }} className={`h-8 text-xs ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}>
            {!state.hasKnownComfyTargetValue ? <option value={state.comfyTargetValue} disabled>{t({ ko: '외부 설정을 찾을 수 없음 ({label})', en: 'Could not find external configuration ({label})' }, { label: resolveComfyTargetBadgeLabel(t, data.inputValues) })}</option> : null}
            <option value="auto">{t({ ko: '자동 분산', en: 'Auto routing' })}</option>
            {state.comfyRoutingTags.length > 0 ? <optgroup label={t({ ko: '태그', en: 'Tags' })}>{state.comfyRoutingTags.map((tag) => <option key={tag} value={`tag:${tag}`}>#{tag}</option>)}</optgroup> : null}
            {state.candidateComfyServers.length > 0 ? <optgroup label={t({ ko: '서버', en: 'Servers' })}>{state.candidateComfyServers.map((server) => <option key={server.id} value={`server:${server.id}`}>{server.name}</option>)}</optgroup> : null}
          </Select>
        </div>
      ) : null}

      {state.canConfigureNaiModel ? <ModelSelect label={t({ ko: '모델', en: 'Model' })} value={state.naiModelValue} options={state.naiModelOptions} onChange={(value) => data.onNodeValueChange?.(state.id, 'model', value)} /> : null}

      {state.canConfigureLlmModel ? (
        <div className="nodrag nowheel mt-2 space-y-1">
          <div className="px-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{t({ ko: '모델', en: 'Model' })}</div>
          <Select value={state.llmSelectedProviderName} onMouseDown={stopNodeInteraction} onClick={stopNodeInteraction} onChange={(event) => { stopNodeInteraction(event); applyLlmModelBinding(event.target.value) }} className={`h-8 text-xs ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}>
            <option value="">{t({ ko: '모델 선택', en: 'Select model' })}</option>
            {state.llmModelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </div>
      ) : null}

      {state.canConfigureCodexModel ? <ModelSelect label={t({ ko: '모델', en: 'Model' })} value={state.codexModelValue} options={state.codexModelOptions} onChange={(value) => data.onNodeValueChange?.(state.id, 'model', value)} /> : null}

      {state.canConfigureLlmPreset ? (
        <div className="nodrag nowheel mt-2 space-y-1.5">
          <div className="px-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{t({ ko: '프리셋', en: 'Preset' })}</div>
          <Select value={state.llmPresetType} onMouseDown={stopNodeInteraction} onClick={stopNodeInteraction} onChange={(event) => { stopNodeInteraction(event); data.onNodeValueChange?.(state.id, 'preset_type', event.target.value); data.onNodeValueChange?.(state.id, 'preset_name', '') }} className={`h-8 text-xs ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}>
            {getLlmPresetTypeOptions(t).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
          <Select value={state.llmPresetName} onMouseDown={stopNodeInteraction} onClick={stopNodeInteraction} onChange={(event) => { stopNodeInteraction(event); data.onNodeValueChange?.(state.id, 'preset_name', event.target.value) }} className={`h-8 text-xs ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}>
            <option value="">{state.llmPresetsLoading ? t({ ko: '불러오는 중', en: 'Loading' }) : t({ ko: '프리셋 선택', en: 'Select preset' })}</option>
            {state.llmPresetEntries.map((preset) => <option key={preset.id || preset.name} value={preset.name}>{preset.name}</option>)}
          </Select>
          {state.selectedLlmPreset ? <div className="rounded-sm border border-border/60 bg-background/45 px-2.5 py-2"><div className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{t({ ko: '선택 내용', en: 'Selected content' })}</div><div className="max-h-24 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-4 text-foreground">{summarizeLlmPresetContent(state.selectedLlmPreset.content)}</div></div> : null}
        </div>
      ) : null}
    </>
  )
}

function ModelSelect({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: ReturnType<typeof normalizeSelectOptions>; value: string }) {
  return (
    <div className="nodrag nowheel mt-2 space-y-1">
      <div className="px-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
      <Select value={value} onMouseDown={stopNodeInteraction} onClick={stopNodeInteraction} onChange={(event) => { stopNodeInteraction(event); onChange(event.target.value) }} className={`h-8 text-xs ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}>
        {options.map((option) => { const optionValue = getSelectOptionValue(option); const optionLabel = typeof option === 'string' ? option : option.label; return <option key={optionValue} value={optionValue}>{optionLabel}</option> })}
      </Select>
    </div>
  )
}
