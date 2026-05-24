import { createPortal } from 'react-dom'
import { Boxes, Copy, PowerOff, SlidersHorizontal, Sparkles, Trash2, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import { cn } from '@/lib/utils'

type PaneActionMenuState = {
  kind: 'pane'
  anchor: { x: number; y: number }
}

type NodeActionMenuState = {
  kind: 'node'
  anchor: { x: number; y: number }
  nodeName: string
  hasAdvancedOutputPorts?: boolean
  advancedOutputPortsEnabled?: boolean
  disabled?: boolean
}

export type ModuleGraphActionMenuState = PaneActionMenuState | NodeActionMenuState

/** Render a compact horizontal quick menu for pane or node actions. */
export function ModuleGraphActionMenu({
  state,
  onOpenNodePicker,
  onDuplicateNode,
  onDisconnectAllConnections,
  onToggleNodeDisabled,
  onRemoveNode,
  onShowRecommendedNodes,
  onToggleAdvancedOutputs,
  onClose,
}: {
  state: ModuleGraphActionMenuState
  onOpenNodePicker: () => void
  onDuplicateNode: () => void
  onDisconnectAllConnections: () => void
  onToggleNodeDisabled: () => void
  onRemoveNode: () => void
  onShowRecommendedNodes: () => void
  onToggleAdvancedOutputs: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  useOverlayBackClose({ open: true, onClose })

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
        aria-label={t({ ko: '퀵 메뉴', en: 'Quick menu' })}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border/70 px-2 py-1.5">
          <span className="text-[11px] font-semibold text-muted-foreground">{t({ ko: '퀵 메뉴', en: 'Quick menu' })}</span>
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
              title={t({ ko: '노드 추가', en: 'Add node' })}
              aria-label={t({ ko: '노드 추가', en: 'Add node' })}
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
                title={t({ ko: '{name} 추천 연결 노드', en: '{name} recommended linked nodes' }, { name: state.nodeName })}
                aria-label={t({ ko: '추천 연결 노드', en: 'Recommended linked nodes' })}
              >
                <Sparkles className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8"
                onClick={onDuplicateNode}
                title={t({ ko: '{name} 복제', en: 'Duplicate {name}' }, { name: state.nodeName })}
                aria-label={t({ ko: '노드 복제', en: 'Duplicate node' })}
              >
                <Copy className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8"
                onClick={onDisconnectAllConnections}
                title={t({ ko: '{name} 모든 연결 끊기', en: 'Disconnect all connections for {name}' }, { name: state.nodeName })}
                aria-label={t({ ko: '모든 연결 끊기', en: 'Disconnect all connections' })}
              >
                <Unplug className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className={cn('h-8 w-8', state.disabled ? 'text-amber-300' : undefined)}
                onClick={onToggleNodeDisabled}
                title={state.disabled
                  ? t({ ko: '{name} 비활성화 해제', en: 'Enable {name}' }, { name: state.nodeName })
                  : t({ ko: '{name} 비활성화', en: 'Disable {name}' }, { name: state.nodeName })}
                aria-label={state.disabled
                  ? t({ ko: '노드 비활성화 해제', en: 'Enable node' })
                  : t({ ko: '노드 비활성화', en: 'Disable node' })}
              >
                <PowerOff className="h-4 w-4" />
              </Button>
              {state.hasAdvancedOutputPorts ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={cn('h-8 w-8', state.advancedOutputPortsEnabled ? 'text-primary' : undefined)}
                  onClick={onToggleAdvancedOutputs}
                  title={state.advancedOutputPortsEnabled
                    ? t({ ko: '{name} 일반 출력 모드', en: '{name} standard output mode' }, { name: state.nodeName })
                    : t({ ko: '{name} 고급 출력 모드', en: '{name} advanced output mode' }, { name: state.nodeName })}
                  aria-label={state.advancedOutputPortsEnabled
                    ? t({ ko: '일반 출력 모드로 전환', en: 'Switch to standard output mode' })
                    : t({ ko: '고급 출력 모드로 전환', en: 'Switch to advanced output mode' })}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"
                onClick={onRemoveNode}
                title={t({ ko: '{name} 삭제', en: 'Delete {name}' }, { name: state.nodeName })}
                aria-label={t({ ko: '노드 삭제', en: 'Delete node' })}
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
