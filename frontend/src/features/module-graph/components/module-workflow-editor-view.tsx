import { useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Boxes, CheckCircle2, Copy, RotateCcw, Save, SlidersHorizontal, Trash2, Unplug, Workflow } from 'lucide-react'
import type { WorkflowValidationIssue } from './workflow-validation-panel'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { BottomDrawerSheet } from '@/components/ui/bottom-drawer-sheet'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FloatingBottomAction } from '@/components/ui/floating-bottom-action'
import { Badge } from '@/components/ui/badge'
import { SectionHeading } from '@/components/common/section-heading'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { SavedGraphWorkflowSummary } from '../saved-graph-list-summary'

interface ModuleWorkflowEditorViewProps {
  isDesktopPageLayout: boolean
  workflowListSidebar: ReactNode
  nodesCount: number
  graphSummary: SavedGraphWorkflowSummary
  graphCanvas: ReactNode
  workflowEditorSupportPanels: ReactNode
  workflowSaveModal?: ReactNode
  workflowDebugMode: boolean
  isEditorSupportOpen: boolean
  editorSupportTitle: string
  editorSupportSubtitle?: ReactNode
  validationIssues: WorkflowValidationIssue[]
  onValidationIssueSelect: (issue: WorkflowValidationIssue) => void
  onOpenModuleLibrary: () => void
  onOpenSaveModal: () => void
  onWorkflowDebugModeToggle: () => void
  onAutoLayout: () => void
  onDuplicateSelectedNode: () => void
  onRemoveSelectedNode: () => void
  onRemoveSelectedEdge: () => void
  onResetCanvas: () => void
  onOpenEditorSupport: () => void
  onCloseEditorSupport: () => void
  hasSelectedNode: boolean
  hasSelectedEdge: boolean
}

type ValidationStatusTone = 'ready' | 'warning' | 'error'

function WorkflowValidationQuickPopup({
  issues,
  onIssueSelect,
  onClose,
}: {
  issues: WorkflowValidationIssue[]
  onIssueSelect: (issue: WorkflowValidationIssue) => void
  onClose: () => void
}) {
  const { t, formatNumber } = useI18n()
  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length

  return (
    <div className="w-[min(360px,calc(100vw-2rem))] p-3">
      <div className="flex items-center justify-between gap-2 border-b border-border/70 pb-2">
        <div>
          <div className="text-xs font-semibold tracking-[0.08em] text-muted-foreground">{t({ ko: '편집기 검증', en: 'Editor validation' })}</div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {errorCount > 0 ? t({ ko: '막히는 치명 이슈가 있어.', en: 'There is a blocking critical issue.' }) : t({ ko: '저장 전 확인할 경고가 있어.', en: 'There are warnings to review before saving.' })}
          </div>
        </div>
        <Button type="button" size="icon-xs" variant="ghost" onClick={onClose} aria-label={t({ ko: '검증 팝업 닫기', en: 'Close validation popup' })} title={t({ ko: '닫기', en: 'Close' })}>
          <span className="text-xs">✕</span>
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Badge variant={errorCount > 0 ? 'outline' : 'secondary'}>{errorCount > 0 ? t({ ko: '치명 {count}', en: 'Critical {count}' }, { count: formatNumber(errorCount) }) : 'ready'}</Badge>
        {warningCount > 0 ? <Badge variant="outline">{t({ ko: '경고 {count}', en: 'Warnings {count}' }, { count: formatNumber(warningCount) })}</Badge> : null}
      </div>

      <div className="mt-3 space-y-2">
        {issues.map((issue) => (
          <button
            key={issue.id}
            type="button"
            onClick={() => {
              onIssueSelect(issue)
              onClose()
            }}
            className={cn(
              'w-full rounded-sm border px-3 py-2 text-left transition hover:border-primary/50 hover:bg-surface-high',
              issue.severity === 'error' ? 'border-rose-500/40 bg-rose-500/10' : 'border-amber-500/40 bg-amber-500/10',
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-medium text-foreground">{issue.title}</div>
              <Badge variant={issue.severity === 'error' ? 'outline' : 'secondary'}>{issue.severity === 'error' ? t({ ko: '치명', en: 'Critical' }) : t({ ko: '경고', en: 'Warning' })}</Badge>
              <Badge variant="secondary">{issue.nodeLabel}</Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{issue.detail}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function getValidationStatus(issues: WorkflowValidationIssue[], t: ReturnType<typeof useI18n>['t'], formatNumber: ReturnType<typeof useI18n>['formatNumber']) {
  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length

  if (errorCount > 0) {
    return {
      tone: 'error' as ValidationStatusTone,
      title: t({ ko: '검증 치명 이슈 {count}개', en: 'Validation critical issues {count}' }, { count: formatNumber(errorCount) }),
    }
  }

  if (warningCount > 0) {
    return {
      tone: 'warning' as ValidationStatusTone,
      title: t({ ko: '검증 경고 {count}개', en: 'Validation warnings {count}' }, { count: formatNumber(warningCount) }),
    }
  }

  return {
    tone: 'ready' as ValidationStatusTone,
    title: t({ ko: '검증 완료', en: 'Validation complete' }),
  }
}

/** Render the edit-mode layout with graph canvas controls and the execution-results drawer. */
export function ModuleWorkflowEditorView({
  isDesktopPageLayout,
  workflowListSidebar,
  nodesCount,
  graphSummary,
  graphCanvas,
  workflowEditorSupportPanels,
  workflowSaveModal,
  workflowDebugMode,
  isEditorSupportOpen,
  editorSupportTitle,
  editorSupportSubtitle,
  validationIssues,
  onValidationIssueSelect,
  onOpenModuleLibrary,
  onOpenSaveModal,
  onWorkflowDebugModeToggle,
  onAutoLayout,
  onDuplicateSelectedNode,
  onRemoveSelectedNode,
  onRemoveSelectedEdge,
  onResetCanvas,
  onOpenEditorSupport,
  onCloseEditorSupport,
  hasSelectedNode,
  hasSelectedEdge,
}: ModuleWorkflowEditorViewProps) {
  const { t, formatNumber } = useI18n()
  const [isValidationPopupOpen, setIsValidationPopupOpen] = useState(false)
  const validationPopupRef = useRef<HTMLDivElement | null>(null)
  const validationStatus = useMemo(() => getValidationStatus(validationIssues, t, formatNumber), [formatNumber, t, validationIssues])
  const graphSummaryLabel = [
    t({ ko: '노드 {count}', en: 'Nodes {count}' }, { count: formatNumber(graphSummary.nodeCount) }),
    t({ ko: '연결 {count}', en: 'Edges {count}' }, { count: formatNumber(graphSummary.edgeCount) }),
    t({ ko: '결과 {count}', en: 'Results {count}' }, { count: formatNumber(graphSummary.finalResultNodeCount) }),
  ].join(' · ')

  return (
    <div className={cn('grid gap-6', isDesktopPageLayout ? 'grid-cols-[320px_minmax(0,1fr)]' : 'grid-cols-1')}>
      {workflowListSidebar}

      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-4">
            <SectionHeading
              variant="inside"
              heading={
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <span className="inline-flex items-center gap-2">
                    <Boxes className="h-4 w-4 text-primary" />
                    {t({ ko: '워크플로우 그래프', en: 'Workflow Graph' })}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground" title={graphSummaryLabel}>
                    {graphSummaryLabel}
                  </span>
                </span>
              }
              actions={
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onOpenSaveModal}
                    aria-label={t({ ko: '워크플로우 저장', en: 'Save workflow' })}
                    title={t({ ko: '워크플로우 저장', en: 'Save workflow' })}
                  >
                    <Save className="h-4 w-4" />
                    {t({ ko: '저장', en: 'Save' })}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={workflowDebugMode ? 'default' : 'outline'}
                    onClick={onWorkflowDebugModeToggle}
                    aria-pressed={workflowDebugMode}
                    aria-label={workflowDebugMode ? t({ ko: '워크플로우 디버그 모드 끄기', en: 'Turn off workflow debug mode' }) : t({ ko: '워크플로우 디버그 모드 켜기', en: 'Turn on workflow debug mode' })}
                    title={t({ ko: '워크플로우 디버그 모드', en: 'Workflow debug mode' })}
                  >
                    {t({ ko: '디버그', en: 'Debug' })} {workflowDebugMode ? 'ON' : 'OFF'}
                  </Button>
                  <div ref={validationPopupRef} className="relative">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      className={cn(
                        validationStatus.tone === 'ready' ? 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200' : undefined,
                        validationStatus.tone === 'warning' ? 'border-amber-500/30 text-amber-200 hover:bg-amber-500/10 hover:text-amber-100' : undefined,
                        validationStatus.tone === 'error' ? 'border-rose-500/30 text-rose-200 hover:bg-rose-500/10 hover:text-rose-100' : undefined,
                      )}
                      onClick={() => {
                        if (validationIssues.length > 0) {
                          setIsValidationPopupOpen((open) => !open)
                        }
                      }}
                      aria-label={validationStatus.title}
                      title={validationStatus.title}
                    >
                      {validationStatus.tone === 'ready' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    </Button>

                    <AnchoredPopup open={isValidationPopupOpen && validationIssues.length > 0} anchorRef={validationPopupRef} onClose={() => setIsValidationPopupOpen(false)} align="end" side="bottom" closeOnBack>
                      <WorkflowValidationQuickPopup
                        issues={validationIssues}
                        onIssueSelect={onValidationIssueSelect}
                        onClose={() => setIsValidationPopupOpen(false)}
                      />
                    </AnchoredPopup>
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    onClick={onOpenModuleLibrary}
                    aria-label={t({ ko: '모듈 추가', en: 'Add module' })}
                    title={t({ ko: '모듈 추가', en: 'Add module' })}
                  >
                    <Boxes className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    onClick={onAutoLayout}
                    disabled={nodesCount === 0}
                    aria-label={t({ ko: '자동 정렬', en: 'Auto layout' })}
                    title={t({ ko: '자동 정렬', en: 'Auto layout' })}
                  >
                    <Workflow className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    onClick={onDuplicateSelectedNode}
                    disabled={!hasSelectedNode}
                    aria-label={t({ ko: '노드 복제', en: 'Duplicate node' })}
                    title={t({ ko: '노드 복제', en: 'Duplicate node' })}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="ml-1 border-rose-500/30 text-rose-200 hover:bg-rose-500/10 hover:text-rose-100"
                    onClick={onRemoveSelectedNode}
                    disabled={!hasSelectedNode}
                    aria-label={t({ ko: '노드 삭제', en: 'Delete node' })}
                    title={t({ ko: '노드 삭제', en: 'Delete node' })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="border-rose-500/30 text-rose-200 hover:bg-rose-500/10 hover:text-rose-100"
                    onClick={onRemoveSelectedEdge}
                    disabled={!hasSelectedEdge}
                    aria-label={t({ ko: '엣지 삭제', en: 'Delete edge' })}
                    title={t({ ko: '엣지 삭제', en: 'Delete edge' })}
                  >
                    <Unplug className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="ml-2 border-amber-500/30 text-amber-200 hover:bg-amber-500/10 hover:text-amber-100"
                    onClick={onResetCanvas}
                    aria-label={t({ ko: '초기화', en: 'Reset' })}
                    title={t({ ko: '초기화', en: 'Reset' })}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </>
              }
            />

            {graphCanvas}
          </CardContent>
        </Card>

        <FloatingBottomAction type="button" onClick={onOpenEditorSupport}>
          <SlidersHorizontal className="h-4 w-4" />
          {t({ ko: '실행 결과', en: 'Execution Results' })}
        </FloatingBottomAction>

        <BottomDrawerSheet
          open={isEditorSupportOpen}
          title={editorSupportTitle}
          subtitle={editorSupportSubtitle}
          ariaLabel={t({ ko: '워크플로우 실행 결과', en: 'Workflow execution results' })}
          onClose={onCloseEditorSupport}
          surfaceVariant="controller"
          className={isDesktopPageLayout ? 'inset-x-auto left-1/2 w-[min(80vw,1400px)] -translate-x-1/2' : undefined}
          bodyClassName="space-y-4 px-4 py-4 sm:px-5"
          footer={null}
          hideHandle
        >
          {workflowEditorSupportPanels}
        </BottomDrawerSheet>

        {workflowSaveModal}
      </div>
    </div>
  )
}
