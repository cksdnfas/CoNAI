import type { ReactNode } from 'react'
import { Boxes, Copy, RotateCcw, SlidersHorizontal, Trash2, Unplug, Workflow } from 'lucide-react'
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
  edgesCount: number
  hasSelectedNode: boolean
  hasSelectedEdge: boolean
  graphCanvas: ReactNode
  workflowEditorSupportPanels: ReactNode
  isEditorSupportOpen: boolean
  editorSupportTitle: string
  editorSupportSubtitle?: ReactNode
  onOpenModuleLibrary: () => void
  onAutoLayout: () => void
  onDuplicateSelectedNode: () => void
  onRemoveSelectedNode: () => void
  onRemoveSelectedEdge: () => void
  onResetCanvas: () => void
  onOpenEditorSupport: () => void
  onCloseEditorSupport: () => void
}

/** Render the edit-mode layout with graph canvas controls and the editor support drawer. */
export function ModuleWorkflowEditorView({
  isDesktopPageLayout,
  workflowListSidebar,
  nodesCount,
  edgesCount,
  hasSelectedNode,
  hasSelectedEdge,
  graphCanvas,
  workflowEditorSupportPanels,
  isEditorSupportOpen,
  editorSupportTitle,
  editorSupportSubtitle,
  onOpenModuleLibrary,
  onAutoLayout,
  onDuplicateSelectedNode,
  onRemoveSelectedNode,
  onRemoveSelectedEdge,
  onResetCanvas,
  onOpenEditorSupport,
  onCloseEditorSupport,
}: ModuleWorkflowEditorViewProps) {
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
                  <Badge variant="outline">노드 {nodesCount}</Badge>
                  <Badge variant="outline">엣지 {edgesCount}</Badge>
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
          편집 도구
        </FloatingBottomAction>

        <BottomDrawerSheet
          open={isEditorSupportOpen}
          title={editorSupportTitle}
          subtitle={editorSupportSubtitle}
          ariaLabel="워크플로우 편집 도구"
          onClose={onCloseEditorSupport}
          className={isDesktopPageLayout ? 'inset-x-auto left-1/2 w-[min(80vw,1400px)] -translate-x-1/2' : undefined}
          bodyClassName="space-y-4 px-4 py-4 sm:px-6"
        >
          {workflowEditorSupportPanels}
        </BottomDrawerSheet>
      </div>
    </div>
  )
}
