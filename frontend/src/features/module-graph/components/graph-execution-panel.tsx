import { useMemo, useState } from 'react'
import { Play, RotateCcw, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Section } from '@/components/ui/section'
import { useI18n } from '@/i18n'
import type {
  GraphExecutionListMeta,
  GraphExecutionRecord,
  GraphWorkflowRecord,
} from '@/lib/api-module-graph'
import { getGraphExecutionStatusLabel } from '../module-graph-shared'
import {
  getExecutionInputEntries,
  getExecutionModeLabel,
  groupArtifactsByNode,
  isCompactExecutionArtifactVisible,
  parseExecutionPlan,
} from './graph-execution-panel-helpers'
import { GraphExecutionDetailModal } from './graph-execution-detail-modal'
import { getExecutionStatusBadgeVariant, type GraphExecutionDetail } from './graph-execution-shared-ui'
import { SelectedExecutionSummary } from './graph-execution-summary'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadingState } from '@/components/ui/loading-state'
import { ErrorState } from '@/components/ui/error-state'

/** Server-side run counts and "load more" wiring for the capped run list. */
export type GraphExecutionListPaging = {
  meta: GraphExecutionListMeta | null
  isLoadingMore: boolean
  onLoadMore: () => void
}

type GraphExecutionPanelProps = {
  selectedGraphId: number | null
  selectedGraph?: GraphWorkflowRecord | null
  nodeLabelOverrides?: Record<string, string> | null
  selectedExecutionId: number | null
  selectedExecutionStatus?: GraphExecutionRecord['status'] | null
  executionList: GraphExecutionRecord[]
  executionListPaging?: GraphExecutionListPaging
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
  executionListPaging,
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
  showHeader = true,
}: GraphExecutionPanelProps) {
  const { t, formatNumber, formatDateTime } = useI18n()
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)

  const queuedExecutions = executionList
    .filter((execution) => execution.status === 'queued')
    .sort((left, right) => (left.queue_position ?? Number.MAX_SAFE_INTEGER) - (right.queue_position ?? Number.MAX_SAFE_INTEGER))
  const runningExecutions = executionList.filter((execution) => execution.status === 'running')
  // Counts come from the server so they stay right even when the list below is only the newest page.
  const executionListMeta = executionListPaging?.meta ?? null
  const queuedCount = executionListMeta?.queued_count ?? queuedExecutions.length
  const runningCount = executionListMeta?.running_count ?? runningExecutions.length
  const totalExecutionCount = executionListMeta?.total ?? executionList.length
  const hasMoreExecutions = executionListMeta?.has_more === true
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


  const actionButtons = (
    <div className="flex items-center gap-1">
      <IconButton
        size="icon-sm"
        variant="ghost"
        onClick={onCancelExecution}
        disabled={isCancellingExecution || (selectedExecutionStatus !== 'queued' && selectedExecutionStatus !== 'running')}
        label={isCancellingExecution ? t({ ko: '실행 취소 요청 중', en: 'Requesting run cancel' }) : t({ ko: '실행 취소', en: 'Cancel run' })}
      >
        <Square className="h-4 w-4" />
      </IconButton>
      <IconButton
        size="icon-sm"
        variant="ghost"
        onClick={onRetryExecution}
        disabled={!retryable || isExecutingGraph}
        label={t({ ko: '실행 다시 시도', en: 'Retry run' })}
      >
        <RotateCcw className="h-4 w-4" />
      </IconButton>
      <IconButton
        size="icon-sm"
        variant="ghost"
        onClick={onRerunGraph}
        disabled={!selectedGraphId || isExecutingGraph}
        label={isExecutingGraph ? t({ ko: '워크플로우 실행 중', en: 'Workflow running' }) : t({ ko: '워크플로우 재실행', en: 'Rerun workflow' })}
      >
        <Play className="h-4 w-4" />
      </IconButton>
    </div>
  )


  return (
    <>
      <Section
        heading={showHeader ? t({ ko: '실행 결과', en: 'Run results' }) : undefined}
        actions={showHeader ? actionButtons : undefined}
      >

        {!showHeader ? <div className="flex justify-end">{actionButtons}</div> : null}

        {!selectedGraphId ? (
          <EmptyState size="compact" title={t({ ko: '그래프를 먼저 골라줘', en: 'Choose a graph first' })} />
        ) : null}

        {selectedGraphId && executionListIsError ? (
          <ErrorState size="compact" title={t({ ko: '실행 목록 오류', en: 'Run list error' })} description={executionListError} />
        ) : null}

        {selectedGraphId && executionList.length === 0 ? (
          <EmptyState size="compact" title={t({ ko: '실행 기록이 없어', en: 'There is no run history' })} />
        ) : null}

        {selectedGraphId && (queuedCount > 0 || runningCount > 0) ? (
          <div className="flex flex-wrap items-center gap-2 border-y border-line py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {t({ ko: '대기 {queued} · 실행 중 {running}', en: 'Queued {queued} · Running {running}' }, { queued: formatNumber(queuedCount), running: formatNumber(runningCount) })}
            </span>
            {activeRunningExecution ? <span>{t({ ko: '실행 #{id}', en: 'Run #{id}' }, { id: activeRunningExecution.id })}</span> : null}
            {nextQueuedExecution ? <span>{t({ ko: '다음 #{id} · {position}', en: 'Next #{id} · {position}' }, { id: nextQueuedExecution.id, position: nextQueuedExecution.queue_position ?? '?' })}</span> : null}
          </div>
        ) : null}

        <div className="space-y-1.5">
          {executionList.map((execution) => {
            const plan = parseExecutionPlan(execution.execution_plan)
            const modeLabel = getExecutionModeLabel(plan, t)
            const isSelected = selectedExecutionId === execution.id
            const selectedDetailMatches = isSelected && executionDetail?.execution.id === execution.id

            return (
              <div key={execution.id} className="space-y-1.5">
                <Button
                  type="button"
                  variant="nav"
                  data-active={isSelected}
                  aria-expanded={isSelected}
                  onClick={() => onSelectExecution(isSelected ? null : execution.id)}
                  className="h-auto flex-col items-stretch gap-1 px-2.5 py-2 whitespace-normal"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="text-sm font-medium text-foreground">#{execution.id}</span>
                      <Badge variant={getExecutionStatusBadgeVariant(execution.status)}>{getGraphExecutionStatusLabel(execution.status, t)}</Badge>
                      <Badge variant="outline">{modeLabel}</Badge>
                    </span>
                    <span className="text-2xs text-muted-foreground">{formatDateTime(execution.created_date)}</span>
                  </span>

                  {(execution.status === 'queued' && execution.queue_position) || execution.cancel_requested || execution.error_message ? (
                    <span className="flex flex-wrap gap-x-2 gap-y-1 text-2xs text-muted-foreground">
                      {execution.status === 'queued' && execution.queue_position ? <span>{t({ ko: '순번 {position}', en: 'Position {position}' }, { position: execution.queue_position })}</span> : null}
                      {execution.cancel_requested ? <span className="text-warning">{t({ ko: '취소 요청됨', en: 'Cancel requested' })}</span> : null}
                      {execution.error_message ? <span className="text-destructive line-clamp-1">{execution.error_message}</span> : null}
                    </span>
                  ) : null}
                </Button>

                {isSelected && executionDetailIsError ? (
                  <ErrorState size="compact" title={t({ ko: '실행 상세 오류', en: 'Run detail error' })} description={executionDetailError} />
                ) : null}

                {isSelected && !executionDetailIsError && !selectedDetailMatches ? (
                  <LoadingState variant="inline" label={t({ ko: '실행 결과 불러오는 중…', en: 'Loading run results…' })} />
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

        {selectedGraphId && executionList.length > 0 && (hasMoreExecutions || totalExecutionCount > executionList.length) ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{t({ ko: '최근 {shown}개 표시 · 전체 {total}개', en: 'Showing latest {shown} of {total}' }, { shown: formatNumber(executionList.length), total: formatNumber(totalExecutionCount) })}</span>
            {hasMoreExecutions && executionListPaging ? (
              <Button type="button" size="sm" variant="secondary" onClick={executionListPaging.onLoadMore} disabled={executionListPaging.isLoadingMore}>
                {executionListPaging.isLoadingMore ? t({ ko: '불러오는 중…', en: 'Loading…' }) : t({ ko: '더 보기', en: 'Load more' })}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Section>

      {executionDetail ? (
        <GraphExecutionDetailModal
          open={isDetailModalOpen}
          onClose={() => setIsDetailModalOpen(false)}
          executionDetail={executionDetail}
          selectedGraph={selectedGraph}
          nodeLabelOverrides={nodeLabelOverrides}
          selectedExecutionPlan={selectedExecutionPlan}
          executionInputEntries={executionInputEntries}
          finalResults={finalResults}
        />
      ) : null}
    </>
  )
}
