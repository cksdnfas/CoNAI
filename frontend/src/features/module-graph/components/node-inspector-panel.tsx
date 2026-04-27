import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ImageAttachmentPickerButton } from '@/features/image-generation/components/image-attachment-picker'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import { getExternalApiLlmOptions, type ExternalApiLlmOptionRecord } from '@/lib/api-external-api'
import { getLlmPresetOptions, type LlmPresetOptionCollections, type LlmPresetOptionRecord } from '@/lib/api-settings'
import type { GraphExecutionArtifactRecord, ModulePortDefinition, ModuleUiFieldDefinition } from '@/lib/api'
import { ExecutionArtifactCard } from './execution-artifact-card'
import { ModuleGraphSimpleValueInput, type ModuleGraphSelectOption } from './module-graph-simple-value-input'
import { PowerLoraLoaderInput, hasPowerLoraLoaderEntries, isPowerLoraLoaderUiField } from './power-lora-loader-input'
import { NaiCharacterPromptsInput, isNaiCharacterPromptPort } from './nai-character-prompts-input'
import { NaiReusableAssetInput, isNaiCharacterReferencePort, isNaiVibePort } from './nai-reusable-assets-input'
import { TechnicalReferenceHint, getModuleGraphPortTypeLabel, hasMeaningfulValue } from './module-graph-field-shared'
import { getWorkflowInputSourcePort } from '../module-graph-workflow-inputs'
import { getModuleBaseDisplayName, getModuleNodeDisplayLabel, getModuleOperationKey, getVisibleModuleOutputPorts, isAdvancedOutputPortsEnabled, normalizeModulePortDescription, normalizeOptionalString, parseHandleId, type ModuleGraphEdge, type ModuleGraphNode } from '../module-graph-shared'

type NodeInspectorPanelProps = {
  nodes: ModuleGraphNode[]
  selectedNode: ModuleGraphNode | null
  selectedEdge: ModuleGraphEdge | null
  selectedExecutionId?: number | null
  selectedExecutionArtifacts?: GraphExecutionArtifactRecord[]
  onNodeLabelChange: (nodeId: string, label: string) => void
  onNodeValueChange: (nodeId: string, portKey: string, value: unknown) => void
  onNodeValueClear: (nodeId: string, portKey: string) => void
  onNodeImageChange: (nodeId: string, portKey: string, image?: SelectedImageDraft) => Promise<void> | void
  onExecuteSelectedNode?: () => void
  onForceExecuteSelectedNode?: () => void
  executeSelectedNodeDisabled?: boolean
  executeSelectedNodeLabel?: string
  forceExecuteSelectedNodeLabel?: string
  highlightedPortKey?: string | null
  showHeader?: boolean
}

type ResolvedEdgeEndpoint = {
  node: ModuleGraphNode | null
  port: ModulePortDefinition | null
  portKey: string | null
}

type NodeOutputArtifactGroup = {
  portKey: string
  portLabel: string
  portType: ModulePortDefinition['data_type'] | null
  artifacts: GraphExecutionArtifactRecord[]
}

type LlmPresetCollectionKey = keyof LlmPresetOptionCollections

const LLM_PRESET_TYPE_OPTIONS: Array<{ value: LlmPresetCollectionKey; label: string }> = [
  { value: 'systemPromptPresets', label: '시스템 프롬프트' },
  { value: 'promptPresets', label: '프롬프트' },
  { value: 'structuredOutputJsonPresets', label: '구조화 출력 JSON' },
]

const NODE_INSPECTOR_INPUT_SURFACE_CLASS = 'space-y-2 rounded-sm border border-border/70 bg-background/35 p-3'
const NODE_INSPECTOR_EDGE_SURFACE_CLASS = 'space-y-3 rounded-sm border border-border/70 bg-background/35 p-4'
const NODE_INSPECTOR_NODE_SURFACE_CLASS = 'rounded-sm border border-border/70 bg-background/35 p-4'

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
  return normalized.length > 220 ? `${normalized.slice(0, 219)}…` : normalized
}

/** Resolve whether one node input is already satisfied by a connection or value. */
function isNodeInputSatisfied(node: ModuleGraphNode, port: ModulePortDefinition) {
  const connectedInputKeys = new Set(node.data.connectedInputKeys ?? [])
  return connectedInputKeys.has(port.key) || hasMeaningfulValue(node.data.inputValues?.[port.key]) || hasMeaningfulValue(port.default_value)
}

/** Find optional UI-schema metadata for one node input port. */
function findNodeUiField(node: ModuleGraphNode, portKey: string) {
  return node.data.module.ui_schema?.find((field) => field.key === portKey)
}

/** Render compact badges for one module port so graph and inspector use the same nouns. */
function PortBadges({ port, missingRequired = false }: { port: ModulePortDefinition; missingRequired?: boolean }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <Badge variant="outline">{getModuleGraphPortTypeLabel(port.data_type)}</Badge>
      <Badge variant="secondary">{port.key}</Badge>
      {port.required ? <Badge variant="outline">필수</Badge> : null}
      {missingRequired ? <Badge variant="secondary">입력 필요</Badge> : null}
      {port.multiple ? <Badge variant="outline">다중</Badge> : null}
    </div>
  )
}

/** Render the shared heading block for an editable node port. */
function PortHeader({
  nodeId,
  port,
  hasExplicitValue,
  missingRequired,
  onClear,
}: {
  nodeId: string
  port: ModulePortDefinition
  hasExplicitValue: boolean
  missingRequired: boolean
  onClear: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <div className="text-sm font-medium text-foreground">{port.label}</div>
          <TechnicalReferenceHint title={`node ${nodeId}\nport ${port.key}`} label="포트 내부 키 보기" />
        </div>
        <PortBadges port={port} missingRequired={missingRequired} />
        {normalizeModulePortDescription(port.description) ? <div className="mt-1 text-xs text-muted-foreground">{normalizeModulePortDescription(port.description)}</div> : null}
      </div>
      <Button type="button" size="sm" variant="ghost" onClick={onClear} disabled={!hasExplicitValue}>
        값 지우기
      </Button>
    </div>
  )
}

function isConfigOnlyNodeField(node: ModuleGraphNode, fieldKey: string) {
  const uiField = findNodeUiField(node, fieldKey)
  const port = (node.data.module.exposed_inputs ?? []).find((inputPort) => inputPort.key === fieldKey)
  const value = node.data.inputValues?.[fieldKey] ?? port?.default_value ?? uiField?.default_value
  return isPowerLoraLoaderUiField(uiField) || hasPowerLoraLoaderEntries(value)
}

function getEditableNodeInputPorts(node: ModuleGraphNode) {
  return (node.data.module.exposed_inputs ?? []).filter((port) => !isConfigOnlyNodeField(node, port.key))
}

/** Find editable UI-only fields that are not backed by module input ports. */
function getStandaloneNodeUiFields(node: ModuleGraphNode) {
  const portKeys = new Set((node.data.module.exposed_inputs ?? []).map((port) => port.key))
  return (node.data.module.ui_schema ?? []).filter((field) => !portKeys.has(field.key) || isConfigOnlyNodeField(node, field.key))
}

/** Resolve a selected edge endpoint back into its node and module port metadata. */
function resolveEdgeEndpoint(nodes: ModuleGraphNode[], nodeId: string, handleId: string | null | undefined, direction: 'in' | 'out'): ResolvedEdgeEndpoint {
  const node = nodes.find((item) => item.id === nodeId) ?? null
  const parsedHandle = parseHandleId(handleId)
  const portKey = parsedHandle?.portKey ?? null

  if (!node || !portKey) {
    return { node, port: null, portKey }
  }

  const portList = direction === 'out' ? node.data.module.output_ports : node.data.module.exposed_inputs
  const port = portList.find((item) => item.key === portKey) ?? null

  return {
    node,
    port,
    portKey,
  }
}

/** Render an edge endpoint summary so selected connections are understandable without raw handle ids. */
function EdgeEndpointCard({
  heading,
  endpoint,
  role,
}: {
  heading: string
  endpoint: ResolvedEdgeEndpoint
  role: '입력' | '출력'
}) {
  return (
    <div className="rounded-sm border border-border/70 bg-background/35 px-3 py-3">
      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{heading}</div>
      <div className="mt-2 flex items-center gap-1">
        <div className="text-sm font-medium text-foreground">{endpoint.node ? getModuleNodeDisplayLabel(endpoint.node) : '알 수 없는 노드'}</div>
        {endpoint.node?.id ? <TechnicalReferenceHint title={`node ${endpoint.node.id}`} label="노드 내부 식별자 보기" /> : null}
      </div>
      <div className="mt-3 text-xs font-medium text-foreground">{role} 포트</div>
      {endpoint.port ? (
        <>
          <div className="mt-1 flex items-center gap-1">
            <div className="text-sm text-foreground">{endpoint.port.label}</div>
            <TechnicalReferenceHint title={`port ${endpoint.port.key}`} label="포트 내부 키 보기" />
          </div>
          <PortBadges port={endpoint.port} />
          {normalizeModulePortDescription(endpoint.port.description) ? <div className="mt-1 text-xs text-muted-foreground">{normalizeModulePortDescription(endpoint.port.description)}</div> : null}
        </>
      ) : (
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <span>{endpoint.portKey ? '포트 세부 정보' : '포트 정보를 찾지 못했어.'}</span>
          {endpoint.portKey ? <TechnicalReferenceHint title={`port ${endpoint.portKey}`} label="포트 내부 키 보기" /> : null}
        </div>
      )}
    </div>
  )
}

/** Group one selected node's execution artifacts by output port for inspector display. */
function groupNodeOutputArtifacts(node: ModuleGraphNode, artifacts: GraphExecutionArtifactRecord[]) {
  const visibleOutputPorts = getVisibleModuleOutputPorts(node.data.module, node.data.inputValues, {
    includeAdvanced: isAdvancedOutputPortsEnabled(node.data.inputValues),
    connectedInputKeys: node.data.connectedInputKeys,
    connectedOutputKeys: node.data.connectedOutputKeys,
  })
  const visibleOutputPortKeys = new Set(visibleOutputPorts.map((port) => port.key))
  const outputPortMap = new Map(visibleOutputPorts.map((port, index) => [port.key, { port, index }]))
  const groupedArtifacts = artifacts.reduce<Map<string, GraphExecutionArtifactRecord[]>>((acc, artifact) => {
    if (!visibleOutputPortKeys.has(artifact.port_key)) {
      return acc
    }

    const current = acc.get(artifact.port_key) ?? []
    current.push(artifact)
    acc.set(artifact.port_key, current)
    return acc
  }, new Map())

  return Array.from(groupedArtifacts.entries())
    .map(([portKey, portArtifacts]) => {
      const outputPort = outputPortMap.get(portKey)?.port ?? null
      return {
        portKey,
        portLabel: outputPort?.label ?? portKey,
        portType: outputPort?.data_type ?? (portArtifacts[0]?.artifact_type === 'file' ? null : portArtifacts[0]?.artifact_type ?? null),
        artifacts: [...portArtifacts].sort((left, right) => new Date(right.created_date).getTime() - new Date(left.created_date).getTime()),
      } satisfies NodeOutputArtifactGroup
    })
    .sort((left, right) => {
      const leftOrder = outputPortMap.get(left.portKey)?.index ?? Number.MAX_SAFE_INTEGER
      const rightOrder = outputPortMap.get(right.portKey)?.index ?? Number.MAX_SAFE_INTEGER
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder
      }

      return left.portLabel.localeCompare(right.portLabel, 'ko')
    })
}

/** Render editable node input overrides and selected edge details. */
export function NodeInspectorPanel({
  nodes,
  selectedNode,
  selectedEdge,
  selectedExecutionId = null,
  selectedExecutionArtifacts,
  onNodeLabelChange,
  onNodeValueChange,
  onNodeValueClear,
  onNodeImageChange,
  onExecuteSelectedNode,
  onForceExecuteSelectedNode,
  executeSelectedNodeDisabled = false,
  executeSelectedNodeLabel = '선택 노드 실행',
  forceExecuteSelectedNodeLabel = '강제 재실행',
  highlightedPortKey = null,
  showHeader = true,
}: NodeInspectorPanelProps) {
  const [collapsedOutputGroupKeys, setCollapsedOutputGroupKeys] = useState<string[]>([])
  const selectedNodeOperationKey = selectedNode ? getModuleOperationKey(selectedNode.data.module) : null
  const isSystemCallLlmNode = selectedNodeOperationKey === 'system.call_llm'
  const isSystemCallCodexMessageNode = selectedNodeOperationKey === 'system.call_codex_message'
  const isSystemLoadLlmPresetNode = selectedNodeOperationKey === 'system.load_llm_preset'
  const llmProvidersQuery = useQuery({
    queryKey: ['external-api-llm-options', 'node-inspector-panel'],
    queryFn: () => getExternalApiLlmOptions(),
    enabled: isSystemCallLlmNode,
    staleTime: 30_000,
  })
  const llmPresetsQuery = useQuery({
    queryKey: ['llm-preset-options', 'node-inspector-panel'],
    queryFn: () => getLlmPresetOptions(),
    enabled: isSystemLoadLlmPresetNode,
    staleTime: 30_000,
  })
  const selectedNodeVisibleOutputPorts = selectedNode
    ? getVisibleModuleOutputPorts(selectedNode.data.module, selectedNode.data.inputValues, {
        includeAdvanced: isAdvancedOutputPortsEnabled(selectedNode.data.inputValues),
        connectedInputKeys: selectedNode.data.connectedInputKeys,
        connectedOutputKeys: selectedNode.data.connectedOutputKeys,
      })
    : []
  const llmModelBindings = (() => {
    if (!isSystemCallLlmNode) {
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
  const applyLlmModelBinding = (node: ModuleGraphNode, providerName: string) => {
    const selectedBinding = llmModelBindings.find((entry) => entry.provider_name === providerName)
    if (!selectedBinding) {
      return
    }

    onNodeValueChange(node.id, 'provider_name', selectedBinding.provider_name)
    onNodeValueChange(node.id, 'model', '')
    onNodeValueChange(node.id, 'temperature', typeof selectedBinding.default_temperature === 'number' ? selectedBinding.default_temperature : '')
    onNodeValueChange(node.id, 'max_tokens', typeof selectedBinding.default_max_tokens === 'number' ? selectedBinding.default_max_tokens : 1024)
  }

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setCollapsedOutputGroupKeys([])
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [selectedNode?.id, selectedExecutionId])

  const renderPortInput = (node: ModuleGraphNode, port: ModulePortDefinition) => {
    const rawValue = node.data.inputValues?.[port.key]
    const uiField = findNodeUiField(node, port.key)
    const normalizedDescription = normalizeModulePortDescription(port.description)
    const numberStep = isSystemCallLlmNode && port.key === 'temperature'
      ? 0.1
      : isSystemCallLlmNode && port.key === 'max_tokens'
        ? 128
        : undefined
    const numberMin = isSystemCallLlmNode && port.key === 'temperature'
      ? 0
      : isSystemCallLlmNode && port.key === 'max_tokens'
        ? 128
        : uiField?.min
    const numberPlaceholder = isSystemCallLlmNode && port.key === 'temperature'
      ? '0.7'
      : isSystemCallLlmNode && port.key === 'max_tokens'
        ? '1024'
        : (uiField?.placeholder || port.label)
    const hasExplicitValue = hasMeaningfulValue(rawValue)
    const missingRequired = Boolean(port.required && !isNodeInputSatisfied(node, port))
    const isHighlightedPort = highlightedPortKey === port.key
    const clearPortValue = () => onNodeValueClear(node.id, port.key)
    const cardStyle = isHighlightedPort
      ? ({ borderColor: '#60a5fa', backgroundColor: 'rgba(96, 165, 250, 0.10)', boxShadow: '0 0 0 1px rgba(96, 165, 250, 0.35)' } as CSSProperties)
      : missingRequired
        ? ({ borderColor: '#f59e0b99', backgroundColor: 'rgba(245, 158, 11, 0.08)' } as CSSProperties)
        : undefined

    if (isSystemLoadLlmPresetNode && port.key === 'preset_type') {
      const presetType = normalizeLlmPresetType(rawValue)

      return (
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <ModuleGraphSimpleValueInput
            dataType="select"
            value={presetType}
            onChange={(value) => {
              onNodeValueChange(node.id, 'preset_type', value)
              onNodeValueClear(node.id, 'preset_name')
            }}
            options={LLM_PRESET_TYPE_OPTIONS}
            allowEmptyOption={false}
          />
        </div>
      )
    }

    if (isSystemLoadLlmPresetNode && port.key === 'preset_name') {
      const presetType = normalizeLlmPresetType(node.data.inputValues?.preset_type)
      const entries = getLlmPresetEntries(llmPresetsQuery.data, presetType)
      const currentPresetName = normalizeOptionalString(rawValue)
      const selectedPreset = currentPresetName
        ? entries.find((preset) => preset.name === currentPresetName) ?? null
        : null
      const presetOptions = entries.map((preset) => ({ value: preset.name, label: preset.name }))
      const options = presetOptions

      return (
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <ModuleGraphSimpleValueInput
            dataType="select"
            value={currentPresetName ?? ''}
            onChange={(value) => onNodeValueChange(node.id, port.key, value)}
            options={options}
            emptyLabel={llmPresetsQuery.isLoading ? '불러오는 중' : '프리셋 선택'}
          />
          {selectedPreset ? (
            <div className="mt-2 rounded-sm border border-border/60 bg-surface-lowest/70 px-3 py-2">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">선택 내용</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-foreground">{summarizeLlmPresetContent(selectedPreset.content)}</pre>
            </div>
          ) : null}
        </div>
      )
    }

    if (isSystemCallLlmNode && port.key === 'provider_name') {
      return null
    }

    if (
      isSystemCallLlmNode
      && ['system_prompt_preset_name', 'prompt_preset_name', 'structured_output_json_preset_name', 'response_mode'].includes(port.key)
    ) {
      return null
    }

    if (isSystemCallCodexMessageNode && port.key === 'response_mode') {
      return null
    }

    if (isSystemCallLlmNode && port.key === 'model' && llmModelOptions.length > 0) {
      const currentProviderName = normalizeOptionalString(node.data.inputValues?.provider_name)
      const effectiveSelectValue = currentProviderName && llmModelOptions.some((option) => typeof option !== 'string' && option.value === currentProviderName)
        ? currentProviderName
        : ''

      return (
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <ModuleGraphSimpleValueInput
            dataType="select"
            value={effectiveSelectValue}
            onChange={(value) => applyLlmModelBinding(node, String(value))}
            options={llmModelOptions}
            emptyLabel="모델 선택"
          />
        </div>
      )
    }

    if (isNaiCharacterPromptPort(port.key, port.data_type)) {
      return (
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <NaiCharacterPromptsInput value={rawValue} onChange={(value) => onNodeValueChange(node.id, port.key, value)} />
        </div>
      )
    }

    if (isNaiVibePort(port.key, port.data_type)) {
      return (
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <NaiReusableAssetInput kind="vibes" value={rawValue} onChange={(value) => onNodeValueChange(node.id, port.key, value)} />
        </div>
      )
    }

    if (isNaiCharacterReferencePort(port.key, port.data_type)) {
      return (
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <NaiReusableAssetInput kind="character_refs" value={rawValue} onChange={(value) => onNodeValueChange(node.id, port.key, value)} />
        </div>
      )
    }

    const powerLoraLoaderValue = rawValue ?? port.default_value ?? uiField?.default_value

    if (isPowerLoraLoaderUiField(uiField) || hasPowerLoraLoaderEntries(powerLoraLoaderValue)) {
      return (
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <PowerLoraLoaderInput
            field={uiField}
            value={powerLoraLoaderValue}
            onChange={(value) => onNodeValueChange(node.id, port.key, value)}
          />
        </div>
      )
    }

    const selectOptions = uiField?.data_type === 'select' && Array.isArray(uiField.options) ? uiField.options : []
    const isCodexModelPort = isSystemCallCodexMessageNode && port.key === 'model'

    if (selectOptions.length > 0) {
      const effectiveSelectValue = isCodexModelPort
        ? (rawValue ?? port.default_value ?? uiField?.default_value ?? selectOptions[0] ?? '')
        : rawValue

      return (
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <ModuleGraphSimpleValueInput
            dataType="select"
            value={effectiveSelectValue}
            onChange={(value) => onNodeValueChange(node.id, port.key, value)}
            options={selectOptions}
            emptyLabel={hasMeaningfulValue(port.default_value ?? uiField?.default_value) ? '기본값 사용' : '선택'}
            allowEmptyOption={!isCodexModelPort}
          />
        </div>
      )
    }

    if (port.data_type === 'prompt' || port.data_type === 'json') {
      return (
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <ModuleGraphSimpleValueInput
            dataType={port.data_type}
            value={rawValue}
            onChange={(value) => onNodeValueChange(node.id, port.key, value)}
            placeholder={normalizedDescription || port.label}
            rows={port.data_type === 'json' ? 6 : 4}
          />
        </div>
      )
    }

    if (port.data_type === 'number') {
      return (
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <ModuleGraphSimpleValueInput
            dataType="number"
            value={rawValue}
            onChange={(value) => onNodeValueChange(node.id, port.key, value)}
            placeholder={numberPlaceholder}
            min={numberMin}
            max={uiField?.max}
            step={numberStep}
          />
        </div>
      )
    }

    if (port.data_type === 'boolean') {
      return (
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <ModuleGraphSimpleValueInput
            dataType="boolean"
            value={rawValue}
            onChange={(value) => onNodeValueChange(node.id, port.key, value)}
          />
        </div>
      )
    }

    if (port.data_type === 'image' || port.data_type === 'mask') {
      return (
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <ImageAttachmentPickerButton label={hasExplicitValue ? '이미지 변경' : '이미지 선택'} modalTitle={port.label} allowSaveDialog={false} onSelect={(image) => void onNodeImageChange(node.id, port.key, image)} />
          {typeof rawValue === 'string' && rawValue.startsWith('data:') ? (
            <InlineMediaPreview src={rawValue} alt={port.label} frameClassName="p-3" />
          ) : null}
        </div>
      )
    }

    if (port.data_type === 'any') {
      return (
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <div className="text-sm text-muted-foreground">
            이 포트는 연결된 업스트림 값을 그대로 받아. 직접 편집은 지원하지 않아.
          </div>
        </div>
      )
    }

    return (
      <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
        <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
        <ModuleGraphSimpleValueInput
          dataType="text"
          value={rawValue}
          onChange={(value) => onNodeValueChange(node.id, port.key, value)}
          placeholder={uiField?.placeholder || normalizedDescription || port.label}
        />
      </div>
    )
  }

  const renderStandaloneUiField = (node: ModuleGraphNode, field: ModuleUiFieldDefinition) => {
    const rawValue = node.data.inputValues?.[field.key]
    const normalizedDescription = normalizeModulePortDescription(field.description)
    const hasExplicitValue = hasMeaningfulValue(rawValue)
    const clearFieldValue = () => onNodeValueClear(node.id, field.key)

    const renderFieldInput = () => {
      if (field.data_type === 'select' && Array.isArray(field.options) && field.options.length > 0) {
        const requiresConcreteSelection = selectedNodeOperationKey === 'system.logic_if_branch' && (field.key === 'mode' || field.key === 'expected_type')
        return (
          <ModuleGraphSimpleValueInput
            dataType="select"
            value={requiresConcreteSelection ? (rawValue ?? field.default_value) : rawValue}
            onChange={(value) => onNodeValueChange(node.id, field.key, value)}
            options={field.options}
            emptyLabel={hasMeaningfulValue(field.default_value) ? '기본값 사용' : '선택'}
            allowEmptyOption={!requiresConcreteSelection}
          />
        )
      }

      if (field.data_type === 'number') {
        return (
          <ModuleGraphSimpleValueInput
            dataType="number"
            value={rawValue}
            onChange={(value) => onNodeValueChange(node.id, field.key, value)}
            placeholder={field.placeholder || field.label}
            min={field.min}
            max={field.max}
          />
        )
      }

      if (field.data_type === 'boolean') {
        return (
          <ModuleGraphSimpleValueInput
            dataType="boolean"
            value={rawValue}
            onChange={(value) => onNodeValueChange(node.id, field.key, value)}
          />
        )
      }

      const powerLoraLoaderValue = rawValue ?? field.default_value

      if (isPowerLoraLoaderUiField(field) || hasPowerLoraLoaderEntries(powerLoraLoaderValue)) {
        return (
          <PowerLoraLoaderInput
            field={field}
            value={powerLoraLoaderValue}
            onChange={(value) => onNodeValueChange(node.id, field.key, value)}
          />
        )
      }

      if (field.data_type === 'json' || field.data_type === 'prompt' || field.data_type === 'text') {
        return (
          <ModuleGraphSimpleValueInput
            dataType={field.data_type}
            value={rawValue}
            onChange={(value) => onNodeValueChange(node.id, field.key, value)}
            placeholder={field.placeholder || normalizedDescription || field.label}
            rows={field.data_type === 'json' ? 6 : 2}
          />
        )
      }

      return (
        <ModuleGraphSimpleValueInput
          dataType="text"
          value={rawValue}
          onChange={(value) => onNodeValueChange(node.id, field.key, value)}
          placeholder={field.placeholder || normalizedDescription || field.label}
        />
      )
    }

    return (
      <div key={field.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <div className="text-sm font-medium text-foreground">{field.label}</div>
              <TechnicalReferenceHint title={`field ${field.key}`} label="필드 내부 키 보기" />
            </div>
            {normalizedDescription ? <div className="mt-1 text-xs text-muted-foreground">{normalizedDescription}</div> : null}
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={clearFieldValue} disabled={!hasExplicitValue}>
            값 지우기
          </Button>
        </div>
        {renderFieldInput()}
      </div>
    )
  }

  const sourceEndpoint = selectedEdge
    ? resolveEdgeEndpoint(nodes, selectedEdge.source, selectedEdge.sourceHandle, 'out')
    : null
  const targetEndpoint = selectedEdge
    ? resolveEdgeEndpoint(nodes, selectedEdge.target, selectedEdge.targetHandle, 'in')
    : null
  const selectedEdgeType = sourceEndpoint?.port?.data_type ?? targetEndpoint?.port?.data_type ?? null
  const selectedNodeInputPorts = selectedNode ? getEditableNodeInputPorts(selectedNode) : []
  const missingRequiredInputs = selectedNode
    ? selectedNodeInputPorts.filter((port) => port.required && !isNodeInputSatisfied(selectedNode, port))
    : []
  const selectedNodeWorkflowInputPort = selectedNode ? getWorkflowInputSourcePort(selectedNode) : null
  const selectedNodeStandaloneUiFields = selectedNode ? getStandaloneNodeUiFields(selectedNode) : []
  const sortedSelectedNodeInputs = selectedNode && !selectedNodeWorkflowInputPort
    ? [...selectedNodeInputPorts].sort((left, right) => {
        const leftHighlighted = left.key === highlightedPortKey ? 1 : 0
        const rightHighlighted = right.key === highlightedPortKey ? 1 : 0
        if (leftHighlighted !== rightHighlighted) {
          return rightHighlighted - leftHighlighted
        }

        const leftMissing = left.required && !isNodeInputSatisfied(selectedNode, left) ? 1 : 0
        const rightMissing = right.required && !isNodeInputSatisfied(selectedNode, right) ? 1 : 0
        if (leftMissing !== rightMissing) {
          return rightMissing - leftMissing
        }
        if (Boolean(left.required) !== Boolean(right.required)) {
          return Number(Boolean(right.required)) - Number(Boolean(left.required))
        }
        return left.label.localeCompare(right.label)
      })
    : []
  const selectedNodeOutputGroups = useMemo(
    () => selectedNode && selectedExecutionArtifacts
      ? groupNodeOutputArtifacts(
          selectedNode,
          selectedExecutionArtifacts.filter((artifact) => artifact.node_id === selectedNode.id),
        )
      : [],
    [selectedExecutionArtifacts, selectedNode],
  )

  const toggleOutputGroup = (portKey: string) => {
    setCollapsedOutputGroupKeys((current) => (
      current.includes(portKey)
        ? current.filter((key) => key !== portKey)
        : [...current, portKey]
    ))
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        {showHeader ? (
          <SectionHeading
            variant="inside"
            heading="노드 인스펙터"
          />
        ) : null}
        {!selectedNode && !selectedEdge ? (
          <div className="rounded-sm bg-surface-low px-4 py-6 text-sm text-muted-foreground">노드나 엣지를 선택해.</div>
        ) : null}

        {!selectedNode && selectedEdge && sourceEndpoint && targetEndpoint ? (
          <div className={NODE_INSPECTOR_EDGE_SURFACE_CLASS}>
            <div className="flex items-center gap-2">
              <div className="font-medium text-foreground">선택한 엣지</div>
              {selectedEdgeType ? <Badge variant="outline">{selectedEdgeType}</Badge> : null}
              <TechnicalReferenceHint title={`edge ${selectedEdge.id}`} label="엣지 내부 식별자 보기" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <EdgeEndpointCard heading="출발" endpoint={sourceEndpoint} role="출력" />
              <EdgeEndpointCard heading="도착" endpoint={targetEndpoint} role="입력" />
            </div>
          </div>
        ) : null}

        {selectedNode ? (
          <>
            <div className={NODE_INSPECTOR_NODE_SURFACE_CLASS}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{getModuleNodeDisplayLabel(selectedNode)}</span>
                    <Badge variant="outline">{selectedNode.data.module.engine_type}</Badge>
                    <TechnicalReferenceHint title={`node ${selectedNode.id}`} label="노드 내부 식별자 보기" />
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">노드 이름</div>
                      <Input
                        value={selectedNode.data.label ?? ''}
                        onChange={(event) => onNodeLabelChange(selectedNode.id, event.target.value)}
                        placeholder={getModuleBaseDisplayName(selectedNode.data.module)}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">기본 타입</div>
                      <div className="flex h-10 items-center rounded-sm border border-border bg-background/50 px-3 text-sm text-muted-foreground">
                        {getModuleBaseDisplayName(selectedNode.data.module)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="outline">입력 {selectedNodeInputPorts.length}</Badge>
                    <Badge variant="outline">출력 {selectedNodeVisibleOutputPorts.length}</Badge>
                    {missingRequiredInputs.length > 0 ? <Badge variant="outline">필수 부족 {missingRequiredInputs.length}</Badge> : <Badge variant="secondary">필수 입력 충족</Badge>}
                    {highlightedPortKey ? <Badge variant="secondary">선택 포트 강조</Badge> : null}
                    {highlightedPortKey ? <TechnicalReferenceHint title={`focus port ${highlightedPortKey}`} label="강조 중인 포트 내부 키 보기" /> : null}
                  </div>
                </div>
                {onExecuteSelectedNode ? (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={onExecuteSelectedNode} disabled={executeSelectedNodeDisabled}>
                      {executeSelectedNodeLabel}
                    </Button>
                    {onForceExecuteSelectedNode ? (
                      <Button type="button" size="sm" variant="outline" onClick={onForceExecuteSelectedNode} disabled={executeSelectedNodeDisabled}>
                        {forceExecuteSelectedNodeLabel}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            {missingRequiredInputs.length > 0 ? (
              <div className="rounded-sm border px-4 py-3" style={{ borderColor: '#f59e0b99', backgroundColor: 'rgba(245, 158, 11, 0.08)' } as CSSProperties}>
                <div className="text-sm font-medium text-foreground">아직 채워야 하는 필수 입력</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {missingRequiredInputs.map((port) => (
                    <Badge key={port.key} variant="secondary">{port.label}</Badge>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="space-y-3 rounded-sm border border-border bg-background/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-foreground">노드 출력</div>
                {selectedExecutionId ? <Badge variant="outline">실행 #{selectedExecutionId}</Badge> : <Badge variant="outline">실행 선택 필요</Badge>}
                {selectedNodeOutputGroups.length > 0 ? <Badge variant="outline">포트 {selectedNodeOutputGroups.length}</Badge> : null}
              </div>

              {!selectedExecutionArtifacts ? (
                <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                  실행 결과를 선택하면 이 노드의 출력 값을 포트별로 여기서 바로 확인할 수 있어.
                </div>
              ) : selectedNodeOutputGroups.length === 0 ? (
                <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                  선택한 실행에서 이 노드가 남긴 출력이 없어.
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedNodeOutputGroups.map((group) => {
                    const isCollapsed = collapsedOutputGroupKeys.includes(group.portKey)

                    return (
                      <div key={group.portKey} className="rounded-sm border border-border bg-surface-low/70">
                        <button
                          type="button"
                          onClick={() => toggleOutputGroup(group.portKey)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                            <span className="truncate text-sm font-medium text-foreground">{group.portLabel}</span>
                            <Badge variant="secondary">{group.portKey}</Badge>
                            {group.portType ? <Badge variant="outline">{getModuleGraphPortTypeLabel(group.portType)}</Badge> : null}
                          </div>
                          <Badge variant="outline">{group.artifacts.length}</Badge>
                        </button>

                        {!isCollapsed ? (
                          <div className="space-y-3 border-t border-border px-3 py-3">
                            {group.artifacts.map((artifact) => (
                              <ExecutionArtifactCard key={artifact.id} artifact={artifact} />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {selectedNodeInputPorts.length === 0 || selectedNodeWorkflowInputPort ? (
              selectedNodeStandaloneUiFields.length > 0 ? (
                <div className="space-y-4">{selectedNodeStandaloneUiFields.map((field) => renderStandaloneUiField(selectedNode, field))}</div>
              ) : (
                <div className="text-sm text-muted-foreground">이 노드 입력은 카드에서 바로 편집해.</div>
              )
            ) : (
              <div className="space-y-4">
                {sortedSelectedNodeInputs.map((port) => renderPortInput(selectedNode, port))}
                {selectedNodeStandaloneUiFields.map((field) => renderStandaloneUiField(selectedNode, field))}
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
