import { useMemo, useRef, useState } from 'react'
import { Eye, Play, RotateCcw, Square } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import { useI18n } from '@/i18n'
import type {
  GraphExecutionArtifactRecord,
  GraphExecutionFinalResultRecord,
  GraphExecutionLogRecord,
  GraphExecutionRecord,
  GraphWorkflowRecord,
} from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import {
  getArtifactPreviewUrl,
  hasGraphArtifactVisualPreview,
  parseMetadataValue,
  resolveGraphArtifactMimeType,
} from '../module-graph-shared'
import {
  buildArtifactGroupModalText,
  formatPrimitiveValue,
  getExecutionInputEntries,
  getExecutionModeLabel,
  getNodeDisplayLabel,
  groupArtifactsByNode,
  isCompactExecutionArtifactVisible,
  parseExecutionPlan,
  pickPrimaryExecutionArtifact,
  type ParsedExecutionPlan,
} from './graph-execution-panel-helpers'
import { TechnicalReferenceHint } from './module-graph-field-shared'
import { WorkflowFinalResultsSection } from './workflow-final-results-section'

type GraphExecutionDetail = {
  execution: GraphExecutionRecord
  artifacts: GraphExecutionArtifactRecord[]
  final_results: GraphExecutionFinalResultRecord[]
  logs: GraphExecutionLogRecord[]
}

type ExecutionDetailSectionKey = 'summary' | 'inputs' | 'artifacts' | 'logs'

function ExecutionOutputGroupCard({
  group,
}: {
  group: { nodeId: string; nodeLabel: string; artifacts: GraphExecutionArtifactRecord[] }
}) {
  const { t, formatNumber } = useI18n()
  const [modalType, setModalType] = useState<'text' | 'image' | null>(null)
  const primaryArtifact = useMemo(() => pickPrimaryExecutionArtifact(group.artifacts), [group.artifacts])
  const modalText = useMemo(() => buildArtifactGroupModalText(group.artifacts), [group.artifacts])
  const hasVisualPreview = Boolean(primaryArtifact && hasGraphArtifactVisualPreview(primaryArtifact))
  const previewUrl = primaryArtifact ? getArtifactPreviewUrl(primaryArtifact) : null
  const mimeType = primaryArtifact ? resolveGraphArtifactMimeType(primaryArtifact) : null

  return (
    <>
      <div className="rounded-sm border border-border/70 bg-background/25 p-2">
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-foreground">{group.nodeLabel}</div>
            {primaryArtifact ? <div className="truncate text-[10px] text-muted-foreground">{primaryArtifact.port_key}</div> : null}
          </div>
          <Badge variant="outline" className="h-6 shrink-0 px-1.5 text-[10px]">{t({ ko: '출력 {count}', en: 'Outputs {count}' }, { count: formatNumber(group.artifacts.length) })}</Badge>
        </div>

        {hasVisualPreview && previewUrl && primaryArtifact ? (
          <button
            type="button"
            onClick={() => setModalType('image')}
            className="group relative block w-full overflow-hidden rounded-sm bg-surface-lowest/80"
          >
            <InlineMediaPreview
              src={previewUrl}
              mimeType={mimeType}
              alt={`${primaryArtifact.node_id}-${primaryArtifact.port_key}`}
              frameClassName="border-0 bg-transparent p-0"
              mediaClassName="h-[9.5rem] w-full object-contain"
            />
            <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/24 group-focus-visible:bg-black/24" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
              <span className="rounded-sm bg-black/72 px-2.5 py-1 text-[11px] font-medium text-white">{t({ ko: '보기', en: 'View' })}</span>
            </div>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setModalType('text')}
            className="group relative flex h-[9.5rem] w-full items-center justify-center overflow-hidden rounded-sm bg-surface-lowest/80 text-sm font-medium text-foreground transition-colors hover:bg-surface-low"
          >
            <span>{t({ ko: '텍스트 컨텐츠', en: 'Text content' })}</span>
            <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/24 group-focus-visible:bg-black/24" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
              <span className="rounded-sm bg-black/72 px-2.5 py-1 text-[11px] font-medium text-white">{t({ ko: '보기', en: 'View' })}</span>
            </div>
          </button>
        )}
      </div>

      <SettingsModal
        open={modalType === 'text'}
        title={group.nodeLabel}
        widthClassName="max-w-4xl"
        onClose={() => setModalType(null)}
      >
        <pre className="max-h-[70vh] overflow-auto text-xs leading-5 text-foreground whitespace-pre-wrap break-words">
          {modalText}
        </pre>
      </SettingsModal>

      <SettingsModal
        open={modalType === 'image'}
        title={group.nodeLabel}
        widthClassName="max-w-6xl"
        onClose={() => setModalType(null)}
      >
        {previewUrl && primaryArtifact ? (
          <InlineMediaPreview
            src={previewUrl}
            mimeType={mimeType}
            alt={`${primaryArtifact.node_id}-${primaryArtifact.port_key}`}
            frameClassName="border-0 bg-transparent p-0"
            mediaClassName="max-h-[80vh] w-full object-contain"
          />
        ) : null}
      </SettingsModal>
    </>
  )
}

function SelectedExecutionSummary({
  executionDetail,
  selectedGraph,
  nodeLabelOverrides,
  selectedExecutionPlan,
  executionInputEntries,
  finalResults,
  compactArtifactGroups,
  onOpenDetail,
}: {
  executionDetail: GraphExecutionDetail
  selectedGraph?: GraphWorkflowRecord | null
  nodeLabelOverrides?: Record<string, string> | null
  selectedExecutionPlan: ParsedExecutionPlan | null
  executionInputEntries: ReturnType<typeof getExecutionInputEntries>
  finalResults: GraphExecutionFinalResultRecord[]
  compactArtifactGroups: Array<{ nodeId: string; nodeLabel: string; artifacts: GraphExecutionArtifactRecord[] }>
  onOpenDetail: () => void
}) {
  const { t, formatNumber, formatDateTime } = useI18n()

  return (
    <div className="space-y-4 rounded-sm border border-border bg-surface-low p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-border bg-background/50 px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground">#{executionDetail.execution.id}</span>
          <Badge variant={executionDetail.execution.status === 'completed' ? 'secondary' : 'outline'}>{executionDetail.execution.status}</Badge>
          <Badge variant="outline">{getExecutionModeLabel(selectedExecutionPlan)}</Badge>
          {selectedExecutionPlan?.targetNodeId ? <Badge variant="outline">{getNodeDisplayLabel(selectedGraph, selectedExecutionPlan.targetNodeId, nodeLabelOverrides)}</Badge> : null}
          {selectedExecutionPlan?.forceRerun ? <Badge variant="outline">{t({ ko: '강제', en: 'Forced' })}</Badge> : null}
          {selectedExecutionPlan?.reusedFromExecutionId ? <Badge variant="outline">{t({ ko: '재사용 #{id}', en: 'Reused #{id}' }, { id: selectedExecutionPlan.reusedFromExecutionId })}</Badge> : null}
          <span className="text-[11px] text-muted-foreground">{formatDateTime(executionDetail.execution.created_date)}</span>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={onOpenDetail}>
          <Eye className="h-4 w-4" />
          {t({ ko: '상세', en: 'Details' })}
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
            <span>{t({ ko: '입력', en: 'Inputs' })}</span>
            <Badge variant="outline">{formatNumber(executionInputEntries.length)}</Badge>
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
          nodeLabelOverrides={nodeLabelOverrides}
        />
      </div>

      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          <span>{t({ ko: '출력', en: 'Outputs' })}</span>
          <Badge variant="outline">{formatNumber(compactArtifactGroups.length)}</Badge>
        </div>

        {compactArtifactGroups.length === 0 ? (
          <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            {t({ ko: '표시할 출력 없음', en: 'No outputs to display' })}
          </div>
        ) : (
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(12rem,1fr))]">
            {compactArtifactGroups.map((group) => (
              <ExecutionOutputGroupCard key={group.nodeId} group={group} />
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
  nodeLabelOverrides?: Record<string, string> | null
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
  onSelectExecution: (executionId: number | null) => void
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
  nodeLabelOverrides,
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
  const { t, formatNumber, formatDateTime } = useI18n()
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
    () => groupArtifactsByNode(executionDetail?.artifacts ?? [], selectedGraph, nodeLabelOverrides),
    [executionDetail?.artifacts, nodeLabelOverrides, selectedGraph],
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
        title={isCancellingExecution ? t({ ko: '취소 요청 중', en: 'Requesting cancel' }) : t({ ko: '실행 취소', en: 'Cancel run' })}
        aria-label={isCancellingExecution ? t({ ko: '실행 취소 요청 중', en: 'Requesting run cancel' }) : t({ ko: '실행 취소', en: 'Cancel run' })}
      >
        <Square className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        onClick={onRetryExecution}
        disabled={!retryable || isExecutingGraph}
        title={t({ ko: '다시 시도', en: 'Retry' })}
        aria-label={t({ ko: '실행 다시 시도', en: 'Retry run' })}
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        onClick={onRerunGraph}
        disabled={!selectedGraphId || isExecutingGraph}
        title={isExecutingGraph ? t({ ko: '실행 중', en: 'Running' }) : t({ ko: '재실행', en: 'Rerun' })}
        aria-label={isExecutingGraph ? t({ ko: '워크플로우 실행 중', en: 'Workflow running' }) : t({ ko: '워크플로우 재실행', en: 'Rerun workflow' })}
      >
        <Play className="h-4 w-4" />
      </Button>
    </div>
  )

  const detailSectionButtons = executionDetail ? (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => scrollToDetailSection('summary')}>{t({ ko: '요약', en: 'Summary' })}</Button>
      {executionInputEntries.length > 0 ? <Button type="button" size="sm" variant="outline" onClick={() => scrollToDetailSection('inputs')}>{t({ ko: '입력', en: 'Inputs' })}</Button> : null}
      <Button type="button" size="sm" variant="outline" onClick={() => scrollToDetailSection('artifacts')}>{t({ ko: '아티팩트', en: 'Artifacts' })}</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => scrollToDetailSection('logs')}>{t({ ko: '로그', en: 'Logs' })}</Button>
    </div>
  ) : null

  return (
    <>
      <Card>
        <CardContent className="space-y-4">
          {showHeader ? (
            <SectionHeading
              variant="inside"
              heading={t({ ko: '실행 결과', en: 'Run results' })}
              description={description}
              actions={actionButtons}
            />
          ) : null}

          {!showHeader ? <div className="flex justify-end">{actionButtons}</div> : null}

          {!selectedGraphId ? (
            <Alert>
              <AlertTitle>{t({ ko: '그래프를 먼저 골라줘', en: 'Choose a graph first' })}</AlertTitle>
              <AlertDescription>{t({ ko: '워크플로우를 먼저 선택해.', en: 'Select a workflow first.' })}</AlertDescription>
            </Alert>
          ) : null}

          {selectedGraphId && executionListIsError ? (
            <Alert variant="destructive">
              <AlertTitle>{t({ ko: '실행 목록 오류', en: 'Run list error' })}</AlertTitle>
              <AlertDescription>{executionListError}</AlertDescription>
            </Alert>
          ) : null}

          {selectedGraphId && executionList.length === 0 ? (
            <Alert>
              <AlertTitle>{t({ ko: '실행 기록이 없어', en: 'There is no run history' })}</AlertTitle>
              <AlertDescription>{t({ ko: '먼저 실행해줘.', en: 'Run it first.' })}</AlertDescription>
            </Alert>
          ) : null}

          {selectedGraphId && (queuedCount > 0 || runningCount > 0) ? (
            <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border bg-background/40 px-3 py-2 text-xs text-muted-foreground">
              <Badge variant="outline">Q {queuedCount}</Badge>
              <Badge variant="outline">R {runningCount}</Badge>
              {activeRunningExecution ? <span>{t({ ko: '실행 #{id}', en: 'Run #{id}' }, { id: activeRunningExecution.id })}</span> : null}
              {nextQueuedExecution ? <span>{t({ ko: '다음 #{id} · {position}', en: 'Next #{id} · {position}' }, { id: nextQueuedExecution.id, position: nextQueuedExecution.queue_position ?? '?' })}</span> : null}
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
                    onClick={() => onSelectExecution(isSelected ? null : execution.id)}
                    className={cn('block w-full rounded-sm border px-2.5 py-2 text-left transition-colors hover:bg-surface-high', isSelected ? 'border-primary/50 bg-surface-high' : 'border-border bg-surface-low')}
                    title={isSelected ? t({ ko: '다시 누르면 접기', en: 'Click again to collapse' }) : t({ ko: '클릭해서 펼치기', en: 'Click to expand' })}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="text-sm font-medium text-foreground">#{execution.id}</span>
                        <Badge variant={execution.status === 'completed' ? 'secondary' : 'outline'}>{execution.status}</Badge>
                        <Badge variant="outline">{modeLabel}</Badge>
                        {isSelected ? <Badge variant="secondary">{t({ ko: '선택', en: 'Selected' })}</Badge> : null}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{formatDateTime(execution.created_date)}</div>
                    </div>

                    {(execution.status === 'queued' && execution.queue_position) || execution.cancel_requested || execution.error_message ? (
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                        {execution.status === 'queued' && execution.queue_position ? <span>{t({ ko: '순번 {position}', en: 'Position {position}' }, { position: execution.queue_position })}</span> : null}
                        {execution.cancel_requested ? <span className="text-[#ffd180]">{t({ ko: '취소 요청됨', en: 'Cancel requested' })}</span> : null}
                        {execution.error_message ? <span className="text-[#ffb4ab] line-clamp-1">{execution.error_message}</span> : null}
                      </div>
                    ) : null}
                  </button>

                  {isSelected && executionDetailIsError ? (
                    <Alert variant="destructive">
                      <AlertTitle>{t({ ko: '실행 상세 오류', en: 'Run detail error' })}</AlertTitle>
                      <AlertDescription>{executionDetailError}</AlertDescription>
                    </Alert>
                  ) : null}

                  {isSelected && !executionDetailIsError && !selectedDetailMatches ? (
                    <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                      {t({ ko: '실행 결과 불러오는 중…', en: 'Loading run results…' })}
                    </div>
                  ) : null}

                  {selectedDetailMatches && executionDetail ? (
                    <SelectedExecutionSummary
                      executionDetail={executionDetail}
                      selectedGraph={selectedGraph}
                      nodeLabelOverrides={nodeLabelOverrides}
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
          title={t({ ko: '실행 상세 #{id}', en: 'Run details #{id}' }, { id: executionDetail.execution.id })}
          headerContent={detailSectionButtons}
          onClose={() => setIsDetailModalOpen(false)}
          widthClassName="max-w-6xl"
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
                      <span>{selectedExecutionPlan.forceRerun ? t({ ko: '선택 노드 강제 재실행', en: 'Force rerun selected node' }) : t({ ko: '선택 노드 실행', en: 'Run selected node' })}</span>
                      <TechnicalReferenceHint title={`node ${selectedExecutionPlan.targetNodeId}`} label={t({ ko: '실행 대상 노드 내부 식별자 보기', en: 'Show internal identifier for the target node' })} />
                    </div>
                  ) : null}
                  {selectedExecutionPlan?.forceRerun ? <div>{t({ ko: '캐시 무시: upstream도 새로 실행', en: 'Ignore cache: rerun upstream as well' })}</div> : null}
                  {selectedExecutionPlan?.reusedFromExecutionId ? <div>{t({ ko: '캐시 재사용: #{id} · 노드 {count}', en: 'Cache reused: #{id} · nodes {count}' }, { id: selectedExecutionPlan.reusedFromExecutionId, count: (selectedExecutionPlan.reusedNodeIds ?? []).length })}</div> : null}
                  {executionDetail.execution.status === 'queued' && executionDetail.execution.queue_position ? <div>{t({ ko: '큐 순번 {position}', en: 'Queue position {position}' }, { position: executionDetail.execution.queue_position })}</div> : null}
                  {executionDetail.execution.cancel_requested ? <div>{t({ ko: '취소 요청 접수됨', en: 'Cancel request received' })}</div> : null}
                  {executionDetail.execution.error_message ? <div>{executionDetail.execution.error_message}</div> : null}
                  {executionDetail.execution.failed_node_id ? (
                    <div className="flex items-center gap-1">
                      <span>{t({ ko: '실패 노드 있음', en: 'Failed node present' })}</span>
                      <TechnicalReferenceHint title={`node ${executionDetail.execution.failed_node_id}`} label={t({ ko: '실패 노드 내부 식별자 보기', en: 'Show internal identifier for the failed node' })} />
                    </div>
                  ) : null}
                </AlertDescription>
              </Alert>
            </div>

            {executionInputEntries.length > 0 ? (
              <div ref={(node) => { detailSectionRefs.current.inputs = node }} className="space-y-2 scroll-mt-24 md:scroll-mt-28">
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  <span>{t({ ko: '입력', en: 'Inputs' })}</span>
                  <Badge variant="outline">{formatNumber(executionInputEntries.length)}</Badge>
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
                <span>{t({ ko: '아티팩트', en: 'Artifacts' })}</span>
                <Badge variant="outline">{executionDetail.artifacts.length}</Badge>
              </div>
              {executionDetail.artifacts.map((artifact) => {
                const previewUrl = getArtifactPreviewUrl(artifact)
                const mimeType = resolveGraphArtifactMimeType(artifact)
                const parsedMetadata = parseMetadataValue(artifact.metadata)

                return (
                  <div key={artifact.id} className="rounded-sm border border-border bg-surface-low p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-foreground">{t({ ko: '출력 아티팩트', en: 'Output artifact' })}</span>
                          <Badge variant="outline">{artifact.artifact_type}</Badge>
                          <TechnicalReferenceHint title={`node ${artifact.node_id}\nport ${artifact.port_key}`} label={t({ ko: '아티팩트 내부 연결 정보 보기', en: 'Show internal connection info for the artifact' })} />
                        </div>
                        <div className="text-[11px] text-muted-foreground">{formatDateTime(artifact.created_date)}</div>
                      </div>
                    </div>

                    {hasGraphArtifactVisualPreview(artifact) ? (
                      <InlineMediaPreview
                        src={previewUrl}
                        mimeType={mimeType}
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
                <span>{t({ ko: '로그', en: 'Logs' })}</span>
                <Badge variant="outline">{executionDetail.logs.length}</Badge>
              </div>
              {executionDetail.logs.length === 0 ? (
                <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                  {t({ ko: '로그 없음', en: 'No logs' })}
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
                          {log.node_id ? <TechnicalReferenceHint title={`node ${log.node_id}`} label={t({ ko: '로그 대상 노드 내부 식별자 보기', en: 'Show internal identifier for the log target node' })} /> : null}
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
