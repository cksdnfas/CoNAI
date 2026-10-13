import { cn } from '@/lib/utils'

/**
 * The look of everything that floats over the page (menus, popovers, suggestion lists, hover cards, floating
 * toolbars): surface-high, elevation-2, md radius. Pair with `data-surface="high"` when it holds secondary buttons.
 * The caller sets position, layer, size and padding.
 */
export const floatingSurfaceClassName = 'rounded-md bg-surface-high shadow-elevation-2'

/** Radix open / close animation for floating content (fade + zoom, off under reduced motion). */
export const floatingMotionClassName =
  'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 motion-reduce:animate-none'

/** A menu panel (DropdownMenu, ActionMenu, context menu); add the primitive's max-height / transform-origin vars. */
export const floatingMenuClassName = cn(
  floatingSurfaceClassName,
  'z-floating min-w-40 overflow-x-hidden overflow-y-auto p-1 text-sm text-foreground outline-none',
  floatingMotionClassName,
)

/** One menu item: focus wash, muted 16px icons, disabled dim. */
export const floatingMenuItemClassName = cn(
  'relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none',
  'focus:bg-surface-highest focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4 [&_svg:not([class*=text-])]:text-muted-foreground',
)

export const floatingMenuItemDestructiveClassName =
  'text-destructive focus:bg-destructive-soft focus:text-destructive-soft-foreground [&_svg:not([class*=text-])]:text-current'

export const floatingMenuSeparatorClassName = '-mx-1 my-1 h-px bg-surface-highest'
