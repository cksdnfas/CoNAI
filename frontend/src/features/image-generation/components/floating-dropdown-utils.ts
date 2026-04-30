import { cn } from '@/lib/utils'

export type FloatingDropdownRect = {
  left: number
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
  const top = placement === 'top'
    ? clamp(rect.top - maxHeight - gap, viewportPadding, viewportHeight - viewportPadding - maxHeight)
    : clamp(rect.bottom + gap, viewportPadding, viewportHeight - viewportPadding - maxHeight)

  return { left, top, width, maxHeight, placement }
}

/** Resolve a dropdown menu rectangle that opens upward when the trigger is near the viewport bottom. */
export function resolveFloatingDropdownRect(anchor: HTMLElement, options: ResolveFloatingDropdownRectOptions = {}): FloatingDropdownRect {
  return resolveFloatingDropdownRectFromRect(anchor.getBoundingClientRect(), options)
}

export const FLOATING_DROPDOWN_MENU_CLASS = 'fixed z-[140] rounded-sm border border-border/80 bg-background/98 shadow-[0_18px_48px_rgba(0,0,0,0.38)] backdrop-blur-md'

export function getFloatingDropdownItemClassName({ selected, className }: { selected?: boolean; className?: string }) {
  return cn(
    'flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm transition-colors',
    selected ? 'bg-surface-high text-foreground' : 'text-muted-foreground hover:bg-surface-high/70 hover:text-foreground',
    className,
  )
}
