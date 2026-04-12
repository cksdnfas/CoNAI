import { createPortal } from 'react-dom'
import { Boxes, Copy, Sparkles, Trash2, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type PaneActionMenuState = {
  kind: 'pane'
  anchor: { x: number; y: number }
}

type NodeActionMenuState = {
  kind: 'node'
  anchor: { x: number; y: number }
  nodeName: string
}

export type ModuleGraphActionMenuState = PaneActionMenuState | NodeActionMenuState

/** Render a compact horizontal quick menu for pane or node actions. */
export function ModuleGraphActionMenu({
  state,
  onOpenNodePicker,
  onDuplicateNode,
  onDisconnectAllConnections,
  onRemoveNode,
  onShowRecommendedNodes,
}: {
  state: ModuleGraphActionMenuState
  onOpenNodePicker: () => void
  onDuplicateNode: () => void
  onDisconnectAllConnections: () => void
  onRemoveNode: () => void
  onShowRecommendedNodes: () => void
}) {
  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-40">
      <div
        className={cn(
          'pointer-events-auto fixed min-w-[180px] rounded-sm border border-border/70 bg-background/92 p-1.5 shadow-[0_18px_48px_rgba(0,0,0,0.35)] backdrop-blur-md',
          state.kind === 'node' ? '-translate-x-1/2 -translate-y-full' : undefined,
        )}
        style={{ left: state.anchor.x, top: state.anchor.y }}
        role="dialog"
        aria-label="퀵 메뉴"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-2 py-1.5">
          <span className="text-[11px] font-semibold text-muted-foreground">퀵 메뉴</span>
          {state.kind === 'node' ? <span className="max-w-[112px] truncate text-[11px] text-muted-foreground">{state.nodeName}</span> : null}
        </div>

        <div className="mt-1 flex items-center gap-1">
          {state.kind === 'pane' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="h-8 w-8"
              onClick={onOpenNodePicker}
              title="노드 추가"
              aria-label="노드 추가"
            >
              <Boxes className="h-4 w-4" />
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8"
                onClick={onShowRecommendedNodes}
                title={`${state.nodeName} 추천 연결 노드`}
                aria-label="추천 연결 노드"
              >
                <Sparkles className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8"
                onClick={onDuplicateNode}
                title={`${state.nodeName} 복제`}
                aria-label="노드 복제"
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8"
                onClick={onDisconnectAllConnections}
                title={`${state.nodeName} 모든 연결 끊기`}
                aria-label="모든 연결 끊기"
              >
                <Unplug className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                onClick={onRemoveNode}
                title={`${state.nodeName} 삭제`}
                aria-label="노드 삭제"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
