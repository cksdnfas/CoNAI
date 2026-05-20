import { useEffect, useId, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, File, Folder, RotateCcw } from 'lucide-react'
import { HierarchyNav, type HierarchyNavItemState } from '@/components/common/hierarchy-nav'
import { Button } from '@/components/ui/button'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import { cn } from '@/lib/utils'
import { FLOATING_DROPDOWN_MENU_CLASS, resolveFloatingDropdownRect, type FloatingDropdownRect } from './floating-dropdown-utils'

const PATH_RANDOM_OPTION_VALUE = '__random__'

type PathOptionTreeNode = {
  id: string
  parentId: string | null
  label: string
  value?: string
  kind: 'placeholder' | 'random' | 'folder' | 'option'
  order: number
}

type PathOptionTreeSelectProps = {
  value: string
  options: string[]
  placeholder?: string
  refreshLabel?: string
  isRefreshing?: boolean
  onRefresh?: () => Promise<void> | void
  onChange: (value: string) => void
}

function splitOptionPath(option: string) {
  return option.split(/[\\/]+/).map((part) => part.trim()).filter(Boolean)
}

function getOptionDisplayLabel(option: string) {
  if (option === PATH_RANDOM_OPTION_VALUE) {
    return '랜덤 선택'
  }

  const parts = splitOptionPath(option)
  return parts.at(-1) ?? option
}

function buildPathOptionTree(options: string[], placeholder: string): PathOptionTreeNode[] {
  const nodes: PathOptionTreeNode[] = [
    {
      id: 'placeholder:',
      parentId: null,
      label: placeholder,
      value: '',
      kind: 'placeholder',
      order: -2,
    },
  ]
  const folderIds = new Set<string>()

  for (const option of options) {
    if (option === PATH_RANDOM_OPTION_VALUE) {
      nodes.push({
        id: `option:${option}`,
        parentId: null,
        label: getOptionDisplayLabel(option),
        value: option,
        kind: 'random',
        order: -1,
      })
      continue
    }

    const parts = splitOptionPath(option)
    if (parts.length <= 1) {
      nodes.push({
        id: `option:${option}`,
        parentId: null,
        label: option,
        value: option,
        kind: 'option',
        order: 1,
      })
      continue
    }

    let parentId: string | null = null
    const folderPathParts: string[] = []

    for (let index = 0; index < parts.length - 1; index += 1) {
      folderPathParts.push(parts[index])
      const folderId = `folder:${folderPathParts.join('/')}`
      if (!folderIds.has(folderId)) {
        nodes.push({
          id: folderId,
          parentId,
          label: parts[index],
          kind: 'folder',
          order: 0,
        })
        folderIds.add(folderId)
      }
      parentId = folderId
    }

    nodes.push({
      id: `option:${option}`,
      parentId,
      label: parts.at(-1) ?? option,
      value: option,
      kind: 'option',
      order: 1,
    })
  }

  return nodes
}

function sortPathOptionNodes(left: PathOptionTreeNode, right: PathOptionTreeNode) {
  if (left.order !== right.order) {
    return left.order - right.order
  }

  return left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' })
}

function renderPathOptionIcon(node: PathOptionTreeNode, state: HierarchyNavItemState) {
  if (node.kind === 'folder') {
    return <Folder className={cn('h-4 w-4 shrink-0', state.isExpanded ? 'text-yellow-300' : 'text-muted-foreground')} />
  }

  if (node.kind === 'option') {
    return <File className="h-4 w-4 shrink-0 text-muted-foreground" />
  }

  return null
}

/** Render path-like select options as a reusable HierarchyNav tree while preserving the actual selected value. */
export function PathOptionTreeSelect({ value, options, placeholder = '선택', refreshLabel = '자동수집 새로고침', isRefreshing = false, onRefresh, onChange }: PathOptionTreeSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [menuRect, setMenuRect] = useState<FloatingDropdownRect | null>(null)
  const [isLocalRefreshing, setIsLocalRefreshing] = useState(false)
  const triggerRef = useRef<HTMLDivElement | null>(null)
  const menuId = useId()
  const treeNodes = useMemo(() => buildPathOptionTree(options, placeholder), [options, placeholder])
  const selectedNode = treeNodes.find((node) => node.value === value) ?? null
  const selectedLabel = selectedNode?.label ?? (value ? getOptionDisplayLabel(value) : placeholder)
  const refreshing = isRefreshing || isLocalRefreshing

  useOverlayBackClose({ open: isOpen, onClose: () => setIsOpen(false) })

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const updateMenuRect = () => {
      const triggerElement = triggerRef.current
      if (!triggerElement) {
        return
      }

      setMenuRect(resolveFloatingDropdownRect(triggerElement, { minWidth: 320 }))
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (triggerRef.current?.contains(target)) {
        return
      }

      const menuElement = document.getElementById(menuId)
      if (menuElement?.contains(target)) {
        return
      }

      setIsOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    updateMenuRect()
    window.addEventListener('resize', updateMenuRect)
    window.addEventListener('scroll', updateMenuRect, true)
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)

    return () => {
      window.removeEventListener('resize', updateMenuRect)
      window.removeEventListener('scroll', updateMenuRect, true)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isOpen, menuId])

  const handleRefresh = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (!onRefresh || refreshing) {
      return
    }

    try {
      setIsLocalRefreshing(true)
      await onRefresh()
    } finally {
      setIsLocalRefreshing(false)
    }
  }

  return (
    <>
      <div ref={triggerRef} className="flex min-w-0 gap-2">
        <Button
          type="button"
          variant="outline"
          className="theme-input-surface h-auto min-h-10 min-w-0 flex-1 justify-between gap-3 rounded-sm border-border/80 px-3 py-2 text-left font-normal text-foreground hover:bg-surface-high"
          onClick={() => setIsOpen((current) => !current)}
          aria-haspopup="tree"
          aria-expanded={isOpen}
          title={value || undefined}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm">{selectedLabel}</span>
          </span>
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
        </Button>

        {onRefresh ? (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className="theme-input-surface h-auto min-h-10 shrink-0 border-border/80"
            disabled={refreshing}
            onClick={(event) => void handleRefresh(event)}
            aria-label={refreshLabel}
            title={refreshLabel}
          >
            <RotateCcw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
          </Button>
        ) : null}
      </div>

      {isOpen && menuRect && typeof document !== 'undefined'
        ? createPortal(
            <div
              id={menuId}
              className={cn(FLOATING_DROPDOWN_MENU_CLASS, 'overflow-auto p-2')}
              style={{ left: menuRect.left, top: menuRect.top, width: menuRect.width, maxHeight: menuRect.maxHeight }}
            >
              <HierarchyNav
                items={treeNodes}
                selectedId={selectedNode?.id ?? null}
                onSelect={(node) => {
                  if (node.value === undefined) {
                    return
                  }
                  onChange(node.value)
                  setIsOpen(false)
                }}
                getId={(node) => node.id}
                getParentId={(node) => node.parentId}
                getLabel={(node) => node.label}
                sortItems={sortPathOptionNodes}
                renderIcon={renderPathOptionIcon}
                isItemSelectable={(node) => node.value !== undefined}
                expandable
                expandOnSelect={(node) => node.kind === 'folder'}
              />
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
