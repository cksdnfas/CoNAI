import { useMemo, useRef, useState } from 'react'
import { CircleHelp, Eye, Play, RotateCcw, Square } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import type {
  GraphExecutionArtifactRecord,
  GraphExecutionLogRecord,
  GraphExecutionRecord,
  GraphWorkflowExposedInput,
  GraphWorkflowRecord,
} from '@/lib/api'
import {
  buildArtifactTextPreview,
  formatDateTime,
  getArtifactPreviewUrl,
  getArtifactStoredValue,
  parseMetadataValue,
} from '../module-graph-shared'
import { cn } from '@/lib/utils'

type GraphExecutionDetail = {
  execution: GraphExecutionRecord
  artifacts: GraphExecutionArtifactRecord[]
  logs: GraphExecutionLogRecord[]
}

type ParsedExecutionPlan = {
  orderedNodeIds?: string[]
  targetNodeId?: string | null
  runtimeInputSignature?: string | null
  runtimeInputValues?: Record<string, unknown>
  forceRerun?: boolean
  reusedFromExecutionId?: number | null
  reusedNodeIds?: string[]
  inputValues?: Record<string, unknown>
  input_values?: Record<string, unknown>
  runtimeInputs?: Record<string, unknown>
  runtime_inputs?: Record<string, unknown>
  resolvedInputs?: Record<string, unknown>
  resolved_inputs?: Record<string, unknown>
}

type ExecutionInputEntry = {
  key: string
  label: string
  value: unknown
}

type ExecutionDetailSectionKey = 'summary' | 'inputs' | 'artifacts' | 'logs'

function TechnicalReferenceHint({ title, label }: { title: string; label: string }) {
  return (
    <span className="inline-flex cursor-help text-muted-foreground" title={title} aria-label={label}>
      <CircleHelp className="h-3.5 w-3.5" />
    </span>
  )
}

function parseExecutionPlan(value?: string | null): ParsedExecutionPlan | null {
  if (!value) {
    return null
  }

  try {
    return JSON.parse(value) as ParsedExecutionPlan
  } catch {
    return null
  }
}

function getExecutionModeLabel(plan: ParsedExecutionPlan | null) {
  if (plan?.targetNodeId) {
    return plan.forceRerun ? '강제 노드 재실행' : '선택 노드 실행'
  }

  return '워크플로우 실행'
}

function getExecutionInputCandidate(plan: ParsedExecutionPlan | null) {
  return (
    plan?.runtimeInputValues
    ?? plan?.inputValues
    ?? plan?.input_values
    ?? plan?.runtimeInputs
    ?? plan?.runtime_inputs
    ?? plan?.resolvedInputs
    ?? plan?.resolved_inputs
    ?? null
  )
}

function formatPrimitiveValue(value: unknown) {
  if (value === null || value === undefined) {
    return '없음'
  }

  if (typeof value === 'boolean') {
    return value ? '예' : '아니오'
  }

  if (typeof value === 'number') {
    return String(value)
  }

  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) {
      return '이미지 데이터'
    }

    return value
  }

  return JSON.stringify(value)
}

function summarizeStructuredValue(value: unknown, maxEntries = 4) {
  if (!value || typeof value !== 'object') {
    return [] as string[]
  }

  if (Array.isArray(value)) {
    return value.slice(0, maxEntries).map((entry, index) => `${index + 1}. ${formatPrimitiveValue(entry)}`)
  }

  return Object.entries(value)
    .slice(0, maxEntries)
    .map(([key, entryValue]) => `${key}: ${formatPrimitiveValue(entryValue)}`)
}

function buildArtifactSummaryText(artifact: GraphExecutionArtifactRecord) {
  const storedValue = getArtifactStoredValue(artifact)
  if (storedValue === null || storedValue === undefined) {
    return null
  }

  if (typeof storedValue === 'string' || typeof storedValue === 'number' || typeof storedValue === 'boolean') {
    return buildArtifactTextPreview(artifact, 220) ?? formatPrimitiveValue(storedValue)
  }

  const structuredLines = summarizeStructuredValue(storedValue)
  if (structuredLines.length > 0) {
    return structuredLines.join(' · ')
  }

  return buildArtifactTextPreview(artifact, 220)
}

function buildArtifactDetailLines(artifact: GraphExecutionArtifactRecord) {
  const storedValue = getArtifactStoredValue(artifact)
  const lines = summarizeStructuredValue(storedValue, 6)
  if (lines.length > 0) {
    return lines
  }

  const summaryText = buildArtifactSummaryText(artifact)
  return summaryText ? [summaryText] : []
}

function buildInputLabelMap(inputDefinitions: GraphWorkflowExposedInput[]) {
  return new Map(inputDefinitions.map((inputDefinition) => [inputDefinition.id, inputDefinition.label]))
}

function getExecutionInputEntries(plan: ParsedExecutionPlan | null, inputDefinitions: GraphWorkflowExposedInput[]) {
  const candidate = getExecutionInputCandidate(plan)
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return [] as ExecutionInputEntry[]
  }

  const labelMap = buildInputLabelMap(inputDefinitions)
  return Object.entries(candidate).map(([key, value]) => ({
    key,
    label: labelMap.get(key) ?? key,
    value,
  }))
}

function getNodeDisplayLabel(selectedGraph: GraphWorkflowRecord | null | undefined, nodeId: string) {
  const nodeRecord = selectedGraph?.graph.nodes.find((node) => node.id === nodeId)
  const explicitLabel = nodeRecord?.label?.trim()
  if (explicitLabel) {
    return explicitLabel
  }

  return `노드 ${nodeId}`
}

function groupArtifactsByNode(artifacts: GraphExecutionArtifactRecord[], selectedGraph?: GraphWorkflowRecord | null) {
  const groupMap = new Map<string, GraphExecutionArtifactRecord[]>()

  for (const artifact of artifacts) {
    const current = groupMap.get(artifact.node_id) ?? []
    current.push(artifact)
    groupMap.set(artifact.node_id, current)
  }

  return Array.from(groupMap.entries())
    .map(([nodeId, nodeArtifacts]) => ({
      nodeId,
      nodeLabel: getNodeDisplayLabel(selectedGraph, nodeId),
      artifacts: [...nodeArtifacts].sort((left, right) => new Date(right.created_date).getTime() - new Date(left.created_date).getTime()),
    }))
    .sort((left, right) => {
      const leftTime = new Date(left.artifacts[0]?.created_date ?? 0).getTime()
      const rightTime = new Date(right.artifacts[0]?.created_date ?? 0).getTime()
      return rightTime - leftTime
    })
}

function pickHighlightedArtifacts(artifacts: GraphExecutionArtifactRecord[]) {
  const sortedArtifacts = [...artifacts].sort((left, right) => new Date(right.created_date).getTime() - new Date(left.created_date).getTime())
  const visualArtifacts = sortedArtifacts.filter((artifact) => (artifact.artifact_type === 'image' || artifact.artifact_type === 'mask') && getArtifactPreviewUrl(artifact))

  if (visualArtifacts.length > 0) {
    return visualArtifacts.slice(0, 4)
  }

  return sortedArtifacts.slice(0, 4)
}

function getTerminalNodeIds(selectedGraph?: GraphWorkflowRecord | null) {
  if (!selectedGraph) {
    return [] as string[]
  }

  const sourceNodeIds = new Set(selectedGraph.graph.edges.map((edge) => edge.source_node_id))
  return selectedGraph.graph.nodes
    .filter((node) => !sourceNodeIds.has(node.id))
    .map((node) => node.id)
}

function pickFinalArtifacts(params: {
  artifacts: GraphExecutionArtifactRecord[]
  executionPlan: ParsedExecutionPlan | null
  selectedGraph?: GraphWorkflowRecord | null
}) {
  const { artifacts, executionPlan, selectedGraph } = params
  const sortedArtifacts = [...artifacts].sort((left, right) => new Date(right.created_date).getTime() - new Date(left.created_date).getTime())
  if (sortedArtifacts.length === 0) {
    return [] as GraphExecutionArtifactRecord[]
  }

  const artifactNodeIds = new Set(sortedArtifacts.map((artifact) => artifact.node_id))
  const preferredNodeIds: string[] = []

  if (executionPlan?.targetNodeId) {
    preferredNodeIds.push(executionPlan.targetNodeId)
  }

  const terminalNodeIds = getTerminalNodeIds(selectedGraph)
  for (const nodeId of terminalNodeIds) {
    if (artifactNodeIds.has(nodeId)) {
      preferredNodeIds.push(nodeId)
    }
  }

  const orderedNodeIds = [...(executionPlan?.orderedNodeIds ?? [])].reverse()
  for (const nodeId of orderedNodeIds) {
    if (artifactNodeIds.has(nodeId)) {
      preferredNodeIds.push(nodeId)
      break
    }
  }

  const uniquePreferredNodeIds = preferredNodeIds.filter((nodeId, index) => preferredNodeIds.indexOf(nodeId) === index)
  if (uniquePreferredNodeIds.length > 0) {
    const finalArtifacts = sortedArtifacts.filter((artifact) => uniquePreferredNodeIds.includes(artifact.node_id))
    if (finalArtifacts.length > 0) {
      return pickHighlightedArtifacts(finalArtifacts)
    }
  }

  return pickHighlightedArtifacts(sortedArtifacts)
}

function ExecutionArtifactCard({ artifact, compact = false }: { artifact: GraphExecutionArtifactRecord; compact?: boolean }) {
  const previewUrl = getArtifactPreviewUrl(artifact)
  const summaryText = buildArtifactSummaryText(artifact)
  const detailLines = buildArtifactDetailLines(artifact)

  return (
    <div className={cn('rounded-sm border border-border bg-surface-low p-3', compact ? 'space-y-2' : 'space-y-2.5')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-foreground">{artifact.port_key}</span>
            <Badge variant="outline">{artifact.artifact_type}</Badge>
          </div>
          <div className="text-[11px] text-muted-foreground">{formatDateTime(artifact.created_date)}</div>
        </div>
      </div>

      {previewUrl && (artifact.artifact_type === 'image' || artifact.artifact_type === 'mask') ? (
        <img
          src={previewUrl}
          alt={`${artifact.node_id}-${artifact.port_key}`}
          className={cn('rounded-sm border border-border object-contain', compact ? 'max-h-40 w-full' : 'max-h-52 w-full')}
        />
      ) : null}

      {!previewUrl && summaryText ? <div className="text-sm leading-6 text-foreground whitespace-pre-wrap break-all">{summaryText}</div> : null}

      {previewUrl && detailLines.length > 0 ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          {detailLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

type GraphExecutionPanelProps = {
  selectedGraphId: number | null
  selectedGraph?: GraphWorkflowRecord | null
  selectedExecutionId: number | null
  selectedExecutionStatus?: GraphExecutionRecord['status'] | null
  executionList: GraphExecutionRecord[]
  executionListError: string
  executionListIsError: boolean
  executionDetail: GraphExecutionDetail | undefined
  executionDetailError: string
  executionDetailIsError: boolean
  isExecutingGraph: boolean
  isCancellingExecution: boolean
  onSelectExecution: (executionId: number) => void
  onRerunGraph: () => void
  onRetryExecution: () => void
  onCancelExecution: () => void
  description?: string
  showHeader?: boolean
}

/** Render execution history with a summary-first result surface and opt-in technical detail modal. */
export function GraphExecutionPanel({
  selectedGraphId,
  selectedGraph,
  selectedExecutionId,
  selectedExecutionStatus,
  executionList,
  executionListError,
  executionListIsError,
  executionDetail,
  executionDetailError,
  executionDetailIsError,
  isExecutingGraph,
  isCancellingExecution,
  onSelectExecution,
  onRerunGraph,
  onRetryExecution,
  onCancelExecution,
  description = '최근 실행 상태와 주요 결과를 여기서 확인해.',
  showHeader = true,
}: GraphExecutionPanelProps) {
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const detailSectionRefs = useRef<Record<ExecutionDetailSectionKey, HTMLDivElement | null>>({
    summary: null,
    inputs: null,
    artifacts: null,
    logs: null,
  })

  const queuedExecutions = executionList
    .filter((execution) => execution.status === 'queued')
    .sort((left, right) => (left.queue_position ?? Number.MAX_SAFE_INTEGER) - (right.queue_position ?? Number.MAX_SAFE_INTEGER))
  const runningExecutions = executionList.filter((execution) => execution.status === 'running')
  const queuedCount = queuedExecutions.length
  const runningCount = runningExecutions.length
  const retryable = selectedExecutionStatus === 'failed' || selectedExecutionStatus === 'cancelled'
  const activeRunningExecution = runningExecutions[0] ?? null
  const nextQueuedExecution = queuedExecutions[0] ?? null

  const selectedExecutionPlan = useMemo(
    () => parseExecutionPlan(executionDetail?.execution.execution_plan),
    [executionDetail?.execution.execution_plan],
  )
  const inputDefinitions = selectedGraph?.graph.metadata?.exposed_inputs ?? []
  const executionInputEntries = useMemo(
    () => getExecutionInputEntries(selectedExecutionPlan, inputDefinitions),
    [inputDefinitions, selectedExecutionPlan],
  )
  const groupedArtifacts = useMemo(
    () => groupArtifactsByNode(executionDetail?.artifacts ?? [], selectedGraph),
    [executionDetail?.artifacts, selectedGraph],
  )
  const finalArtifacts = useMemo(
    () => pickFinalArtifacts({ artifacts: executionDetail?.artifacts ?? [], executionPlan: selectedExecutionPlan, selectedGraph }),
    [executionDetail?.artifacts, selectedExecutionPlan, selectedGraph],
  )

  const scrollToDetailSection = (section: ExecutionDetailSectionKey) => {
    detailSectionRefs.current[section]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const actionButtons = (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        onClick={onCancelExecution}
        disabled={isCancellingExecution || (selectedExecutionStatus !== 'queued' && selectedExecutionStatus !== 'running')}
        title={isCancellingExecution ? '취소 요청 중' : '실행 취소'}
        aria-label={isCancellingExecution ? '실행 취소 요청 중' : '실행 취소'}
      >
        <Square className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        onClick={onRetryExecution}
        disabled={!retryable || isExecutingGraph}
        title="다시 시도"
        aria-label="실행 다시 시도"
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        onClick={onRerunGraph}
        disabled={!selectedGraphId || isExecutingGraph}
        title={isExecutingGraph ? '실행 중' : '재실행'}
        aria-label={isExecutingGraph ? '워크플로우 실행 중' : '워크플로우 재실행'}
      >
        <Play className="h-4 w-4" />
      </Button>
    </div>
  )

  return (
    <>
      <Card>
        <CardContent className="space-y-4">
          {showHeader ? (
            <SectionHeading
              variant="inside"
              heading="실행 결과"
              description={description}
              actions={actionButtons}
            />
          ) : null}

          {!showHeader ? <div className="flex justify-end">{actionButtons}</div> : null}

          {!selectedGraphId ? (
            <Alert>
              <AlertTitle>그래프를 먼저 골라줘</AlertTitle>
              <AlertDescription>워크플로우를 먼저 선택해.</AlertDescription>
            </Alert>
          ) : null}

          {selectedGraphId && executionListIsError ? (
            <Alert variant="destructive">
              <AlertTitle>실행 목록 오류</AlertTitle>
              <AlertDescription>{executionListError}</AlertDescription>
            </Alert>
          ) : null}

          {selectedGraphId && executionList.length === 0 ? (
            <Alert>
              <AlertTitle>실행 기록이 없어</AlertTitle>
              <AlertDescription>먼저 실행해줘.</AlertDescription>
            </Alert>
          ) : null}

          {selectedGraphId ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline">Q {queuedCount}</Badge>
                <Badge variant="outline">R {runningCount}</Badge>
              </div>

              {queuedCount > 0 || runningCount > 0 ? (
                <Alert>
                  <AlertTitle>큐/실행 상태</AlertTitle>
                  <AlertDescription>
                    {activeRunningExecution ? <div>실행 중 #{activeRunningExecution.id}</div> : null}
                    {nextQueuedExecution ? <div>다음 #{nextQueuedExecution.id} · 순번 {nextQueuedExecution.queue_position ?? '?'}</div> : null}
                  </AlertDescription>
                </Alert>
              ) : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            {executionList.map((execution) => {
              const plan = parseExecutionPlan(execution.execution_plan)
              const modeLabel = getExecutionModeLabel(plan)

              return (
                <button
                  key={execution.id}
                  type="button"
                  onClick={() => onSelectExecution(execution.id)}
                  className={cn('block w-full rounded-sm border px-2.5 py-2 text-left transition-colors hover:bg-surface-high', selectedExecutionId === execution.id ? 'border-primary/50 bg-surface-high' : 'border-border bg-surface-low')}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-sm font-medium text-foreground">#{execution.id}</span>
                      <Badge variant={execution.status === 'completed' ? 'secondary' : 'outline'}>{execution.status}</Badge>
                      <Badge variant="outline">{modeLabel}</Badge>
                      {selectedExecutionId === execution.id ? <Badge variant="secondary">선택</Badge> : null}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{formatDateTime(execution.created_date)}</div>
                  </div>

                  {(execution.status === 'queued' && execution.queue_position) || execution.cancel_requested || execution.error_message ? (
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      {execution.status === 'queued' && execution.queue_position ? <span>순번 {execution.queue_position}</span> : null}
                      {execution.cancel_requested ? <span className="text-[#ffd180]">취소 요청됨</span> : null}
                      {execution.error_message ? <span className="text-[#ffb4ab] line-clamp-1">{execution.error_message}</span> : null}
                    </div>
                  ) : null}
                </button>
              )
            })}
          </div>

          {selectedExecutionId && executionDetailIsError ? (
            <Alert variant="destructive">
              <AlertTitle>실행 상세 오류</AlertTitle>
              <AlertDescription>{executionDetailError}</AlertDescription>
            </Alert>
          ) : null}

          {selectedExecutionId && executionDetail ? (
            <div className="space-y-4 rounded-sm border border-border bg-surface-low p-3">
              <Alert>
                <AlertTitle className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>#{executionDetail.execution.id}</span>
                    <Badge variant={executionDetail.execution.status === 'completed' ? 'secondary' : 'outline'}>{executionDetail.execution.status}</Badge>
                    <Badge variant="outline">{getExecutionModeLabel(selectedExecutionPlan)}</Badge>
                    <span className="text-[11px] text-muted-foreground">{formatDateTime(executionDetail.execution.created_date)}</span>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => setIsDetailModalOpen(true)}>
                    <Eye className="h-4 w-4" />
                    상세보기
                  </Button>
                </AlertTitle>
                <AlertDescription>
                  {executionDetail.execution.started_at ? <div>시작 {formatDateTime(executionDetail.execution.started_at)}</div> : null}
                  {executionDetail.execution.completed_at ? <div>완료 {formatDateTime(executionDetail.execution.completed_at)}</div> : null}
                  {selectedExecutionPlan?.targetNodeId ? <div>대상 {getNodeDisplayLabel(selectedGraph, selectedExecutionPlan.targetNodeId)}</div> : null}
                  {selectedExecutionPlan?.forceRerun ? <div>캐시 무시 후 다시 실행</div> : null}
                  {selectedExecutionPlan?.reusedFromExecutionId ? <div>이전 실행 #{selectedExecutionPlan.reusedFromExecutionId} 결과 일부 재사용</div> : null}
                  {executionDetail.execution.error_message ? <div>{executionDetail.execution.error_message}</div> : null}
                </AlertDescription>
              </Alert>

              {executionInputEntries.length > 0 ? (
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    <span>Run Inputs</span>
                    <Badge variant="outline">{executionInputEntries.length}</Badge>
                  </div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {executionInputEntries.map((entry) => (
                      <div key={entry.key} className="rounded-sm border border-border bg-background/50 px-3 py-2">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{entry.label}</div>
                        {entry.label !== entry.key ? <div className="mt-0.5 text-[11px] text-muted-foreground">{entry.key}</div> : null}
                        <div className="mt-1 text-sm text-foreground whitespace-pre-wrap break-all">{formatPrimitiveValue(entry.value)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <span>최종 결과</span>
                  <Badge variant="outline">{finalArtifacts.length}</Badge>
                </div>

                {finalArtifacts.length === 0 ? (
                  <Alert>
                    <AlertTitle>표시할 최종 결과가 아직 없어</AlertTitle>
                    <AlertDescription>이 실행에서는 저장된 출력 아티팩트를 찾지 못했어.</AlertDescription>
                  </Alert>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {finalArtifacts.map((artifact) => (
                      <ExecutionArtifactCard key={artifact.id} artifact={artifact} compact />
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <span>노드 출력</span>
                  <Badge variant="outline">{groupedArtifacts.length}</Badge>
                </div>

                {groupedArtifacts.length === 0 ? (
                  <Alert>
                    <AlertTitle>노드 출력이 없어</AlertTitle>
                    <AlertDescription>실행 결과로 저장된 노드 아티팩트를 아직 찾지 못했어.</AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-3">
                    {groupedArtifacts.map((group) => (
                      <div key={group.nodeId} className="rounded-sm border border-border bg-background/40 p-3">
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">{group.nodeLabel}</span>
                          <Badge variant="outline">출력 {group.artifacts.length}</Badge>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2">
                          {group.artifacts.map((artifact) => (
                            <ExecutionArtifactCard key={artifact.id} artifact={artifact} compact />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {executionDetail ? (
        <SettingsModal
          open={isDetailModalOpen}
          title={`실행 상세 #${executionDetail.execution.id}`}
          description="기술 정보, 원본 아티팩트 메타데이터, 로그를 여기서 확인해."
          onClose={() => setIsDetailModalOpen(false)}
          widthClassName="max-w-6xl"
        >
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => scrollToDetailSection('summary')}>요약</Button>
              {executionInputEntries.length > 0 ? <Button type="button" size="sm" variant="outline" onClick={() => scrollToDetailSection('inputs')}>입력</Button> : null}
              <Button type="button" size="sm" variant="outline" onClick={() => scrollToDetailSection('artifacts')}>아티팩트</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => scrollToDetailSection('logs')}>로그</Button>
            </div>

            <div ref={(node) => { detailSectionRefs.current.summary = node }} className="space-y-2.5 scroll-mt-4">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <span>Execution Meta</span>
              </div>
              <Alert>
                <AlertTitle className="flex flex-wrap items-center gap-2">
                  <span>#{executionDetail.execution.id}</span>
                  <Badge variant={executionDetail.execution.status === 'completed' ? 'secondary' : 'outline'}>{executionDetail.execution.status}</Badge>
                  <Badge variant="outline">{getExecutionModeLabel(selectedExecutionPlan)}</Badge>
                  <span className="text-[11px] text-muted-foreground">{formatDateTime(executionDetail.execution.created_date)}</span>
                </AlertTitle>
                <AlertDescription>
                  {selectedExecutionPlan?.targetNodeId ? (
                    <div className="flex items-center gap-1">
                      <span>{selectedExecutionPlan.forceRerun ? '선택 노드 강제 재실행' : '선택 노드 실행'}</span>
                      <TechnicalReferenceHint title={`node ${selectedExecutionPlan.targetNodeId}`} label="실행 대상 노드 내부 식별자 보기" />
                    </div>
                  ) : null}
                  {selectedExecutionPlan?.forceRerun ? <div>캐시 무시: upstream도 새로 실행</div> : null}
                  {selectedExecutionPlan?.reusedFromExecutionId ? <div>캐시 재사용: #{selectedExecutionPlan.reusedFromExecutionId} · 노드 {(selectedExecutionPlan.reusedNodeIds ?? []).length}</div> : null}
                  {executionDetail.execution.status === 'queued' && executionDetail.execution.queue_position ? <div>큐 순번 {executionDetail.execution.queue_position}</div> : null}
                  {executionDetail.execution.cancel_requested ? <div>취소 요청 접수됨</div> : null}
                  {executionDetail.execution.error_message ? <div>{executionDetail.execution.error_message}</div> : null}
                  {executionDetail.execution.failed_node_id ? (
                    <div className="flex items-center gap-1">
                      <span>실패 노드 있음</span>
                      <TechnicalReferenceHint title={`node ${executionDetail.execution.failed_node_id}`} label="실패 노드 내부 식별자 보기" />
                    </div>
                  ) : null}
                </AlertDescription>
              </Alert>
            </div>

            {executionInputEntries.length > 0 ? (
              <div ref={(node) => { detailSectionRefs.current.inputs = node }} className="space-y-2.5 scroll-mt-4">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <span>Run Inputs</span>
                  <Badge variant="outline">{executionInputEntries.length}</Badge>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {executionInputEntries.map((entry) => (
                    <div key={entry.key} className="rounded-sm border border-border bg-surface-low p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{entry.label}</div>
                      {entry.label !== entry.key ? <div className="mt-0.5 text-[11px] text-muted-foreground">{entry.key}</div> : null}
                      <div className="mt-1 text-sm text-foreground whitespace-pre-wrap break-all">{formatPrimitiveValue(entry.value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div ref={(node) => { detailSectionRefs.current.artifacts = node }} className="space-y-2.5 scroll-mt-4">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <span>Artifacts</span>
                <Badge variant="outline">{executionDetail.artifacts.length}</Badge>
              </div>
              {executionDetail.artifacts.map((artifact) => {
                const previewUrl = getArtifactPreviewUrl(artifact)
                const parsedMetadata = parseMetadataValue(artifact.metadata)

                return (
                  <div key={artifact.id} className="rounded-sm border border-border bg-surface-low p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-foreground">출력 아티팩트</span>
                          <Badge variant="outline">{artifact.artifact_type}</Badge>
                          <TechnicalReferenceHint title={`node ${artifact.node_id}\nport ${artifact.port_key}`} label="아티팩트 내부 연결 정보 보기" />
                        </div>
                        <div className="text-[11px] text-muted-foreground">{formatDateTime(artifact.created_date)}</div>
                      </div>
                    </div>

                    {previewUrl && (artifact.artifact_type === 'image' || artifact.artifact_type === 'mask') ? (
                      <img src={previewUrl} alt={`${artifact.node_id}-${artifact.port_key}`} className="mt-2 max-h-44 rounded-sm border border-border object-contain" />
                    ) : null}

                    {artifact.storage_path ? <div className="mt-2 rounded-sm bg-surface-high px-2 py-1.5 break-all text-[11px] text-muted-foreground">{artifact.storage_path}</div> : null}

                    {parsedMetadata ? (
                      <pre className="mt-2 overflow-auto rounded-sm bg-[#0b111c] p-2.5 text-[11px] text-[#d7e3ff]">{typeof parsedMetadata === 'string' ? parsedMetadata : JSON.stringify(parsedMetadata, null, 2)}</pre>
                    ) : null}
                  </div>
                )
              })}
            </div>

            <div ref={(node) => { detailSectionRefs.current.logs = node }} className="space-y-2.5 scroll-mt-4">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <span>Logs</span>
                <Badge variant="outline">{executionDetail.logs.length}</Badge>
              </div>
              {executionDetail.logs.length === 0 ? (
                <Alert>
                  <AlertTitle>저장된 로그가 없어</AlertTitle>
                  <AlertDescription>이번 실행은 별도 로그 이벤트 없이 끝났어.</AlertDescription>
                </Alert>
              ) : (
                executionDetail.logs.map((log) => {
                  const parsedDetails = parseMetadataValue(log.details)
                  return (
                    <div key={log.id} className="rounded-sm border border-border bg-surface-low p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={log.level === 'error' ? 'outline' : 'secondary'}>{log.level}</Badge>
                          <span className="text-sm font-medium text-foreground">{log.event_type}</span>
                          {log.node_id ? <TechnicalReferenceHint title={`node ${log.node_id}`} label="로그 대상 노드 내부 식별자 보기" /> : null}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{formatDateTime(log.created_date)}</div>
                      </div>
                      <div className="mt-1.5 text-sm text-foreground">{log.message}</div>
                      {parsedDetails ? (
                        <pre className="mt-2 overflow-auto rounded-sm bg-[#0b111c] p-2.5 text-[11px] text-[#d7e3ff]">{typeof parsedDetails === 'string' ? parsedDetails : JSON.stringify(parsedDetails, null, 2)}</pre>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </SettingsModal>
      ) : null}
    </>
  )
}
