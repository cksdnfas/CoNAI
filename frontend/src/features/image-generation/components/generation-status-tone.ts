/**
 * Status tone classes for small badges, chips and dots in the generation area.
 * They use the theme status tokens (soft fill + readable foreground), so they stay legible in dark and light themes.
 */
export type GenerationStatusTone = 'success' | 'warning' | 'info' | 'destructive' | 'neutral'

/** Badge override: pair with `<Badge variant="secondary" className={STATUS_BADGE_CLASS[tone]}>`. */
export const STATUS_BADGE_CLASS: Record<GenerationStatusTone, string> = {
  success: 'bg-success-soft text-success-soft-foreground',
  warning: 'bg-warning-soft text-warning-soft-foreground',
  info: 'bg-info-soft text-info-soft-foreground',
  destructive: 'bg-destructive-soft text-destructive-soft-foreground',
  neutral: 'bg-surface-highest text-muted-foreground',
}

/** Solid status dot / indicator fill. */
export const STATUS_DOT_CLASS: Record<GenerationStatusTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  info: 'bg-info',
  destructive: 'bg-destructive',
  neutral: 'bg-muted-foreground/60',
}

/** Status text colour for inline messages. */
export const STATUS_TEXT_CLASS: Record<GenerationStatusTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  info: 'text-info',
  destructive: 'text-destructive',
  neutral: 'text-muted-foreground',
}
