import { useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Boxes, Bug, CheckCircle2, Copy, RotateCcw, Save, SlidersHorizontal, Trash2, Unplug, Workflow, X } from 'lucide-react'
import type { WorkflowValidationIssue } from './workflow-validation-panel'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { BottomDrawerSheet } from '@/components/ui/bottom-drawer-sheet'
import { Button } from '@/components/ui/button'
import { FloatingBottomAction } from '@/components/ui/floating-bottom-action'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { SavedGraphWorkflowSummary } from '../saved-graph-list-summary'

interface ModuleWorkflowEditorViewProps {
  isDesktopPageLayout: boolean
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
      <div className="flex items-center justify-between gap-2 pb-1">
        <div>
          <Text as="div" variant="overline" className="font-semibold">{t({ ko: '편집기 검증', en: 'Editor validation' })}</Text>
          <div className="mt-1 text-sm font-medium text-foreground">
            {errorCount > 0 ? t({ ko: '막히는 치명 이슈가 있어.', en: 'There is a blocking critical issue.' }) : t({ ko: '저장 전 확인할 경고가 있어.', en: 'There are warnings to review before saving.' })}
          </div>
        </div>
        <IconButton size="icon-xs" variant="ghost" onClick={onClose} label={t({ ko: '검증 팝업 닫기', en: 'Close validation popup' })}>
          <X />
        </IconButton>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Badge variant={errorCount > 0 ? 'destructive' : 'secondary'}>{errorCount > 0 ? t({ ko: '치명 {count}', en: 'Critical {count}' }, { count: formatNumber(errorCount) }) : 'ready'}</Badge>
        {warningCount > 0 ? <Badge className="bg-warning-soft text-warning-soft-foreground">{t({ ko: '경고 {count}', en: 'Warnings {count}' }, { count: formatNumber(warningCount) })}</Badge> : null}
      </div>

      <div className="mt-2 space-y-0.5">
        {issues.map((issue) => (
          <Button
            key={issue.id}
            type="button"
            variant="ghost"
            onClick={() => {
              onIssueSelect(issue)
              onClose()
            }}
            className="h-auto w-full flex-col items-stretch gap-1 px-2.5 py-2 text-left whitespace-normal"
          >
            <span className="flex flex-wrap items-center gap-2">
              <AlertTriangle className={cn('size-4', issue.severity === 'error' ? 'text-destructive' : 'text-warning')} aria-hidden />
              <span className="text-sm font-medium text-foreground">{issue.title}</span>
              <Badge variant="outline">{issue.severity === 'error' ? t({ ko: '치명', en: 'Critical' }) : t({ ko: '경고', en: 'Warning' })}</Badge>
              <Badge variant="secondary">{issue.nodeLabel}</Badge>
            </span>
            <span className="pl-6 text-xs font-normal text-muted-foreground">{issue.detail}</span>
          </Button>
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
    <div>
      <div className="space-y-6">
        <Section
          headingAs="div"
          heading={
                <Tip content={graphSummaryLabel}>
                  <span className="inline-flex items-center gap-2 text-sm font-semibold">
                    <Boxes className="h-4 w-4 text-primary" />
                    {t({ ko: '워크플로우 그래프', en: 'Workflow Graph' })}
                  </span>
                </Tip>
              }
              actions={
                <>
                  <Button
                    type="button"
                    size="sm"
                    onClick={onOpenSaveModal}
                    aria-label={t({ ko: '워크플로우 저장', en: 'Save workflow' })}
                  >
                    <Save className="h-4 w-4" />
                    {t({ ko: '저장', en: 'Save' })}
                  </Button>
                  <IconButton
                    size="icon-sm"
                    variant="ghost"
                    onClick={onWorkflowDebugModeToggle}
                    active={workflowDebugMode}
                    label={workflowDebugMode ? t({ ko: '워크플로우 디버그 모드 끄기', en: 'Turn off workflow debug mode' }) : t({ ko: '워크플로우 디버그 모드 켜기', en: 'Turn on workflow debug mode' })}
                  >
                    <Bug className="h-4 w-4" />
                  </IconButton>
                  <div ref={validationPopupRef} className="relative">
                    <IconButton
                      size="icon-sm"
                      variant="ghost"
                      data-tone={validationStatus.tone}
                      className={cn(
                        validationStatus.tone === 'ready' && 'text-success hover:text-success',
                        validationStatus.tone === 'warning' && 'text-warning hover:text-warning',
                        validationStatus.tone === 'error' && 'text-destructive hover:text-destructive',
                      )}
                      onClick={() => {
                        if (validationIssues.length > 0) {
                          setIsValidationPopupOpen((open) => !open)
                        }
                      }}
                      aria-expanded={validationIssues.length > 0 ? isValidationPopupOpen : undefined}
                      label={validationStatus.title}
                    >
                      {validationStatus.tone === 'ready' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    </IconButton>

                    <AnchoredPopup open={isValidationPopupOpen && validationIssues.length > 0} anchorRef={validationPopupRef} onClose={() => setIsValidationPopupOpen(false)} align="end" side="bottom" closeOnBack>
                      <WorkflowValidationQuickPopup
                        issues={validationIssues}
                        onIssueSelect={onValidationIssueSelect}
                        onClose={() => setIsValidationPopupOpen(false)}
                      />
                    </AnchoredPopup>
                  </div>
                  <IconButton
                    size="icon-sm"
                    variant="ghost"
                    onClick={onOpenModuleLibrary}
                    label={t({ ko: '모듈 추가', en: 'Add module' })}
                  >
                    <Boxes className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    size="icon-sm"
                    variant="ghost"
                    onClick={onAutoLayout}
                    disabled={nodesCount === 0}
                    label={t({ ko: '자동 정렬', en: 'Auto layout' })}
                  >
                    <Workflow className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    size="icon-sm"
                    variant="ghost"
                    onClick={onDuplicateSelectedNode}
                    disabled={!hasSelectedNode}
                    label={t({ ko: '노드 복제', en: 'Duplicate node' })}
                  >
                    <Copy className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    size="icon-sm"
                    variant="ghost"
                    className="ml-1 text-destructive hover:text-destructive"
                    onClick={onRemoveSelectedNode}
                    disabled={!hasSelectedNode}
                    label={t({ ko: '노드 삭제', en: 'Delete node' })}
                  >
                    <Trash2 className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    size="icon-sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={onRemoveSelectedEdge}
                    disabled={!hasSelectedEdge}
                    label={t({ ko: '엣지 삭제', en: 'Delete edge' })}
                  >
                    <Unplug className="h-4 w-4" />
                  </IconButton>
                  <IconButton
                    size="icon-sm"
                    variant="ghost"
                    className="ml-2 text-warning hover:text-warning"
                    onClick={onResetCanvas}
                    label={t({ ko: '초기화', en: 'Reset' })}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </IconButton>
                </>
              }
        >
          {graphCanvas}
        </Section>

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
