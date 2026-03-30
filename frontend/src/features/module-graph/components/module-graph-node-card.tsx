import type { CSSProperties } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Badge } from '@/components/ui/badge'
import type { ModulePortDefinition } from '@/lib/api'
import { buildHandleId, getModuleColor, getPortOffset, getPortTypeColor, type ModuleGraphNode } from '../module-graph-shared'

const PORT_TYPE_LABELS: Record<ModulePortDefinition['data_type'], string> = {
  image: 'image',
  mask: 'mask',
  prompt: 'prompt',
  text: 'text',
  number: 'number',
  boolean: 'boolean',
  json: 'json',
}

type PortCellProps = {
  port?: ModulePortDefinition
  side: 'input' | 'output'
  accentColor: string
  connected: boolean
  satisfied: boolean
  requiredMissing: boolean
}

/** Check whether a node input has any explicit or default value. */
function hasMeaningfulValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}

/** Build one compact hover tooltip so node cards stay visually clean. */
function buildPortTooltip(port: ModulePortDefinition, statusLabel: string) {
  return [
    port.label,
    `key: ${port.key}`,
    `type: ${PORT_TYPE_LABELS[port.data_type]}`,
    `status: ${statusLabel}`,
    port.required ? 'required' : null,
    port.multiple ? 'multi' : null,
    port.description || null,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Render one compact port row with a label and a colored type badge only. */
function PortCell({ port, side, accentColor, connected, satisfied, requiredMissing }: PortCellProps) {
  if (!port) {
    return <div className="min-h-[38px] rounded-sm border border-dashed border-border/35 bg-surface-low/20" aria-hidden="true" />
  }

  const portTypeColor = getPortTypeColor(port.data_type)
  const statusLabel = requiredMissing ? 'needs input' : connected ? 'linked' : satisfied ? 'set' : 'open'
  const borderColor = requiredMissing ? '#f59e0b99' : connected ? `${portTypeColor}99` : `${accentColor}30`
  const backgroundColor = requiredMissing ? 'rgba(245, 158, 11, 0.10)' : connected ? `${portTypeColor}10` : 'rgba(148, 163, 184, 0.06)'
  const alignmentClass = side === 'input' ? 'pl-4 pr-2' : 'pl-2 pr-4'
  const labelAlignmentClass = side === 'input' ? 'text-left' : 'text-right'
  const rowJustifyClass = side === 'input' ? 'justify-start' : 'justify-end'

  return (
    <div
      className={`min-h-[38px] rounded-sm border ${alignmentClass}`}
      style={{ borderColor, backgroundColor } as CSSProperties}
      title={buildPortTooltip(port, statusLabel)}
    >
      <div className={`flex min-h-[36px] items-center gap-2 ${rowJustifyClass}`}>
        {side === 'input' ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: portTypeColor }} aria-hidden="true" /> : null}
        <span className={`min-w-0 flex-1 truncate text-xs font-medium text-foreground ${labelAlignmentClass}`}>
          {port.label}
          {port.required ? <span className="ml-1 text-[11px] text-amber-300">*</span> : null}
        </span>
        <Badge
          variant="outline"
          className="shrink-0 px-1.5 py-0 text-[10px] font-semibold uppercase tracking-[0.08em]"
          style={{ borderColor: `${portTypeColor}88`, color: portTypeColor } as CSSProperties}
        >
          {PORT_TYPE_LABELS[port.data_type]}
        </Badge>
        {side === 'output' ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: portTypeColor }} aria-hidden="true" /> : null}
      </div>
    </div>
  )
}

/** Build a larger handle target so graph connections are easier to click and drag. */
function buildHandleStyle(params: { side: 'input' | 'output'; top: string; color: string }): CSSProperties {
  return {
    top: params.top,
    width: 16,
    height: 16,
    borderRadius: 999,
    background: params.color,
    border: '2px solid var(--surface-container)',
    boxShadow: `0 0 0 4px ${params.color}22`,
    left: params.side === 'input' ? -9 : undefined,
    right: params.side === 'output' ? -9 : undefined,
  }
}

/** Render a cleaner module graph node card with compact ports and hover-only details. */
export function ModuleGraphNodeCard({ data }: NodeProps<ModuleGraphNode>) {
  const { module } = data
  const inputPorts = module.exposed_inputs ?? []
  const outputPorts = module.output_ports ?? []
  const accentColor = getModuleColor(module)
  const executionStatus = data.executionStatus || 'idle'
  const portRowCount = Math.max(inputPorts.length, outputPorts.length, 1)
  const connectedInputKeys = new Set(data.connectedInputKeys ?? [])
  const connectedOutputKeys = new Set(data.connectedOutputKeys ?? [])
  const connectedInputCount = connectedInputKeys.size
  const connectedOutputCount = connectedOutputKeys.size
  const missingRequiredInputCount = inputPorts.filter((port) => {
    const connected = connectedInputKeys.has(port.key)
    const explicitValue = hasMeaningfulValue(data.inputValues?.[port.key])
    const defaultValue = hasMeaningfulValue(port.default_value)
    return port.required && !connected && !explicitValue && !defaultValue
  }).length

  const statusLabel =
    executionStatus === 'completed'
      ? 'done'
      : executionStatus === 'failed'
        ? 'failed'
        : executionStatus === 'blocked'
          ? 'blocked'
          : missingRequiredInputCount > 0
            ? 'needs input'
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

  return (
    <div
      className="min-w-[300px] rounded-sm border bg-surface-container px-3 py-3 text-foreground shadow-lg"
      style={{ borderColor: statusBorderColor, boxShadow: `0 0 0 1px ${accentColor}22` } as CSSProperties}
      title={`${module.name}\nmodule id: ${module.id}${module.description ? `\n${module.description}` : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{module.name}</div>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span>{module.engine_type}</span>
            <span>#{module.id}</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" style={{ borderColor: `${accentColor}66`, color: accentColor } as CSSProperties}>
            {module.engine_type}
          </Badge>
          {statusLabel ? <Badge variant="secondary">{statusLabel}</Badge> : null}
        </div>
      </div>

      <div className="mt-2 text-[11px] text-muted-foreground">
        입력 {connectedInputCount}/{inputPorts.length} · 출력 {connectedOutputCount}/{outputPorts.length}
        {missingRequiredInputCount > 0 ? ` · 필수 부족 ${missingRequiredInputCount}` : ''}
      </div>

      <div className="mt-3 grid gap-1.5">
        {Array.from({ length: portRowCount }, (_, index) => {
          const inputPort = inputPorts[index]
          const outputPort = outputPorts[index]
          const inputConnected = Boolean(inputPort && connectedInputKeys.has(inputPort.key))
          const inputSatisfied = Boolean(inputPort && (inputConnected || hasMeaningfulValue(data.inputValues?.[inputPort.key]) || hasMeaningfulValue(inputPort.default_value)))
          const inputRequiredMissing = Boolean(inputPort && inputPort.required && !inputSatisfied)
          const outputConnected = Boolean(outputPort && connectedOutputKeys.has(outputPort.key))

          return (
            <div key={`port-row-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1.5">
              <PortCell
                port={inputPort}
                side="input"
                accentColor={accentColor}
                connected={inputConnected}
                satisfied={inputSatisfied}
                requiredMissing={inputRequiredMissing}
              />
              <PortCell
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

      {inputPorts.map((port, index) => (
        <Handle
          key={port.key}
          id={buildHandleId('in', port.key)}
          type="target"
          position={Position.Left}
          style={buildHandleStyle({ side: 'input', top: getPortOffset(index, inputPorts.length), color: getPortTypeColor(port.data_type) })}
          title={buildPortTooltip(port, connectedInputKeys.has(port.key) ? 'linked' : 'open')}
        />
      ))}

      {outputPorts.map((port, index) => (
        <Handle
          key={port.key}
          id={buildHandleId('out', port.key)}
          type="source"
          position={Position.Right}
          style={buildHandleStyle({ side: 'output', top: getPortOffset(index, outputPorts.length), color: getPortTypeColor(port.data_type) })}
          title={buildPortTooltip(port, connectedOutputKeys.has(port.key) ? 'linked' : 'open')}
        />
      ))}
    </div>
  )
}
