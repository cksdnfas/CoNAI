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
import { getGraphWorkflowSchedules, type GraphExecutionArtifactRecord, type GraphExecutionFinalResultRecord, type GraphExecutionRecord, type GraphWorkflowExposedInput, type GraphWorkflowRecord } from '@/lib/api-module-graph'
import { WorkflowValidationPanel, type WorkflowValidationIssue } from './workflow-validation-panel'
import { WorkflowFinalResultsSection } from './workflow-final-results-section'
import { WorkflowInputFields } from './workflow-input-fields'

type WorkflowRunnerPanelProps = {
  selectedGraph: GraphWorkflowRecord | null
  inputDefinitions: GraphWorkflowExposedInput[]
  inputValues: Record<string, unknown>
  isExecuting: boolean
  latestExecution?: GraphExecutionRecord | null
  latestExecutionArtifacts?: GraphExecutionArtifactRecord[] | null
  latestExecutionFinalResults?: GraphExecutionFinalResultRecord[] | null
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
                  {latestExecution ? (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Badge variant={latestExecution.status === 'completed' ? 'secondary' : 'outline'}>{latestExecution.status}</Badge>
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
                {latestExecution ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Badge variant={latestExecution.status === 'completed' ? 'secondary' : 'outline'}>{latestExecution.status}</Badge>
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
                  <Badge variant="outline">{latestExecution.status}</Badge>
                </AlertTitle>
                <AlertDescription className="pt-3">
                  {latestExecutionArtifacts && latestExecutionFinalResults ? (
                    <WorkflowFinalResultsSection
                      finalResults={latestExecutionFinalResults}
                      artifacts={latestExecutionArtifacts}
                      selectedGraph={selectedGraph}
                      emptyLabel={t({ ko: '아직 선언된 최종 결과가 없어. 최종 결과 노드를 추가하고 원하는 출력에 연결해줘.', en: 'No final result is declared yet. Add a final result node and connect it to the output you want.' })}
                    />
                  ) : (
                    <div className="text-sm text-muted-foreground">{t({ ko: '최종 결과를 불러오는 중…', en: 'Loading final results…' })}</div>
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
