import * as React from 'react'
import { ContextMenu as ContextMenuPrimitive, DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import { Check, MoreHorizontal } from 'lucide-react'
import { stopAtPortalEdge } from '@/lib/portal-events'
import { cn } from '@/lib/utils'
import {
  floatingMenuClassName,
  floatingMenuItemClassName,
  floatingMenuItemDestructiveClassName,
  floatingMenuItemPopClassName,
  floatingMenuPopClassName,
  floatingMenuSeparatorClassName,
} from './floating-surface'
import { IconButton } from './icon-button'

/**
 * One entry of an action menu: an action, `'-'` for a separator, or null / false for an action that does not apply.
 * Entries are data so the same list can open from a ⋯ button and from a right-click / long-press on the thing.
 */
export type ActionMenuAction = {
  key: string
  label: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  onSelect: () => void
  disabled?: boolean
  destructive?: boolean
  /** A choice in a set (e.g. list layout): shows a check while picked. */
  checked?: boolean
}
export type ActionMenuEntry = ActionMenuAction | '-' | null | false
/** `pop`: the panel springs open and its items rise in one after another (playful menus); default is the standard fade. */
export type ActionMenuMotion = 'standard' | 'pop'

const POP_ITEM_DELAY_MS = 70
const POP_ITEM_STAGGER_MS = 50

const surfaceClassName = cn(floatingMenuClassName, 'min-w-44')
const popSurfaceClassName = cn(floatingMenuPopClassName, 'min-w-44')
const itemClassName = floatingMenuItemClassName
const destructiveClassName = floatingMenuItemDestructiveClassName
const separatorClassName = floatingMenuSeparatorClassName

/** Drop missing actions, and separators at the edges or doubled, so callers can put `'-'` between groups that may be empty. */
export function tidyActionEntries(entries: ActionMenuEntry[]) {
  const out: Array<ActionMenuAction | '-'> = []
  for (const entry of entries) {
    if (!entry) continue
    if (entry === '-' && (out.length === 0 || out[out.length - 1] === '-')) continue
    out.push(entry)
  }
  while (out.length && out[out.length - 1] === '-') out.pop()
  return out
}

function hasActions(entries: ActionMenuEntry[]) {
  return entries.some((entry) => entry && entry !== '-')
}

type Primitive = typeof DropdownMenuPrimitive | typeof ContextMenuPrimitive

function Entries({ entries, primitive, motion }: { entries: ActionMenuEntry[]; primitive: Primitive; motion: ActionMenuMotion }) {
  const { Item, Separator } = primitive
  const tidy = tidyActionEntries(entries)
  const anyChecked = tidy.some((entry) => entry !== '-' && entry.checked !== undefined)
  return tidy.map((entry, index) => {
    if (entry === '-') return <Separator key={`separator-${index}`} className={separatorClassName} />
    const Icon = entry.icon
    return (
      <Item key={entry.key} disabled={entry.disabled} onSelect={entry.onSelect}
        className={cn(itemClassName, entry.destructive && destructiveClassName, motion === 'pop' && floatingMenuItemPopClassName)}
        style={motion === 'pop' ? { animationDelay: `${POP_ITEM_DELAY_MS + index * POP_ITEM_STAGGER_MS}ms` } : undefined}>
        {anyChecked ? <Check className={cn('size-4', entry.checked ? 'text-primary-text' : 'invisible')} /> : Icon ? <Icon /> : null}
        {entry.label}
      </Item>
    )
  })
}

/** The ⋯ button that opens an action menu. Renders nothing when there is no action. */
export function ActionMenuButton({ entries, label, size = 'icon-sm', variant = 'ghost', className, align = 'end', icon: Icon = MoreHorizontal, motion = 'standard', onOpenChange }: {
  entries: ActionMenuEntry[]
  label: string
  size?: 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg'
  variant?: React.ComponentProps<typeof IconButton>['variant']
  className?: string
  align?: 'start' | 'center' | 'end'
  icon?: React.ComponentType<{ className?: string }>
  motion?: ActionMenuMotion
  onOpenChange?: (open: boolean) => void
}) {
  if (!hasActions(entries)) return null
  return (
    <DropdownMenuPrimitive.Root onOpenChange={onOpenChange}>
      <DropdownMenuPrimitive.Trigger asChild>
        <IconButton variant={variant} size={size} label={label} className={className}><Icon /></IconButton>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content align={align} sideOffset={4} onClick={stopAtPortalEdge()}
          className={cn(motion === 'pop' ? popSurfaceClassName : surfaceClassName, 'max-h-(--radix-dropdown-menu-content-available-height) origin-(--radix-dropdown-menu-content-transform-origin)')}>
          <Entries entries={entries} primitive={DropdownMenuPrimitive} motion={motion} />
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  )
}

/**
 * Right-click (long-press on touch) on `children` opens the same entries at the pointer. `children` must be a single
 * element that takes a ref; with no action it is rendered as is.
 */
export function ActionContextMenu({ entries, children, disabled = false, openOnClick = false, mouseOnly = false, motion = 'standard', onOpenChange }: {
  entries: ActionMenuEntry[]
  children: React.ReactElement
  disabled?: boolean
  /** A plain click opens the menu too (for items that have nothing else to open). */
  openOnClick?: boolean
  /** Only a mouse right-click opens it; a touch or pen long-press stays with `children` (e.g. long-press selection). */
  mouseOnly?: boolean
  motion?: ActionMenuMotion
  onOpenChange?: (open: boolean) => void
}) {
  const pressPointerTypeRef = React.useRef('mouse')
  if (!hasActions(entries)) return children
  // `disabled` keeps the Root mounted (the trigger just stops opening): swapping the wrapper would remount `children`
  // and drop keyboard focus, e.g. when a list enters selection mode from its focused row.
  const openAtPointer = (event: React.MouseEvent<HTMLElement>) => {
    event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY }))
  }
  // Radix skips its handlers for an event already default-prevented: this stops its touch long-press timer, and the
  // contextmenu Android raises for the same long-press.
  const keepTouchPress = (event: React.PointerEvent<HTMLElement>) => {
    pressPointerTypeRef.current = event.pointerType
    if (event.pointerType !== 'mouse') event.preventDefault()
  }
  const keepTouchContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    if (pressPointerTypeRef.current !== 'mouse') event.preventDefault()
  }
  // A keyboard menu key raises contextmenu without a press: forget the touch once it ends.
  const endPress = () => {
    pressPointerTypeRef.current = 'mouse'
  }
  return (
    <ContextMenuPrimitive.Root onOpenChange={onOpenChange}>
      <ContextMenuPrimitive.Trigger asChild disabled={disabled} onClick={openOnClick && !disabled ? openAtPointer : undefined}
        onPointerDown={mouseOnly ? keepTouchPress : undefined} onContextMenu={mouseOnly ? keepTouchContextMenu : undefined}
        onPointerUp={mouseOnly ? endPress : undefined} onPointerCancel={mouseOnly ? endPress : undefined}>
        {children}
      </ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content onClick={stopAtPortalEdge()}
          className={cn(motion === 'pop' ? popSurfaceClassName : surfaceClassName, 'max-h-(--radix-context-menu-content-available-height) origin-(--radix-context-menu-content-transform-origin)')}>
          <Entries entries={entries} primitive={ContextMenuPrimitive} motion={motion} />
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  )
}
