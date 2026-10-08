import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Loader2, RotateCcw, Square, X } from 'lucide-react'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { IconButton } from '@/components/ui/icon-button'
import { Progress } from '@/components/ui/progress'
import { useI18n } from '@/i18n'
import { getGraphExecution, type GraphExecutionArtifactRecord, type GraphExecutionListMeta, type GraphExecutionRecord, type GraphWorkflowRecord } from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import { getArtifactPreviewUrl, getGraphExecutionStatusLabel, hasGraphArtifactVisualPreview, localizeGraphWorkflowErrorMessage } from '../module-graph-shared'
import { GraphExecutionDetailModal } from './graph-execution-detail-modal'
import { buildNodeDisplayLabelMap, getExecutionInputEntries, getExecutionModeLabel, getNodeDisplayLabelFromMap, groupArtifactsByNode, isCompactExecutionArtifactVisible, parseExecutionPlan } from './graph-execution-panel-helpers'
import type { GraphExecutionDetail } from './graph-execution-shared-ui'
import { SelectedExecutionSummary } from './graph-execution-summary'

type ExecutionStatus = GraphExecutionRecord['status']

/** Server-side run counts and "load more" wiring for the capped run list. */
export type GraphExecutionListPaging = {
  meta: GraphExecutionListMeta | null
  isLoadingMore: boolean
  onLoadMore: () => void
}

const STATUS_PILL_CLASS: Record<string, string> = {
  completed: 'bg-success/12 text-success',
  failed: 'bg-destructive-soft text-destructive-soft-foreground',
  running: 'bg-primary/12 text-primary',
  queued: 'bg-primary/8 text-primary',
}

export function isActiveGraphExecution(status: ExecutionStatus | undefined) {
  return status === 'queued' || status === 'running'
}

/** Small status label used by run rows and the active-run card. */
export function GraphExecutionStatusPill({ status, className }: { status: ExecutionStatus; className?: string }) {
  const { t } = useI18n()
  return (
    <span className={cn('inline-flex h-5 shrink-0 items-center gap-1 rounded-sm px-1.5 text-2xs font-semibold whitespace-nowrap', STATUS_PILL_CLASS[status] ?? 'bg-fill text-muted-foreground', className)}>
      {status === 'running' ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
      {getGraphExecutionStatusLabel(status, t)}
    </span>
  )
}

function useElapsedLabel(startIso: string | null | undefined, active: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  if (!startIso) return null
  const started = Date.parse(startIso)
  if (!Number.isFinite(started)) return null
  const seconds = Math.max(0, Math.floor((now - started) / 1000))
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

type NodeProgress = { nodeId: string; label: string; state: 'done' | 'now' | 'failed' | 'pending' }

/** Node-by-node progress from the run's plan order and its engine start/complete/failure log events. */
function buildNodeProgress(detail: GraphExecutionDetail | undefined, graph: GraphWorkflowRecord | null, labelOverrides?: Record<string, string> | null): NodeProgress[] {
  if (!detail) return []
  const plan = parseExecutionPlan(detail.execution.execution_plan)
  const order = plan?.orderedNodeIds?.length ? plan.orderedNodeIds : graph?.graph.nodes.map((node) => node.id) ?? []
  const started = new Set<string>()
  const completed = new Set<string>()
  const failed = new Set<string>()
  for (const log of detail.logs) {
    if (!log.node_id) continue
    if (log.event_type === 'node_engine_start') started.add(log.node_id)
    else if (log.event_type === 'node_engine_complete') completed.add(log.node_id)
    else if (log.event_type === 'node_failure') failed.add(log.node_id)
  }
  for (const reused of plan?.reusedNodeIds ?? []) completed.add(reused)
  const labelMap = buildNodeDisplayLabelMap(graph)
  return order.map((nodeId) => ({
    nodeId,
    label: getNodeDisplayLabelFromMap(labelMap, nodeId, labelOverrides),
    state: failed.has(nodeId) ? 'failed' : completed.has(nodeId) ? 'done' : started.has(nodeId) ? 'now' : 'pending',
  }))
}

/** The newest queued/running run of the workflow, pinned above its results while it works. */
export function WorkflowActiveRunCard({
  execution,
  selectedGraph,
  nodeLabelOverrides,
  isCancelling,
  onCancel,
}: {
  execution: GraphExecutionRecord
  selectedGraph: GraphWorkflowRecord | null
  nodeLabelOverrides?: Record<string, string> | null
  isCancelling: boolean
  onCancel: (execution: GraphExecutionRecord) => void
}) {
  const { canExecuteGeneration } = useFeaturePermissions()
  const { t, formatNumber } = useI18n()
  const isRunning = execution.status === 'running'
  // Same key as the run detail query: the logs feed the node chips and refresh while the run works.
  const detailQuery = useQuery({
    queryKey: ['module-graph-execution-detail', execution.id],
    queryFn: () => getGraphExecution(execution.id),
    enabled: isRunning,
    refetchInterval: isRunning ? 3_000 : false,
  })
  const progress = useMemo(() => buildNodeProgress(detailQuery.data, selectedGraph, nodeLabelOverrides), [detailQuery.data, nodeLabelOverrides, selectedGraph])
  const doneCount = progress.filter((node) => node.state === 'done').length
  const elapsed = useElapsedLabel(execution.started_at ?? execution.created_date, true)

  return (
    <div className="space-y-2 rounded-md bg-primary/6 px-3 py-2.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--primary)_25%,transparent)]">
      <div className="flex items-center gap-2">
        <GraphExecutionStatusPill status={execution.status} />
        <span className="font-mono text-xs text-muted-foreground">
          #{execution.id}
          {elapsed ? ` · ${elapsed}` : null}
          {execution.status === 'queued' && execution.queue_position ? ` · ${t({ ko: '순번 {position}', en: 'position {position}' }, { position: execution.queue_position })}` : null}
        </span>
        <span className="flex-1" />
        <IconButton
          size="icon-xs"
          variant="ghost"
          onClick={() => onCancel(execution)}
          disabled={!canExecuteGeneration || isCancelling || execution.cancel_requested}
          label={execution.cancel_requested ? t({ ko: '취소 요청됨', en: 'Cancel requested' }) : t({ ko: '실행 취소', en: 'Cancel run' })}
        >
          <X />
        </IconButton>
      </div>
      {isRunning && progress.length > 0 ? (
        <>
          <Progress value={(doneCount / progress.length) * 100} className="h-1" aria-label={t({ ko: '노드 {done}/{total}', en: 'Nodes {done}/{total}' }, { done: formatNumber(doneCount), total: formatNumber(progress.length) })} />
          <div className="flex flex-wrap gap-1">
            {progress.map((node) => (
              <span
                key={node.nodeId}
                className={cn(
                  'inline-flex h-5 items-center gap-1 rounded-sm px-1.5 text-2xs',
                  node.state === 'done' && 'bg-success/10 text-success',
                  node.state === 'now' && 'bg-primary/12 text-primary',
                  node.state === 'failed' && 'bg-destructive-soft text-destructive-soft-foreground',
                  node.state === 'pending' && 'bg-fill text-muted-foreground',
                )}
              >
                {node.state === 'done' ? <Check className="size-3" aria-hidden /> : node.state === 'now' ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
                {node.label}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

/** One line per run (status, outputs or error, time) with the run's details in a modal. */
export function WorkflowRunHistory({
  selectedGraph,
  nodeLabelOverrides,
  executionList,
  executionListPaging,
  executionListIsError,
  executionListError,
  previewArtifactsByExecution,
  selectedExecutionId,
  executionDetail,
  executionDetailIsError,
  executionDetailError,
  cancellingExecutionId,
  isExecutingGraph,
  onSelectExecution,
  onCancelExecution,
  onRetryExecution,
  className,
}: {
  selectedGraph: GraphWorkflowRecord | null
  nodeLabelOverrides?: Record<string, string> | null
  executionList: GraphExecutionRecord[]
  executionListPaging?: GraphExecutionListPaging
  executionListIsError: boolean
  executionListError: string
  previewArtifactsByExecution: ReadonlyMap<number, GraphExecutionArtifactRecord[]>
  selectedExecutionId: number | null
  executionDetail?: GraphExecutionDetail
  executionDetailIsError: boolean
  executionDetailError: string
  cancellingExecutionId: number | null
  isExecutingGraph: boolean
  onSelectExecution: (executionId: number | null) => void
  onCancelExecution: (execution: GraphExecutionRecord) => void
  onRetryExecution: (execution: GraphExecutionRecord) => void
  className?: string
}) {
  const { canExecuteGeneration } = useFeaturePermissions()
  const { t, formatNumber, formatDateTime } = useI18n()
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const detailMatches = executionDetail && executionDetail.execution.id === selectedExecutionId ? executionDetail : undefined

  const detailPlan = useMemo(() => parseExecutionPlan(detailMatches?.execution.execution_plan), [detailMatches?.execution.execution_plan])
  const detailInputEntries = useMemo(
    () => getExecutionInputEntries(detailPlan, selectedGraph?.graph.metadata?.exposed_inputs ?? []),
    [detailPlan, selectedGraph],
  )
  const detailArtifactGroups = useMemo(
    () => groupArtifactsByNode(detailMatches?.artifacts ?? [], selectedGraph, nodeLabelOverrides)
      .map((group) => ({ ...group, artifacts: group.artifacts.filter((artifact) => isCompactExecutionArtifactVisible(artifact)) }))
      .filter((group) => group.artifacts.length > 0),
    [detailMatches?.artifacts, nodeLabelOverrides, selectedGraph],
  )

  const hasMore = executionListPaging?.meta?.has_more === true

  if (executionListIsError) {
    return <ErrorState size="compact" title={t({ ko: '실행 기록을 못 불러왔어', en: 'Could not load runs' })} description={executionListError} />
  }

  if (executionList.length === 0) {
    return <EmptyState size="compact" title={t({ ko: '아직 실행한 적이 없어', en: 'No runs yet' })} />
  }

  return (
    <div className={className}>
      {executionList.map((execution) => {
        const plan = parseExecutionPlan(execution.execution_plan)
        const visualArtifacts = (previewArtifactsByExecution.get(execution.id) ?? []).filter((artifact) => hasGraphArtifactVisualPreview(artifact))
        const isActive = isActiveGraphExecution(execution.status)
        const retryable = execution.status === 'failed' || execution.status === 'cancelled'
        const errorText = execution.error_message ? localizeGraphWorkflowErrorMessage(execution.error_message, t, execution.error_message) ?? execution.error_message : null
        return (
          <div
            key={execution.id}
            data-active={selectedExecutionId === execution.id || undefined}
            className="flex min-h-12 items-center gap-3 border-b border-line px-2 data-[active=true]:bg-fill"
          >
            <Button
              type="button"
              variant="nav"
              onClick={() => {
                onSelectExecution(execution.id)
                setIsDetailOpen(true)
              }}
              className="h-auto min-w-0 flex-1 gap-3 self-stretch rounded-none px-0 py-2 hover:bg-transparent"
            >
              <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground">#{execution.id}</span>
              <GraphExecutionStatusPill status={execution.status} className="w-16 justify-center" />
              <span className="flex min-w-0 flex-1 items-center gap-1">
                {visualArtifacts.length > 0 ? (
                  <>
                    {visualArtifacts.slice(0, 3).map((artifact) => (
                      <img key={artifact.id} src={getArtifactPreviewUrl(artifact) ?? undefined} alt="" loading="lazy" className="size-8 shrink-0 rounded-sm bg-fill object-cover" />
                    ))}
                    {visualArtifacts.length > 3 ? <span className="ml-1 font-mono text-2xs text-muted-foreground">+{formatNumber(visualArtifacts.length - 3)}</span> : null}
                  </>
                ) : errorText ? (
                  <span className="truncate text-xs text-destructive">{errorText}</span>
                ) : (
                  <span className="truncate text-xs text-muted-foreground">{getExecutionModeLabel(plan, t)}</span>
                )}
              </span>
              <span className="shrink-0 text-right font-mono text-2xs text-muted-foreground">{formatDateTime(execution.created_date)}</span>
            </Button>
            {isActive ? (
              <IconButton size="icon-xs" variant="ghost" onClick={() => onCancelExecution(execution)} disabled={!canExecuteGeneration || cancellingExecutionId === execution.id || execution.cancel_requested} label={t({ ko: '실행 취소', en: 'Cancel run' })}>
                <Square />
              </IconButton>
            ) : retryable ? (
              <IconButton size="icon-xs" variant="ghost" onClick={() => onRetryExecution(execution)} disabled={!canExecuteGeneration || isExecutingGraph} label={t({ ko: '다시 실행', en: 'Run again' })}>
                <RotateCcw />
              </IconButton>
            ) : <span className="size-6 shrink-0" />}
          </div>
        )
      })}

      {hasMore && executionListPaging ? (
        <div className="flex justify-center py-3">
          <Button type="button" size="sm" variant="secondary" onClick={executionListPaging.onLoadMore} disabled={executionListPaging.isLoadingMore}>
            {executionListPaging.isLoadingMore ? t({ ko: '불러오는 중…', en: 'Loading…' }) : t({ ko: '더 보기', en: 'Load more' })}
          </Button>
        </div>
      ) : null}

      {isDetailOpen && executionDetailIsError ? (
        <ErrorState size="compact" title={t({ ko: '실행 상세를 못 불러왔어', en: 'Could not load the run' })} description={executionDetailError} />
      ) : null}

      {detailMatches ? (
        <GraphExecutionDetailModal
          open={isDetailOpen}
          onClose={() => setIsDetailOpen(false)}
          executionDetail={detailMatches}
          selectedGraph={selectedGraph}
          nodeLabelOverrides={nodeLabelOverrides}
          selectedExecutionPlan={detailPlan}
          executionInputEntries={detailInputEntries}
          finalResults={detailMatches.final_results ?? []}
          resultContent={(
            <SelectedExecutionSummary
              executionDetail={detailMatches}
              selectedGraph={selectedGraph}
              nodeLabelOverrides={nodeLabelOverrides}
              selectedExecutionPlan={detailPlan}
              finalResults={detailMatches.final_results ?? []}
              compactArtifactGroups={detailArtifactGroups}
            />
          )}
        />
      ) : null}
    </div>
  )
}
