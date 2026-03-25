import type { CSSProperties } from 'react'

export type ThemeTone = 'positive' | 'negative' | 'auto' | 'rating'

export function getThemeToneStyle(tone: ThemeTone): CSSProperties {
  return {
    backgroundColor: `var(--theme-badge-${tone}-soft)`,
    color: `var(--theme-badge-${tone})`,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, var(--theme-badge-${tone}) 24%, transparent)`,
  }
}

export function getThemeToneTextStyle(tone: ThemeTone): CSSProperties {
  return {
    color: `var(--theme-badge-${tone})`,
  }
}

export function getThemeToneFillStyle(tone: ThemeTone): CSSProperties {
  return {
    backgroundColor: `var(--theme-badge-${tone})`,
  }
}

export function getThemeTonePanelStyle(tone: ThemeTone): CSSProperties {
  return {
    backgroundColor: `var(--theme-badge-${tone}-soft)`,
    color: `var(--theme-badge-${tone})`,
    borderColor: `color-mix(in srgb, var(--theme-badge-${tone}) 28%, transparent)`,
  }
}
