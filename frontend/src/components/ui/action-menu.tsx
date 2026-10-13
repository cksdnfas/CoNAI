import * as React from 'react'
import { ContextMenu as ContextMenuPrimitive, DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import { Check, MoreHorizontal } from 'lucide-react'
import { stopAtPortalEdge } from '@/lib/portal-events'
import { cn } from '@/lib/utils'
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

const surfaceClassName = cn(
  'z-floating min-w-44 overflow-x-hidden overflow-y-auto rounded-md bg-surface-high p-1 text-sm text-foreground shadow-elevation-2 outline-none',
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 motion-reduce:animate-none',
)
const itemClassName = cn(
  'relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none',
  'focus:bg-surface-highest focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4 [&_svg:not([class*=text-])]:text-muted-foreground',
)
const destructiveClassName = 'text-destructive focus:bg-destructive-soft focus:text-destructive-soft-foreground [&_svg:not([class*=text-])]:text-current'
const separatorClassName = '-mx-1 my-1 h-px bg-surface-highest'

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

function Entries({ entries, primitive }: { entries: ActionMenuEntry[]; primitive: Primitive }) {
  const { Item, Separator } = primitive
  const tidy = tidyActionEntries(entries)
  const anyChecked = tidy.some((entry) => entry !== '-' && entry.checked !== undefined)
  return tidy.map((entry, index) => {
    if (entry === '-') return <Separator key={`separator-${index}`} className={separatorClassName} />
    const Icon = entry.icon
    return (
      <Item key={entry.key} disabled={entry.disabled} onSelect={entry.onSelect} className={cn(itemClassName, entry.destructive && destructiveClassName)}>
        {anyChecked ? <Check className={cn('size-4', entry.checked ? 'text-primary' : 'invisible')} /> : Icon ? <Icon /> : null}
        {entry.label}
      </Item>
    )
  })
}

/** The ⋯ button that opens an action menu. Renders nothing when there is no action. */
export function ActionMenuButton({ entries, label, size = 'icon-sm', variant = 'ghost', className, align = 'end', icon: Icon = MoreHorizontal, onOpenChange }: {
  entries: ActionMenuEntry[]
  label: string
  size?: 'icon' | 'icon-xs' | 'icon-sm' | 'icon-lg'
  variant?: React.ComponentProps<typeof IconButton>['variant']
  className?: string
  align?: 'start' | 'center' | 'end'
  icon?: React.ComponentType<{ className?: string }>
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
          className={cn(surfaceClassName, 'max-h-(--radix-dropdown-menu-content-available-height) origin-(--radix-dropdown-menu-content-transform-origin)')}>
          <Entries entries={entries} primitive={DropdownMenuPrimitive} />
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  )
}

/**
 * Right-click (long-press on touch) on `children` opens the same entries at the pointer. `children` must be a single
 * element that takes a ref; with no action it is rendered as is.
 */
export function ActionContextMenu({ entries, children, disabled = false, openOnClick = false, onOpenChange }: {
  entries: ActionMenuEntry[]
  children: React.ReactElement
  disabled?: boolean
  /** A plain click opens the menu too (for items that have nothing else to open). */
  openOnClick?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  if (disabled || !hasActions(entries)) return children
  const openAtPointer = (event: React.MouseEvent<HTMLElement>) => {
    event.currentTarget.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: event.clientX, clientY: event.clientY }))
  }
  return (
    <ContextMenuPrimitive.Root onOpenChange={onOpenChange}>
      <ContextMenuPrimitive.Trigger asChild onClick={openOnClick ? openAtPointer : undefined}>{children}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content onClick={stopAtPortalEdge()}
          className={cn(surfaceClassName, 'max-h-(--radix-context-menu-content-available-height) origin-(--radix-context-menu-content-transform-origin)')}>
          <Entries entries={entries} primitive={ContextMenuPrimitive} />
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  )
}
