import { type CSSProperties, type MouseEvent, type SyntheticEvent } from 'react'
import { Handle, Position } from '@xyflow/react'
import { ModuleGraphSimpleValueInput, type ModuleGraphSelectOption } from './module-graph-simple-value-input'
import type { ModulePortDefinition, ModuleUiFieldDefinition } from '@/lib/api-module-graph'
import { getModuleGraphPortTypeLabel, hasMeaningfulValue } from './module-graph-field-shared'
import { useI18n } from '@/i18n'
import {
  buildHandleId,
  getModuleOperationKey,
  getPortTypeColor,
  normalizeModulePortDescription,
  type ModuleGraphConditionalOutputState,
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
  outputState?: ModuleGraphConditionalOutputState | null
  onDisconnectInput?: (nodeId: string, portKey: string) => void
}

export type ModuleUiFieldMap = Map<string, ModuleUiFieldDefinition>

export function buildModuleUiFieldMap(fields: ModuleUiFieldDefinition[] | null | undefined): ModuleUiFieldMap {
  return new Map((fields ?? []).map((field) => [field.key, field] as const))
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
export function buildPortTooltip(t: ReturnType<typeof useI18n>['t'], port: ModulePortDefinition, statusLabel: string) {
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
export function buildHandleStyle(params: { side: 'input' | 'output'; color: string }): CSSProperties {
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
export function getCompactValuePreview(value: unknown) {
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
export function PortCell({ nodeId, port, side, accentColor, connected, satisfied, requiredMissing, requiredMissingLabel, outputState, onDisconnectInput }: PortCellProps) {
  const { t } = useI18n()
  const resolvedRequiredMissingLabel = requiredMissingLabel ?? t({ ko: '입력 필요', en: 'Input required' })

  if (!port) {
    return <div className="min-h-[28px] border-b border-dashed border-border/35" aria-hidden="true" />
  }

  const portTypeColor = getPortTypeColor(port.data_type)
  const outputStateLabel = outputState === 'active'
    ? t({ ko: '활성 경로', en: 'Active path' })
    : outputState === 'inactive'
      ? t({ ko: '비활성 경로', en: 'Inactive path' })
      : null
  const statusLabel = outputStateLabel ?? (requiredMissing ? resolvedRequiredMissingLabel : connected ? t({ ko: '연결됨', en: 'Connected' }) : satisfied ? t({ ko: '설정됨', en: 'Configured' }) : t({ ko: '대기', en: 'Waiting' }))
  const borderColor = outputState === 'active'
    ? '#22c55e99'
    : outputState === 'inactive'
      ? '#64748b99'
      : requiredMissing ? '#f59e0b99' : connected ? `${portTypeColor}88` : `${accentColor}26`
  const alignmentClass = side === 'input' ? 'pl-4 pr-2 text-left' : 'pl-2 pr-4 text-right'
  const rowJustifyClass = side === 'input' ? 'justify-start' : 'justify-end'
  const handleColor = outputState === 'inactive' ? '#64748b' : portTypeColor

  return (
    <div
      className={`relative min-h-[28px] border-b ${alignmentClass} ${outputState === 'inactive' ? 'opacity-65' : ''}`}
      style={{ borderColor } as CSSProperties}
      title={buildPortTooltip(t, port, statusLabel)}
      onMouseDown={side === 'input' && connected ? () => onDisconnectInput?.(nodeId, port.key) : undefined}
    >
      <Handle
        id={buildHandleId(side === 'input' ? 'in' : 'out', port.key)}
        type={side === 'input' ? 'target' : 'source'}
        position={side === 'input' ? Position.Left : Position.Right}
        style={buildHandleStyle({ side, color: handleColor })}
        title={buildPortTooltip(t, port, statusLabel)}
        onMouseDown={side === 'input' && connected ? () => onDisconnectInput?.(nodeId, port.key) : undefined}
      />

      <div className={`flex min-h-[28px] items-center gap-2 ${rowJustifyClass}`}>
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
          {port.label}
          {port.required ? <span className="ml-1 text-[11px] text-amber-300">*</span> : null}
        </span>
        {outputStateLabel ? (
          <span className={`shrink-0 rounded-sm border px-1 py-0.5 text-[9px] font-medium ${outputState === 'active' ? 'border-emerald-400/40 text-emerald-200' : 'border-slate-400/30 text-slate-300'}`}>
            {outputState === 'active' ? t({ ko: '활성', en: 'Active' }) : t({ ko: '꺼짐', en: 'Off' })}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/** Render one plain inline editor row for input ports while keeping all ports visible. */
export function InputPortCell({
  nodeId,
  data,
  port,
  uiField: uiFieldOverride,
  accentColor,
  connected,
  satisfied,
  requiredMissing,
  selectOptionsOverride,
}: {
  nodeId: string
  data: ModuleGraphNode['data']
  port?: ModulePortDefinition
  uiField?: ModuleUiFieldDefinition | null
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
  const uiField = uiFieldOverride !== undefined ? uiFieldOverride : data.module.ui_schema?.find((field) => field.key === port.key)
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
