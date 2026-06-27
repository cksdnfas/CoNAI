import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import { GripVertical, Play, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { getGenerationComfyUIServers, getGenerationWorkflowServers } from '@/lib/api-image-generation-workflows'
import { getExternalApiLlmOptions, type ExternalApiLlmOptionRecord } from '@/lib/api-external-api'
import { getLlmPresetOptions, type LlmPresetOptionCollections, type LlmPresetOptionRecord } from '@/lib/api-settings'
import type { ModuleGraphSelectOption } from './module-graph-simple-value-input'
import { PowerLoraLoaderInput, hasPowerLoraLoaderEntries, isPowerLoraLoaderUiField } from './power-lora-loader-input'
import type { ComfyUIServer } from '@/lib/api-image-generation-types'
import { WORKFLOW_INPUT_ENABLED_KEY, isWorkflowInputSourceModule } from '../module-graph-workflow-inputs'
import {
  ApiRequestNodeLayout,
  IfBranchNodeLayout,
  InlineWorkflowInputEditor,
  NodeArtifactOutputs,
  RandomTextChoiceNodeLayout,
  TextMergeNodeLayout,
  TextTransformNodeLayout,
  getApiRequestDynamicInputPortKeys,
  getRandomTextChoiceDynamicInputPortKeys,
} from './module-graph-node-card-layouts'
import {
  InputPortCell,
  MODULE_GRAPH_INLINE_CONTROL_CLASS,
  PortCell,
  SourceNodeOutputPorts,
  buildModuleUiFieldMap,
  getInputPortState,
  stopNodeActionEvent,
  stopNodeInteraction,
} from './module-graph-port-cells'
import {
  getModuleBaseDisplayName,
  getModuleColor,
  getModuleNodeDisplayLabelFromData,
  getModuleOperationKey,
  getVisibleModuleOutputPorts,
  hasCustomModuleNodeLabel,
  isAdvancedOutputPortsEnabled,
  isFinalResultModule,
  normalizeOptionalString,
  parsePositiveIntegerish,
  type ModuleGraphNode,
} from '../module-graph-shared'

const GRAPH_COMFY_TARGET_MODE_KEY = 'execution_target_mode'
const GRAPH_COMFY_TARGET_TAG_KEY = 'execution_target_tag'
const GRAPH_COMFY_TARGET_SERVER_ID_KEY = 'execution_target_server_id'

type LlmPresetCollectionKey = keyof LlmPresetOptionCollections
type ComfyWorkflowServerCandidate = ComfyUIServer & { is_enabled?: boolean | number }

function getLlmPresetTypeOptions(t: ReturnType<typeof useI18n>['t']): Array<{ value: LlmPresetCollectionKey; label: string }> {
  return [
    { value: 'systemPromptPresets', label: t({ ko: '시스템 프롬프트', en: 'System prompt' }) },
    { value: 'promptPresets', label: t({ ko: '프롬프트', en: 'Prompt' }) },
    { value: 'structuredOutputJsonPresets', label: t({ ko: '구조화 출력 JSON', en: 'Structured output JSON' }) },
  ]
}

function resolveComfyTargetMode(inputValues: Record<string, unknown> | undefined) {
  const rawMode = normalizeOptionalString(inputValues?.[GRAPH_COMFY_TARGET_MODE_KEY])?.toLowerCase()
  return rawMode === 'tag' || rawMode === 'server' ? rawMode : 'auto'
}

function resolveComfyTargetValue(inputValues: Record<string, unknown> | undefined) {
  const mode = resolveComfyTargetMode(inputValues)
  const tag = normalizeOptionalString(inputValues?.[GRAPH_COMFY_TARGET_TAG_KEY])
  const serverId = parsePositiveIntegerish(inputValues?.[GRAPH_COMFY_TARGET_SERVER_ID_KEY])

  if (mode === 'tag' && tag) {
    return `tag:${tag}`
  }

  if (mode === 'server' && serverId) {
    return `server:${serverId}`
  }

  return 'auto'
}

function resolveComfyTargetBadgeLabel(t: ReturnType<typeof useI18n>['t'], inputValues: Record<string, unknown> | undefined) {
  const mode = resolveComfyTargetMode(inputValues)
  const tag = normalizeOptionalString(inputValues?.[GRAPH_COMFY_TARGET_TAG_KEY])
  const serverId = parsePositiveIntegerish(inputValues?.[GRAPH_COMFY_TARGET_SERVER_ID_KEY])

  if (mode === 'tag' && tag) {
    return `#${tag}`
  }

  if (mode === 'server' && serverId) {
    return t({ ko: '서버 #{id}', en: 'Server #{id}' }, { id: serverId })
  }

  return t({ ko: '자동 분산', en: 'Auto routing' })
}

function isActiveComfyWorkflowServerCandidate(server: ComfyWorkflowServerCandidate) {
  return server.is_active !== false && server.is_enabled !== false && server.is_enabled !== 0
}

function getSelectOptionValue(option: ModuleGraphSelectOption) {
  return typeof option === 'string' ? option : option.value
}

function normalizeBooleanFlag(value: unknown) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase()
    if (normalizedValue === 'true') return true
    if (normalizedValue === 'false') return false
  }

  return false
}

function normalizeSelectOptions(options: ModuleGraphSelectOption[] | null | undefined) {
  return Array.isArray(options)
    ? options.filter((option) => getSelectOptionValue(option).trim().length > 0)
    : []
}

function normalizeLlmPresetType(value: unknown): LlmPresetCollectionKey {
  return value === 'systemPromptPresets' || value === 'structuredOutputJsonPresets'
    ? value
    : 'promptPresets'
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

/** Render a cleaner module graph node card with source-node specific layout. */
export function ModuleGraphNodeCard({ id, data, selected }: NodeProps<ModuleGraphNode>) {
  const { t } = useI18n()
  const { module } = data
  const updateNodeInternals = useUpdateNodeInternals()
  const uiFieldByKey = useMemo(() => buildModuleUiFieldMap(module.ui_schema), [module.ui_schema])
  const powerLoraUiFields = (module.ui_schema ?? []).filter((field) => (
    isPowerLoraLoaderUiField(field) || hasPowerLoraLoaderEntries(data.inputValues?.[field.key] ?? field.default_value)
  ))
  const powerLoraUiFieldKeys = new Set(powerLoraUiFields.map((field) => field.key))
  const inputPorts = (module.exposed_inputs ?? []).filter((port) => {
    const uiField = uiFieldByKey.get(port.key)
    const value = data.inputValues?.[port.key] ?? port.default_value ?? uiField?.default_value
    return !powerLoraUiFieldKeys.has(port.key) && !isPowerLoraLoaderUiField(uiField) && !hasPowerLoraLoaderEntries(value)
  })
  const outputPorts = module.output_ports ?? []
  const accentColor = getModuleColor(module)
  const executionStatus = data.executionStatus || 'idle'
  const connectedInputKeys = new Set(data.connectedInputKeys ?? [])
  const connectedOutputKeys = new Set(data.connectedOutputKeys ?? [])
  const isWorkflowInputSource = isWorkflowInputSourceModule(module)
  const isWorkflowInputWaiting = isWorkflowInputSource
    && normalizeBooleanFlag(data.inputValues?.[WORKFLOW_INPUT_ENABLED_KEY])
    && inputPorts.some((port) => getInputPortState(data, port, connectedInputKeys).requiredMissing)
  const sourceOutputPorts = isWorkflowInputSource ? outputPorts : []
  const missingRequiredInputCount = inputPorts.filter((port) => getInputPortState(data, port, connectedInputKeys).requiredMissing).length

  const nodeDisplayLabel = getModuleNodeDisplayLabelFromData(data)
  const moduleBaseLabel = getModuleBaseDisplayName(module)
  const usesCustomNodeLabel = hasCustomModuleNodeLabel(data)
  const [isEditingLabel, setIsEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState(data.label ?? '')
  const missingStatusLabel = isWorkflowInputWaiting
    ? t({ ko: '실행 입력 대기', en: 'Runtime input waiting' })
    : isWorkflowInputSource ? t({ ko: '값 필요', en: 'Value required' }) : t({ ko: '입력 필요', en: 'Input required' })
  useEffect(() => {
    if (!isEditingLabel) {
      setLabelDraft(data.label ?? '')
    }
  }, [data.label, isEditingLabel])

  useEffect(() => {
    if (!selected) {
      setIsEditingLabel(false)
    }
  }, [selected])

  const statusLabel =
    data.disabled === true
      ? t({ ko: '비활성', en: 'Disabled' })
      : executionStatus === 'completed'
      ? t({ ko: '완료', en: 'Completed' })
      : executionStatus === 'failed'
        ? t({ ko: '실패', en: 'Failed' })
        : executionStatus === 'blocked'
          ? t({ ko: '차단됨', en: 'Blocked' })
          : executionStatus === 'skipped'
            ? t({ ko: '건너뜀', en: 'Skipped' })
          : missingRequiredInputCount > 0
            ? missingStatusLabel
            : null
  const skippedReasonLabel =
    data.executionSkipReason === 'disabled'
      ? t({ ko: '비활성 건너뜀', en: 'Disabled skip' })
      : data.executionSkipReason === 'source-node-skipped'
        ? t({ ko: '상위 건너뜀', en: 'Upstream skipped' })
        : data.executionSkipReason === 'source-output-disabled'
          ? t({ ko: '출력 차단', en: 'Output blocked' })
          : data.executionSkipReason === 'inactive-branch'
            ? t({ ko: '비활성 분기', en: 'Inactive branch' })
            : t({ ko: '건너뜀', en: 'Skipped' })
  const activationLabel =
    data.disabled === true
      ? t({ ko: '비활성', en: 'Disabled' })
      : executionStatus === 'failed'
        ? t({ ko: '실패 지점', en: 'Failed node' })
        : executionStatus === 'blocked'
          ? t({ ko: '이후 차단', en: 'Blocked downstream' })
          : executionStatus === 'skipped'
            ? skippedReasonLabel
          : isWorkflowInputWaiting
            ? t({ ko: '실행 입력 대기', en: 'Runtime input waiting' })
            : missingRequiredInputCount > 0
            ? t({ ko: '입력 {count}개 필요', en: '{count} inputs needed' }, { count: missingRequiredInputCount })
            : data.activationHint === 'conditional-input'
              ? t({ ko: '조건 입력', en: 'Conditional input' })
              : t({ ko: '실행 가능', en: 'Runnable' })
  const activationTitle =
    data.disabled === true
      ? t({ ko: '이 노드는 실행 중 건너뛰고 출력도 비활성 처리돼.', en: 'This node is skipped during execution and its outputs are disabled.' })
      : isWorkflowInputWaiting
        ? t({ ko: '저장된 워크플로우 실행 때 이 값을 입력받도록 노출돼 있어. 실행 전 입력값을 확인해야 해.', en: 'This value is exposed for saved-workflow runs. Confirm the runtime input before execution.' })
        : missingRequiredInputCount > 0
        ? t({ ko: '필수 입력이 비어 있거나 연결되지 않아 실행 전 확인이 필요해.', en: 'One or more required inputs are empty or unconnected and need review before execution.' })
        : executionStatus === 'skipped'
          ? data.executionSkipReason === 'disabled'
            ? t({ ko: '이전 실행에서 이 노드는 비활성 상태라 실행하지 않고 모든 출력을 비활성 처리했어.', en: 'In the selected run this node was disabled, so execution skipped it and disabled all outputs.' })
            : data.executionSkipReason === 'source-node-skipped'
              ? t({ ko: '이전 실행에서 상위 노드가 먼저 건너뛰어져 이 노드도 실행되지 않았어.', en: 'In the selected run an upstream node was skipped first, so this node did not run.' })
              : data.executionSkipReason === 'source-output-disabled'
                ? t({ ko: '이전 실행에서 연결된 상위 출력이 비활성 처리되어 이 노드가 실행되지 않았어.', en: 'In the selected run a connected upstream output was disabled, so this node did not run.' })
                : t({ ko: '이전 실행에서 IF 분기 결과가 이 노드로 이어지지 않아 건너뛰었어.', en: 'In the selected run the IF branch result did not lead to this node, so it was skipped.' })
        : data.activationHint === 'conditional-input'
          ? t({ ko: 'IF 분기 출력이 연결되어 실행 때 조건 결과에 따라 건너뛸 수 있어.', en: 'An IF branch output feeds this node, so execution may skip it depending on the branch result.' })
          : t({ ko: '현재 연결과 값 기준으로 실행 경로에 들어갈 수 있어.', en: 'Current wiring and values allow this node to enter the execution path.' })

  const statusBorderColor =
    data.disabled === true
      ? '#94a3b8'
      : executionStatus === 'completed'
      ? '#7bd88f'
      : executionStatus === 'failed'
        ? '#ff8a80'
        : executionStatus === 'blocked'
          ? '#ffd180'
          : executionStatus === 'skipped'
            ? '#94a3b8'
          : missingRequiredInputCount > 0
            ? '#f59e0b'
            : `${accentColor}66`
  const operationKey = getModuleOperationKey(module)
  const isFinalResult = isFinalResultModule(module)
  const isTextMergeModule = operationKey === 'system.merge_text'
  const isRandomTextChoiceModule = operationKey === 'system.random_text_choice'
  const isTextTransformModule = operationKey === 'system.regex_text_transform'
  const isIfBranchModule = operationKey === 'system.logic_if_branch'
  const isApiRequestModule = operationKey === 'system.api_request' || (module.engine_type === 'system' && module.name === 'API 요청')
  const isSystemCallLlmModule = operationKey === 'system.call_llm'
  const isSystemCallCodexMessageModule = operationKey === 'system.call_codex_message'
  const isSystemLoadLlmPresetModule = operationKey === 'system.load_llm_preset'
  const llmProvidersQuery = useQuery({
    queryKey: ['external-api-llm-options', 'module-graph-node-card'],
    queryFn: () => getExternalApiLlmOptions(),
    enabled: isSystemCallLlmModule,
    staleTime: 30_000,
  })
  const llmPresetsQuery = useQuery({
    queryKey: ['llm-preset-options', 'module-graph-node-card'],
    queryFn: () => getLlmPresetOptions(),
    enabled: isSystemLoadLlmPresetModule,
    staleTime: 30_000,
  })
  const llmModelBindings = (() => {
    if (!isSystemCallLlmModule) {
      return [] as Array<ExternalApiLlmOptionRecord & { default_model: string }>
    }

    const entries = (llmProvidersQuery.data ?? [])
      .map((provider) => ({
        ...provider,
        default_model: normalizeOptionalString(provider.default_model),
      }))
      .filter((provider): provider is ExternalApiLlmOptionRecord & { default_model: string } => Boolean(provider.default_model))
      .sort((left, right) => left.provider_name.localeCompare(right.provider_name))

    return entries
  })()
  const llmModelOptions = llmModelBindings.map((provider) => ({
    value: provider.provider_name,
    label: `${provider.provider_name} · ${provider.default_model}`,
  })) satisfies ModuleGraphSelectOption[]
  const llmSelectedProviderName = normalizeOptionalString(data.inputValues?.provider_name) ?? ''
  const applyLlmModelBinding = (providerName: string) => {
    if (!data.onNodeValueChange) {
      return
    }

    const selectedBinding = llmModelBindings.find((entry) => entry.provider_name === providerName)
    if (!selectedBinding) {
      return
    }

    data.onNodeValueChange(id, 'provider_name', selectedBinding.provider_name)
    data.onNodeValueChange(id, 'model', '')
    data.onNodeValueChange(id, 'temperature', typeof selectedBinding.default_temperature === 'number' ? selectedBinding.default_temperature : '')
    data.onNodeValueChange(id, 'max_tokens', typeof selectedBinding.default_max_tokens === 'number' ? selectedBinding.default_max_tokens : 1024)
  }
  const codexModelPort = isSystemCallCodexMessageModule
    ? inputPorts.find((port) => port.key === 'model')
    : null
  const codexModelUiField = isSystemCallCodexMessageModule
    ? uiFieldByKey.get('model') ?? null
    : null
  const codexModelCurrentValue = normalizeOptionalString(data.inputValues?.model)
  const codexModelOptions = normalizeSelectOptions(
    codexModelUiField?.data_type === 'select' ? codexModelUiField.options : null,
  )
  const codexModelValue = codexModelCurrentValue
    ?? normalizeOptionalString(codexModelPort?.default_value)
    ?? (typeof codexModelUiField?.default_value === 'string' ? codexModelUiField.default_value : null)
    ?? (codexModelOptions[0] ? getSelectOptionValue(codexModelOptions[0]) : null)
    ?? ''
  const isNaiImageGenerationModule = module.engine_type === 'nai' || operationKey === 'system.generate_image_nai'
  const naiModelPort = isNaiImageGenerationModule
    ? inputPorts.find((port) => port.key === 'model')
    : null
  const naiModelUiField = isNaiImageGenerationModule
    ? uiFieldByKey.get('model') ?? null
    : null
  const naiModelCurrentValue = normalizeOptionalString(data.inputValues?.model)
  const naiModelOptions = normalizeSelectOptions(
    naiModelUiField?.data_type === 'select' ? naiModelUiField.options : null,
  )
  const naiModelValue = naiModelCurrentValue
    ?? normalizeOptionalString(naiModelPort?.default_value)
    ?? (typeof naiModelUiField?.default_value === 'string' ? naiModelUiField.default_value : null)
    ?? (naiModelOptions[0] ? getSelectOptionValue(naiModelOptions[0]) : null)
    ?? ''
  const canConfigureLlmModel = Boolean(isSystemCallLlmModule && llmModelOptions.length > 0 && data.onNodeValueChange)
  const canConfigureCodexModel = Boolean(isSystemCallCodexMessageModule && codexModelOptions.length > 0 && data.onNodeValueChange)
  const canConfigureNaiModel = Boolean(isNaiImageGenerationModule && naiModelOptions.length > 0 && data.onNodeValueChange && !connectedInputKeys.has('model'))
  const canConfigureLlmPreset = Boolean(isSystemLoadLlmPresetModule && data.onNodeValueChange)
  const llmPresetType = normalizeLlmPresetType(data.inputValues?.preset_type)
  const llmPresetEntries = getLlmPresetEntries(llmPresetsQuery.data, llmPresetType)
  const llmPresetName = normalizeOptionalString(data.inputValues?.preset_name) ?? ''
  const selectedLlmPreset = llmPresetName ? llmPresetEntries.find((preset) => preset.name === llmPresetName) ?? null : null
  const llmPresetNameOptions = llmPresetEntries
  const visibleOutputPorts = getVisibleModuleOutputPorts(module, data.inputValues, {
    includeAdvanced: isAdvancedOutputPortsEnabled(data.inputValues),
    connectedInputKeys,
    connectedOutputKeys,
  })
  const visibleOutputPortKeys = new Set(visibleOutputPorts.map((port) => port.key))
  const visibleInputPorts = inputPorts.filter((port) => {
    if (isSystemLoadLlmPresetModule && (port.key === 'preset_type' || port.key === 'preset_name')) {
      return false
    }

    if (isSystemCallLlmModule && port.key === 'provider_name') {
      return false
    }

    if (isSystemCallLlmModule && ['system_prompt_preset_name', 'prompt_preset_name', 'structured_output_json_preset_name', 'response_mode'].includes(port.key)) {
      return false
    }

    if (isSystemCallCodexMessageModule && port.key === 'response_mode') {
      return false
    }

    if (canConfigureLlmModel && port.key === 'model') {
      return false
    }

    if (canConfigureCodexModel && port.key === 'model') {
      return false
    }

    if (canConfigureNaiModel && port.key === 'model') {
      return false
    }

    return true
  })
  const portRowCount = Math.max(visibleInputPorts.length, visibleOutputPorts.length, 1)
  const renderedInputPorts = isWorkflowInputSource
    ? []
    : (isTextMergeModule || isRandomTextChoiceModule || isTextTransformModule || isIfBranchModule || isApiRequestModule ? inputPorts : visibleInputPorts)
  const renderedOutputPorts = isWorkflowInputSource
    ? sourceOutputPorts
    : (isTextMergeModule || isRandomTextChoiceModule || isTextTransformModule || isIfBranchModule || isApiRequestModule ? outputPorts : visibleOutputPorts)
  const renderedHandleSignature = [
    ...renderedInputPorts.map((port) => `in:${port.key}`),
    ...(isApiRequestModule ? getApiRequestDynamicInputPortKeys(data).map((portKey) => `in:${portKey}`) : []),
    ...(isRandomTextChoiceModule ? getRandomTextChoiceDynamicInputPortKeys(data).map((portKey) => `in:${portKey}`) : []),
    ...renderedOutputPorts.map((port) => `out:${port.key}`),
  ].join('|')

  useEffect(() => {
    updateNodeInternals(id)
  }, [id, renderedHandleSignature, updateNodeInternals])

  const comfyWorkflowId = module.engine_type === 'comfyui'
    ? parsePositiveIntegerish(module.source_workflow_id ?? module.template_defaults?.workflow_id)
    : null
  const canConfigureComfyTarget = Boolean(module.engine_type === 'comfyui' && comfyWorkflowId && data.onNodeValueChange)
  const comfyTargetBadgeLabel = canConfigureComfyTarget ? resolveComfyTargetBadgeLabel(t, data.inputValues) : null
  const comfyTargetValue = resolveComfyTargetValue(data.inputValues)
  const comfyServersQuery = useQuery({
    queryKey: ['generation-comfyui-servers', 'module-graph-node-card'],
    queryFn: () => getGenerationComfyUIServers(true),
    enabled: canConfigureComfyTarget,
    staleTime: 30_000,
  })
  const workflowServersQuery = useQuery({
    queryKey: ['generation-workflow-servers', comfyWorkflowId, 'module-graph-node-card'],
    queryFn: () => getGenerationWorkflowServers(comfyWorkflowId as number),
    enabled: canConfigureComfyTarget,
    staleTime: 30_000,
  })
  const linkedComfyServers = (workflowServersQuery.data ?? []) as ComfyWorkflowServerCandidate[]
  const activeLinkedComfyServers = linkedComfyServers.filter(isActiveComfyWorkflowServerCandidate)
  const activeGlobalComfyServers = ((comfyServersQuery.data ?? []) as ComfyWorkflowServerCandidate[]).filter(isActiveComfyWorkflowServerCandidate)
  const candidateComfyServers: ComfyUIServer[] = linkedComfyServers.length > 0 ? activeLinkedComfyServers : activeGlobalComfyServers
  const comfyRoutingTags = Array.from(new Set(candidateComfyServers.flatMap((server) => server.routing_tags ?? []))).sort((left, right) => left.localeCompare(right))
  const knownComfyTargetValues = new Set<string>([
    'auto',
    ...comfyRoutingTags.map((tag) => `tag:${tag}`),
    ...candidateComfyServers.map((server) => `server:${server.id}`),
  ])
  const hasKnownComfyTargetValue = knownComfyTargetValues.has(comfyTargetValue)
  const applyComfyTargetValue = (nextValue: string) => {
    if (!data.onNodeValueChange) {
      return
    }

    if (nextValue === 'auto') {
      data.onNodeValueChange(id, GRAPH_COMFY_TARGET_MODE_KEY, 'auto')
      data.onNodeValueChange(id, GRAPH_COMFY_TARGET_TAG_KEY, '')
      data.onNodeValueChange(id, GRAPH_COMFY_TARGET_SERVER_ID_KEY, '')
      return
    }

    if (nextValue.startsWith('tag:')) {
      data.onNodeValueChange(id, GRAPH_COMFY_TARGET_MODE_KEY, 'tag')
      data.onNodeValueChange(id, GRAPH_COMFY_TARGET_TAG_KEY, nextValue.slice('tag:'.length))
      data.onNodeValueChange(id, GRAPH_COMFY_TARGET_SERVER_ID_KEY, '')
      return
    }

    if (nextValue.startsWith('server:')) {
      data.onNodeValueChange(id, GRAPH_COMFY_TARGET_MODE_KEY, 'server')
      data.onNodeValueChange(id, GRAPH_COMFY_TARGET_TAG_KEY, '')
      data.onNodeValueChange(id, GRAPH_COMFY_TARGET_SERVER_ID_KEY, nextValue.slice('server:'.length))
    }
  }

  return (
    <div
      className={`w-[340px] max-w-[340px] rounded-sm border bg-surface-container px-2.5 py-2 text-foreground shadow-lg ${data.disabled === true ? 'opacity-60 grayscale' : ''}`}
      style={{
        borderColor: selected ? accentColor : statusBorderColor,
        boxShadow: selected ? `0 0 0 2px ${accentColor}66, 0 0 0 1px ${accentColor}22` : `0 0 0 1px ${accentColor}22`,
      } as CSSProperties}
      title={`${nodeDisplayLabel}\n${t({ ko: '기본 타입: {label}', en: 'Base type: {label}' }, { label: moduleBaseLabel })}\n${t({ ko: '모듈 ID: {id}', en: 'Module ID: {id}' }, { id: module.id })}${module.description ? `\n${module.description}` : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <div className="module-graph-drag-handle flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm border border-border/70 bg-background/50 text-muted-foreground active:cursor-grabbing">
            <GripVertical className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            {isEditingLabel ? (
              <Input
                value={labelDraft}
                autoFocus
                onChange={(event) => setLabelDraft(event.target.value)}
                onMouseDown={stopNodeInteraction}
                onClick={stopNodeInteraction}
                onBlur={() => {
                  data.onNodeLabelChange?.(id, labelDraft)
                  setIsEditingLabel(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    event.stopPropagation()
                    data.onNodeLabelChange?.(id, labelDraft)
                    setIsEditingLabel(false)
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    setLabelDraft(data.label ?? '')
                    setIsEditingLabel(false)
                  }
                }}
                placeholder={moduleBaseLabel}
                className={`nodrag nowheel h-8 text-sm ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
              />
            ) : (
              <button
                type="button"
                className="max-w-full cursor-pointer truncate text-left text-sm font-semibold text-foreground transition-colors hover:text-primary"
                onClick={(event) => {
                  if (!selected) {
                    return
                  }
                  stopNodeActionEvent(event)
                  setIsEditingLabel(true)
                }}
                title={selected ? t({ ko: '클릭해서 이름 변경', en: 'Click to rename' }) : undefined}
              >
                {nodeDisplayLabel}
              </button>
            )}
            {usesCustomNodeLabel ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{moduleBaseLabel}</div> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {data.plannedExecutionOrder ? <Badge variant="outline" title={t({ ko: '계획 실행 순서', en: 'Planned execution order' })}>#{data.plannedExecutionOrder}</Badge> : null}
          <Badge variant="outline" title={activationTitle}>{activationLabel}</Badge>
          {isFinalResult ? <Badge variant="secondary">{t({ ko: '최종 결과', en: 'Final result' })}</Badge> : null}
          {data.executionReuseState === 'reused' ? <Badge variant="outline">{t({ ko: '캐시', en: 'Cache' })}</Badge> : null}
          {data.executionArtifactCount ? <Badge variant="outline">A {data.executionArtifactCount}</Badge> : null}
          {statusLabel && statusLabel !== activationLabel ? <Badge variant="secondary">{statusLabel}</Badge> : null}
        </div>
      </div>

      {(data.onExecuteNode || data.onForceExecuteNode) ? (
        <div className="nodrag nowheel mt-2 flex flex-wrap gap-1.5">
          {data.onExecuteNode ? (
            <Button
              type="button"
              size="icon-sm"
              className="h-7 w-7"
              disabled={data.executeNodeDisabled}
              onMouseDown={stopNodeActionEvent}
              onClick={(event) => {
                stopNodeActionEvent(event)
                data.onExecuteNode?.()
              }}
              title={t({ ko: '실행', en: 'Run' })}
              aria-label={t({ ko: '실행', en: 'Run' })}
            >
              <Play className="h-3.5 w-3.5" />
            </Button>
          ) : null}
          {data.onForceExecuteNode ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="h-7 w-7"
              disabled={data.executeNodeDisabled}
              onMouseDown={stopNodeActionEvent}
              onClick={(event) => {
                stopNodeActionEvent(event)
                data.onForceExecuteNode?.()
              }}
              title={t({ ko: '재실행', en: 'Rerun' })}
              aria-label={t({ ko: '재실행', en: 'Rerun' })}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}

      {canConfigureComfyTarget ? (
        <div className="nodrag nowheel mt-2">
          <Select
            value={comfyTargetValue}
            onMouseDown={stopNodeInteraction}
            onClick={stopNodeInteraction}
            onChange={(event) => {
              stopNodeInteraction(event)
              applyComfyTargetValue(event.target.value)
            }}
            className={`h-8 text-xs ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
          >
            {!hasKnownComfyTargetValue ? <option value={comfyTargetValue} disabled>{t({ ko: '외부 설정을 찾을 수 없음 ({label})', en: 'Could not find external configuration ({label})' }, { label: comfyTargetBadgeLabel ?? '' })}</option> : null}
            <option value="auto">{t({ ko: '자동 분산', en: 'Auto routing' })}</option>
            {comfyRoutingTags.length > 0 ? (
              <optgroup label={t({ ko: '태그', en: 'Tags' })}>
                {comfyRoutingTags.map((tag) => (
                  <option key={tag} value={`tag:${tag}`}>#{tag}</option>
                ))}
              </optgroup>
            ) : null}
            {candidateComfyServers.length > 0 ? (
              <optgroup label={t({ ko: '서버', en: 'Servers' })}>
                {candidateComfyServers.map((server) => (
                  <option key={server.id} value={`server:${server.id}`}>{server.name}</option>
                ))}
              </optgroup>
            ) : null}
          </Select>
        </div>
      ) : null}

      {canConfigureNaiModel ? (
        <div className="nodrag nowheel mt-2 space-y-1">
          <div className="px-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{t({ ko: '모델', en: 'Model' })}</div>
          <Select
            value={naiModelValue}
            onMouseDown={stopNodeInteraction}
            onClick={stopNodeInteraction}
            onChange={(event) => {
              stopNodeInteraction(event)
              data.onNodeValueChange?.(id, 'model', event.target.value)
            }}
            className={`h-8 text-xs ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
          >
            {naiModelOptions.map((option) => {
              const optionValue = getSelectOptionValue(option)
              const optionLabel = typeof option === 'string' ? option : option.label
              return <option key={optionValue} value={optionValue}>{optionLabel}</option>
            })}
          </Select>
        </div>
      ) : null}

      {canConfigureLlmModel ? (
        <div className="nodrag nowheel mt-2 space-y-1">
          <div className="px-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{t({ ko: '모델', en: 'Model' })}</div>
          <Select
            value={llmSelectedProviderName}
            onMouseDown={stopNodeInteraction}
            onClick={stopNodeInteraction}
            onChange={(event) => {
              stopNodeInteraction(event)
              applyLlmModelBinding(event.target.value)
            }}
            className={`h-8 text-xs ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
          >
            <option value="">{t({ ko: '모델 선택', en: 'Select model' })}</option>
            {llmModelOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </div>
      ) : null}

      {canConfigureCodexModel ? (
        <div className="nodrag nowheel mt-2 space-y-1">
          <div className="px-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{t({ ko: '모델', en: 'Model' })}</div>
          <Select
            value={codexModelValue}
            onMouseDown={stopNodeInteraction}
            onClick={stopNodeInteraction}
            onChange={(event) => {
              stopNodeInteraction(event)
              data.onNodeValueChange?.(id, 'model', event.target.value)
            }}
            className={`h-8 text-xs ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
          >
            {codexModelOptions.map((option) => {
              const optionValue = getSelectOptionValue(option)
              const optionLabel = typeof option === 'string' ? option : option.label
              return <option key={optionValue} value={optionValue}>{optionLabel}</option>
            })}
          </Select>
        </div>
      ) : null}

      {canConfigureLlmPreset ? (
        <div className="nodrag nowheel mt-2 space-y-1.5">
          <div className="px-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{t({ ko: '프리셋', en: 'Preset' })}</div>
          <Select
            value={llmPresetType}
            onMouseDown={stopNodeInteraction}
            onClick={stopNodeInteraction}
            onChange={(event) => {
              stopNodeInteraction(event)
              data.onNodeValueChange?.(id, 'preset_type', event.target.value)
              data.onNodeValueChange?.(id, 'preset_name', '')
            }}
            className={`h-8 text-xs ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
          >
            {getLlmPresetTypeOptions(t).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
          <Select
            value={llmPresetName}
            onMouseDown={stopNodeInteraction}
            onClick={stopNodeInteraction}
            onChange={(event) => {
              stopNodeInteraction(event)
              data.onNodeValueChange?.(id, 'preset_name', event.target.value)
            }}
            className={`h-8 text-xs ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
          >
            <option value="">{llmPresetsQuery.isLoading ? t({ ko: '불러오는 중', en: 'Loading' }) : t({ ko: '프리셋 선택', en: 'Select preset' })}</option>
            {llmPresetNameOptions.map((preset) => (
              <option key={preset.id || preset.name} value={preset.name}>{preset.name}</option>
            ))}
          </Select>
          {selectedLlmPreset ? (
            <div className="rounded-sm border border-border/60 bg-background/45 px-2.5 py-2">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{t({ ko: '선택 내용', en: 'Selected content' })}</div>
              <div className="max-h-24 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-4 text-foreground">{summarizeLlmPresetContent(selectedLlmPreset.content)}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {isWorkflowInputSource ? <SourceNodeOutputPorts nodeId={id} ports={sourceOutputPorts} connectedOutputKeys={connectedOutputKeys} accentColor={accentColor} /> : null}
      {isWorkflowInputSource ? <InlineWorkflowInputEditor id={id} data={data} /> : null}

      {!isWorkflowInputSource ? (
        isTextMergeModule ? (
          <TextMergeNodeLayout
            id={id}
            data={data}
            accentColor={accentColor}
            connectedInputKeys={connectedInputKeys}
            connectedOutputKeys={connectedOutputKeys}
            uiFieldByKey={uiFieldByKey}
          />
        ) : isRandomTextChoiceModule ? (
          <RandomTextChoiceNodeLayout
            id={id}
            data={data}
            accentColor={accentColor}
            connectedInputKeys={connectedInputKeys}
            connectedOutputKeys={connectedOutputKeys}
          />
        ) : isTextTransformModule ? (
          <TextTransformNodeLayout
            id={id}
            data={data}
            accentColor={accentColor}
            connectedInputKeys={connectedInputKeys}
            connectedOutputKeys={connectedOutputKeys}
            uiFieldByKey={uiFieldByKey}
          />
        ) : isIfBranchModule ? (
          <IfBranchNodeLayout
            id={id}
            data={data}
            accentColor={accentColor}
            connectedInputKeys={connectedInputKeys}
            connectedOutputKeys={connectedOutputKeys}
            uiFieldByKey={uiFieldByKey}
          />
        ) : isApiRequestModule ? (
          <ApiRequestNodeLayout
            id={id}
            data={data}
            accentColor={accentColor}
            connectedInputKeys={connectedInputKeys}
            connectedOutputKeys={connectedOutputKeys}
            uiFieldByKey={uiFieldByKey}
          />
        ) : (
          <div className="mt-2.5 grid gap-1">
            {Array.from({ length: portRowCount }, (_, index) => {
              const inputPort = visibleInputPorts[index]
              const outputPort = visibleOutputPorts[index]
              const inputPortState = getInputPortState(data, inputPort, connectedInputKeys)
              const outputConnected = Boolean(outputPort && connectedOutputKeys.has(outputPort.key))

              if (inputPort && !outputPort) {
                return (
                  <div key={`port-row-${index}`} className="grid grid-cols-1">
                    <InputPortCell
                      nodeId={id}
                      data={data}
                      port={inputPort}
                      uiField={uiFieldByKey.get(inputPort.key) ?? null}
                      accentColor={accentColor}
                      connected={inputPortState.connected}
                      satisfied={inputPortState.satisfied}
                      requiredMissing={inputPortState.requiredMissing}
                      selectOptionsOverride={undefined}
                    />
                  </div>
                )
              }

              if (!inputPort && outputPort) {
                return (
                  <div key={`port-row-${index}`} className="grid grid-cols-1">
                    <PortCell
                      nodeId={id}
                      port={outputPort}
                      side="output"
                      accentColor={accentColor}
                      connected={outputConnected}
                      satisfied={outputConnected}
                      requiredMissing={false}
                      outputState={data.conditionalOutputStates?.[outputPort.key] ?? null}
                    />
                  </div>
                )
              }

              return (
                <div key={`port-row-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
                  <InputPortCell
                    nodeId={id}
                    data={data}
                    port={inputPort}
                    uiField={inputPort ? uiFieldByKey.get(inputPort.key) ?? null : null}
                    accentColor={accentColor}
                    connected={inputPortState.connected}
                    satisfied={inputPortState.satisfied}
                    requiredMissing={inputPortState.requiredMissing}
                    selectOptionsOverride={undefined}
                  />
                  <PortCell
                    nodeId={id}
                    port={outputPort}
                    side="output"
                    accentColor={accentColor}
                    connected={outputConnected}
                    satisfied={outputConnected}
                    requiredMissing={false}
                    outputState={outputPort ? data.conditionalOutputStates?.[outputPort.key] ?? null : null}
                  />
                </div>
              )
            })}
          </div>
        )
      ) : null}

      {powerLoraUiFields.length > 0 ? (
        <div className="nodrag nowheel mt-1.5 space-y-1 border-t border-border/20 pt-1.5" onMouseDown={stopNodeInteraction} onClick={stopNodeInteraction}>
          <div className="px-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">LoRA</div>
          {powerLoraUiFields.map((field) => {
            const value = data.inputValues?.[field.key] ?? field.default_value
            return (
              <PowerLoraLoaderInput
                key={field.key}
                field={field}
                value={value}
                variant="compact"
                onChange={(nextValue) => data.onNodeValueChange?.(id, field.key, nextValue)}
              />
            )
          })}
        </div>
      ) : null}

      <NodeArtifactOutputs
        data={data}
        moduleName={module.name}
        isFinalResult={isFinalResult}
        visibleOutputPortKeys={visibleOutputPortKeys}
      />    </div>
  )
}
