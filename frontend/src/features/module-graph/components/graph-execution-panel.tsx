import { useMemo, useRef, useState } from 'react'
import { CircleHelp, Eye, Play, RotateCcw, Square } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import type {
  GraphExecutionArtifactRecord,
  GraphExecutionFinalResultRecord,
  GraphExecutionLogRecord,
  GraphExecutionRecord,
  GraphWorkflowRecord,
} from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  formatDateTime,
  getArtifactPreviewUrl,
  parseMetadataValue,
} from '../module-graph-shared'
import { ExecutionArtifactCard } from './execution-artifact-card'
import {
  formatPrimitiveValue,
  getExecutionInputEntries,
  getExecutionModeLabel,
  getNodeDisplayLabel,
  groupArtifactsByNode,
  isCompactExecutionArtifactVisible,
  parseExecutionPlan,
  type ParsedExecutionPlan,
} from './graph-execution-panel-helpers'
import { WorkflowFinalResultsSection } from './workflow-final-results-section'

type GraphExecutionDetail = {
  execution: GraphExecutionRecord
  artifacts: GraphExecutionArtifactRecord[]
  final_results: GraphExecutionFinalResultRecord[]
  logs: GraphExecutionLogRecord[]
}

type ExecutionDetailSectionKey = 'summary' | 'inputs' | 'artifacts' | 'logs'

function TechnicalReferenceHint({ title, label }: { title: string; label: string }) {
  return (
    <span className="inline-flex cursor-help text-muted-foreground" title={title} aria-label={label}>
      <CircleHelp className="h-3.5 w-3.5" />
    </span>
  )
}

function SelectedExecutionSummary({
  executionDetail,
  selectedGraph,
  selectedExecutionPlan,
  executionInputEntries,
  finalResults,
  compactArtifactGroups,
  onOpenDetail,
}: {
  executionDetail: GraphExecutionDetail
  selectedGraph?: GraphWorkflowRecord | null
  selectedExecutionPlan: ParsedExecutionPlan | null
  executionInputEntries: ReturnType<typeof getExecutionInputEntries>
  finalResults: GraphExecutionFinalResultRecord[]
  compactArtifactGroups: Array<{ nodeId: string; nodeLabel: string; artifacts: GraphExecutionArtifactRecord[] }>
  onOpenDetail: () => void
}) {
  return (
    <div className="space-y-4 rounded-sm border border-border bg-surface-low p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-background/50 px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">#{executionDetail.execution.id}</span>
          <Badge variant={executionDetail.execution.status === 'completed' ? 'secondary' : 'outline'}>{executionDetail.execution.status}</Badge>
          <Badge variant="outline">{getExecutionModeLabel(selectedExecutionPlan)}</Badge>
          {selectedExecutionPlan?.targetNodeId ? <Badge variant="outline">{getNodeDisplayLabel(selectedGraph, selectedExecutionPlan.targetNodeId)}</Badge> : null}
          {selectedExecutionPlan?.forceRerun ? <Badge variant="outline">강제</Badge> : null}
          {selectedExecutionPlan?.reusedFromExecutionId ? <Badge variant="outline">재사용 #{selectedExecutionPlan.reusedFromExecutionId}</Badge> : null}
          <span className="text-[11px] text-muted-foreground">{formatDateTime(executionDetail.execution.created_date)}</span>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onOpenDetail}>
          <Eye className="h-4 w-4" />
          상세
        </Button>
      </div>

      {executionDetail.execution.error_message ? (
        <div className="rounded-sm border border-[#7f1d1d] bg-[#3a1010]/60 px-3 py-2 text-sm text-[#ffb4ab]">
          {executionDetail.execution.error_message}
        </div>
      ) : null}

      {executionInputEntries.length > 0 ? (
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <span>입력</span>
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

      <div className="rounded-sm border border-border bg-background/35 p-3">
        <WorkflowFinalResultsSection
          finalResults={finalResults}
          artifacts={executionDetail.artifacts}
          selectedGraph={selectedGraph}
        />
      </div>

      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <span>출력</span>
          <Badge variant="outline">{compactArtifactGroups.length}</Badge>
        </div>

        {compactArtifactGroups.length === 0 ? (
          <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            표시할 출력 없음
          </div>
        ) : (
          <div className="space-y-4">
            {compactArtifactGroups.map((group) => (
              <div key={group.nodeId} className="rounded-sm border border-border bg-background/35 p-3 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">{group.nodeLabel}</span>
                  <Badge variant="outline">출력 {group.artifacts.length}</Badge>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {group.artifacts.map((artifact) => {
                    const useVisualCompactCard = artifact.artifact_type === 'image' || artifact.artifact_type === 'mask'

                    return (
                      <ExecutionArtifactCard
                        key={artifact.id}
                        artifact={artifact}
                        compact
                        hideTitle={useVisualCompactCard}
                      />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
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
  description,
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
  const inputDefinitions = useMemo(
    () => selectedGraph?.graph.metadata?.exposed_inputs ?? [],
    [selectedGraph],
  )
  const executionInputEntries = useMemo(
    () => getExecutionInputEntries(selectedExecutionPlan, inputDefinitions),
    [inputDefinitions, selectedExecutionPlan],
  )
  const groupedArtifacts = useMemo(
    () => groupArtifactsByNode(executionDetail?.artifacts ?? [], selectedGraph),
    [executionDetail?.artifacts, selectedGraph],
  )
  const compactArtifactGroups = useMemo(
    () => groupedArtifacts
      .map((group) => ({
        ...group,
        artifacts: group.artifacts.filter((artifact) => isCompactExecutionArtifactVisible(artifact)),
      }))
      .filter((group) => group.artifacts.length > 0),
    [groupedArtifacts],
  )
  const finalResults = executionDetail?.final_results ?? []

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

  const detailSectionButtons = executionDetail ? (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => scrollToDetailSection('summary')}>요약</Button>
      {executionInputEntries.length > 0 ? <Button type="button" size="sm" variant="outline" onClick={() => scrollToDetailSection('inputs')}>입력</Button> : null}
      <Button type="button" size="sm" variant="outline" onClick={() => scrollToDetailSection('artifacts')}>아티팩트</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => scrollToDetailSection('logs')}>로그</Button>
    </div>
  ) : null

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

          {selectedGraphId && (queuedCount > 0 || runningCount > 0) ? (
            <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
              <Badge variant="outline">Q {queuedCount}</Badge>
              <Badge variant="outline">R {runningCount}</Badge>
              {activeRunningExecution ? <span>실행 #{activeRunningExecution.id}</span> : null}
              {nextQueuedExecution ? <span>다음 #{nextQueuedExecution.id} · {nextQueuedExecution.queue_position ?? '?'}</span> : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            {executionList.map((execution) => {
              const plan = parseExecutionPlan(execution.execution_plan)
              const modeLabel = getExecutionModeLabel(plan)
              const isSelected = selectedExecutionId === execution.id
              const selectedDetailMatches = isSelected && executionDetail?.execution.id === execution.id

              return (
                <div key={execution.id} className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => onSelectExecution(execution.id)}
                    className={cn('block w-full rounded-sm border px-2.5 py-2 text-left transition-colors hover:bg-surface-high', isSelected ? 'border-primary/50 bg-surface-high' : 'border-border bg-surface-low')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="text-sm font-medium text-foreground">#{execution.id}</span>
                        <Badge variant={execution.status === 'completed' ? 'secondary' : 'outline'}>{execution.status}</Badge>
                        <Badge variant="outline">{modeLabel}</Badge>
                        {isSelected ? <Badge variant="secondary">선택</Badge> : null}
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

                  {isSelected && executionDetailIsError ? (
                    <Alert variant="destructive">
                      <AlertTitle>실행 상세 오류</AlertTitle>
                      <AlertDescription>{executionDetailError}</AlertDescription>
                    </Alert>
                  ) : null}

                  {isSelected && !executionDetailIsError && !selectedDetailMatches ? (
                    <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                      실행 결과 불러오는 중…
                    </div>
                  ) : null}

                  {selectedDetailMatches && executionDetail ? (
                    <SelectedExecutionSummary
                      executionDetail={executionDetail}
                      selectedGraph={selectedGraph}
                      selectedExecutionPlan={selectedExecutionPlan}
                      executionInputEntries={executionInputEntries}
                      finalResults={finalResults}
                      compactArtifactGroups={compactArtifactGroups}
                      onOpenDetail={() => setIsDetailModalOpen(true)}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {executionDetail ? (
        <SettingsModal
          open={isDetailModalOpen}
          title={`실행 상세 #${executionDetail.execution.id}`}
          headerContent={detailSectionButtons}
          onClose={() => setIsDetailModalOpen(false)}
          widthClassName="max-w-6xl"
          closeOnBack={false}
        >
          <div className="space-y-4">
            <div ref={(node) => { detailSectionRefs.current.summary = node }} className="space-y-2 scroll-mt-24 md:scroll-mt-28">
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
              <div ref={(node) => { detailSectionRefs.current.inputs = node }} className="space-y-2 scroll-mt-24 md:scroll-mt-28">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <span>입력</span>
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

            <div ref={(node) => { detailSectionRefs.current.artifacts = node }} className="space-y-2 scroll-mt-24 md:scroll-mt-28">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <span>아티팩트</span>
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
                      <InlineMediaPreview
                        src={previewUrl}
                        alt={`${artifact.node_id}-${artifact.port_key}`}
                        frameClassName="mt-2 p-2"
                        mediaClassName="max-h-44 w-full object-contain"
                      />
                    ) : null}

                    {artifact.storage_path ? <div className="mt-2 rounded-sm bg-surface-high px-2 py-1.5 break-all text-[11px] text-muted-foreground">{artifact.storage_path}</div> : null}

                    {parsedMetadata ? (
                      <pre className="mt-2 overflow-auto rounded-sm bg-[#0b111c] p-2.5 text-[11px] text-[#d7e3ff]">{typeof parsedMetadata === 'string' ? parsedMetadata : JSON.stringify(parsedMetadata, null, 2)}</pre>
                    ) : null}
                  </div>
                )
              })}
            </div>

            <div ref={(node) => { detailSectionRefs.current.logs = node }} className="space-y-2 scroll-mt-24 md:scroll-mt-28">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <span>로그</span>
                <Badge variant="outline">{executionDetail.logs.length}</Badge>
              </div>
              {executionDetail.logs.length === 0 ? (
                <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                  로그 없음
                </div>
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
