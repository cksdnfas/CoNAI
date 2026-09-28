import type { TranslationDictionary, TranslationInput, TranslationParams } from '@/i18n'

/**
 * Counts shown to people are real totals from the server, never "loaded so far".
 * While the total is unknown we say so ("Counting…") instead of showing a partial number.
 */
export type CountStatus = 'known' | 'pending' | 'error'

export interface CountState {
  /** Server total. Ignored unless `status` is `known`. */
  total: number | null
  status: CountStatus
  /** Items the viewer cannot see because of rating settings. Shown as a muted note when > 0. */
  hidden?: number
  /** 1-based position inside the total, for "12 / 12,345" counters. */
  position?: number
}

export interface CountFormatter {
  t: (input: TranslationInput, params?: TranslationParams) => string
  formatNumber: (value: number) => string
}

export interface CountDisplayOptions {
  /**
   * Unit template with a `{count}` slot, e.g. `{ ko: '{count}장', en: '{count} images' }`.
   * Not applied to position counters.
   */
  unit?: TranslationDictionary
}

export interface CountDisplay {
  /** Main text: "12,345", "12,345 images", "12 / 12,345", "Counting…" or "—". */
  text: string
  /** Muted suffix for rating-hidden items, or null. */
  hiddenNote: string | null
}

export const COUNT_UNITS = {
  images: { ko: '{count}장', en: '{count} images' },
  items: { ko: '{count}개', en: '{count} items' },
} satisfies Record<string, TranslationDictionary>

const PENDING_LABEL: TranslationDictionary = { ko: '계산 중', en: 'Counting…' }
const ERROR_LABEL = '—'
const HIDDEN_NOTE: TranslationDictionary = { ko: '(등급 설정으로 {count}개 숨김)', en: '({count} hidden by rating settings)' }

/** Map query-style state (server total + error flag) to a count state. Data wins over a later refetch error. */
export function countStateFromQuery(input: { total: number | null | undefined; isError: boolean; hidden?: number }): CountState {
  if (typeof input.total === 'number') {
    return { total: input.total, status: 'known', hidden: input.hidden }
  }

  return { total: null, status: input.isError ? 'error' : 'pending', hidden: input.hidden }
}

/** Format a count state for display with the active locale. */
export function formatCountDisplay(state: CountState, formatter: CountFormatter, options: CountDisplayOptions = {}): CountDisplay {
  const { t, formatNumber } = formatter
  const isKnown = state.status === 'known' && state.total !== null
  let totalText: string

  if (isKnown) {
    totalText = formatNumber(state.total as number)
  } else if (state.status === 'pending') {
    totalText = t(PENDING_LABEL)
  } else {
    totalText = ERROR_LABEL
  }

  let text: string
  if (state.position !== undefined) {
    text = `${formatNumber(state.position)} / ${totalText}`
  } else if (isKnown && options.unit) {
    text = t(options.unit, { count: totalText })
  } else {
    text = totalText
  }

  const hiddenNote = state.hidden !== undefined && state.hidden > 0
    ? t(HIDDEN_NOTE, { count: formatNumber(state.hidden) })
    : null

  return { text, hiddenNote }
}
