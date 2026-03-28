import type { CSSProperties } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Badge } from '@/components/ui/badge'
import { buildHandleId, getModuleColor, getPortOffset, type ModuleGraphNode } from '../module-graph-shared'

/** Render a module node with typed input/output handles. */
export function ModuleGraphNodeCard({ data }: NodeProps<ModuleGraphNode>) {
  const { module } = data
  const inputPorts = module.exposed_inputs ?? []
  const outputPorts = module.output_ports ?? []
  const accentColor = getModuleColor(module)
  const executionStatus = data.executionStatus || 'idle'

  const statusLabel =
    executionStatus === 'completed'
      ? 'done'
      : executionStatus === 'failed'
        ? 'failed'
        : executionStatus === 'blocked'
          ? 'blocked'
          : null

  const statusBorderColor =
    executionStatus === 'completed'
      ? '#7bd88f'
      : executionStatus === 'failed'
        ? '#ff8a80'
        : executionStatus === 'blocked'
          ? '#ffd180'
          : `${accentColor}66`

  return (
    <div
      className="min-w-[240px] rounded-sm border bg-surface-container px-4 py-3 text-foreground shadow-lg"
      style={{ borderColor: statusBorderColor, boxShadow: `0 0 0 1px ${accentColor}22` } as CSSProperties}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{module.engine_type}</div>
          <div className="mt-1 text-sm font-semibold text-foreground">{module.name}</div>
        </div>
        <div className="flex items-center gap-2">
          {statusLabel ? <Badge variant="secondary">{statusLabel}</Badge> : null}
          <Badge variant="outline">v{module.version}</Badge>
        </div>
      </div>

      <div className="mt-3 grid gap-1 text-xs text-muted-foreground">
        {inputPorts.length > 0 ? <div>입력 {inputPorts.length}</div> : <div>입력 없음</div>}
        {outputPorts.length > 0 ? <div>출력 {outputPorts.length}</div> : <div>출력 없음</div>}
        {typeof data.executionArtifactCount === 'number' && data.executionArtifactCount > 0 ? <div>아티팩트 {data.executionArtifactCount}</div> : null}
      </div>

      {inputPorts.map((port, index) => (
        <Handle
          key={port.key}
          id={buildHandleId('in', port.key)}
          type="target"
          position={Position.Left}
          style={{ top: getPortOffset(index, inputPorts.length), background: accentColor }}
          title={`${port.label} (${port.data_type})`}
        />
      ))}

      {outputPorts.map((port, index) => (
        <Handle
          key={port.key}
          id={buildHandleId('out', port.key)}
          type="source"
          position={Position.Right}
          style={{ top: getPortOffset(index, outputPorts.length), background: accentColor }}
          title={`${port.label} (${port.data_type})`}
        />
      ))}
    </div>
  )
}
