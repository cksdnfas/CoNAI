import { useState, type CSSProperties, type MouseEvent } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronRight, Play, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import type { ModulePortDefinition } from '@/lib/api'
import { buildHandleId, getModuleColor, getPortTypeColor, isFinalResultModule, type ModuleGraphNode } from '../module-graph-shared'

const PORT_TYPE_LABELS: Record<ModulePortDefinition['data_type'], string> = {
  image: '이미지',
  mask: '마스크',
  prompt: '프롬프트',
  text: '텍스트',
  number: '숫자',
  boolean: '불리언',
  json: 'JSON',
  any: '임의',
}

const ENGINE_TYPE_LABELS = {
  nai: 'NAI',
  comfyui: 'ComfyUI',
  system: '시스템',
  custom_js: 'Custom JS',
} as const

const TEXT_PORT_COLOR = getPortTypeColor('text')
const PROMPT_PORT_COLOR = getPortTypeColor('prompt')

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

/** Flag prompt/text ports that can bridge within the string family. */
function isStringBridgePort(dataType: ModulePortDefinition['data_type']) {
  return dataType === 'text' || dataType === 'prompt'
}

/** Build one compact hover tooltip so node cards stay visually clean. */
function buildPortTooltip(port: ModulePortDefinition, statusLabel: string) {
  return [
    port.label,
    `키: ${port.key}`,
    `타입: ${PORT_TYPE_LABELS[port.data_type]}`,
    `상태: ${statusLabel}`,
    isStringBridgePort(port.data_type) ? '브리지: 텍스트 ↔ 프롬프트' : null,
    port.required ? '필수' : null,
    port.multiple ? '다중' : null,
    port.description || null,
  ]
    .filter(Boolean)
    .join('\n')
}

/** Render one port row whose label and handle share the same visual center line. */
function PortCell({ port, side, accentColor, connected, satisfied, requiredMissing }: PortCellProps) {
  if (!port) {
    return <div className="min-h-[34px] rounded-sm border border-dashed border-border/35 bg-surface-low/20" aria-hidden="true" />
  }

  const portTypeColor = getPortTypeColor(port.data_type)
  const statusLabel = requiredMissing ? '입력 필요' : connected ? '연결됨' : satisfied ? '설정됨' : '대기'
  const borderColor = requiredMissing ? '#f59e0b99' : connected ? `${portTypeColor}99` : `${accentColor}30`
  const backgroundColor = requiredMissing ? 'rgba(245, 158, 11, 0.10)' : connected ? `${portTypeColor}10` : 'rgba(148, 163, 184, 0.06)'
  const alignmentClass = side === 'input' ? 'pl-4 pr-2' : 'pl-2 pr-4'
  const labelAlignmentClass = side === 'input' ? 'text-left' : 'text-right'
  const rowJustifyClass = side === 'input' ? 'justify-start' : 'justify-end'
  const usesStringBridgeBadge = isStringBridgePort(port.data_type)

  return (
    <div
      className={`relative min-h-[34px] rounded-sm border ${alignmentClass}`}
      style={{ borderColor, backgroundColor } as CSSProperties}
      title={buildPortTooltip(port, statusLabel)}
    >
      <Handle
        id={buildHandleId(side === 'input' ? 'in' : 'out', port.key)}
        type={side === 'input' ? 'target' : 'source'}
        position={side === 'input' ? Position.Left : Position.Right}
        style={buildHandleStyle({ side, color: portTypeColor })}
        title={buildPortTooltip(port, statusLabel)}
      />

      <div className={`flex min-h-[32px] items-center gap-2 ${rowJustifyClass}`}>
        <span className={`min-w-0 flex-1 truncate text-[11px] font-medium text-foreground ${labelAlignmentClass}`}>
          {port.label}
          {port.required ? <span className="ml-1 text-[11px] text-amber-300">*</span> : null}
        </span>
        {usesStringBridgeBadge ? (
          <span
            className="shrink-0 rounded-sm border px-1.5 py-0 text-[9px] font-semibold uppercase tracking-[0.08em]"
            style={{
              borderColor: `${portTypeColor}66`,
              color: portTypeColor,
              background: `linear-gradient(90deg, ${TEXT_PORT_COLOR}16 0 50%, ${PROMPT_PORT_COLOR}16 50% 100%)`,
            } as CSSProperties}
          >
            T↔P
          </span>
        ) : (
          <Badge
            variant="outline"
            className="shrink-0 px-1.5 py-0 text-[9px] font-medium uppercase tracking-[0.08em]"
            style={{ borderColor: `${portTypeColor}66`, color: portTypeColor } as CSSProperties}
          >
            {PORT_TYPE_LABELS[port.data_type]}
          </Badge>
        )}
      </div>
    </div>
  )
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

/** Prevent node-card action buttons from also triggering canvas drag/selection side effects. */
function stopNodeActionEvent(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
  event.stopPropagation()
}

/** Render a cleaner module graph node card with compact ports and hover-only details. */
export function ModuleGraphNodeCard({ data }: NodeProps<ModuleGraphNode>) {
  const { module } = data
  const [outputsExpanded, setOutputsExpanded] = useState(false)
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
      ? '완료'
      : executionStatus === 'failed'
        ? '실패'
        : executionStatus === 'blocked'
          ? '차단됨'
          : missingRequiredInputCount > 0
            ? '입력 필요'
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
  const outputGroups = data.executionOutputGroups ?? []
  const hasOutputGroups = outputGroups.length > 0
  const isFinalResult = isFinalResultModule(module)

  return (
    <div
      className="min-w-[280px] rounded-sm border bg-surface-container px-3 py-2.5 text-foreground shadow-lg"
      style={{ borderColor: statusBorderColor, boxShadow: `0 0 0 1px ${accentColor}22` } as CSSProperties}
      title={`${module.name}\n모듈 ID: ${module.id}${module.description ? `\n${module.description}` : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{module.name}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {(ENGINE_TYPE_LABELS[module.engine_type] ?? module.engine_type)} · 입력 {connectedInputCount}/{inputPorts.length} · 출력 {connectedOutputCount}/{outputPorts.length}
            {missingRequiredInputCount > 0 ? ` · 미입력 ${missingRequiredInputCount}` : ''}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
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
              size="sm"
              className="h-7 px-2 text-[11px]"
              disabled={data.executeNodeDisabled}
              onMouseDown={stopNodeActionEvent}
              onClick={(event) => {
                stopNodeActionEvent(event)
                data.onExecuteNode?.()
              }}
            >
              <Play className="h-3.5 w-3.5" />
              실행
            </Button>
          ) : null}
          {data.onForceExecuteNode ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={data.executeNodeDisabled}
              onMouseDown={stopNodeActionEvent}
              onClick={(event) => {
                stopNodeActionEvent(event)
                data.onForceExecuteNode?.()
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              재실행
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-2.5 grid gap-1">
        {Array.from({ length: portRowCount }, (_, index) => {
          const inputPort = inputPorts[index]
          const outputPort = outputPorts[index]
          const inputConnected = Boolean(inputPort && connectedInputKeys.has(inputPort.key))
          const inputSatisfied = Boolean(inputPort && (inputConnected || hasMeaningfulValue(data.inputValues?.[inputPort.key]) || hasMeaningfulValue(inputPort.default_value)))
          const inputRequiredMissing = Boolean(inputPort && inputPort.required && !inputSatisfied)
          const outputConnected = Boolean(outputPort && connectedOutputKeys.has(outputPort.key))

          return (
            <div key={`port-row-${index}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
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

      {hasArtifactPreview ? (
        <div className="mt-2.5 rounded-sm border border-border/70 bg-surface-low p-2">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
            {data.executionReuseState === 'reused' ? 'cached artifact' : data.latestArtifactLabel || 'latest artifact'}
          </div>
          {data.latestArtifactPreviewUrl ? (
            <InlineMediaPreview
              src={data.latestArtifactPreviewUrl}
              alt={data.latestArtifactLabel || `${module.name} output`}
              frameClassName="p-2"
              mediaClassName="max-h-40 w-full object-contain"
            />
          ) : data.latestArtifactTextPreview ? (
            <div className="rounded-sm bg-surface-high px-2 py-1.5 text-[11px] leading-4 text-foreground break-words">
              {data.latestArtifactTextPreview}
            </div>
          ) : null}
        </div>
      ) : null}

      {hasOutputGroups ? (
        <div className="mt-2.5 rounded-sm border border-border/70 bg-surface-low p-2">
          <button
            type="button"
            className="nodrag nowheel flex w-full items-center justify-between gap-2 text-left"
            onMouseDown={stopNodeActionEvent}
            onClick={(event) => {
              stopNodeActionEvent(event)
              setOutputsExpanded((current) => !current)
            }}
            title="포트별 출력 보기"
          >
            <div className="flex items-center gap-2">
              {outputsExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">node outputs</span>
            </div>
            <Badge variant="outline">{outputGroups.length}</Badge>
          </button>

          {outputsExpanded ? (
            <div className="mt-2 space-y-2">
              {outputGroups.map((group) => (
                <div key={group.portKey} className="rounded-sm border border-border/60 bg-surface-high px-2 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-medium text-foreground">{group.portLabel}</div>
                      <div className="text-[10px] text-muted-foreground">{group.portKey}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {group.portType ? (
                        <Badge variant="outline" className="px-1.5 py-0 text-[9px] uppercase tracking-[0.08em]">
                          {PORT_TYPE_LABELS[group.portType]}
                        </Badge>
                      ) : null}
                      <Badge variant="secondary" className="px-1.5 py-0 text-[9px]">{group.artifactCount}</Badge>
                    </div>
                  </div>

                  {group.latestArtifactPreviewUrl ? (
                    <div className="mt-2 overflow-hidden rounded-sm border border-border/60 bg-surface-lowest">
                      <InlineMediaPreview
                        src={group.latestArtifactPreviewUrl}
                        alt={group.latestArtifactLabel || `${module.name} ${group.portLabel}`}
                        frameClassName="p-1.5"
                        mediaClassName="max-h-24 w-full object-contain"
                      />
                    </div>
                  ) : group.latestArtifactTextPreview ? (
                    <div className="mt-2 rounded-sm bg-surface-low px-2 py-1.5 text-[11px] leading-4 text-foreground break-words">
                      {group.latestArtifactTextPreview}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
