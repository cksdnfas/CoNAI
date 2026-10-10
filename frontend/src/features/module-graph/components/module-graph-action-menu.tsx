import type { ReactNode } from 'react'
import { BoxSelect, ClipboardPaste, Copy, LayoutGrid, ListPlus, Play, Plus, Power, RotateCcw, SlidersHorizontal, Trash2, Unplug } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import { useI18n } from '@/i18n'
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

function MenuItem({ icon, label, shortcut, danger, disabled, onSelect }: { icon: ReactNode; label: string; shortcut?: string; danger?: boolean; disabled?: boolean; onSelect: () => void }) {
  return (
    <Button
      type="button"
      variant={danger ? 'destructive-ghost' : 'ghost'}
      size="sm"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'w-full justify-start gap-2.5 px-2.5 font-normal transition-none [&_svg:not([class*=size-])]:size-3.5',
        danger ? '' : 'text-foreground [&_svg]:text-muted-foreground',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {shortcut ? <kbd className="font-mono text-2xs text-muted-foreground">{shortcut}</kbd> : null}
    </Button>
  )
}

function MenuDivider() {
  return <div className="my-1 h-px bg-line" aria-hidden />
}

/** Right-click menu for a node or the empty canvas: icon, name and shortcut on every row. */
export function ModuleGraphActionMenu({
  state,
  canRun,
  onRunNode,
  onRerunNode,
  onOpenNodePicker,
  onPaste,
  onAutoLayout,
  onSelectAll,
  onDuplicateNode,
  onDisconnectAllConnections,
  onToggleNodeDisabled,
  onRemoveNode,
  onShowRecommendedNodes,
  onToggleAdvancedOutputs,
  onClose,
}: {
  state: ModuleGraphActionMenuState
  canRun: boolean
  onRunNode: () => void
  onRerunNode: () => void
  onOpenNodePicker: () => void
  onPaste: () => void
  onAutoLayout: () => void
  onSelectAll: () => void
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
        data-module-graph-menu=""
        side="bottom"
        align="start"
        sideOffset={2}
        collisionPadding={12}
        className="w-56 p-1"
        role="menu"
        aria-label={state.kind === 'node' ? state.nodeName : t({ ko: '캔버스 메뉴', en: 'Canvas menu' })}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
      >
        {state.kind === 'pane' ? (
          <>
            <MenuItem icon={<Plus />} label={t({ ko: '노드 추가', en: 'Add node' })} shortcut={t({ ko: '더블클릭', en: 'Dbl-click' })} onSelect={onOpenNodePicker} />
            <MenuItem icon={<ClipboardPaste />} label={t({ ko: '붙여넣기', en: 'Paste' })} shortcut="Ctrl+V" onSelect={onPaste} />
            <MenuDivider />
            <MenuItem icon={<LayoutGrid />} label={t({ ko: '자동 정렬', en: 'Auto layout' })} onSelect={onAutoLayout} />
            <MenuItem icon={<BoxSelect />} label={t({ ko: '모두 선택', en: 'Select all' })} shortcut="Ctrl+A" onSelect={onSelectAll} />
          </>
        ) : (
          <>
            <MenuItem icon={<Play />} label={t({ ko: '이 노드까지 실행', en: 'Run up to this node' })} disabled={!canRun} onSelect={onRunNode} />
            <MenuItem icon={<RotateCcw />} label={t({ ko: '캐시 무시하고 다시 실행', en: 'Rerun, ignoring the cache' })} disabled={!canRun} onSelect={onRerunNode} />
            <MenuDivider />
            <MenuItem icon={<ListPlus />} label={t({ ko: '이어서 노드 추가', en: 'Add a connected node' })} onSelect={onShowRecommendedNodes} />
            <MenuItem icon={<Copy />} label={t({ ko: '복제', en: 'Duplicate' })} shortcut="Ctrl+D" onSelect={onDuplicateNode} />
            <MenuItem icon={<Unplug />} label={t({ ko: '연결 모두 끊기', en: 'Remove all links' })} onSelect={onDisconnectAllConnections} />
            <MenuItem icon={<Power />} label={state.disabled ? t({ ko: '켜기', en: 'Turn on' }) : t({ ko: '끄기', en: 'Turn off' })} onSelect={onToggleNodeDisabled} />
            {state.hasAdvancedOutputPorts ? (
              <MenuItem
                icon={<SlidersHorizontal />}
                label={state.advancedOutputPortsEnabled ? t({ ko: '고급 출력 숨기기', en: 'Hide advanced outputs' }) : t({ ko: '고급 출력 보기', en: 'Show advanced outputs' })}
                onSelect={onToggleAdvancedOutputs}
              />
            ) : null}
            <MenuDivider />
            <MenuItem icon={<Trash2 />} label={t({ ko: '삭제', en: 'Delete' })} shortcut="Del" danger onSelect={onRemoveNode} />
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
