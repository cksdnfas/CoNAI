import { Boxes, Copy, PowerOff, SlidersHorizontal, Sparkles, Trash2, Unplug } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import { cn } from '@/lib/utils'
import { useViewportPointAnchor } from './use-viewport-point-anchor'

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
  const anchorRef = useViewportPointAnchor(state.anchor)
  useOverlayBackClose({ open: true, onClose })

  return (
    <Popover open onOpenChange={(open) => { if (!open) onClose() }}>
      <PopoverAnchor virtualRef={anchorRef} />
      <PopoverContent
        side={state.kind === 'node' ? 'top' : 'bottom'}
        align={state.kind === 'node' ? 'center' : 'start'}
        sideOffset={state.kind === 'node' ? 8 : 0}
        className="w-auto min-w-[180px] p-1.5"
        aria-label={t({ ko: '퀵 메뉴', en: 'Quick menu' })}
        // Keep the canvas focus (and avoid opening the first tooltip) when the menu appears under the pointer.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
      >
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <Text as="span" variant="caption" className="font-semibold">{t({ ko: '퀵 메뉴', en: 'Quick menu' })}</Text>
          {state.kind === 'node' ? <Text as="span" variant="caption" className="max-w-[112px] truncate">{state.nodeName}</Text> : null}
        </div>

        <div className="mt-0.5 flex items-center gap-1">
          {state.kind === 'pane' ? (
            <IconButton variant="ghost" size="icon-sm" onClick={onOpenNodePicker} label={t({ ko: '노드 추가', en: 'Add node' })}>
              <Boxes className="h-4 w-4" />
            </IconButton>
          ) : (
            <>
              <IconButton
                variant="ghost"
                size="icon-sm"
                onClick={onShowRecommendedNodes}
                label={t({ ko: '{name} 추천 연결 노드', en: '{name} recommended linked nodes' }, { name: state.nodeName })}
              >
                <Sparkles className="h-4 w-4" />
              </IconButton>
              <IconButton
                variant="ghost"
                size="icon-sm"
                onClick={onDuplicateNode}
                label={t({ ko: '{name} 복제', en: 'Duplicate {name}' }, { name: state.nodeName })}
              >
                <Copy className="h-4 w-4" />
              </IconButton>
              <IconButton
                variant="ghost"
                size="icon-sm"
                onClick={onDisconnectAllConnections}
                label={t({ ko: '{name} 모든 연결 끊기', en: 'Disconnect all connections for {name}' }, { name: state.nodeName })}
              >
                <Unplug className="h-4 w-4" />
              </IconButton>
              <IconButton
                variant="ghost"
                size="icon-sm"
                aria-pressed={state.disabled === true}
                className={cn(state.disabled && 'text-warning hover:text-warning')}
                onClick={onToggleNodeDisabled}
                label={state.disabled
                  ? t({ ko: '{name} 비활성화 해제', en: 'Enable {name}' }, { name: state.nodeName })
                  : t({ ko: '{name} 비활성화', en: 'Disable {name}' }, { name: state.nodeName })}
              >
                <PowerOff className="h-4 w-4" />
              </IconButton>
              {state.hasAdvancedOutputPorts ? (
                <IconButton
                  variant="ghost"
                  size="icon-sm"
                  aria-pressed={state.advancedOutputPortsEnabled === true}
                  className={cn(state.advancedOutputPortsEnabled && 'text-primary hover:text-primary')}
                  onClick={onToggleAdvancedOutputs}
                  label={state.advancedOutputPortsEnabled
                    ? t({ ko: '{name} 일반 출력 모드', en: '{name} standard output mode' }, { name: state.nodeName })
                    : t({ ko: '{name} 고급 출력 모드', en: '{name} advanced output mode' }, { name: state.nodeName })}
                >
                  <SlidersHorizontal className="h-4 w-4" />
                </IconButton>
              ) : null}
              <IconButton
                variant="destructive"
                size="icon-sm"
                onClick={onRemoveNode}
                label={t({ ko: '{name} 삭제', en: 'Delete {name}' }, { name: state.nodeName })}
              >
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
