import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { ProviderIcon } from '@/components/common/provider-icons'
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, ChevronRight, Eraser, MousePointerClick, Play, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Panel } from '@/components/ui/panel'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import { Tip } from '@/components/ui/tooltip'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { useI18n, type TranslationInput } from '@/i18n'
import { getLlmProfileOptions } from '@/lib/api-external-api'
import { getLlmPresetOptions } from '@/lib/api-settings-llm'
import type { GraphExecutionArtifactRecord, ModuleEngineType, ModulePortDefinition, ModuleUiFieldDefinition } from '@/lib/api-module-graph'
import { ExecutionArtifactCard } from './execution-artifact-card'
import { ModuleGraphKeyValueListInput } from './module-graph-key-value-list-input'
import { formatModuleGraphDefaultOptionLabel, type ModuleGraphSelectOption } from './module-graph-simple-value-input'
import { PowerLoraLoaderInput, hasPowerLoraLoaderEntries, isPowerLoraLoaderUiField } from './power-lora-loader-input'
import { NaiCharacterPromptsInput, isNaiCharacterPromptPort } from './nai-character-prompts-input'
import { NaiReusableAssetInput, isNaiCharacterReferencePort, isNaiVibePort } from './nai-reusable-assets-input'
import { TechnicalReferenceHint, getModuleGraphPortTypeLabel, hasMeaningfulValue } from './module-graph-field-shared'
import { getWorkflowInputSourcePort } from '../module-graph-workflow-inputs'
import {
  NODE_INSPECTOR_EDGE_SURFACE_CLASS,
  NODE_INSPECTOR_INPUT_SURFACE_CLASS,
  NODE_INSPECTOR_NODE_SURFACE_CLASS,
  EdgeEndpointCard,
  PortHeader,
  findNodeUiField,
  getEditableNodeInputPorts,
  getLlmPresetEntries,
  getLlmPresetTypeOptions,
  getStandaloneNodeUiFields,
  groupNodeOutputArtifacts,
  isNodeInputSatisfied,
  normalizeLlmPresetType,
  resolveEdgeEndpoint,
  summarizeLlmPresetContent,
} from './node-inspector-panel-helpers'
import { getModuleBaseDisplayName, getModuleNodeDisplayLabel, getModuleOperationKey, normalizeModulePortDescription, normalizeOptionalString, type ModuleGraphEdge, type ModuleGraphNode } from '../module-graph-shared'
import { EmptyState } from '@/components/ui/empty-state'
import type { PromptWildcardTool } from '@/features/image-generation/components/wildcard-inline-picker-helpers'
import { TypedFieldInput, type TypedFieldKind } from '@/features/shared-fields/typed-field-input'

const MODULE_ENGINE_LABELS: Record<ModuleEngineType, TranslationInput> = {
  nai: 'NovelAI',
  codex: 'Codex',
  comfyui: 'ComfyUI',
  system: { ko: '기본 노드', en: 'Built-in node' },
  custom_js: { ko: '커스텀 노드', en: 'Custom node' },
}

/** Map a module port data type onto the shared field renderer (non-editable types fall back to text). */
function resolveInspectorFieldKind(dataType: string): TypedFieldKind {
  if (dataType === 'prompt' || dataType === 'json' || dataType === 'number' || dataType === 'boolean') {
    return dataType
  }
  return dataType === 'image' || dataType === 'mask' ? 'image' : 'text'
}

/** Scope wildcard autocomplete to the node's engine; built-in and custom nodes use the general set. */
function resolvePromptWildcardTool(engineType: ModuleEngineType): PromptWildcardTool {
  return engineType === 'nai' || engineType === 'comfyui' || engineType === 'codex' ? engineType : 'general'
}

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
  executeSelectedNodeLabel,
  forceExecuteSelectedNodeLabel,
  highlightedPortKey = null,
  showHeader = true,
}: NodeInspectorPanelProps) {
  const { t, formatNumber } = useI18n()
  const { canExecuteGeneration } = useFeaturePermissions()
  const resolvedExecuteSelectedNodeLabel = executeSelectedNodeLabel ?? t({ ko: '이 노드까지 실행', en: 'Run up to this node' })
  const resolvedForceExecuteSelectedNodeLabel = forceExecuteSelectedNodeLabel ?? t({ ko: '강제 재실행', en: 'Force rerun' })
  const [collapsedOutputGroupKeys, setCollapsedOutputGroupKeys] = useState<string[]>([])
  const collapsedOutputGroupKeySet = useMemo(() => new Set(collapsedOutputGroupKeys), [collapsedOutputGroupKeys])
  const selectedNodeOperationKey = selectedNode ? getModuleOperationKey(selectedNode.data.module) : null
  const isSystemCallLlmNode = selectedNodeOperationKey === 'system.call_llm'
  const isSystemCallCodexMessageNode = selectedNodeOperationKey === 'system.call_codex_message'
  const isSystemLoadLlmPresetNode = selectedNodeOperationKey === 'system.load_llm_preset'
  const llmProfilesQuery = useQuery({
    queryKey: ['llm-profile-options', 'node-inspector-panel'],
    queryFn: () => getLlmProfileOptions(),
    enabled: isSystemCallLlmNode,
    staleTime: 30_000,
  })
  const llmPresetsQuery = useQuery({
    queryKey: ['llm-preset-options', 'node-inspector-panel'],
    queryFn: () => getLlmPresetOptions(),
    enabled: isSystemLoadLlmPresetNode,
    staleTime: 30_000,
  })
  // The LLM node runs on a chat profile (connection, model, reasoning, extra parameters); its own temperature and
  // output limit stay empty unless they should override the profile.
  const llmProfileOptions = (llmProfilesQuery.data ?? []).map((profile) => ({
    value: String(profile.id),
    label: profile.model ? `${profile.name} · ${profile.model}` : profile.name,
  })) satisfies ModuleGraphSelectOption[]
  const applyLlmProfile = (node: ModuleGraphNode, profileId: string) => {
    onNodeValueChange(node.id, 'profile_id', profileId ? Number(profileId) : '')
    onNodeValueChange(node.id, 'provider_name', '')
    onNodeValueChange(node.id, 'model', '')
    onNodeValueChange(node.id, 'temperature', '')
    onNodeValueChange(node.id, 'max_tokens', '')
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
    // A thin left accent instead of a tinted card: info for the focused port, warning for a missing required value.
    const cardStyle = isHighlightedPort
      ? ({ boxShadow: 'inset 2px 0 0 var(--info)', paddingLeft: '0.625rem' } as CSSProperties)
      : missingRequired
        ? ({ boxShadow: 'inset 2px 0 0 var(--warning)', paddingLeft: '0.625rem' } as CSSProperties)
        : undefined
    const renderPortCard = (children: ReactNode) => (
      <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
        <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
        {children}
      </div>
    )
    const changePortValue = (value: unknown) => onNodeValueChange(node.id, port.key, value)

    if (isSystemLoadLlmPresetNode && port.key === 'preset_type') {
      const presetType = normalizeLlmPresetType(rawValue)

      return renderPortCard(
        <TypedFieldInput
          kind="select"
          value={presetType}
          onChange={(value) => {
            onNodeValueChange(node.id, 'preset_type', value)
            onNodeValueClear(node.id, 'preset_name')
          }}
          options={getLlmPresetTypeOptions(t)}
          emptyOption="none"
        />,
      )
    }

    if (isSystemLoadLlmPresetNode && port.key === 'preset_name') {
      const presetType = normalizeLlmPresetType(node.data.inputValues?.preset_type)
      const entries = getLlmPresetEntries(llmPresetsQuery.data, presetType)
      const currentPresetName = normalizeOptionalString(rawValue)
      const selectedPreset = currentPresetName
        ? entries.find((preset) => preset.name === currentPresetName) ?? null
        : null

      return renderPortCard(
        <>
          <TypedFieldInput
            kind="select"
            value={currentPresetName ?? ''}
            onChange={changePortValue}
            options={entries.map((preset) => preset.name)}
            emptyLabel={llmPresetsQuery.isLoading ? t({ ko: '불러오는 중', en: 'Loading' }) : t({ ko: '프리셋 선택', en: 'Select preset' })}
          />
          {selectedPreset ? (
            <div className="mt-2 rounded-sm bg-surface-container px-3 py-2">
              <Text as="div" variant="overline" className="mb-1 font-semibold">{t({ ko: '선택 내용', en: 'Selected content' })}</Text>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-foreground">{summarizeLlmPresetContent(selectedPreset.content)}</pre>
            </div>
          ) : null}
        </>,
      )
    }

    if (isSystemCallLlmNode && (port.key === 'provider_name' || port.key === 'model')) {
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

    if (isSystemCallLlmNode && port.key === 'profile_id') {
      const currentProfileId = rawValue === undefined || rawValue === null || rawValue === '' ? '' : String(rawValue)
      // Nodes saved before profiles name a bare connection; show it until a profile is picked.
      const legacyProvider = normalizeOptionalString(node.data.inputValues?.provider_name)
      return renderPortCard(
        <TypedFieldInput
          kind="select"
          value={llmProfileOptions.some((option) => option.value === currentProfileId) ? currentProfileId : ''}
          onChange={(value) => applyLlmProfile(node, String(value))}
          options={llmProfileOptions}
          emptyLabel={!currentProfileId && legacyProvider
            ? t({ ko: '연결: {name} (이전 방식)', en: 'Connection: {name} (legacy)' }, { name: legacyProvider })
            : t({ ko: 'LLM 프로필 선택', en: 'Select LLM profile' })}
        />,
      )
    }

    if (isNaiCharacterPromptPort(port.key, port.data_type)) {
      return renderPortCard(<NaiCharacterPromptsInput value={rawValue} onChange={changePortValue} />)
    }

    if (isNaiVibePort(port.key, port.data_type)) {
      return renderPortCard(<NaiReusableAssetInput kind="vibes" value={rawValue} onChange={changePortValue} />)
    }

    if (isNaiCharacterReferencePort(port.key, port.data_type)) {
      return renderPortCard(<NaiReusableAssetInput kind="character_refs" value={rawValue} onChange={changePortValue} />)
    }

    const powerLoraLoaderValue = rawValue ?? port.default_value ?? uiField?.default_value

    if (isPowerLoraLoaderUiField(uiField) || hasPowerLoraLoaderEntries(powerLoraLoaderValue)) {
      return renderPortCard(<PowerLoraLoaderInput field={uiField} value={powerLoraLoaderValue} onChange={changePortValue} />)
    }

    const selectOptions = uiField?.data_type === 'select' && Array.isArray(uiField.options) ? uiField.options : []
    const isCodexModelPort = isSystemCallCodexMessageNode && port.key === 'model'

    if (selectOptions.length > 0) {
      const defaultSelectValue = port.default_value ?? uiField?.default_value

      return renderPortCard(
        <TypedFieldInput
          kind="select"
          value={rawValue ?? defaultSelectValue ?? (isCodexModelPort ? selectOptions[0] : '')}
          onChange={changePortValue}
          options={selectOptions}
          emptyLabel={hasMeaningfulValue(defaultSelectValue) ? formatModuleGraphDefaultOptionLabel(t, defaultSelectValue) : undefined}
          emptyOption={isCodexModelPort ? 'none' : 'auto'}
        />,
      )
    }

    if (uiField?.ui_hint === 'key_value_entries') {
      return renderPortCard(<ModuleGraphKeyValueListInput value={rawValue ?? uiField.default_value ?? port.default_value} onChange={changePortValue} />)
    }

    if (port.data_type === 'any') {
      return renderPortCard(
        <div className="text-sm text-muted-foreground">
          {t({ ko: '이 포트는 연결된 업스트림 값을 그대로 받아. 직접 편집은 지원하지 않아.', en: 'This port uses the connected upstream value as-is. Direct editing is not supported.' })}
        </div>,
      )
    }

    const kind = resolveInspectorFieldKind(port.data_type)

    return renderPortCard(
      <TypedFieldInput
        kind={kind}
        value={rawValue}
        onChange={changePortValue}
        placeholder={kind === 'number' ? numberPlaceholder : kind === 'text' ? (uiField?.placeholder || normalizedDescription || port.label) : (normalizedDescription || port.label)}
        rows={kind === 'json' ? 6 : kind === 'prompt' ? 4 : undefined}
        promptTool={resolvePromptWildcardTool(node.data.module.engine_type)}
        min={numberMin}
        max={uiField?.max}
        step={numberStep}
        imageModalTitle={port.label}
        onImageChange={(image) => onNodeImageChange(node.id, port.key, image)}
      />,
    )
  }

  const renderStandaloneUiField = (node: ModuleGraphNode, field: ModuleUiFieldDefinition) => {
    const rawValue = node.data.inputValues?.[field.key]
    const normalizedDescription = normalizeModulePortDescription(field.description)
    const hasExplicitValue = hasMeaningfulValue(rawValue)
    const clearFieldValue = () => onNodeValueClear(node.id, field.key)

    const renderFieldInput = () => {
      const powerLoraLoaderValue = rawValue ?? field.default_value
      const isSelect = field.data_type === 'select' && Array.isArray(field.options) && field.options.length > 0

      if (!isSelect && field.data_type !== 'number' && field.data_type !== 'boolean'
        && (isPowerLoraLoaderUiField(field) || hasPowerLoraLoaderEntries(powerLoraLoaderValue))) {
        return <PowerLoraLoaderInput field={field} value={powerLoraLoaderValue} onChange={(value) => onNodeValueChange(node.id, field.key, value)} />
      }

      const requiresConcreteSelection = isSelect && selectedNodeOperationKey === 'system.logic_if_branch' && (field.key === 'mode' || field.key === 'expected_type')
      const kind = isSelect ? 'select' : resolveInspectorFieldKind(field.data_type)

      return (
        <TypedFieldInput
          kind={kind === 'image' ? 'text' : kind}
          value={requiresConcreteSelection ? (rawValue ?? field.default_value) : rawValue}
          onChange={(value) => onNodeValueChange(node.id, field.key, value)}
          placeholder={kind === 'number' ? (field.placeholder || field.label) : (field.placeholder || normalizedDescription || field.label)}
          rows={field.data_type === 'json' ? 6 : field.data_type === 'prompt' || field.data_type === 'text' ? 2 : undefined}
          promptTool={resolvePromptWildcardTool(node.data.module.engine_type)}
          options={field.options}
          emptyLabel={isSelect && hasMeaningfulValue(field.default_value) ? formatModuleGraphDefaultOptionLabel(t, field.default_value) : undefined}
          emptyOption={requiresConcreteSelection ? 'none' : undefined}
          min={field.min}
          max={field.max}
        />
      )
    }

    return (
      <div key={field.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <Tip content={normalizedDescription}>
                <div className="text-sm font-medium text-foreground">{field.label}</div>
              </Tip>
              <TechnicalReferenceHint title={`field ${field.key}`} label={t({ ko: '필드 내부 키 보기', en: 'Show internal field key' })} />
            </div>
          </div>
          <IconButton size="icon-sm" variant="ghost" onClick={clearFieldValue} disabled={!hasExplicitValue} label={t({ ko: '값 지우기', en: 'Clear value' })}>
            <Eraser />
          </IconButton>
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
    <Section heading={showHeader ? t({ ko: '노드 인스펙터', en: 'Node Inspector' }) : undefined}>
      {!selectedNode && !selectedEdge ? (
        <EmptyState icon={MousePointerClick} title={t({ ko: '노드나 엣지를 선택해.', en: 'Select a node or edge.' })} />
      ) : null}

      {!selectedNode && selectedEdge && sourceEndpoint && targetEndpoint ? (
        <div className={NODE_INSPECTOR_EDGE_SURFACE_CLASS}>
          <div className="flex items-center gap-2">
            <Text as="div" variant="label">{t({ ko: '선택한 엣지', en: 'Selected edge' })}</Text>
            {selectedEdgeType ? <Badge variant="outline">{selectedEdgeType}</Badge> : null}
            <TechnicalReferenceHint title={`edge ${selectedEdge.id}`} label={t({ ko: '엣지 내부 식별자 보기', en: 'Show internal edge identifier' })} />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <EdgeEndpointCard heading={t({ ko: '출발', en: 'Source' })} endpoint={sourceEndpoint} role={t({ ko: '출력', en: 'Output' })} />
            <EdgeEndpointCard heading={t({ ko: '도착', en: 'Target' })} endpoint={targetEndpoint} role={t({ ko: '입력', en: 'Input' })} />
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
                  <Badge variant="outline" className="gap-1"><ProviderIcon provider={selectedNode.data.module.engine_type === 'nai' ? 'novelai' : selectedNode.data.module.engine_type} className="size-3" />{t(MODULE_ENGINE_LABELS[selectedNode.data.module.engine_type] ?? selectedNode.data.module.engine_type)}</Badge>
                  <TechnicalReferenceHint title={`node ${selectedNode.id}`} label={t({ ko: '노드 내부 식별자 보기', en: 'Show internal node identifier' })} />
                </div>
                <div className="mt-3 space-y-1">
                  <Text as="div" variant="overline" className="font-medium">{t({ ko: '노드 이름', en: 'Node name' })}</Text>
                  <Input
                    value={selectedNode.data.label ?? ''}
                    onChange={(event) => onNodeLabelChange(selectedNode.id, event.target.value)}
                    placeholder={getModuleBaseDisplayName(selectedNode.data.module)}
                  />
                </div>
              </div>
              {onExecuteSelectedNode ? (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={onExecuteSelectedNode} disabled={!canExecuteGeneration || executeSelectedNodeDisabled}>
                    <Play className="size-4" />
                    {resolvedExecuteSelectedNodeLabel}
                  </Button>
                  {onForceExecuteSelectedNode ? (
                    <IconButton size="icon-sm" variant="secondary" onClick={onForceExecuteSelectedNode} disabled={!canExecuteGeneration || executeSelectedNodeDisabled} label={resolvedForceExecuteSelectedNodeLabel}>
                      <RotateCcw />
                    </IconButton>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>

          {missingRequiredInputs.length > 0 ? (
            <div role="status" className="flex items-start gap-1.5 text-sm text-warning">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span className="min-w-0">{t({ ko: '필수 입력 비어 있음: {names}', en: 'Required inputs empty: {names}' }, { names: missingRequiredInputs.map((port) => port.label).join(', ') })}</span>
            </div>
          ) : null}

          {selectedNodeOutputGroups.length > 0 ? (
          <div className="space-y-2 border-b border-line pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <Text as="div" variant="overline" className="font-semibold">{t({ ko: '노드 출력', en: 'Node outputs' })}</Text>
              {selectedExecutionId ? <span className="font-mono text-2xs text-muted-foreground">#{formatNumber(selectedExecutionId)}</span> : null}
            </div>

            {(
              <div className="space-y-2">
                {selectedNodeOutputGroups.map((group) => {
                  const isCollapsed = collapsedOutputGroupKeySet.has(group.portKey)

                  return (
                    <Panel key={group.portKey} tone="container" padding="none">
                      <Button
                        type="button"
                        variant="ghost"
                        aria-expanded={!isCollapsed}
                        onClick={() => toggleOutputGroup(group.portKey)}
                        className="h-auto w-full justify-between gap-3 px-3 py-2 text-left"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                          <span className="truncate text-sm font-medium text-foreground">{group.portLabel}</span>
                          {group.portType ? <Badge variant="outline">{getModuleGraphPortTypeLabel(t, group.portType)}</Badge> : null}
                        </span>
                        <Badge variant="outline">{group.artifacts.length}</Badge>
                      </Button>

                      {!isCollapsed ? (
                        <div className="space-y-3 px-3 pt-1 pb-3">
                          {group.artifacts.map((artifact) => (
                            <ExecutionArtifactCard key={artifact.id} artifact={artifact} />
                          ))}
                        </div>
                      ) : null}
                    </Panel>
                  )
                })}
              </div>
            )}
          </div>
          ) : null}

          {selectedNodeInputPorts.length === 0 || selectedNodeWorkflowInputPort ? (
            selectedNodeStandaloneUiFields.length > 0 ? (
              <div className="space-y-4">{selectedNodeStandaloneUiFields.map((field) => renderStandaloneUiField(selectedNode, field))}</div>
            ) : null
          ) : (
            <div className="space-y-4">
              {sortedSelectedNodeInputs.map((port) => renderPortInput(selectedNode, port))}
              {selectedNodeStandaloneUiFields.map((field) => renderStandaloneUiField(selectedNode, field))}
            </div>
          )}
        </>
      ) : null}
    </Section>
  )
}
