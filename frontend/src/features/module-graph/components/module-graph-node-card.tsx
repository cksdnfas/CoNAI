import { useEffect, useState, type CSSProperties, type MouseEvent, type SyntheticEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronRight, GripVertical, Play, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ImageAttachmentPickerButton } from '@/features/image-generation/components/image-attachment-picker'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { getGenerationComfyUIServers, getGenerationWorkflowServers } from '@/lib/api-image-generation-workflows'
import { getExternalApiLlmOptions, type ExternalApiLlmOptionRecord } from '@/lib/api-external-api'
import { getLlmPresetOptions, type LlmPresetOptionCollections, type LlmPresetOptionRecord } from '@/lib/api-settings'
import { ModuleGraphSimpleValueInput, type ModuleGraphSelectOption } from './module-graph-simple-value-input'
import { PowerLoraLoaderInput, hasPowerLoraLoaderEntries, isPowerLoraLoaderUiField } from './power-lora-loader-input'
import type { ComfyUIServer, ModulePortDefinition, ModuleUiFieldDefinition } from '@/lib/api'
import { getModuleGraphPortTypeLabel, hasMeaningfulValue } from './module-graph-field-shared'
import {
  WORKFLOW_INPUT_ENABLED_KEY,
  isWorkflowInputEnabledForNode,
  isWorkflowInputSourceModule,
} from '../module-graph-workflow-inputs'
import {
  buildHandleId,
  getModuleBaseDisplayName,
  getModuleColor,
  getModuleNodeDisplayLabelFromData,
  getModuleOperationKey,
  getPortTypeColor,
  getVisibleModuleOutputPorts,
  hasCustomModuleNodeLabel,
  isAdvancedOutputPortsEnabled,
  isFinalResultModule,
  normalizeModulePortDescription,
  type ModuleGraphNode,
} from '../module-graph-shared'

const MODULE_GRAPH_INLINE_CONTROL_CLASS = 'theme-input-surface border-border/80 focus:border-primary'
const GRAPH_COMFY_TARGET_MODE_KEY = 'execution_target_mode'
const GRAPH_COMFY_TARGET_TAG_KEY = 'execution_target_tag'
const GRAPH_COMFY_TARGET_SERVER_ID_KEY = 'execution_target_server_id'

type LlmPresetCollectionKey = keyof LlmPresetOptionCollections

const LLM_PRESET_TYPE_OPTIONS: Array<{ value: LlmPresetCollectionKey; label: string }> = [
  { value: 'systemPromptPresets', label: '시스템 프롬프트' },
  { value: 'promptPresets', label: '프롬프트' },
  { value: 'structuredOutputJsonPresets', label: '구조화 출력 JSON' },
]

type PortCellProps = {
  nodeId: string
  port?: ModulePortDefinition
  side: 'input' | 'output'
  accentColor: string
  connected: boolean
  satisfied: boolean
  requiredMissing: boolean
  requiredMissingLabel?: string
  onDisconnectInput?: (nodeId: string, portKey: string) => void
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parsePositiveIntegerish(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }

  return null
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

function resolveComfyTargetBadgeLabel(inputValues: Record<string, unknown> | undefined) {
  const mode = resolveComfyTargetMode(inputValues)
  const tag = normalizeOptionalString(inputValues?.[GRAPH_COMFY_TARGET_TAG_KEY])
  const serverId = parsePositiveIntegerish(inputValues?.[GRAPH_COMFY_TARGET_SERVER_ID_KEY])

  if (mode === 'tag' && tag) {
    return `#${tag}`
  }

  if (mode === 'server' && serverId) {
    return `서버 #${serverId}`
  }

  return '자동 분산'
}

function resolveSelectOptionsWithCurrentValue(options: string[] | null | undefined, currentValue: string | null) {
  const normalizedOptions = Array.isArray(options) ? options.filter((option) => option.trim().length > 0) : []
  if (currentValue && !normalizedOptions.includes(currentValue)) {
    return [...normalizedOptions, currentValue]
  }
  return normalizedOptions
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

/** Prevent embedded controls from triggering node drag or canvas selection. */
function stopNodeInteraction(event: SyntheticEvent) {
  event.stopPropagation()
}

/** Prevent button clicks from also triggering node drag/selection side effects. */
function stopNodeActionEvent(event: MouseEvent<HTMLElement>) {
  event.preventDefault()
  event.stopPropagation()
}

/** Build one compact hover tooltip so node cards stay visually clean. */
function buildPortTooltip(port: ModulePortDefinition, statusLabel: string) {
  return [
    port.label,
    `키: ${port.key}`,
    `타입: ${getModuleGraphPortTypeLabel(port.data_type)}`,
    `상태: ${statusLabel}`,
    null,
    port.required ? '필수' : null,
    port.multiple ? '다중' : null,
    normalizeModulePortDescription(port.description) || null,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Build a smaller handle target that aligns directly with its port row. */
function buildHandleStyle(params: { side: 'input' | 'output'; color: string }): CSSProperties {
  return {
    top: '50%',
    transform: 'translateY(-50%)',
    width: 12,
    height: 12,
    borderRadius: 999,
    background: params.color,
    border: '2px solid var(--surface-container)',
    boxShadow: `0 0 0 2px ${params.color}22`,
    left: params.side === 'input' ? -7 : undefined,
    right: params.side === 'output' ? -7 : undefined,
  }
}

/** Resolve a plain one-line string preview for compact node-side value rendering. */
function getCompactValuePreview(value: unknown) {
  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim()
    return normalized.length > 0 ? normalized : ''
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return value.length > 0 ? `${value.length} items` : ''
  }

  if (value && typeof value === 'object') {
    return 'configured'
  }

  return ''
}

/** Render one standard minimal socket row for outputs and simple port-only surfaces. */
function PortCell({ nodeId, port, side, accentColor, connected, satisfied, requiredMissing, requiredMissingLabel = '입력 필요', onDisconnectInput }: PortCellProps) {
  if (!port) {
    return <div className="min-h-[28px] border-b border-dashed border-border/35" aria-hidden="true" />
  }

  const portTypeColor = getPortTypeColor(port.data_type)
  const statusLabel = requiredMissing ? requiredMissingLabel : connected ? '연결됨' : satisfied ? '설정됨' : '대기'
  const borderColor = requiredMissing ? '#f59e0b99' : connected ? `${portTypeColor}88` : `${accentColor}26`
  const alignmentClass = side === 'input' ? 'pl-4 pr-2 text-left' : 'pl-2 pr-4 text-right'
  const rowJustifyClass = side === 'input' ? 'justify-start' : 'justify-end'

  return (
    <div
      className={`relative min-h-[28px] border-b ${alignmentClass}`}
      style={{ borderColor } as CSSProperties}
      title={buildPortTooltip(port, statusLabel)}
      onMouseDown={side === 'input' && connected ? () => onDisconnectInput?.(nodeId, port.key) : undefined}
    >
      <Handle
        id={buildHandleId(side === 'input' ? 'in' : 'out', port.key)}
        type={side === 'input' ? 'target' : 'source'}
        position={side === 'input' ? Position.Left : Position.Right}
        style={buildHandleStyle({ side, color: portTypeColor })}
        title={buildPortTooltip(port, statusLabel)}
        onMouseDown={side === 'input' && connected ? () => onDisconnectInput?.(nodeId, port.key) : undefined}
      />

      <div className={`flex min-h-[28px] items-center gap-2 ${rowJustifyClass}`}>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
          {port.label}
          {port.required ? <span className="ml-1 text-[11px] text-amber-300">*</span> : null}
        </span>
      </div>
    </div>
  )
}

/** Render one plain inline editor row for input ports while keeping all ports visible. */
function InputPortCell({
  nodeId,
  data,
  port,
  accentColor,
  connected,
  satisfied,
  requiredMissing,
  selectOptionsOverride,
}: {
  nodeId: string
  data: ModuleGraphNode['data']
  port?: ModulePortDefinition
  accentColor: string
  connected: boolean
  satisfied: boolean
  requiredMissing: boolean
  selectOptionsOverride?: ModuleGraphSelectOption[]
}) {
  if (!port) {
    return <div className="min-h-[28px] border-b border-dashed border-border/35" aria-hidden="true" />
  }

  const rawValue = data.inputValues?.[port.key]
  const portTypeColor = getPortTypeColor(port.data_type)
  const statusLabel = requiredMissing ? '입력 필요' : connected ? '연결됨' : satisfied ? '설정됨' : '대기'
  const borderColor = requiredMissing ? '#f59e0b99' : connected ? `${portTypeColor}88` : `${accentColor}26`
  const uiField = data.module.ui_schema?.find((field) => field.key === port.key)
  const operationKey = getModuleOperationKey(data.module)
  const isSystemCallLlmPort = operationKey === 'system.call_llm'
  const selectOptions = selectOptionsOverride && selectOptionsOverride.length > 0
    ? selectOptionsOverride
    : (uiField?.data_type === 'select' && Array.isArray(uiField.options) ? uiField.options : null)
  const numberStep = isSystemCallLlmPort && port.key === 'temperature'
    ? 0.1
    : isSystemCallLlmPort && port.key === 'max_tokens'
      ? 128
      : undefined
  const numberMin = isSystemCallLlmPort && port.key === 'temperature'
    ? 0
    : isSystemCallLlmPort && port.key === 'max_tokens'
      ? 128
      : uiField?.min
  const numberPlaceholder = isSystemCallLlmPort && port.key === 'temperature'
    ? '0.7'
    : isSystemCallLlmPort && port.key === 'max_tokens'
      ? '1024'
      : (typeof port.default_value === 'number' ? String(port.default_value) : port.label)
  const preview = getCompactValuePreview(rawValue ?? port.default_value)
  const isInlineTextPort = port.data_type === 'text' && uiField?.ui_hint === 'inline'
  const isPromptLikePort = (port.data_type === 'text' || port.data_type === 'prompt') && !isInlineTextPort

  const renderEditor = () => {
    if (connected) {
      return <div className="truncate text-[10px] text-muted-foreground">linked</div>
    }

    if (selectOptions && data.onNodeValueChange) {
      return (
        <div onMouseDown={stopNodeInteraction}>
          <ModuleGraphSimpleValueInput
            dataType="select"
            value={rawValue}
            onChange={(value) => data.onNodeValueChange?.(nodeId, port.key, value)}
            options={selectOptions}
            emptyLabel={hasMeaningfulValue(port.default_value ?? uiField?.default_value) ? 'default' : 'select'}
            className={`h-7 text-[11px] ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
          />
        </div>
      )
    }

    if (port.data_type === 'number' && data.onNodeValueChange) {
      return (
        <div onMouseDown={stopNodeInteraction}>
          <ModuleGraphSimpleValueInput
            dataType="number"
            value={rawValue}
            onChange={(value) => data.onNodeValueChange?.(nodeId, port.key, value)}
            placeholder={numberPlaceholder}
            min={numberMin}
            max={uiField?.max}
            step={numberStep}
            className={`h-7 text-[11px] ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
          />
        </div>
      )
    }

    if (port.data_type === 'boolean' && data.onNodeValueChange) {
      return (
        <div onMouseDown={stopNodeInteraction}>
          <ModuleGraphSimpleValueInput
            dataType="boolean"
            value={rawValue}
            onChange={(value) => data.onNodeValueChange?.(nodeId, port.key, value)}
            emptyLabel="default"
            className={`h-7 text-[11px] ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
          />
        </div>
      )
    }

    if (isInlineTextPort && data.onNodeValueChange) {
      return (
        <div onMouseDown={stopNodeInteraction}>
          <ModuleGraphSimpleValueInput
            dataType="text"
            value={rawValue}
            onChange={(value) => data.onNodeValueChange?.(nodeId, port.key, value)}
            placeholder={uiField?.placeholder || port.label}
            className={`h-7 text-[11px] ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
          />
        </div>
      )
    }

    if (isPromptLikePort) {
      return null
    }

    return preview ? <div className="truncate text-[10px] text-muted-foreground">{preview}</div> : null
  }

  return (
    <div className="relative min-h-[28px] border-b pl-4 pr-2" style={{ borderColor } as CSSProperties} title={buildPortTooltip(port, statusLabel)}>
      <Handle
        id={buildHandleId('in', port.key)}
        type="target"
        position={Position.Left}
        style={buildHandleStyle({ side: 'input', color: portTypeColor })}
        title={buildPortTooltip(port, statusLabel)}
        onMouseDown={connected ? () => data.onDisconnectNodeInput?.(nodeId, port.key) : undefined}
      />

      <div className="flex min-h-[28px] items-center gap-2">
        <span className={`min-w-0 truncate text-[11px] font-medium text-foreground ${isPromptLikePort ? 'flex-1' : 'shrink-0'}`}>
          {port.label}
          {port.required ? <span className="ml-1 text-[11px] text-amber-300">*</span> : null}
        </span>
        {!isPromptLikePort ? <div className="min-w-0 flex-1">{renderEditor()}</div> : null}
      </div>
    </div>
  )
}

/** Render all workflow-input-source outputs so multi-output nodes keep every handle visible. */
function SourceNodeOutputPorts({
  nodeId,
  ports,
  connectedOutputKeys,
  accentColor,
}: {
  nodeId: string
  ports: ModulePortDefinition[]
  connectedOutputKeys: Set<string>
  accentColor: string
}) {
  if (ports.length === 0) {
    return null
  }

  return (
    <div className="mt-2 grid gap-1">
      {ports.map((port) => (
        <PortCell
          key={port.key}
          nodeId={nodeId}
          port={port}
          side="output"
          accentColor={accentColor}
          connected={connectedOutputKeys.has(port.key)}
          satisfied={connectedOutputKeys.has(port.key)}
          requiredMissing={false}
        />
      ))}
    </div>
  )
}

/** Render compact value controls for constant-input nodes using shared form surfaces. */
function InlineWorkflowInputEditor({ id, data }: Pick<NodeProps<ModuleGraphNode>, 'id' | 'data'>) {
  const sourcePort = isWorkflowInputSourceModule(data.module) ? data.module.exposed_inputs[0] ?? null : null
  if (!sourcePort) {
    return null
  }

  const rawValue = data.inputValues?.[sourcePort.key]
  const workflowInputEnabled = isWorkflowInputEnabledForNode({ id, data } as ModuleGraphNode)
  const hasExplicitValue = hasMeaningfulValue(rawValue)

  const handleValueChange = (value: unknown) => {
    data.onNodeValueChange?.(id, sourcePort.key, value)
  }

  const handleValueClear = () => {
    data.onNodeValueClear?.(id, sourcePort.key)
  }

  return (
    <div className="nodrag nowheel mt-2 space-y-1" onMouseDown={stopNodeInteraction}>
      <div className="flex min-h-[28px] items-center justify-between border-b border-border/30 px-1 pb-1 text-[11px] text-foreground">
        <span>실행 입력</span>
        <input
          type="checkbox"
          checked={workflowInputEnabled}
          onChange={(event) => data.onNodeValueChange?.(id, WORKFLOW_INPUT_ENABLED_KEY, event.target.checked)}
          onMouseDown={stopNodeInteraction}
          className="h-4 w-4 shrink-0 accent-primary"
        />
      </div>

      {(sourcePort.data_type === 'prompt' || sourcePort.data_type === 'text' || sourcePort.data_type === 'json') ? (
        <div onMouseDown={stopNodeInteraction}>
          <ModuleGraphSimpleValueInput
            dataType={sourcePort.data_type}
            value={rawValue}
            onChange={handleValueChange}
            placeholder={sourcePort.label}
            rows={sourcePort.data_type === 'json' ? 4 : 3}
            className={`text-sm ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
          />
        </div>
      ) : null}

      {sourcePort.data_type === 'number' ? (
        <div onMouseDown={stopNodeInteraction}>
          <ModuleGraphSimpleValueInput
            dataType="number"
            value={rawValue}
            onChange={handleValueChange}
            placeholder={sourcePort.label}
            className={MODULE_GRAPH_INLINE_CONTROL_CLASS}
          />
        </div>
      ) : null}

      {sourcePort.data_type === 'boolean' ? (
        <div onMouseDown={stopNodeInteraction}>
          <ModuleGraphSimpleValueInput
            dataType="boolean"
            value={rawValue}
            onChange={handleValueChange}
            emptyLabel="선택"
            className={MODULE_GRAPH_INLINE_CONTROL_CLASS}
          />
        </div>
      ) : null}

      {(sourcePort.data_type === 'image' || sourcePort.data_type === 'mask') ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <ImageAttachmentPickerButton
              label={hasExplicitValue ? '이미지 변경' : '이미지 선택'}
              modalTitle={sourcePort.label}
              allowSaveDialog={false}
              onSelect={(image) => void data.onNodeImageChange?.(id, sourcePort.key, image)}
            />
            {hasExplicitValue ? (
              <Button type="button" size="sm" variant="ghost" onMouseDown={stopNodeActionEvent} onClick={handleValueClear}>
                지우기
              </Button>
            ) : null}
          </div>
          {typeof rawValue === 'string' && rawValue.startsWith('data:') ? (
            <InlineMediaPreview src={rawValue} alt={sourcePort.label} frameClassName="p-2" mediaClassName="max-h-28 w-full object-contain" />
          ) : null}
        </div>
      ) : null}

      {sourcePort.data_type !== 'image' && sourcePort.data_type !== 'mask' && hasExplicitValue ? (
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="ghost" onMouseDown={stopNodeActionEvent} onClick={handleValueClear}>
            값 지우기
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** Resolve one inline UI-field string value from node state with a default fallback. */
function getInlineUiFieldValue(rawValue: unknown, field?: ModuleUiFieldDefinition | null) {
  if (typeof rawValue === 'string') {
    return rawValue
  }

  if (typeof field?.default_value === 'string') {
    return field.default_value
  }

  return rawValue == null ? '' : String(rawValue)
}

function getCompactUiFieldInputType(field: ModuleUiFieldDefinition): 'select' | 'number' | 'boolean' | 'text' {
  if (field.data_type === 'select') {
    return 'select'
  }

  if (field.data_type === 'number') {
    return 'number'
  }

  if (field.data_type === 'boolean') {
    return 'boolean'
  }

  return 'text'
}

/** Render one compact inline separator editor that matches normal node row height. */
function TextMergeSeparatorCell({ id, data, field }: { id: string; data: ModuleGraphNode['data']; field: ModuleUiFieldDefinition }) {
  const rawValue = data.inputValues?.[field.key]
  const value = rawValue == null
    ? (typeof field.default_value === 'string' && field.default_value.length > 0 ? field.default_value : ',')
    : String(rawValue)

  return (
    <div onMouseDown={stopNodeInteraction}>
      <ModuleGraphSimpleValueInput
        dataType="text"
        value={value}
        onChange={(nextValue) => data.onNodeValueChange?.(id, field.key, nextValue)}
        className={`nodrag nowheel h-8 text-xs ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
      />
    </div>
  )
}

/** Render the dedicated text-merge node layout with top output and A/B/C rows. */
function TextMergeNodeLayout({
  id,
  data,
  accentColor,
  connectedInputKeys,
  connectedOutputKeys,
}: {
  id: string
  data: ModuleGraphNode['data']
  accentColor: string
  connectedInputKeys: Set<string>
  connectedOutputKeys: Set<string>
}) {
  const inputPorts = data.module.exposed_inputs ?? []
  const outputPort = data.module.output_ports[0]
  const separatorAbField = data.module.ui_schema?.find((field) => field.key === 'separator_ab') ?? {
    key: 'separator_ab',
    label: 'A 뒤 문자열',
    data_type: 'text',
    default_value: ',',
  }
  const separatorBcField = data.module.ui_schema?.find((field) => field.key === 'separator_bc') ?? {
    key: 'separator_bc',
    label: 'B 뒤 문자열',
    data_type: 'text',
    default_value: ',',
  }

  const buildInputCell = (port?: ModulePortDefinition) => {
    const connected = Boolean(port && connectedInputKeys.has(port.key))
    const satisfied = Boolean(port && (connected || hasMeaningfulValue(data.inputValues?.[port.key]) || hasMeaningfulValue(port.default_value)))

    return (
      <PortCell
        nodeId={id}
        port={port}
        side="input"
        accentColor={accentColor}
        connected={connected}
        satisfied={satisfied}
        requiredMissing={false}
        onDisconnectInput={data.onDisconnectNodeInput}
      />
    )
  }

  return (
    <div className="mt-2.5 grid gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
        <div aria-hidden="true" />
        <PortCell
          nodeId={id}
          port={outputPort}
          side="output"
          accentColor={accentColor}
          connected={Boolean(outputPort && connectedOutputKeys.has(outputPort.key))}
          satisfied={Boolean(outputPort && connectedOutputKeys.has(outputPort.key))}
          requiredMissing={false}
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
        {buildInputCell(inputPorts[0])}
        <TextMergeSeparatorCell id={id} data={data} field={separatorAbField} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
        {buildInputCell(inputPorts[1])}
        <TextMergeSeparatorCell id={id} data={data} field={separatorBcField} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
        {buildInputCell(inputPorts[2])}
        <div aria-hidden="true" />
      </div>
    </div>
  )
}

/** Render one minimal inline field for transform-style system nodes without extra card chrome. */
function TextTransformInlineField({
  id,
  data,
  field,
}: {
  id: string
  data: ModuleGraphNode['data']
  field: ModuleUiFieldDefinition
}) {
  const rawValue = data.inputValues?.[field.key]
  const normalizedValue = rawValue ?? field.default_value

  return (
    <label className="nodrag nowheel flex min-h-[28px] items-center gap-2 border-b border-border/30 px-1 pb-1" onMouseDown={stopNodeInteraction} title={field.description || field.label}>
      <span className="shrink-0 text-[11px] font-medium text-foreground">{field.label}</span>
      <div className="min-w-0 flex-1" onMouseDown={stopNodeInteraction}>
        <ModuleGraphSimpleValueInput
          dataType={getCompactUiFieldInputType(field)}
          value={normalizedValue}
          onChange={(value) => data.onNodeValueChange?.(id, field.key, value)}
          options={field.options ?? []}
          placeholder={field.placeholder || field.description || field.label}
          emptyLabel="선택"
          className={`h-7 min-w-0 flex-1 text-[11px] ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
        />
      </div>
    </label>
  )
}

/** Render the regex/text transform node with one source input and inline transform settings. */
function TextTransformNodeLayout({
  id,
  data,
  accentColor,
  connectedInputKeys,
  connectedOutputKeys,
}: {
  id: string
  data: ModuleGraphNode['data']
  accentColor: string
  connectedInputKeys: Set<string>
  connectedOutputKeys: Set<string>
}) {
  const inputPort = data.module.exposed_inputs[0]
  const outputPort = data.module.output_ports[0]
  const uiFields = data.module.ui_schema ?? []
  const modeField = uiFields.find((field) => field.key === 'mode')
  const patternField = uiFields.find((field) => field.key === 'pattern')
  const flagsField = uiFields.find((field) => field.key === 'flags')
  const replacementField = uiFields.find((field) => field.key === 'replacement')
  const groupIndexField = uiFields.find((field) => field.key === 'group_index')
  const prefixField = uiFields.find((field) => field.key === 'prefix')
  const suffixField = uiFields.find((field) => field.key === 'suffix')
  const currentMode = getInlineUiFieldValue(data.inputValues?.mode, modeField)
  const hasAdvancedFlagsValue = hasMeaningfulValue(data.inputValues?.flags)
  const [showAdvancedFields, setShowAdvancedFields] = useState(hasAdvancedFlagsValue)

  useEffect(() => {
    if (hasAdvancedFlagsValue) {
      setShowAdvancedFields(true)
    }
  }, [hasAdvancedFlagsValue])

  return (
    <div className="mt-2 grid gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
        <InputPortCell
          nodeId={id}
          data={data}
          port={inputPort}
          accentColor={accentColor}
          connected={Boolean(inputPort && connectedInputKeys.has(inputPort.key))}
          satisfied={Boolean(inputPort && (connectedInputKeys.has(inputPort.key) || hasMeaningfulValue(data.inputValues?.[inputPort.key]) || hasMeaningfulValue(inputPort.default_value)))}
          requiredMissing={Boolean(inputPort?.required && !connectedInputKeys.has(inputPort.key) && !hasMeaningfulValue(data.inputValues?.[inputPort.key]) && !hasMeaningfulValue(inputPort.default_value))}
        />
        <PortCell
          nodeId={id}
          port={outputPort}
          side="output"
          accentColor={accentColor}
          connected={Boolean(outputPort && connectedOutputKeys.has(outputPort.key))}
          satisfied={Boolean(outputPort && connectedOutputKeys.has(outputPort.key))}
          requiredMissing={false}
        />
      </div>

      <div className="grid gap-1 px-0.5 pt-1">
        {modeField ? <TextTransformInlineField id={id} data={data} field={modeField} /> : null}
        {patternField ? <TextTransformInlineField id={id} data={data} field={patternField} /> : null}
        {currentMode === 'replace'
          ? (replacementField ? <TextTransformInlineField id={id} data={data} field={replacementField} /> : null)
          : (groupIndexField ? <TextTransformInlineField id={id} data={data} field={groupIndexField} /> : null)}
        {prefixField ? <TextTransformInlineField id={id} data={data} field={prefixField} /> : null}
        {suffixField ? <TextTransformInlineField id={id} data={data} field={suffixField} /> : null}
        {flagsField && showAdvancedFields ? <TextTransformInlineField id={id} data={data} field={flagsField} /> : null}
        {flagsField ? (
          <button
            type="button"
            className="nodrag nowheel flex min-h-[28px] items-center justify-between border-b border-border/30 px-1 pb-1 text-[11px] text-muted-foreground"
            onMouseDown={stopNodeActionEvent}
            onClick={() => setShowAdvancedFields((current) => !current)}
          >
            <span>flags</span>
            <span>{showAdvancedFields ? '−' : '+'}</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Render a compact text artifact preview with optional modal expansion. */
function ArtifactTextPreviewCard({
  preview,
  fullText,
  onOpen,
}: {
  preview: string
  fullText?: string | null
  onOpen: () => void
}) {
  const canOpen = Boolean(fullText && (fullText !== preview || fullText.includes('\n')))

  return (
    <div className="px-1 py-1 text-[11px] leading-4 text-foreground">
      <div className="max-h-[6.25rem] overflow-hidden whitespace-pre-wrap break-words [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:5]">{preview}</div>
      {canOpen ? (
        <button type="button" className="mt-1 text-[10px] text-muted-foreground hover:text-foreground" onMouseDown={stopNodeActionEvent} onClick={onOpen}>
          open
        </button>
      ) : null}
    </div>
  )
}

/** Render one minimal output preview body so result nodes stay plain instead of card-heavy. */
function NodeArtifactPreviewBody({
  previewUrl,
  previewAlt,
  textPreview,
  textValue,
  onOpenText,
  compact = false,
}: {
  previewUrl?: string | null
  previewAlt: string
  textPreview?: string | null
  textValue?: string | null
  onOpenText: () => void
  compact?: boolean
}) {
  if (previewUrl) {
    return (
      <InlineMediaPreview
        src={previewUrl}
        alt={previewAlt}
        frameClassName="mt-1 border-border/50 bg-background/30 p-1"
        mediaClassName={compact ? 'max-h-20 w-full object-contain' : 'max-h-24 w-full object-contain'}
      />
    )
  }

  if (textPreview) {
    return (
      <div className="mt-1 border-l border-border/40 pl-2">
        <ArtifactTextPreviewCard preview={textPreview} fullText={textValue} onOpen={onOpenText} />
      </div>
    )
  }

  return null
}

/** Render a cleaner module graph node card with source-node specific layout. */
export function ModuleGraphNodeCard({ id, data, selected }: NodeProps<ModuleGraphNode>) {
  const { module } = data
  const [expandedOutputGroupKeys, setExpandedOutputGroupKeys] = useState<string[]>([])
  const [artifactTextModal, setArtifactTextModal] = useState<{ title: string; text: string } | null>(null)
  const powerLoraUiFields = (module.ui_schema ?? []).filter((field) => (
    isPowerLoraLoaderUiField(field) || hasPowerLoraLoaderEntries(data.inputValues?.[field.key] ?? field.default_value)
  ))
  const powerLoraUiFieldKeys = new Set(powerLoraUiFields.map((field) => field.key))
  const inputPorts = (module.exposed_inputs ?? []).filter((port) => {
    const uiField = module.ui_schema?.find((field) => field.key === port.key)
    const value = data.inputValues?.[port.key] ?? port.default_value ?? uiField?.default_value
    return !powerLoraUiFieldKeys.has(port.key) && !isPowerLoraLoaderUiField(uiField) && !hasPowerLoraLoaderEntries(value)
  })
  const outputPorts = module.output_ports ?? []
  const accentColor = getModuleColor(module)
  const executionStatus = data.executionStatus || 'idle'
  const connectedInputKeys = new Set(data.connectedInputKeys ?? [])
  const connectedOutputKeys = new Set(data.connectedOutputKeys ?? [])
  const isWorkflowInputSource = isWorkflowInputSourceModule(module)
  const sourceOutputPorts = isWorkflowInputSource ? outputPorts : []
  const missingRequiredInputCount = inputPorts.filter((port) => {
    const connected = connectedInputKeys.has(port.key)
    const explicitValue = hasMeaningfulValue(data.inputValues?.[port.key])
    const defaultValue = hasMeaningfulValue(port.default_value)
    return port.required && !connected && !explicitValue && !defaultValue
  }).length

  const nodeDisplayLabel = getModuleNodeDisplayLabelFromData(data)
  const moduleBaseLabel = getModuleBaseDisplayName(module)
  const usesCustomNodeLabel = hasCustomModuleNodeLabel(data)
  const [isEditingLabel, setIsEditingLabel] = useState(false)
  const [labelDraft, setLabelDraft] = useState(data.label ?? '')
  const missingStatusLabel = isWorkflowInputSource ? '값 필요' : '입력 필요'
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
    executionStatus === 'completed'
      ? '완료'
      : executionStatus === 'failed'
        ? '실패'
        : executionStatus === 'blocked'
          ? '차단됨'
          : missingRequiredInputCount > 0
            ? missingStatusLabel
            : null

  const statusBorderColor =
    executionStatus === 'completed'
      ? '#7bd88f'
      : executionStatus === 'failed'
        ? '#ff8a80'
        : executionStatus === 'blocked'
          ? '#ffd180'
          : missingRequiredInputCount > 0
            ? '#f59e0b'
            : `${accentColor}66`
  const hasArtifactPreview = Boolean(data.latestArtifactPreviewUrl || data.latestArtifactTextPreview)
  const operationKey = getModuleOperationKey(module)
  const isFinalResult = isFinalResultModule(module)
  const isTextMergeModule = operationKey === 'system.merge_text'
  const isTextTransformModule = operationKey === 'system.regex_text_transform'
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

    const currentProviderName = normalizeOptionalString(data.inputValues?.provider_name)
    if (currentProviderName && !entries.some((entry) => entry.provider_name === currentProviderName)) {
      return [
        ...entries,
        {
          provider_name: currentProviderName,
          display_name: currentProviderName,
          provider_type: 'llm_openai_compatible',
          default_model: '설정 필요',
          default_temperature: null,
          default_max_tokens: null,
        },
      ]
    }

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
    ? module.ui_schema?.find((field) => field.key === 'model')
    : null
  const codexModelCurrentValue = normalizeOptionalString(data.inputValues?.model)
  const codexModelOptions = resolveSelectOptionsWithCurrentValue(
    codexModelUiField?.data_type === 'select' ? codexModelUiField.options : null,
    codexModelCurrentValue,
  )
  const codexModelValue = codexModelCurrentValue
    ?? normalizeOptionalString(codexModelPort?.default_value)
    ?? (typeof codexModelUiField?.default_value === 'string' ? codexModelUiField.default_value : null)
    ?? codexModelOptions[0]
    ?? ''
  const canConfigureLlmModel = Boolean(isSystemCallLlmModule && llmModelOptions.length > 0 && data.onNodeValueChange)
  const canConfigureCodexModel = Boolean(isSystemCallCodexMessageModule && codexModelOptions.length > 0 && data.onNodeValueChange)
  const canConfigureLlmPreset = Boolean(isSystemLoadLlmPresetModule && data.onNodeValueChange)
  const llmPresetType = normalizeLlmPresetType(data.inputValues?.preset_type)
  const llmPresetEntries = getLlmPresetEntries(llmPresetsQuery.data, llmPresetType)
  const llmPresetName = normalizeOptionalString(data.inputValues?.preset_name) ?? ''
  const selectedLlmPreset = llmPresetName ? llmPresetEntries.find((preset) => preset.name === llmPresetName) ?? null : null
  const llmPresetNameOptions = llmPresetName && !llmPresetEntries.some((preset) => preset.name === llmPresetName)
    ? [...llmPresetEntries, { id: llmPresetName, name: llmPresetName, content: '', updatedAt: '' }]
    : llmPresetEntries
  const visibleOutputPorts = getVisibleModuleOutputPorts(module, data.inputValues, {
    includeAdvanced: isAdvancedOutputPortsEnabled(data.inputValues),
    connectedInputKeys,
    connectedOutputKeys,
  })
  const visibleOutputPortKeys = new Set(visibleOutputPorts.map((port) => port.key))
  const outputGroups = (data.executionOutputGroups ?? []).filter((group) => visibleOutputPortKeys.has(group.portKey))
  const hasOutputGroups = outputGroups.length > 0
  const hasStandaloneArtifactPreview = hasArtifactPreview && !hasOutputGroups
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

    return true
  })
  const portRowCount = Math.max(visibleInputPorts.length, visibleOutputPorts.length, 1)
  const comfyWorkflowId = module.engine_type === 'comfyui'
    ? parsePositiveIntegerish(module.source_workflow_id ?? module.template_defaults?.workflow_id)
    : null
  const canConfigureComfyTarget = Boolean(module.engine_type === 'comfyui' && comfyWorkflowId && data.onNodeValueChange)
  const comfyTargetBadgeLabel = canConfigureComfyTarget ? resolveComfyTargetBadgeLabel(data.inputValues) : null
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
  const linkedComfyServers = workflowServersQuery.data ?? []
  const candidateComfyServers: ComfyUIServer[] = linkedComfyServers.length > 0 ? linkedComfyServers : (comfyServersQuery.data ?? [])
  const comfyRoutingTags = Array.from(new Set(candidateComfyServers.flatMap((server) => server.routing_tags ?? []))).sort((left, right) => left.localeCompare(right))
  const knownComfyTargetValues = new Set<string>([
    'auto',
    ...comfyRoutingTags.map((tag) => `tag:${tag}`),
    ...candidateComfyServers.map((server) => `server:${server.id}`),
  ])
  const shouldShowFallbackComfyTargetOption = comfyTargetValue !== 'auto' && !knownComfyTargetValues.has(comfyTargetValue)
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
      className="w-[340px] max-w-[340px] rounded-sm border bg-surface-container px-2.5 py-2 text-foreground shadow-lg"
      style={{
        borderColor: selected ? accentColor : statusBorderColor,
        boxShadow: selected ? `0 0 0 2px ${accentColor}66, 0 0 0 1px ${accentColor}22` : `0 0 0 1px ${accentColor}22`,
      } as CSSProperties}
      title={`${nodeDisplayLabel}\n기본 타입: ${moduleBaseLabel}\n모듈 ID: ${module.id}${module.description ? `\n${module.description}` : ''}`}
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
                title={selected ? '클릭해서 이름 변경' : undefined}
              >
                {nodeDisplayLabel}
              </button>
            )}
            {usesCustomNodeLabel ? <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{moduleBaseLabel}</div> : null}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
          {isFinalResult ? <Badge variant="secondary">최종 결과</Badge> : null}
          {data.executionReuseState === 'reused' ? <Badge variant="outline">캐시</Badge> : null}
          {data.executionArtifactCount ? <Badge variant="outline">A {data.executionArtifactCount}</Badge> : null}
          {statusLabel ? <Badge variant="secondary">{statusLabel}</Badge> : null}
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
              title="실행"
              aria-label="실행"
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
              title="재실행"
              aria-label="재실행"
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
            {shouldShowFallbackComfyTargetOption ? <option value={comfyTargetValue}>현재 설정 유지 ({comfyTargetBadgeLabel})</option> : null}
            <option value="auto">자동 분산</option>
            {comfyRoutingTags.length > 0 ? (
              <optgroup label="태그">
                {comfyRoutingTags.map((tag) => (
                  <option key={tag} value={`tag:${tag}`}>#{tag}</option>
                ))}
              </optgroup>
            ) : null}
            {candidateComfyServers.length > 0 ? (
              <optgroup label="서버">
                {candidateComfyServers.map((server) => (
                  <option key={server.id} value={`server:${server.id}`}>{server.name}</option>
                ))}
              </optgroup>
            ) : null}
          </Select>
        </div>
      ) : null}

      {canConfigureLlmModel ? (
        <div className="nodrag nowheel mt-2 space-y-1">
          <div className="px-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">모델</div>
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
            <option value="">모델 선택</option>
            {llmModelOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </div>
      ) : null}

      {canConfigureCodexModel ? (
        <div className="nodrag nowheel mt-2 space-y-1">
          <div className="px-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">모델</div>
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
            {codexModelOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>
        </div>
      ) : null}

      {canConfigureLlmPreset ? (
        <div className="nodrag nowheel mt-2 space-y-1.5">
          <div className="px-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">프리셋</div>
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
            {LLM_PRESET_TYPE_OPTIONS.map((option) => (
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
            <option value="">{llmPresetsQuery.isLoading ? '불러오는 중' : '프리셋 선택'}</option>
            {llmPresetNameOptions.map((preset) => (
              <option key={preset.id || preset.name} value={preset.name}>{preset.name}</option>
            ))}
          </Select>
          {selectedLlmPreset ? (
            <div className="rounded-sm border border-border/60 bg-background/45 px-2.5 py-2">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">선택 내용</div>
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
          />
        ) : isTextTransformModule ? (
          <TextTransformNodeLayout
            id={id}
            data={data}
            accentColor={accentColor}
            connectedInputKeys={connectedInputKeys}
            connectedOutputKeys={connectedOutputKeys}
          />
        ) : (
          <div className="mt-2.5 grid gap-1">
            {Array.from({ length: portRowCount }, (_, index) => {
              const inputPort = visibleInputPorts[index]
              const outputPort = visibleOutputPorts[index]
              const inputConnected = Boolean(inputPort && connectedInputKeys.has(inputPort.key))
              const inputSatisfied = Boolean(inputPort && (inputConnected || hasMeaningfulValue(data.inputValues?.[inputPort.key]) || hasMeaningfulValue(inputPort.default_value)))
              const inputRequiredMissing = Boolean(inputPort && inputPort.required && !inputSatisfied)
              const outputConnected = Boolean(outputPort && connectedOutputKeys.has(outputPort.key))

              return (
                <div key={`port-row-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
                  <InputPortCell
                    nodeId={id}
                    data={data}
                    port={inputPort}
                    accentColor={accentColor}
                    connected={inputConnected}
                    satisfied={inputSatisfied}
                    requiredMissing={inputRequiredMissing}
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

      {hasStandaloneArtifactPreview ? (
        <div className="mt-2 border-t border-border/20 pt-1.5">
          <div className="flex items-center gap-2 px-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <span>{isFinalResult ? 'result' : 'output'}</span>
          </div>
          <NodeArtifactPreviewBody
            previewUrl={data.latestArtifactPreviewUrl}
            previewAlt={data.latestArtifactLabel || `${module.name} output`}
            textPreview={data.latestArtifactTextPreview}
            textValue={data.latestArtifactTextValue}
            compact={isFinalResult}
            onOpenText={() =>
              setArtifactTextModal({
                title: data.latestArtifactLabel || `${module.name} output`,
                text: data.latestArtifactTextValue ?? data.latestArtifactTextPreview ?? '',
              })
            }
          />
        </div>
      ) : null}

      {hasOutputGroups ? (
        <div className="mt-2 border-t border-border/20 pt-1.5">
          {outputGroups.map((group) => {
            const isExpanded = expandedOutputGroupKeys.includes(group.portKey)

            return (
              <div key={group.portKey} className="border-b border-border/20 py-0.5 last:border-b-0">
                <button
                  type="button"
                  className="nodrag nowheel flex min-h-[28px] w-full items-center justify-between gap-2 px-1 text-left"
                  onMouseDown={stopNodeActionEvent}
                  onClick={(event) => {
                    stopNodeActionEvent(event)
                    setExpandedOutputGroupKeys((current) => (
                      current.includes(group.portKey)
                        ? current.filter((key) => key !== group.portKey)
                        : [...current, group.portKey]
                    ))
                  }}
                  title={`${group.portLabel} output`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <span className="truncate text-[11px] font-medium text-foreground">{group.portLabel}</span>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{group.artifactCount}</span>
                </button>

                {isExpanded ? (
                  <div className="pb-1 pl-5 pr-1">
                    <NodeArtifactPreviewBody
                      previewUrl={group.latestArtifactPreviewUrl}
                      previewAlt={group.latestArtifactLabel || `${module.name} ${group.portLabel}`}
                      textPreview={group.latestArtifactTextPreview}
                      textValue={group.latestArtifactTextValue}
                      compact={isFinalResult}
                      onOpenText={() =>
                        setArtifactTextModal({
                          title: `${module.name} · ${group.portLabel}`,
                          text: group.latestArtifactTextValue ?? group.latestArtifactTextPreview ?? '',
                        })
                      }
                    />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      <SettingsModal
        open={Boolean(artifactTextModal)}
        title={artifactTextModal?.title ?? '출력 내용'}
        widthClassName="max-w-3xl"
        onClose={() => setArtifactTextModal(null)}
      >
        <pre className="max-h-[70vh] overflow-auto rounded-sm border border-border/70 bg-surface-low p-3 text-xs leading-5 text-foreground whitespace-pre-wrap break-words">
          {artifactTextModal?.text ?? ''}
        </pre>
      </SettingsModal>
    </div>
  )
}
