import { useState, type CSSProperties, type MouseEvent, type SyntheticEvent } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronRight, Play, RotateCcw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleRow } from '@/components/ui/toggle-row'
import { ImageAttachmentPickerButton } from '@/features/image-generation/components/image-attachment-picker'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import type { ModulePortDefinition } from '@/lib/api'
import {
  WORKFLOW_INPUT_ENABLED_KEY,
  WORKFLOW_INPUT_REQUIRED_KEY,
  isWorkflowInputEnabledForNode,
  isWorkflowInputSourceModule,
} from '../module-graph-workflow-inputs'
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
  requiredMissingLabel?: string
}

/** Check whether a node input has any explicit or default value. */
function hasMeaningfulValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}

/** Flag prompt/text ports that can bridge within the string family. */
function isStringBridgePort(dataType: ModulePortDefinition['data_type']) {
  return dataType === 'text' || dataType === 'prompt'
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

/** Render one standard left/right port row for general modules. */
function PortCell({ port, side, accentColor, connected, satisfied, requiredMissing, requiredMissingLabel = '입력 필요' }: PortCellProps) {
  if (!port) {
    return <div className="min-h-[34px] rounded-sm border border-dashed border-border/35 bg-surface-low/20" aria-hidden="true" />
  }

  const portTypeColor = getPortTypeColor(port.data_type)
  const statusLabel = requiredMissing ? requiredMissingLabel : connected ? '연결됨' : satisfied ? '설정됨' : '대기'
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

/** Render one top-side output port for workflow source nodes. */
function SourceNodeOutputPort({ port, connected, accentColor }: { port: ModulePortDefinition; connected: boolean; accentColor: string }) {
  const portTypeColor = getPortTypeColor(port.data_type)
  const statusLabel = connected ? '연결됨' : '대기'
  const borderColor = connected ? `${portTypeColor}99` : `${accentColor}30`
  const backgroundColor = connected ? `${portTypeColor}10` : 'rgba(148, 163, 184, 0.06)'

  return (
    <div className="mt-2.5 space-y-1">
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">출력 연결</div>
      <div
        className="relative min-h-[36px] rounded-sm border pl-3 pr-4"
        style={{ borderColor, backgroundColor } as CSSProperties}
        title={buildPortTooltip(port, statusLabel)}
      >
        <Handle
          id={buildHandleId('out', port.key)}
          type="source"
          position={Position.Right}
          style={buildHandleStyle({ side: 'output', color: portTypeColor })}
          title={buildPortTooltip(port, statusLabel)}
        />

        <div className="flex min-h-[34px] items-center justify-between gap-2">
          <span className="truncate text-xs font-medium text-foreground">{port.label}</span>
          <Badge
            variant="outline"
            className="shrink-0 px-1.5 py-0 text-[9px] font-medium uppercase tracking-[0.08em]"
            style={{ borderColor: `${portTypeColor}66`, color: portTypeColor } as CSSProperties}
          >
            {PORT_TYPE_LABELS[port.data_type]}
          </Badge>
        </div>
      </div>
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
  const workflowInputRequired = Boolean(data.inputValues?.[WORKFLOW_INPUT_REQUIRED_KEY])
  const hasExplicitValue = hasMeaningfulValue(rawValue)

  const handleValueChange = (value: unknown) => {
    data.onNodeValueChange?.(id, sourcePort.key, value)
  }

  const handleValueClear = () => {
    data.onNodeValueClear?.(id, sourcePort.key)
  }

  return (
    <div className="nodrag nowheel mt-2.5 space-y-2.5 rounded-sm border border-border/70 bg-background/40 p-2.5" onMouseDown={stopNodeInteraction}>
      <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">직접 값 설정</div>

      <div className="grid gap-2">
        <ToggleRow variant="detail" className="nodrag nowheel justify-between px-2.5 py-2" onMouseDown={stopNodeInteraction}>
          <div className="min-w-0 text-xs font-medium text-foreground">실행 입력으로 노출</div>
          <input
            type="checkbox"
            checked={workflowInputEnabled}
            onChange={(event) => data.onNodeValueChange?.(id, WORKFLOW_INPUT_ENABLED_KEY, event.target.checked)}
            onMouseDown={stopNodeInteraction}
            className="h-4 w-4 shrink-0 accent-primary"
          />
        </ToggleRow>

        {workflowInputEnabled ? (
          <ToggleRow variant="detail" className="nodrag nowheel justify-between px-2.5 py-2" onMouseDown={stopNodeInteraction}>
            <div className="min-w-0 text-xs font-medium text-foreground">실행 시 필수</div>
            <input
              type="checkbox"
              checked={workflowInputRequired}
              onChange={(event) => data.onNodeValueChange?.(id, WORKFLOW_INPUT_REQUIRED_KEY, event.target.checked)}
              onMouseDown={stopNodeInteraction}
              className="h-4 w-4 shrink-0 accent-primary"
            />
          </ToggleRow>
        ) : null}
      </div>

      {(sourcePort.data_type === 'prompt' || sourcePort.data_type === 'text' || sourcePort.data_type === 'json') ? (
        <Textarea
          rows={sourcePort.data_type === 'json' ? 4 : 3}
          value={typeof rawValue === 'string' ? rawValue : rawValue ? JSON.stringify(rawValue, null, 2) : ''}
          onChange={(event) => handleValueChange(event.target.value)}
          onMouseDown={stopNodeInteraction}
          placeholder={sourcePort.label}
          className="text-sm"
        />
      ) : null}

      {sourcePort.data_type === 'number' ? (
        <Input
          type="number"
          value={typeof rawValue === 'number' ? String(rawValue) : typeof rawValue === 'string' ? rawValue : ''}
          onChange={(event) => handleValueChange(event.target.value === '' ? '' : Number(event.target.value))}
          onMouseDown={stopNodeInteraction}
          placeholder={sourcePort.label}
        />
      ) : null}

      {sourcePort.data_type === 'boolean' ? (
        <Select
          value={typeof rawValue === 'boolean' ? String(rawValue) : ''}
          onChange={(event) => handleValueChange(event.target.value === 'true')}
          onMouseDown={stopNodeInteraction}
        >
          <option value="">선택</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </Select>
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
    <div className="rounded-sm bg-surface-high px-2 py-1.5 text-[11px] leading-4 text-foreground">
      <div className="max-h-[6.25rem] overflow-hidden whitespace-pre-wrap break-words [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:5]">{preview}</div>
      {canOpen ? (
        <div className="mt-2 flex justify-end">
          <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onMouseDown={stopNodeActionEvent} onClick={onOpen}>
            전체 보기
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** Render a cleaner module graph node card with source-node specific layout. */
export function ModuleGraphNodeCard({ id, data, selected }: NodeProps<ModuleGraphNode>) {
  const { module } = data
  const [expandedOutputGroupKeys, setExpandedOutputGroupKeys] = useState<string[]>([])
  const [artifactTextModal, setArtifactTextModal] = useState<{ title: string; text: string } | null>(null)
  const inputPorts = module.exposed_inputs ?? []
  const outputPorts = module.output_ports ?? []
  const accentColor = getModuleColor(module)
  const executionStatus = data.executionStatus || 'idle'
  const portRowCount = Math.max(inputPorts.length, outputPorts.length, 1)
  const connectedInputKeys = new Set(data.connectedInputKeys ?? [])
  const connectedOutputKeys = new Set(data.connectedOutputKeys ?? [])
  const connectedInputCount = connectedInputKeys.size
  const connectedOutputCount = connectedOutputKeys.size
  const isWorkflowInputSource = isWorkflowInputSourceModule(module)
  const sourceValuePort = isWorkflowInputSource ? inputPorts[0] ?? null : null
  const sourceOutputPort = isWorkflowInputSource ? outputPorts[0] ?? null : null
  const sourceValueConfigured = Boolean(sourceValuePort && (hasMeaningfulValue(data.inputValues?.[sourceValuePort.key]) || hasMeaningfulValue(sourceValuePort.default_value)))
  const missingRequiredInputCount = inputPorts.filter((port) => {
    const connected = connectedInputKeys.has(port.key)
    const explicitValue = hasMeaningfulValue(data.inputValues?.[port.key])
    const defaultValue = hasMeaningfulValue(port.default_value)
    return port.required && !connected && !explicitValue && !defaultValue
  }).length

  const missingStatusLabel = isWorkflowInputSource ? '값 필요' : '입력 필요'
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
  const outputGroups = data.executionOutputGroups ?? []
  const hasOutputGroups = outputGroups.length > 0
  const hasStandaloneArtifactPreview = hasArtifactPreview && !hasOutputGroups
  const isFinalResult = isFinalResultModule(module)
  const summaryText = isWorkflowInputSource
    ? `${ENGINE_TYPE_LABELS[module.engine_type] ?? module.engine_type} · 값 ${sourceValueConfigured ? 1 : 0}/${sourceValuePort ? 1 : 0} · 출력 ${connectedOutputCount}/${sourceOutputPort ? 1 : outputPorts.length}`
    : `${ENGINE_TYPE_LABELS[module.engine_type] ?? module.engine_type} · 입력 ${connectedInputCount}/${inputPorts.length} · 출력 ${connectedOutputCount}/${outputPorts.length}`

  return (
    <div
      className="w-[340px] max-w-[340px] rounded-sm border bg-surface-container px-3 py-2.5 text-foreground shadow-lg"
      style={{
        borderColor: selected ? accentColor : statusBorderColor,
        boxShadow: selected ? `0 0 0 2px ${accentColor}66, 0 0 0 1px ${accentColor}22` : `0 0 0 1px ${accentColor}22`,
      } as CSSProperties}
      title={`${module.name}\n모듈 ID: ${module.id}${module.description ? `\n${module.description}` : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-foreground">{module.name}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {summaryText}
            {missingRequiredInputCount > 0 ? ` · 미설정 ${missingRequiredInputCount}` : ''}
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

      {isWorkflowInputSource && sourceOutputPort ? <SourceNodeOutputPort port={sourceOutputPort} connected={connectedOutputKeys.has(sourceOutputPort.key)} accentColor={accentColor} /> : null}
      {isWorkflowInputSource ? <InlineWorkflowInputEditor id={id} data={data} /> : null}

      {!isWorkflowInputSource ? (
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
      ) : null}

      {hasStandaloneArtifactPreview ? (
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
            <ArtifactTextPreviewCard
              preview={data.latestArtifactTextPreview}
              fullText={data.latestArtifactTextValue}
              onOpen={() =>
                setArtifactTextModal({
                  title: data.latestArtifactLabel || `${module.name} output`,
                  text: data.latestArtifactTextValue ?? data.latestArtifactTextPreview ?? '',
                })
              }
            />
          ) : null}
        </div>
      ) : null}

      {hasOutputGroups ? (
        <div className="mt-2.5 space-y-2">
          {outputGroups.map((group) => {
            const isExpanded = expandedOutputGroupKeys.includes(group.portKey)

            return (
              <div key={group.portKey} className="rounded-sm border border-border/70 bg-surface-low p-2">
                <button
                  type="button"
                  className="nodrag nowheel flex w-full items-center justify-between gap-2 text-left"
                  onMouseDown={stopNodeActionEvent}
                  onClick={(event) => {
                    stopNodeActionEvent(event)
                    setExpandedOutputGroupKeys((current) => (
                      current.includes(group.portKey)
                        ? current.filter((key) => key !== group.portKey)
                        : [...current, group.portKey]
                    ))
                  }}
                  title={`${group.portLabel} 출력 보기`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {isExpanded ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-medium text-foreground">{group.portLabel}</div>
                      <div className="truncate text-[10px] text-muted-foreground">{group.portKey}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {group.portType ? (
                      <Badge variant="outline" className="px-1.5 py-0 text-[9px] uppercase tracking-[0.08em]">
                        {PORT_TYPE_LABELS[group.portType]}
                      </Badge>
                    ) : null}
                    <Badge variant="secondary" className="px-1.5 py-0 text-[9px]">{group.artifactCount}</Badge>
                  </div>
                </button>

                {isExpanded ? (
                  <div className="mt-2 space-y-2">
                    {group.latestArtifactPreviewUrl ? (
                      <div className="overflow-hidden rounded-sm border border-border/60 bg-surface-lowest">
                        <InlineMediaPreview
                          src={group.latestArtifactPreviewUrl}
                          alt={group.latestArtifactLabel || `${module.name} ${group.portLabel}`}
                          frameClassName="p-1.5"
                          mediaClassName="max-h-28 w-full object-contain"
                        />
                      </div>
                    ) : group.latestArtifactTextPreview ? (
                      <ArtifactTextPreviewCard
                        preview={group.latestArtifactTextPreview}
                        fullText={group.latestArtifactTextValue}
                        onOpen={() =>
                          setArtifactTextModal({
                            title: `${module.name} · ${group.portLabel}`,
                            text: group.latestArtifactTextValue ?? group.latestArtifactTextPreview ?? '',
                          })
                        }
                      />
                    ) : null}
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
        description="긴 출력 전문 보기"
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
