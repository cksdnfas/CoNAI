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

/** Render one visible port row so graph nodes show each port label and type without hover. */
function PortCell({ port, side, accentColor, connected, satisfied, requiredMissing }: PortCellProps) {
  if (!port) {
    return <div className="min-h-[54px] rounded-sm border border-dashed border-border/40 bg-surface-low/30" aria-hidden="true" />
  }

  const alignClass = side === 'input' ? 'items-start text-left' : 'items-end text-right'
  const badgeWrapClass = side === 'input' ? 'justify-start' : 'justify-end'
  const markerJustifyClass = side === 'input' ? 'justify-start' : 'justify-end'
  const portTypeColor = getPortTypeColor(port.data_type)
  const statusLabel = requiredMissing ? 'needs input' : connected ? 'linked' : satisfied ? 'set' : 'open'
  const borderColor = requiredMissing ? '#f59e0b99' : connected ? `${portTypeColor}88` : `${accentColor}33`
  const backgroundColor = requiredMissing ? 'rgba(245, 158, 11, 0.08)' : connected ? undefined : 'rgba(148, 163, 184, 0.08)'

  return (
    <div
      className={`min-h-[54px] rounded-sm border px-2.5 py-2 ${alignClass}`}
      style={{ borderColor, backgroundColor } as CSSProperties}
      title={port.description || `${port.label} (${port.data_type})`}
    >
      <div className={`flex w-full ${markerJustifyClass}`}>
        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: portTypeColor, boxShadow: connected ? `0 0 0 3px ${portTypeColor}22` : 'none' }} aria-hidden="true" />
      </div>
      <div className="mt-1 w-full truncate text-xs font-medium text-foreground">{port.label}</div>
      <div className={`mt-1 flex w-full flex-wrap gap-1 ${badgeWrapClass}`}>
        <Badge variant="outline" style={{ borderColor: `${portTypeColor}88`, color: portTypeColor } as CSSProperties}>{PORT_TYPE_LABELS[port.data_type]}</Badge>
        <Badge variant="secondary">{port.key}</Badge>
        <Badge variant={connected || satisfied ? 'secondary' : 'outline'}>{statusLabel}</Badge>
        {port.required ? <Badge variant="outline">required</Badge> : null}
        {port.multiple ? <Badge variant="outline">multi</Badge> : null}
      </div>
      {port.description ? <div className="mt-1 line-clamp-2 w-full text-[11px] text-muted-foreground">{port.description}</div> : null}
    </div>
  )
}

/** Render a module node with visible typed port rows so users can identify graph connections quickly. */
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
      className="min-w-[340px] rounded-sm border bg-surface-container px-4 py-3 text-foreground shadow-lg"
      style={{ borderColor: statusBorderColor, boxShadow: `0 0 0 1px ${accentColor}22` } as CSSProperties}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{module.engine_type}</div>
          <div className="mt-1 truncate text-sm font-semibold text-foreground">{module.name}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">node · {module.id}</div>
        </div>
        <div className="flex items-center gap-2">
          {statusLabel ? <Badge variant="secondary">{statusLabel}</Badge> : null}
          <Badge variant="outline">v{module.version}</Badge>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
        <Badge variant="outline">입력 {connectedInputCount}/{inputPorts.length}</Badge>
        <Badge variant="outline">출력 {connectedOutputCount}/{outputPorts.length}</Badge>
        {missingRequiredInputCount > 0 ? <Badge variant="outline">필수 부족 {missingRequiredInputCount}</Badge> : null}
        {typeof data.executionArtifactCount === 'number' && data.executionArtifactCount > 0 ? <Badge variant="outline">아티팩트 {data.executionArtifactCount}</Badge> : null}
      </div>

      <div className="mt-4 grid gap-2">
        {Array.from({ length: portRowCount }, (_, index) => {
          const inputPort = inputPorts[index]
          const outputPort = outputPorts[index]
          const inputConnected = Boolean(inputPort && connectedInputKeys.has(inputPort.key))
          const inputSatisfied = Boolean(inputPort && (inputConnected || hasMeaningfulValue(data.inputValues?.[inputPort.key]) || hasMeaningfulValue(inputPort.default_value)))
          const inputRequiredMissing = Boolean(inputPort && inputPort.required && !inputSatisfied)
          const outputConnected = Boolean(outputPort && connectedOutputKeys.has(outputPort.key))

          return (
            <div key={`port-row-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
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
          style={{ top: getPortOffset(index, inputPorts.length), background: getPortTypeColor(port.data_type) }}
          title={`${port.label} (${port.data_type})`}
        />
      ))}

      {outputPorts.map((port, index) => (
        <Handle
          key={port.key}
          id={buildHandleId('out', port.key)}
          type="source"
          position={Position.Right}
          style={{ top: getPortOffset(index, outputPorts.length), background: getPortTypeColor(port.data_type) }}
          title={`${port.label} (${port.data_type})`}
        />
      ))}
    </div>
  )
}
