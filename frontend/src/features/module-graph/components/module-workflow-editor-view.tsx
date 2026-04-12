import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Boxes, CheckCircle2, Copy, RotateCcw, Save, SlidersHorizontal, Trash2, Unplug, Workflow } from 'lucide-react'
import type { WorkflowValidationIssue } from './workflow-validation-panel'
import { BottomDrawerSheet } from '@/components/ui/bottom-drawer-sheet'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FloatingBottomAction } from '@/components/ui/floating-bottom-action'
import { Badge } from '@/components/ui/badge'
import { SectionHeading } from '@/components/common/section-heading'
import { cn } from '@/lib/utils'

export interface ModuleWorkflowEditorViewProps {
  isDesktopPageLayout: boolean
  workflowListSidebar: ReactNode
  nodesCount: number
  graphCanvas: ReactNode
  workflowEditorSupportPanels: ReactNode
  workflowSaveModal?: ReactNode
  isEditorSupportOpen: boolean
  editorSupportTitle: string
  editorSupportSubtitle?: ReactNode
  validationIssues: WorkflowValidationIssue[]
  onValidationIssueSelect: (issue: WorkflowValidationIssue) => void
  onOpenModuleLibrary: () => void
  onOpenSaveModal: () => void
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
  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length

  return (
    <div className="absolute right-0 top-full z-20 mt-2 w-[min(360px,calc(100vw-2rem))] rounded-sm border border-border/70 bg-background/95 p-3 shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-md">
      <div className="flex items-center justify-between gap-2 border-b border-border/70 pb-2">
        <div>
          <div className="text-xs font-semibold tracking-[0.08em] text-muted-foreground">편집기 검증</div>
          <div className="mt-1 text-sm font-medium text-foreground">
            {errorCount > 0 ? '막히는 치명 이슈가 있어.' : warningCount > 0 ? '저장 전 확인할 경고가 있어.' : '지금 상태 좋아. 저장 진행해도 돼.'}
          </div>
        </div>
        <Button type="button" size="icon-xs" variant="ghost" onClick={onClose} aria-label="검증 팝업 닫기" title="닫기">
          <span className="text-xs">✕</span>
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Badge variant={errorCount > 0 ? 'outline' : 'secondary'}>{errorCount > 0 ? `치명 ${errorCount}` : 'ready'}</Badge>
        {warningCount > 0 ? <Badge variant="outline">경고 {warningCount}</Badge> : null}
      </div>

      {issues.length === 0 ? (
        <div className="mt-3 rounded-sm border border-border bg-surface-low px-3 py-2 text-sm text-muted-foreground">
          막히는 이슈는 없어. 저장 전에 이름이랑 폴더만 확인하면 돼.
        </div>
      ) : (
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
                <Badge variant={issue.severity === 'error' ? 'outline' : 'secondary'}>{issue.severity === 'error' ? '치명' : '경고'}</Badge>
                <Badge variant="secondary">{issue.nodeLabel}</Badge>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{issue.detail}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function getValidationStatus(issues: WorkflowValidationIssue[]) {
  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length

  if (errorCount > 0) {
    return {
      tone: 'error' as ValidationStatusTone,
      title: `검증 치명 이슈 ${errorCount}개`,
    }
  }

  if (warningCount > 0) {
    return {
      tone: 'warning' as ValidationStatusTone,
      title: `검증 경고 ${warningCount}개`,
    }
  }

  return {
    tone: 'ready' as ValidationStatusTone,
    title: '검증 완료',
  }
}

/** Render the edit-mode layout with graph canvas controls and the execution-results drawer. */
export function ModuleWorkflowEditorView({
  isDesktopPageLayout,
  workflowListSidebar,
  nodesCount,
  graphCanvas,
  workflowEditorSupportPanels,
  workflowSaveModal,
  isEditorSupportOpen,
  editorSupportTitle,
  editorSupportSubtitle,
  validationIssues,
  onValidationIssueSelect,
  onOpenModuleLibrary,
  onOpenSaveModal,
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
  const [isValidationPopupOpen, setIsValidationPopupOpen] = useState(false)
  const validationPopupRef = useRef<HTMLDivElement | null>(null)
  const validationStatus = useMemo(() => getValidationStatus(validationIssues), [validationIssues])

  useEffect(() => {
    if (!isValidationPopupOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!validationPopupRef.current?.contains(event.target as Node)) {
        setIsValidationPopupOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsValidationPopupOpen(false)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isValidationPopupOpen])

  return (
    <div className={cn('grid gap-6', isDesktopPageLayout ? 'grid-cols-[320px_minmax(0,1fr)]' : 'grid-cols-1')}>
      {workflowListSidebar}

      <div className="space-y-6">
        <Card>
          <CardContent className="space-y-4">
            <SectionHeading
              variant="inside"
              heading={
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Boxes className="h-4 w-4 text-primary" />
                  Workflow Graph
                </span>
              }
              actions={
                <>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    onClick={onOpenSaveModal}
                    aria-label="워크플로우 저장"
                    title="워크플로우 저장"
                  >
                    <Save className="h-4 w-4" />
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
                      onClick={() => setIsValidationPopupOpen((open) => !open)}
                      aria-label={validationStatus.title}
                      title={validationStatus.title}
                    >
                      {validationStatus.tone === 'ready' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                    </Button>

                    {isValidationPopupOpen ? (
                      <WorkflowValidationQuickPopup
                        issues={validationIssues}
                        onIssueSelect={onValidationIssueSelect}
                        onClose={() => setIsValidationPopupOpen(false)}
                      />
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    onClick={onOpenModuleLibrary}
                    aria-label="모듈 추가"
                    title="모듈 추가"
                  >
                    <Boxes className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    onClick={onAutoLayout}
                    disabled={nodesCount === 0}
                    aria-label="자동 정렬"
                    title="자동 정렬"
                  >
                    <Workflow className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    onClick={onDuplicateSelectedNode}
                    disabled={!hasSelectedNode}
                    aria-label="노드 복제"
                    title="노드 복제"
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
                    aria-label="노드 삭제"
                    title="노드 삭제"
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
                    aria-label="엣지 삭제"
                    title="엣지 삭제"
                  >
                    <Unplug className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="outline"
                    className="ml-2 border-amber-500/30 text-amber-200 hover:bg-amber-500/10 hover:text-amber-100"
                    onClick={onResetCanvas}
                    aria-label="초기화"
                    title="초기화"
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
          Execution Results
        </FloatingBottomAction>

        <BottomDrawerSheet
          open={isEditorSupportOpen}
          title={editorSupportTitle}
          subtitle={editorSupportSubtitle}
          ariaLabel="워크플로우 실행 결과"
          onClose={onCloseEditorSupport}
          className={isDesktopPageLayout ? 'inset-x-auto left-1/2 w-[min(80vw,1400px)] -translate-x-1/2' : undefined}
          bodyClassName="space-y-4 px-4 py-4 sm:px-6"
        >
          {workflowEditorSupportPanels}
        </BottomDrawerSheet>

        {workflowSaveModal}
      </div>
    </div>
  )
}
