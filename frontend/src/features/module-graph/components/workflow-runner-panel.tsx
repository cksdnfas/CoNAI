import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Folder, PenSquare, Trash2 } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { useI18n } from '@/i18n'
import { getGraphWorkflowSchedules, type GraphExecutionArtifactRecord, type GraphExecutionFinalResultRecord, type GraphExecutionLogRecord, type GraphExecutionRecord, type GraphWorkflowExposedInput, type GraphWorkflowRecord } from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import { getGraphExecutionStatusLabel, localizeGraphWorkflowErrorMessage } from '../module-graph-shared'
import type { SavedGraphWorkflowSummary } from '../saved-graph-list-summary'
import { WorkflowValidationPanel, type WorkflowValidationIssue } from './workflow-validation-panel'
import { WorkflowFinalResultsSection } from './workflow-final-results-section'
import { findFinalResultPromotionWarningLog } from './workflow-execution-log-alerts'
import { WorkflowInputFields } from './workflow-input-fields'

type WorkflowRunnerPanelProps = {
  selectedGraph: GraphWorkflowRecord | null
  inputDefinitions: GraphWorkflowExposedInput[]
  inputValues: Record<string, unknown>
  isExecuting: boolean
  latestExecution?: GraphExecutionRecord | null
  latestExecutionArtifacts?: GraphExecutionArtifactRecord[] | null
  latestExecutionFinalResults?: GraphExecutionFinalResultRecord[] | null
  latestExecutionLogs?: GraphExecutionLogRecord[] | null
  latestExecutionDetailIsLoading?: boolean
  latestExecutionDetailError?: string | null
  graphSummary?: SavedGraphWorkflowSummary | null
  onInputValueChange: (inputId: string, value: unknown) => void
  onInputValueClear: (inputId: string) => void
  onInputImageChange: (inputId: string, image?: SelectedImageDraft) => Promise<void> | void
  onExecute: () => void
  onEdit: () => void
  onDeleteWorkflow?: () => void
  onOpenFolderSettings?: () => void
  canExecute?: boolean
  validationIssues?: WorkflowValidationIssue[]
  onValidationIssueSelect?: (issue: WorkflowValidationIssue) => void
  showHeader?: boolean
}

/** Render workflow-level runtime inputs so users can run saved workflows without opening the graph editor. */
export function WorkflowRunnerPanel({
  selectedGraph,
  inputDefinitions,
  inputValues,
  isExecuting,
  latestExecution,
  latestExecutionArtifacts,
  latestExecutionFinalResults,
  latestExecutionLogs,
  latestExecutionDetailIsLoading = false,
  latestExecutionDetailError = null,
  graphSummary,
  onInputValueChange,
  onInputValueClear,
  onInputImageChange,
  onExecute,
  onEdit,
  onDeleteWorkflow,
  onOpenFolderSettings,
  canExecute = true,
  validationIssues = [],
  onValidationIssueSelect,
  showHeader = true,
}: WorkflowRunnerPanelProps) {
  const { t, formatNumber } = useI18n()
  const scheduleQuery = useQuery({
    queryKey: ['module-graph-workflow-schedules', selectedGraph?.id ?? null],
    queryFn: () => getGraphWorkflowSchedules({ workflowId: selectedGraph?.id ?? null }),
    enabled: selectedGraph !== null,
    staleTime: 10_000,
  })

  const reviewRequiredSchedules = useMemo(
    () => (scheduleQuery.data ?? []).filter((schedule) => schedule.stop_reason_code === 'workflow_changed'),
    [scheduleQuery.data],
  )
  const graphSummaryLine = graphSummary
    ? [
        t({ ko: '노드 {count}', en: 'Nodes {count}' }, { count: formatNumber(graphSummary.nodeCount) }),
        t({ ko: '연결 {count}', en: 'Edges {count}' }, { count: formatNumber(graphSummary.edgeCount) }),
        t({ ko: '결과 {count}', en: 'Results {count}' }, { count: formatNumber(graphSummary.finalResultNodeCount) }),
      ].join(' · ')
    : null
  const latestExecutionStatus = latestExecution?.status ?? null
  const latestExecutionStatusLabel = latestExecutionStatus ? getGraphExecutionStatusLabel(latestExecutionStatus) : null
  const shouldShowLatestExecutionResults = latestExecution?.status === 'completed'
  const latestExecutionPromotionWarningLog = useMemo(() => findFinalResultPromotionWarningLog(latestExecutionLogs), [latestExecutionLogs])
  const latestExecutionArtifactCount = shouldShowLatestExecutionResults && latestExecutionArtifacts ? latestExecutionArtifacts.length : null
  const latestExecutionEmptyResultLabel = graphSummary && graphSummary.finalResultNodeCount > 0
    ? latestExecutionArtifactCount && latestExecutionArtifactCount > 0
      ? t({
        ko: '원본 산출물 {count}개는 있지만 최종 결과로 확정된 출력은 없어. 최종 결과 노드가 원하는 출력 포트에 연결됐는지 확인해줘.',
        en: 'Final result nodes exist and {count} source artifacts were created, but this run did not finalize any outputs. Check whether the final result node is connected to the intended output port.',
      }, { count: formatNumber(latestExecutionArtifactCount) })
      : t({
        ko: '최종 결과 노드는 있지만 이번 실행에서 확정된 출력이 없어. 연결된 출력 노드가 실제 결과를 만들었는지 확인해줘.',
        en: 'Final result nodes exist, but this run did not finalize any outputs. Check whether the connected output node produced a result.',
      })
    : t({
      ko: '아직 선언된 최종 결과가 없어. 최종 결과 노드를 추가하고 원하는 출력에 연결해줘.',
      en: 'No final result is declared yet. Add a final result node and connect it to the output you want.',
    })
  const latestExecutionPendingMessage = latestExecution
    ? latestExecution.status === 'queued'
      ? t({ ko: '큐에서 대기 중이라 아직 결과물이 없어.', en: 'This run is queued, so results are not ready yet.' })
      : latestExecution.status === 'running'
        ? t({ ko: '실행 중이라 완료 후 결과물이 표시돼.', en: 'This run is still running; results will appear after it completes.' })
        : latestExecution.status === 'failed'
          ? localizeGraphWorkflowErrorMessage(latestExecution.error_message, t({ ko: '실행에 실패해서 결과물이 없어.', en: 'This run failed, so there are no results to show.' }))
            ?? t({ ko: '실행에 실패해서 결과물이 없어.', en: 'This run failed, so there are no results to show.' })
          : latestExecution.status === 'cancelled'
            ? t({ ko: '취소된 실행이라 결과물이 없어.', en: 'This run was cancelled, so there are no results to show.' })
            : latestExecution.status === 'draft'
              ? t({ ko: '아직 실행되지 않은 기록이야.', en: 'This run has not started yet.' })
              : null
    : null
  const latestExecutionResultCountLabel = shouldShowLatestExecutionResults && latestExecutionFinalResults
    ? t({ ko: '결과 {count}', en: 'Results {count}' }, { count: formatNumber(latestExecutionFinalResults.length) })
    : null
  const latestExecutionArtifactCountLabel = latestExecutionArtifactCount !== null
    ? t({ ko: '원본 {count}', en: 'Source {count}' }, { count: formatNumber(latestExecutionArtifactCount) })
    : null
  const latestExecutionDetailLoadMessage = latestExecutionDetailError
    ?? (latestExecutionDetailIsLoading ? t({ ko: '최종 결과를 불러오는 중...', en: 'Loading final results...' }) : t({ ko: '최종 결과 정보를 불러오지 못했어.', en: 'Could not load final result details.' }))

  return (
    <Card>
      <CardContent className="space-y-3.5">
        {showHeader ? (
          <SectionHeading
            variant="inside"
            heading={t({ ko: '워크플로우 실행기', en: 'Workflow Runner' })}
            actions={
              <Button type="button" size="sm" variant="outline" onClick={onEdit} disabled={!selectedGraph}>
                {t({ ko: '구조 수정', en: 'Edit graph' })}
              </Button>
            }
          />
        ) : null}

        {selectedGraph ? (
          <div className="space-y-3.5">
            {!showHeader ? (
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-2">
                  <div className="truncate text-base font-semibold text-foreground">{selectedGraph.name}</div>
                  {selectedGraph.description ? <div className="text-sm text-muted-foreground">{selectedGraph.description}</div> : null}
                  {graphSummaryLine || latestExecutionStatus ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                      {graphSummaryLine ? <span title={graphSummaryLine}>{graphSummaryLine}</span> : null}
                      {latestExecutionStatusLabel ? <Badge variant={latestExecutionStatus === 'completed' ? 'secondary' : 'outline'}>{latestExecutionStatusLabel}</Badge> : null}
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {onOpenFolderSettings ? (
                    <Button type="button" size="icon-sm" variant="outline" onClick={onOpenFolderSettings} disabled={!selectedGraph} aria-label={t({ ko: '폴더 설정', en: 'Folder settings' })} title={t({ ko: '폴더 설정', en: 'Folder settings' })}>
                      <Folder className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <Button type="button" size="icon-sm" variant="outline" onClick={onEdit} disabled={!selectedGraph} aria-label={t({ ko: '구조 수정', en: 'Edit graph' })} title={t({ ko: '구조 수정', en: 'Edit graph' })}>
                    <PenSquare className="h-4 w-4" />
                  </Button>
                  {onDeleteWorkflow ? (
                    <Button type="button" size="icon-sm" variant="outline" onClick={onDeleteWorkflow} disabled={!selectedGraph} aria-label={t({ ko: '워크플로우 삭제', en: 'Delete workflow' })} title={t({ ko: '워크플로우 삭제', en: 'Delete workflow' })}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-base font-semibold text-foreground">{selectedGraph.name}</div>
                {selectedGraph.description ? <div className="text-sm text-muted-foreground">{selectedGraph.description}</div> : null}
                {graphSummaryLine || latestExecutionStatus ? (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    {graphSummaryLine ? <span title={graphSummaryLine}>{graphSummaryLine}</span> : null}
                    {latestExecutionStatusLabel ? <Badge variant={latestExecutionStatus === 'completed' ? 'secondary' : 'outline'}>{latestExecutionStatusLabel}</Badge> : null}
                  </div>
                ) : null}
              </div>
            )}

            {reviewRequiredSchedules.length > 0 ? (
              <Alert>
                <AlertTitle className="flex flex-wrap items-center gap-1.5">
                  <span>{t({ ko: '자동 실행 재검토 필요', en: 'Auto-run review required' })}</span>
                  <Badge variant="outline">{t({ ko: '{count}개', en: '{count}' }, { count: formatNumber(reviewRequiredSchedules.length) })}</Badge>
                </AlertTitle>
                <AlertDescription className="pt-2 text-sm text-muted-foreground">
                  {t({ ko: '이 워크플로우가 바뀌어서 연결된 자동 실행이 일시정지됐어. 선택을 해제한 뒤 `예약작업` 탭에서 확인하고 다시 켜줘.', en: 'This workflow changed, so linked auto-runs were paused. Deselect it, then review and re-enable them in the `Schedules` tab.' })}
                </AlertDescription>
              </Alert>
            ) : null}

            {latestExecution ? (
              <Alert>
                <AlertTitle className="flex flex-wrap items-center gap-1.5">
                  <span>{t({ ko: '최근 결과', en: 'Latest result' })}</span>
                  <Badge variant={latestExecution.status === 'completed' ? 'secondary' : 'outline'}>#{latestExecution.id}</Badge>
                  <Badge variant="outline">{getGraphExecutionStatusLabel(latestExecution.status)}</Badge>
                  {latestExecutionArtifactCountLabel ? (
                    <Badge variant={latestExecutionArtifactCount && latestExecutionArtifactCount > 0 ? 'secondary' : 'outline'}>{latestExecutionArtifactCountLabel}</Badge>
                  ) : null}
                  {latestExecutionResultCountLabel ? (
                    <Badge variant={latestExecutionFinalResults && latestExecutionFinalResults.length > 0 ? 'secondary' : 'outline'}>{latestExecutionResultCountLabel}</Badge>
                  ) : null}
                </AlertTitle>
                <AlertDescription className="pt-3">
                  {latestExecutionPromotionWarningLog ? (
                    <div className="mb-3 rounded-sm border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                      {t({ ko: '최종 결과는 저장됐지만 생성 기록 연결은 실패했어. 실행 상세 로그에서 원인을 확인해줘.', en: 'The final result was saved, but linking it into generation history failed. Check the run logs for the cause.' })}
                    </div>
                  ) : null}
                  {shouldShowLatestExecutionResults && latestExecutionArtifacts && latestExecutionFinalResults ? (
                    <WorkflowFinalResultsSection
                      finalResults={latestExecutionFinalResults}
                      artifacts={latestExecutionArtifacts}
                      selectedGraph={selectedGraph}
                      emptyLabel={latestExecutionEmptyResultLabel}
                    />
                  ) : shouldShowLatestExecutionResults ? (
                    <div className={cn('text-sm', latestExecutionDetailError ? 'text-destructive' : 'text-muted-foreground')}>{latestExecutionDetailLoadMessage}</div>
                  ) : (
                    <div className="text-sm text-muted-foreground">{latestExecutionPendingMessage}</div>
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            <WorkflowValidationPanel
              issues={validationIssues}
              title={t({ ko: '실행 검증', en: 'Run validation' })}
              description={t({ ko: '실행 전 확인', en: 'Check before running' })}
              showHeader={false}
              onIssueSelect={onValidationIssueSelect}
            />

            <WorkflowInputFields
              inputDefinitions={inputDefinitions}
              inputValues={inputValues}
              onInputValueChange={onInputValueChange}
              onInputValueClear={onInputValueClear}
              onInputImageChange={onInputImageChange}
            />

            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="button" onClick={onExecute} disabled={isExecuting || !canExecute}>
                {isExecuting ? t({ ko: '실행 요청 중…', en: 'Requesting run…' }) : canExecute ? t({ ko: '실행', en: 'Run' }) : t({ ko: '실행 불가', en: 'Cannot run' })}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
