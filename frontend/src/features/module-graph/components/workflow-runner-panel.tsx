import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, Folder, PenSquare, Trash2 } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { Inset } from '@/components/ui/inset'
import { Section } from '@/components/ui/section'
import { ErrorState } from '@/components/ui/error-state'
import { LoadingState } from '@/components/ui/loading-state'
import { Tip } from '@/components/ui/tooltip'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { useI18n } from '@/i18n'
import type { GraphExecutionArtifactRecord, GraphExecutionFinalResultRecord, GraphExecutionLogRecord, GraphExecutionNodeIoRecord, GraphExecutionRecord, GraphWorkflowExposedInput, GraphWorkflowRecord } from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import { getGraphExecutionStatusLabel, localizeGraphWorkflowErrorMessage } from '../module-graph-shared'
import type { SavedGraphWorkflowSummary } from '../saved-graph-list-summary'
import { buildExecutionComparisonSummary, buildNodeDisplayLabelMap, getExecutionInputEntries, getNodeDisplayLabelFromMap, parseExecutionPlan } from './graph-execution-panel-helpers'
import { WorkflowValidationPanel, type WorkflowValidationIssue } from './workflow-validation-panel'
import { WorkflowFinalResultsSection } from './workflow-final-results-section'
import { buildFinalResultLifecycleWarningSourceLabel, listFinalResultLifecycleWarnings } from './workflow-execution-log-alerts'
import { WorkflowInputFields } from './workflow-input-fields'
import { GenerationTargetGroupControl } from '@/features/groups/components/generation-target-group-control'
import { buildGraphWorkflowTargetGroupKey } from '@/features/groups/generation-target-group-store'

type WorkflowRunnerPanelProps = {
  selectedGraph: GraphWorkflowRecord | null
  inputDefinitions: GraphWorkflowExposedInput[]
  inputValues: Record<string, unknown>
  isExecuting: boolean
  latestExecution?: GraphExecutionRecord | null
  latestExecutionArtifacts?: GraphExecutionArtifactRecord[] | null
  latestExecutionFinalResults?: GraphExecutionFinalResultRecord[] | null
  latestExecutionLogs?: GraphExecutionLogRecord[] | null
  latestExecutionNodeIo?: GraphExecutionNodeIoRecord[] | null
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
  latestExecutionNodeIo,
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
  const graphSummaryLine = graphSummary
    ? [
        t({ ko: '노드 {count}', en: 'Nodes {count}' }, { count: formatNumber(graphSummary.nodeCount) }),
        t({ ko: '연결 {count}', en: 'Edges {count}' }, { count: formatNumber(graphSummary.edgeCount) }),
        t({ ko: '결과 {count}', en: 'Results {count}' }, { count: formatNumber(graphSummary.finalResultNodeCount) }),
      ].join(' · ')
    : null
  const latestExecutionStatus = latestExecution?.status ?? null
  const latestExecutionStatusLabel = latestExecutionStatus ? getGraphExecutionStatusLabel(latestExecutionStatus, t) : null
  const shouldShowLatestExecutionResults = latestExecution?.status === 'completed'
  const latestExecutionFinalResultWarnings = useMemo(() => listFinalResultLifecycleWarnings(latestExecutionLogs), [latestExecutionLogs])
  const latestExecutionFinalResultWarning = latestExecutionFinalResultWarnings[0] ?? null
  const latestExecutionAdditionalWarningCount = Math.max(0, latestExecutionFinalResultWarnings.length - 1)
  const nodeLabelMap = useMemo(() => buildNodeDisplayLabelMap(selectedGraph), [selectedGraph])
  const latestExecutionFinalResultWarningSourceLabel = latestExecutionFinalResultWarning?.sourceNodeId
    ? buildFinalResultLifecycleWarningSourceLabel(
      latestExecutionFinalResultWarning,
      getNodeDisplayLabelFromMap(nodeLabelMap, latestExecutionFinalResultWarning.sourceNodeId),
    )
    : buildFinalResultLifecycleWarningSourceLabel(latestExecutionFinalResultWarning)
  const latestExecutionInputEntries = useMemo(
    () => getExecutionInputEntries(parseExecutionPlan(latestExecution?.execution_plan), inputDefinitions),
    [inputDefinitions, latestExecution?.execution_plan],
  )
  const latestExecutionComparisonSummary = useMemo(() => buildExecutionComparisonSummary({
    inputEntries: latestExecutionInputEntries,
    artifacts: latestExecutionArtifacts ?? [],
    finalResults: latestExecutionFinalResults ?? [],
    logs: latestExecutionLogs ?? [],
    nodeIo: latestExecutionNodeIo ?? [],
  }), [latestExecutionArtifacts, latestExecutionFinalResults, latestExecutionInputEntries, latestExecutionLogs, latestExecutionNodeIo])
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
          ? localizeGraphWorkflowErrorMessage(latestExecution.error_message, t, t({ ko: '실행에 실패해서 결과물이 없어.', en: 'This run failed, so there are no results to show.' }))
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
  const latestExecutionAttentionCount = latestExecutionFinalResultWarnings.length + latestExecutionComparisonSummary.issueLogCount
  const [isLatestResultExpanded, setIsLatestResultExpanded] = useState(false)
  const latestResultDetailsId = useId()
  const blockingIssueCount = validationIssues.filter((issue) => issue.severity === 'error').length
  const warningIssueCount = validationIssues.filter((issue) => issue.severity === 'warning').length
  const firstBlockingIssue = validationIssues.find((issue) => issue.severity === 'error') ?? null
  const runReadinessMessage = !selectedGraph
    ? t({ ko: '워크플로우를 먼저 선택해야 해.', en: 'Select a workflow first.' })
    : isExecuting
      ? t({ ko: '실행 요청을 보내는 중이야.', en: 'A run request is being sent.' })
      : !canExecute
        ? firstBlockingIssue
          ? t({ ko: '{title}부터 정리하면 실행할 수 있어.', en: 'Resolve {title} first, then run.' }, { title: firstBlockingIssue.title })
        : t({ ko: '치명 검증 이슈를 먼저 정리해야 해.', en: 'Resolve the critical validation issues first.' })
        : warningIssueCount > 0
          ? t({ ko: '실행은 가능하지만 경고 {count}개를 먼저 훑어봐.', en: 'The workflow can run, but review {count} warnings first.' }, { count: formatNumber(warningIssueCount) })
          : null
  const canRun = Boolean(selectedGraph) && !isExecuting && canExecute
  // Read at shortcut time (after a deferred tick) so pending input commits have re-rendered with fresh values.
  const runStateRef = useRef({ canRun, onExecute })
  useEffect(() => {
    runStateRef.current = { canRun, onExecute }
  })

  /** Run on Ctrl/Cmd+Enter from inside the panel (not from portalled modals), after committing the focused input. */
  const handleRunShortcut = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.nativeEvent.isComposing) {
      return
    }
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target) || !canRun) {
      return
    }

    event.preventDefault()
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Number inputs commit their draft on blur; blur first so the run uses what was typed.
    activeElement?.blur()
    window.setTimeout(() => {
      activeElement?.focus({ preventScroll: true })
      if (runStateRef.current.canRun) {
        runStateRef.current.onExecute()
      }
    }, 0)
  }

  return (
    <Section onKeyDown={handleRunShortcut} className="overflow-visible" bodyClassName="space-y-3.5">
        {showHeader ? (
          <SectionHeading
            variant="inside"
            heading={t({ ko: '워크플로우 실행기', en: 'Workflow Runner' })}
            actions={
              <Button type="button" size="sm" variant="secondary" onClick={onEdit} disabled={!selectedGraph}>
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
                  <Heading level={3} className="truncate">{selectedGraph.name}</Heading>
                  {selectedGraph.description ? <div className="text-sm text-muted-foreground">{selectedGraph.description}</div> : null}
                  {graphSummaryLine || latestExecutionStatus ? (
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
                      {graphSummaryLine ? <span title={graphSummaryLine}>{graphSummaryLine}</span> : null}
                      {latestExecutionStatusLabel ? <Badge variant={latestExecutionStatus === 'completed' ? 'secondary' : 'outline'}>{latestExecutionStatusLabel}</Badge> : null}
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  {onOpenFolderSettings ? (
                    <IconButton size="icon-sm" variant="secondary" onClick={onOpenFolderSettings} disabled={!selectedGraph} label={t({ ko: '폴더 설정', en: 'Folder settings' })}>
                      <Folder className="h-4 w-4" />
                    </IconButton>
                  ) : null}
                  <IconButton size="icon-sm" variant="secondary" onClick={onEdit} disabled={!selectedGraph} label={t({ ko: '구조 수정', en: 'Edit graph' })}>
                    <PenSquare className="h-4 w-4" />
                  </IconButton>
                  {onDeleteWorkflow ? (
                    <IconButton size="icon-sm" variant="secondary" onClick={onDeleteWorkflow} disabled={!selectedGraph} label={t({ ko: '워크플로우 삭제', en: 'Delete workflow' })}>
                      <Trash2 className="h-4 w-4" />
                    </IconButton>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Heading level={3}>{selectedGraph.name}</Heading>
                {selectedGraph.description ? <div className="text-sm text-muted-foreground">{selectedGraph.description}</div> : null}
                {graphSummaryLine || latestExecutionStatus ? (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
                    {graphSummaryLine ? <span title={graphSummaryLine}>{graphSummaryLine}</span> : null}
                    {latestExecutionStatusLabel ? <Badge variant={latestExecutionStatus === 'completed' ? 'secondary' : 'outline'}>{latestExecutionStatusLabel}</Badge> : null}
                  </div>
                ) : null}
              </div>
            )}

            {latestExecution ? (
              <Inset className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-sm font-medium text-foreground">{t({ ko: '최근 결과', en: 'Latest result' })}</span>
                  <Badge variant={latestExecution.status === 'completed' ? 'secondary' : 'outline'}>#{latestExecution.id}</Badge>
                  <Badge variant="outline">{getGraphExecutionStatusLabel(latestExecution.status, t)}</Badge>
                  {latestExecutionResultCountLabel ? (
                    <Badge variant={latestExecutionFinalResults && latestExecutionFinalResults.length > 0 ? 'secondary' : 'outline'}>{latestExecutionResultCountLabel}</Badge>
                  ) : null}
                  {!isLatestResultExpanded && latestExecutionAttentionCount > 0 ? (
                    <Badge variant="destructive">{t({ ko: '확인 필요 {count}', en: 'Needs review {count}' }, { count: formatNumber(latestExecutionAttentionCount) })}</Badge>
                  ) : null}
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    className="ml-auto"
                    aria-expanded={isLatestResultExpanded}
                    aria-controls={latestResultDetailsId}
                    onClick={() => setIsLatestResultExpanded((current) => !current)}
                  >
                    <ChevronDown className={cn('transition-transform', !isLatestResultExpanded && '-rotate-90')} aria-hidden />
                    {isLatestResultExpanded ? t({ ko: '접기', en: 'Hide' }) : t({ ko: '자세히', en: 'Details' })}
                  </Button>
                </div>

                {!isLatestResultExpanded && !shouldShowLatestExecutionResults && latestExecutionPendingMessage ? (
                  <div className="mt-1 truncate text-xs text-muted-foreground" title={latestExecutionPendingMessage}>{latestExecutionPendingMessage}</div>
                ) : null}

                {isLatestResultExpanded ? (
                  <div id={latestResultDetailsId} className="mt-3 space-y-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {latestExecutionArtifactCountLabel ? (
                        <Badge variant={latestExecutionArtifactCount && latestExecutionArtifactCount > 0 ? 'secondary' : 'outline'}>{latestExecutionArtifactCountLabel}</Badge>
                      ) : null}
                      <Badge variant="outline">{t({ ko: '입출력 {count}', en: 'I/O {count}' }, { count: formatNumber(latestExecutionComparisonSummary.compactInputCount + latestExecutionComparisonSummary.compactOutputCount) })}</Badge>
                      {latestExecutionComparisonSummary.issueLogCount > 0 ? (
                        <Badge variant="outline">{t({ ko: '경고/오류 {count}', en: 'Warnings/errors {count}' }, { count: formatNumber(latestExecutionComparisonSummary.issueLogCount) })}</Badge>
                      ) : null}
                    </div>
                    {latestExecutionFinalResultWarning ? (
                      <div role="status" className="rounded-sm bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
                        <div>
                          {latestExecutionFinalResultWarning.kind === 'source_artifact_missing'
                            ? latestExecutionFinalResultWarningSourceLabel
                              ? t({
                                ko: '최종 결과 노드는 실행됐지만 {source} 출력이 저장된 결과물을 만들지 못했어. 연결한 출력 포트를 확인해줘.',
                                en: 'The final result node ran, but the {source} output did not create a saved result. Check the connected output port.',
                              }, { source: latestExecutionFinalResultWarningSourceLabel })
                              : t({ ko: '최종 결과 노드는 실행됐지만 연결된 출력이 저장된 결과물을 만들지 못했어. 연결한 출력 포트를 확인해줘.', en: 'The final result node ran, but the connected output did not create a saved result. Check the connected output port.' })
                            : latestExecutionFinalResultWarningSourceLabel
                              ? t({
                                ko: '최종 결과는 저장됐지만 {source} 출력의 생성 기록 연결은 실패했어. 실행 상세 로그에서 원인을 확인해줘.',
                                en: 'The final result was saved, but linking the {source} output into generation history failed. Check the run logs for the cause.',
                              }, { source: latestExecutionFinalResultWarningSourceLabel })
                              : t({ ko: '최종 결과는 저장됐지만 생성 기록 연결은 실패했어. 실행 상세 로그에서 원인을 확인해줘.', en: 'The final result was saved, but linking it into generation history failed. Check the run logs for the cause.' })}
                        </div>
                        {latestExecutionAdditionalWarningCount > 0 ? (
                          <div className="mt-1 text-xs text-warning-soft-foreground/80">
                            {t({ ko: '추가 최종 결과 경고 {count}개가 더 있어. 실행 상세 로그에서 함께 확인해줘.', en: '{count} more final-result warnings are available in the run logs.' }, { count: formatNumber(latestExecutionAdditionalWarningCount) })}
                          </div>
                        ) : null}
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
                      latestExecutionDetailError ? (
                        <ErrorState size="compact" title={latestExecutionDetailError} />
                      ) : latestExecutionDetailIsLoading ? (
                        <LoadingState variant="inline" label={t({ ko: '최종 결과를 불러오는 중...', en: 'Loading final results...' })} />
                      ) : (
                        <div className="text-sm text-muted-foreground">{t({ ko: '최종 결과 정보를 불러오지 못했어.', en: 'Could not load final result details.' })}</div>
                      )
                    ) : (
                      <div className="text-sm text-muted-foreground">{latestExecutionPendingMessage}</div>
                    )}
                  </div>
                ) : null}
              </Inset>
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

            <div
              data-slot="workflow-run-action-row"
              className="sticky bottom-0 z-raised -mx-4 space-y-2 border-t border-outline-subtle bg-surface-low px-4 py-3"
            >
              {runReadinessMessage ? (
                <div
                  role="status"
                  className={cn(
                    'flex flex-wrap items-center gap-1.5 text-sm',
                    !canExecute && !isExecuting ? 'text-destructive' : warningIssueCount > 0 && !isExecuting ? 'text-warning' : 'text-muted-foreground',
                  )}
                >
                  {blockingIssueCount > 0 ? <Badge variant="destructive">{t({ ko: '치명 {count}', en: 'Critical {count}' }, { count: formatNumber(blockingIssueCount) })}</Badge> : null}
                  {warningIssueCount > 0 ? <Badge variant="outline">{t({ ko: '경고 {count}', en: 'Warnings {count}' }, { count: formatNumber(warningIssueCount) })}</Badge> : null}
                  <span className="min-w-0">{runReadinessMessage}</span>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Tip content={canRun ? t({ ko: 'Ctrl/⌘ + Enter로도 실행돼', en: 'Ctrl/⌘ + Enter also runs it' }) : null}>
                  <Button type="button" onClick={onExecute} disabled={!canRun} aria-keyshortcuts="Control+Enter Meta+Enter">
                    {isExecuting ? t({ ko: '실행 요청 중…', en: 'Requesting run…' }) : canExecute ? t({ ko: '실행', en: 'Run' }) : t({ ko: '실행 불가', en: 'Cannot run' })}
                  </Button>
                </Tip>
                <GenerationTargetGroupControl
                  storageKey={buildGraphWorkflowTargetGroupKey(selectedGraph.id)}
                  label={t({ ko: '기본 결과 그룹', en: 'Default result group' })}
                  disabled={isExecuting}
                  className="min-w-0"
                />
              </div>
            </div>
          </div>
        ) : null}
    </Section>
  )
}
