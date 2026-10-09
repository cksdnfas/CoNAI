import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

export type FloatingDropdownRect = {
  left: number
  /** Top edge for `bottom` placement, bottom edge for `top` placement. */
  top: number
  width: number
  maxHeight: number
  placement: 'top' | 'bottom'
}

type ResolveFloatingDropdownRectOptions = {
  minWidth?: number
  preferredMaxHeight?: number
  minUsableHeight?: number
  viewportPadding?: number
  gap?: number
}

type FloatingDropdownAnchorRect = Pick<DOMRect, 'left' | 'top' | 'bottom' | 'width'>

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

/** Resolve a dropdown menu rectangle from a viewport-relative anchor rectangle. */
export function resolveFloatingDropdownRectFromRect(rect: FloatingDropdownAnchorRect, options: ResolveFloatingDropdownRectOptions = {}): FloatingDropdownRect {
  const {
    minWidth = 220,
    preferredMaxHeight = 420,
    minUsableHeight = 220,
    viewportPadding = 12,
    gap = 6,
  } = options
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const maxViewportWidth = Math.max(160, viewportWidth - viewportPadding * 2)
  const width = Math.min(Math.max(rect.width, minWidth), maxViewportWidth)
  const left = clamp(rect.left, viewportPadding, viewportWidth - viewportPadding - width)
  const availableBelow = Math.max(0, viewportHeight - rect.bottom - viewportPadding - gap)
  const availableAbove = Math.max(0, rect.top - viewportPadding - gap)
  const placement: FloatingDropdownRect['placement'] = availableBelow < minUsableHeight && availableAbove > availableBelow ? 'top' : 'bottom'
  const availableHeight = placement === 'top' ? availableAbove : availableBelow
  const fallbackHeight = Math.max(96, Math.max(availableAbove, availableBelow))
  const maxHeight = Math.min(preferredMaxHeight, Math.max(96, availableHeight || fallbackHeight))
  // Upward menus are anchored by their bottom edge (see getFloatingDropdownStyle) so a short menu
  // hugs the trigger instead of sitting a full maxHeight above it.
  const top = placement === 'top'
    ? clamp(rect.top - gap, viewportPadding + maxHeight, viewportHeight - viewportPadding)
    : clamp(rect.bottom + gap, viewportPadding, viewportHeight - viewportPadding - maxHeight)

  return { left, top, width, maxHeight, placement }
}

/** Inline style for a fixed menu. For `placement: 'top'`, `top` is the menu's bottom edge. */
export function getFloatingDropdownStyle(rect: FloatingDropdownRect): CSSProperties {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    maxHeight: rect.maxHeight,
    transform: rect.placement === 'top' ? 'translateY(-100%)' : undefined,
  }
}

/** Resolve a dropdown menu rectangle that opens upward when the trigger is near the viewport bottom. */
export function resolveFloatingDropdownRect(anchor: HTMLElement, options: ResolveFloatingDropdownRectOptions = {}): FloatingDropdownRect {
  return resolveFloatingDropdownRectFromRect(anchor.getBoundingClientRect(), options)
}

/** Floating menu surface, same tone and elevation as Popover / DropdownMenu (surface-high, elevation-2). Pair with data-surface="high". */
export const FLOATING_DROPDOWN_MENU_CLASS = 'fixed z-popover rounded-md bg-surface-high shadow-elevation-2'

export function getFloatingDropdownItemClassName({ selected, className }: { selected?: boolean; className?: string }) {
  return cn(
    'flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm transition-colors',
    selected ? 'bg-primary/12 text-foreground' : 'text-muted-foreground hover:bg-surface-highest hover:text-foreground',
    className,
  )
}
