import { cn } from '@/lib/utils'

/**
 * The raised pill chips that spring in over the composer (flags tray, appearance slots). Bespoke on purpose: ToggleChip
 * is a flat wash and Button sizes do not fit; both trays share these classes so the two never drift apart.
 */
const POP_CHIP_CLASS = 'flex shrink-0 cursor-pointer items-center rounded-full border bg-surface-container text-foreground shadow-elevation-1 outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40'

/** A pop chip; `pressed` = the on / current one. */
export function popChipClassName(pressed: boolean, className?: string) {
  return cn(POP_CHIP_CLASS, pressed ? 'border-primary bg-primary/15 text-secondary-text' : 'border-line hover:bg-surface-high', className)
}

/** The dashed round key at the end of a pop-chip tray (add / manage). Size it with `className`. */
export function popChipAddClassName(className?: string) {
  return cn('flex shrink-0 cursor-pointer items-center justify-center rounded-full border border-dashed border-foreground/25 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40', className)
}
