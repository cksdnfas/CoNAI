import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Folder, PenSquare, Trash2 } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { getGraphWorkflowSchedules, type GraphExecutionArtifactRecord, type GraphExecutionFinalResultRecord, type GraphExecutionRecord, type GraphWorkflowExposedInput, type GraphWorkflowRecord } from '@/lib/api'
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
            heading="Workflow Runner"
            actions={
              <Button type="button" size="sm" variant="outline" onClick={onEdit} disabled={!selectedGraph}>
                구조 수정
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
                    <Button type="button" size="icon-sm" variant="outline" onClick={onOpenFolderSettings} disabled={!selectedGraph} aria-label="폴더 설정" title="폴더 설정">
                      <Folder className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <Button type="button" size="icon-sm" variant="outline" onClick={onEdit} disabled={!selectedGraph} aria-label="구조 수정" title="구조 수정">
                    <PenSquare className="h-4 w-4" />
                  </Button>
                  {onDeleteWorkflow ? (
                    <Button type="button" size="icon-sm" variant="outline" onClick={onDeleteWorkflow} disabled={!selectedGraph} aria-label="워크플로우 삭제" title="워크플로우 삭제">
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
                  <span>자동 실행 재검토 필요</span>
                  <Badge variant="outline">{reviewRequiredSchedules.length}개</Badge>
                </AlertTitle>
                <AlertDescription className="pt-2 text-sm text-muted-foreground">
                  이 워크플로우가 바뀌어서 연결된 자동 실행이 일시정지됐어. 선택을 해제한 뒤 `대기열 · 빈 실행` 탭의 `자동 실행` 섹션에서 확인하고 다시 켜줘.
                </AlertDescription>
              </Alert>
            ) : null}

            {latestExecution ? (
              <Alert>
                <AlertTitle className="flex flex-wrap items-center gap-1.5">
                  <span>최근 결과</span>
                  <Badge variant={latestExecution.status === 'completed' ? 'secondary' : 'outline'}>#{latestExecution.id}</Badge>
                  <Badge variant="outline">{latestExecution.status}</Badge>
                </AlertTitle>
                <AlertDescription className="pt-3">
                  {latestExecutionArtifacts && latestExecutionFinalResults ? (
                    <WorkflowFinalResultsSection
                      finalResults={latestExecutionFinalResults}
                      artifacts={latestExecutionArtifacts}
                      selectedGraph={selectedGraph}
                      emptyLabel="아직 선언된 최종 결과가 없어. 최종 결과 노드를 추가하고 원하는 출력에 연결해줘."
                    />
                  ) : (
                    <div className="text-sm text-muted-foreground">최종 결과를 불러오는 중…</div>
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            <WorkflowValidationPanel
              issues={validationIssues}
              title="실행 검증"
              description="실행 전 확인"
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
                {isExecuting ? '실행 요청 중…' : canExecute ? '실행' : '실행 불가'}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
