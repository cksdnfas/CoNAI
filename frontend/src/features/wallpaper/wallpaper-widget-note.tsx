import type { ReactNode } from 'react'
import { useI18n } from '@/i18n'
import { ApiRequestError } from '@/lib/api-request'
import { cn } from '@/lib/utils'

const NOTE_TONE_CLASS = {
  muted: 'opacity-60',
  error: 'text-destructive',
  /** Not set up yet (no group picked, nothing to show): a dashed slot where the content will go. */
  placeholder: 'rounded-sm border border-dashed border-border/80 bg-surface-low px-3 text-muted-foreground',
} as const

/** Quiet one-line state (loading, empty, no access, not set up) centered in the widget. */
export function WallpaperWidgetNote({ children, tone = 'muted', className }: { children: ReactNode; tone?: keyof typeof NOTE_TONE_CLASS; className?: string }) {
  return (
    <div className={cn('flex h-full items-center justify-center px-2 text-center text-sm', NOTE_TONE_CLASS[tone], className)}>
      {children}
    </div>
  )
}

/** Why a widget feed failed: a login or key would open it, this reader may not see it, it is gone, or unreachable. */
export type WallpaperWidgetErrorKind = 'sign-in' | 'forbidden' | 'not-found' | 'unavailable'

export function getWallpaperWidgetErrorKind(error: unknown): WallpaperWidgetErrorKind {
  if (error instanceof ApiRequestError) {
    // The runtime routes mark refusals a login or runtime key would lift (the viewer is logged out).
    if (error.status === 401 || error.code === 'sign_in_required') return 'sign-in'
    if (error.status === 403) return 'forbidden'
    if (error.status === 404) return 'not-found'
  }
  // Network failures, timeouts and 5xx.
  return 'unavailable'
}

/** Error state of a widget feed; `forbidden` / `notFound` word those cases for this widget (e.g. "admins only"). */
export function WallpaperWidgetErrorNote({ error, forbidden, notFound }: { error: unknown; forbidden?: string; notFound?: string }) {
  const { t } = useI18n()
  const kind = getWallpaperWidgetErrorKind(error)
  const message = kind === 'sign-in'
    ? t({ ko: '로그인하거나 키가 든 URL이 필요해.', en: 'Sign in or open a URL with a key.' })
    : kind === 'forbidden'
      ? forbidden ?? t({ ko: '볼 권한이 없어.', en: 'You do not have access to this.' })
      : kind === 'not-found'
        ? notFound ?? t({ ko: '찾을 수 없어.', en: 'Not found.' })
        : t({ ko: '불러오지 못했어.', en: 'Could not load.' })
  return <WallpaperWidgetNote>{message}</WallpaperWidgetNote>
}
