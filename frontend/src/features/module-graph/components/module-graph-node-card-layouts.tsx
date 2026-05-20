import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent, type SyntheticEvent } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ImageAttachmentPickerButton } from '@/features/image-generation/components/image-attachment-picker'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { useI18n } from '@/i18n'
import { ModuleGraphSimpleValueInput, type ModuleGraphSelectOption } from './module-graph-simple-value-input'
import { NodeArtifactPreviewBody } from './module-graph-node-artifact-preview'
import type { ModulePortDefinition, ModuleUiFieldDefinition } from '@/lib/api-module-graph'
import { getModuleGraphPortTypeLabel, hasMeaningfulValue } from './module-graph-field-shared'
import {
  WORKFLOW_INPUT_ENABLED_KEY,
  isWorkflowInputEnabledForNode,
  isWorkflowInputSourceModule,
} from '../module-graph-workflow-inputs'
import {
  buildHandleId,
  getModuleOperationKey,
  getPortTypeColor,
  normalizeModulePortDescription,
  type ModuleGraphNode,
} from '../module-graph-shared'

export const MODULE_GRAPH_INLINE_CONTROL_CLASS = 'theme-input-surface border-border/80 focus:border-primary'

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

/** Prevent embedded controls from triggering node drag or canvas selection. */
export function stopNodeInteraction(event: SyntheticEvent) {
  event.stopPropagation()
}

/** Prevent button clicks from also triggering node drag/selection side effects. */
export function stopNodeActionEvent(event: MouseEvent<HTMLElement>) {
  event.preventDefault()
  event.stopPropagation()
}

/** Build one compact hover tooltip so node cards stay visually clean. */
function buildPortTooltip(t: ReturnType<typeof useI18n>['t'], port: ModulePortDefinition, statusLabel: string) {
  return [
    port.label,
    t({ ko: '키: {key}', en: 'Key: {key}' }, { key: port.key }),
    t({ ko: '타입: {type}', en: 'Type: {type}' }, { type: getModuleGraphPortTypeLabel(t, port.data_type) }),
    t({ ko: '상태: {status}', en: 'Status: {status}' }, { status: statusLabel }),
    null,
    port.required ? t({ ko: '필수', en: 'Required' }) : null,
    port.multiple ? t({ ko: '다중', en: 'Multiple' }) : null,
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

type InputPortState = {
  connected: boolean
  satisfied: boolean
  requiredMissing: boolean
}

/** Resolve reusable input-port status flags for node rows and card-level missing-state badges. */
export function getInputPortState(
  data: ModuleGraphNode['data'],
  port: ModulePortDefinition | undefined,
  connectedInputKeys: Set<string>,
): InputPortState {
  const connected = Boolean(port && connectedInputKeys.has(port.key))
  const satisfied = Boolean(port && (connected || hasMeaningfulValue(data.inputValues?.[port.key]) || hasMeaningfulValue(port.default_value)))

  return {
    connected,
    satisfied,
    requiredMissing: Boolean(port && port.required && !satisfied),
  }
}

/** Render one standard minimal socket row for outputs and simple port-only surfaces. */
export function PortCell({ nodeId, port, side, accentColor, connected, satisfied, requiredMissing, requiredMissingLabel, onDisconnectInput }: PortCellProps) {
  const { t } = useI18n()
  const resolvedRequiredMissingLabel = requiredMissingLabel ?? t({ ko: '입력 필요', en: 'Input required' })

  if (!port) {
    return <div className="min-h-[28px] border-b border-dashed border-border/35" aria-hidden="true" />
  }

  const portTypeColor = getPortTypeColor(port.data_type)
  const statusLabel = requiredMissing ? resolvedRequiredMissingLabel : connected ? t({ ko: '연결됨', en: 'Connected' }) : satisfied ? t({ ko: '설정됨', en: 'Configured' }) : t({ ko: '대기', en: 'Waiting' })
  const borderColor = requiredMissing ? '#f59e0b99' : connected ? `${portTypeColor}88` : `${accentColor}26`
  const alignmentClass = side === 'input' ? 'pl-4 pr-2 text-left' : 'pl-2 pr-4 text-right'
  const rowJustifyClass = side === 'input' ? 'justify-start' : 'justify-end'

  return (
    <div
      className={`relative min-h-[28px] border-b ${alignmentClass}`}
      style={{ borderColor } as CSSProperties}
      title={buildPortTooltip(t, port, statusLabel)}
      onMouseDown={side === 'input' && connected ? () => onDisconnectInput?.(nodeId, port.key) : undefined}
    >
      <Handle
        id={buildHandleId(side === 'input' ? 'in' : 'out', port.key)}
        type={side === 'input' ? 'target' : 'source'}
        position={side === 'input' ? Position.Left : Position.Right}
        style={buildHandleStyle({ side, color: portTypeColor })}
        title={buildPortTooltip(t, port, statusLabel)}
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
export function InputPortCell({
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
  const { t } = useI18n()

  if (!port) {
    return <div className="min-h-[28px] border-b border-dashed border-border/35" aria-hidden="true" />
  }

  const rawValue = data.inputValues?.[port.key]
  const portTypeColor = getPortTypeColor(port.data_type)
  const statusLabel = requiredMissing ? t({ ko: '입력 필요', en: 'Input required' }) : connected ? t({ ko: '연결됨', en: 'Connected' }) : satisfied ? t({ ko: '설정됨', en: 'Configured' }) : t({ ko: '대기', en: 'Waiting' })
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
      return <div className="truncate text-[10px] text-muted-foreground">{t({ ko: '연결됨', en: 'Linked' })}</div>
    }

    if (selectOptions && data.onNodeValueChange) {
      return (
        <div onMouseDown={stopNodeInteraction}>
          <ModuleGraphSimpleValueInput
            dataType="select"
            value={rawValue}
            onChange={(value) => data.onNodeValueChange?.(nodeId, port.key, value)}
            options={selectOptions}
            emptyLabel={hasMeaningfulValue(port.default_value ?? uiField?.default_value) ? t({ ko: '기본값', en: 'Default' }) : t({ ko: '선택', en: 'Select' })}
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
            emptyLabel={t({ ko: '기본값', en: 'Default' })}
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
    <div className="relative min-h-[28px] border-b pl-4 pr-2" style={{ borderColor } as CSSProperties} title={buildPortTooltip(t, port, statusLabel)}>
      <Handle
        id={buildHandleId('in', port.key)}
        type="target"
        position={Position.Left}
        style={buildHandleStyle({ side: 'input', color: portTypeColor })}
        title={buildPortTooltip(t, port, statusLabel)}
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
export function SourceNodeOutputPorts({
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
export function InlineWorkflowInputEditor({ id, data }: Pick<NodeProps<ModuleGraphNode>, 'id' | 'data'>) {
  const { t } = useI18n()
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
        <span>{t({ ko: '실행 입력', en: 'Run input' })}</span>
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
            emptyLabel={t({ ko: '선택', en: 'Select' })}
            className={MODULE_GRAPH_INLINE_CONTROL_CLASS}
          />
        </div>
      ) : null}

      {(sourcePort.data_type === 'image' || sourcePort.data_type === 'mask') ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            <ImageAttachmentPickerButton
              label={hasExplicitValue ? t({ ko: '이미지 변경', en: 'Change image' }) : t({ ko: '이미지 선택', en: 'Select image' })}
              modalTitle={sourcePort.label}
              allowSaveDialog={false}
              onSelect={(image) => void data.onNodeImageChange?.(id, sourcePort.key, image)}
            />
            {hasExplicitValue ? (
              <Button type="button" size="sm" variant="ghost" onMouseDown={stopNodeActionEvent} onClick={handleValueClear}>
                {t({ ko: '지우기', en: 'Clear' })}
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
            {t({ ko: '값 지우기', en: 'Clear value' })}
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

function renderCompactUiField({
  id,
  data,
  field,
  value,
  allowEmptyOption = true,
  t,
}: {
  id: string
  data: ModuleGraphNode['data']
  field: ModuleUiFieldDefinition
  value?: unknown
  allowEmptyOption?: boolean
  t: ReturnType<typeof useI18n>['t']
}) {
  const normalizedValue = value ?? data.inputValues?.[field.key] ?? field.default_value

  return (
    <label key={field.key} className="nodrag nowheel flex min-h-[28px] items-center gap-2 border-b border-border/30 px-1 pb-1" onMouseDown={stopNodeInteraction} title={field.description || field.label}>
      <span className="shrink-0 text-[11px] font-medium text-foreground">{field.label}</span>
      <div className="min-w-0 flex-1" onMouseDown={stopNodeInteraction}>
        <ModuleGraphSimpleValueInput
          dataType={getCompactUiFieldInputType(field)}
          value={normalizedValue}
          onChange={(nextValue) => data.onNodeValueChange?.(id, field.key, nextValue)}
          options={field.options ?? []}
          placeholder={field.placeholder || field.description || field.label}
          emptyLabel={t({ ko: '선택', en: 'Select' })}
          allowEmptyOption={allowEmptyOption}
          className={`h-7 min-w-0 flex-1 text-[11px] ${MODULE_GRAPH_INLINE_CONTROL_CLASS}`}
        />
      </div>
    </label>
  )
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
export function TextMergeNodeLayout({
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
  const { t } = useI18n()
  const inputPorts = data.module.exposed_inputs ?? []
  const outputPort = data.module.output_ports[0]
  const separatorAbField = data.module.ui_schema?.find((field) => field.key === 'separator_ab') ?? {
    key: 'separator_ab',
    label: t({ ko: 'A 뒤 문자열', en: 'Text after A' }),
    data_type: 'text',
    default_value: ',',
  }
  const separatorBcField = data.module.ui_schema?.find((field) => field.key === 'separator_bc') ?? {
    key: 'separator_bc',
    label: t({ ko: 'B 뒤 문자열', en: 'Text after B' }),
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
  const { t } = useI18n()
  return renderCompactUiField({ id, data, field, t })
}

/** Render the regex/text transform node with one source input and inline transform settings. */
export function TextTransformNodeLayout({
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
  const inputPortState = getInputPortState(data, inputPort, connectedInputKeys)
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
          connected={inputPortState.connected}
          satisfied={inputPortState.satisfied}
          requiredMissing={inputPortState.requiredMissing}
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

/** Render the IF branch node with node-level condition controls instead of hiding them in module config. */
export function IfBranchNodeLayout({
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
  const { t } = useI18n()
  const inputPorts = data.module.exposed_inputs ?? []
  const outputPorts = data.module.output_ports ?? []
  const uiFields = data.module.ui_schema ?? []
  const modeField = uiFields.find((field) => field.key === 'mode')
  const expectedTypeField = uiFields.find((field) => field.key === 'expected_type')
  const modeValue = getInlineUiFieldValue(data.inputValues?.mode, modeField)
  const portRowCount = Math.max(inputPorts.length, outputPorts.length, 1)

  return (
    <div className="mt-2 grid gap-1">
      <div className="grid gap-1 px-0.5 pb-1">
        {modeField ? renderCompactUiField({ id, data, field: modeField, value: modeValue, allowEmptyOption: false, t }) : null}
        {expectedTypeField && modeValue === 'type_is'
          ? renderCompactUiField({ id, data, field: expectedTypeField, allowEmptyOption: false, t })
          : null}
      </div>

      <div className="grid gap-1">
        {Array.from({ length: portRowCount }, (_, index) => {
          const inputPort = inputPorts[index]
          const outputPort = outputPorts[index]
          const inputPortState = getInputPortState(data, inputPort, connectedInputKeys)
          const outputConnected = Boolean(outputPort && connectedOutputKeys.has(outputPort.key))

          return (
            <div key={`if-port-row-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
              <InputPortCell
                nodeId={id}
                data={data}
                port={inputPort}
                accentColor={accentColor}
                connected={inputPortState.connected}
                satisfied={inputPortState.satisfied}
                requiredMissing={inputPortState.requiredMissing}
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
    </div>
  )
}
export function NodeArtifactOutputs({
  data,
  moduleName,
  isFinalResult,
  visibleOutputPortKeys,
}: {
  data: ModuleGraphNode['data']
  moduleName: string
  isFinalResult: boolean
  visibleOutputPortKeys: Set<string>
}) {
  const { t } = useI18n()
  const [expandedOutputGroupKeys, setExpandedOutputGroupKeys] = useState<string[]>([])
  const [artifactTextModal, setArtifactTextModal] = useState<{ title: string; text: string } | null>(null)
  const hasArtifactPreview = Boolean(data.latestArtifactPreviewUrl || data.latestArtifactTextPreview)
  const outputGroups = (data.executionOutputGroups ?? []).filter((group) => visibleOutputPortKeys.has(group.portKey))
  const expandedOutputGroupKeySet = useMemo(() => new Set(expandedOutputGroupKeys), [expandedOutputGroupKeys])
  const hasOutputGroups = outputGroups.length > 0
  const hasStandaloneArtifactPreview = hasArtifactPreview && !hasOutputGroups

  return (
    <>
      {hasStandaloneArtifactPreview ? (
        <div className="mt-2 border-t border-border/20 pt-1.5">
          <div className="flex items-center gap-2 px-1 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
            <span>{isFinalResult ? 'result' : 'output'}</span>
          </div>
          <NodeArtifactPreviewBody
            previewUrl={data.latestArtifactPreviewUrl}
            previewAlt={data.latestArtifactLabel || `${moduleName} output`}
            textPreview={data.latestArtifactTextPreview}
            textValue={data.latestArtifactTextValue}
            compact={isFinalResult}
            onOpenText={() =>
              setArtifactTextModal({
                title: data.latestArtifactLabel || `${moduleName} output`,
                text: data.latestArtifactTextValue ?? data.latestArtifactTextPreview ?? '',
              })
            }
          />
        </div>
      ) : null}

      {hasOutputGroups ? (
        <div className="mt-2 border-t border-border/20 pt-1.5">
          {outputGroups.map((group) => {
            const isExpanded = expandedOutputGroupKeySet.has(group.portKey)

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
                      previewAlt={group.latestArtifactLabel || `${moduleName} ${group.portLabel}`}
                      textPreview={group.latestArtifactTextPreview}
                      textValue={group.latestArtifactTextValue}
                      compact={isFinalResult}
                      onOpenText={() =>
                        setArtifactTextModal({
                          title: `${moduleName} · ${group.portLabel}`,
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
        title={artifactTextModal?.title ?? t({ ko: '출력 내용', en: 'Output content' })}
        widthClassName="max-w-3xl"
        onClose={() => setArtifactTextModal(null)}
      >
        <pre className="max-h-[70vh] overflow-auto rounded-sm border border-border/70 bg-surface-low p-3 text-xs leading-5 text-foreground whitespace-pre-wrap break-words">
          {artifactTextModal?.text ?? ''}
        </pre>
      </SettingsModal>
    </>
  )
}

