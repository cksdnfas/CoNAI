import { getWallpaperCanvasPreset } from './wallpaper-canvas-presets'
import { normalizeWallpaperLayoutPreset, WALLPAPER_DEFAULT_BACKGROUND } from './wallpaper-layout-utils'
import { createWallpaperWidgetInstance } from './wallpaper-widget-registry'
import type { WallpaperBackground, WallpaperLayoutPreset, WallpaperWidgetInstance, WallpaperWidgetStyle, WallpaperWidgetType } from './wallpaper-types'

export type WallpaperTemplateId = 'generation-monitor' | 'gallery-wall' | 'studio-dashboard' | 'character-corner' | 'minimal-clock'

export interface WallpaperTemplateDefinition {
  id: WallpaperTemplateId
  name: { ko: string; en: string }
  description: { ko: string; en: string }
  accent: string
}

export const WALLPAPER_TEMPLATES: WallpaperTemplateDefinition[] = [
  {
    id: 'generation-monitor',
    name: { ko: '생성 모니터', en: 'Generation monitor' },
    description: { ko: '진행률 · 최근 생성 · 오늘 생성 수', en: 'Progress, recent generations and today’s count' },
    accent: 'linear-gradient(135deg, #1b1512, #5a2a12)',
  },
  {
    id: 'gallery-wall',
    name: { ko: '갤러리 월', en: 'Gallery wall' },
    description: { ko: '그룹 쇼케이스와 최근 생성 메이슨리', en: 'A group showcase beside recent generations' },
    accent: 'linear-gradient(135deg, #1f1728, #4c1d3d)',
  },
  {
    id: 'studio-dashboard',
    name: { ko: '작업실 대시보드', en: 'Studio dashboard' },
    description: { ko: '생성 통계 · LLM 사용량 · 라이브러리', en: 'Generation stats, LLM usage and the library' },
    accent: 'linear-gradient(135deg, #111827, #164e63)',
  },
  {
    id: 'character-corner',
    name: { ko: '캐릭터 코너', en: 'Character corner' },
    description: { ko: '캐릭터 카드 · 최근 대화 · 오디오', en: 'A character, its chat and some music' },
    accent: 'linear-gradient(135deg, #1d1a2b, #3d2a44)',
  },
  {
    id: 'minimal-clock',
    name: { ko: '미니멀', en: 'Minimal' },
    description: { ko: '큰 시계와 달력', en: 'A large clock and a calendar' },
    accent: 'linear-gradient(135deg, #12151c, #283244)',
  },
]

/** Fractions of the canvas. */
type Spot = [x: number, y: number, w: number, h: number]

interface Placement {
  type: WallpaperWidgetType
  landscape: Spot
  portrait: Spot
  settings?: Record<string, unknown>
  style?: Partial<WallpaperWidgetStyle>
}

function place(placement: Placement): Placement {
  return placement
}

const TEMPLATE_PLACEMENTS: Record<WallpaperTemplateId, { background: WallpaperBackground; widgets: Placement[] }> = {
  'generation-monitor': {
    background: { kind: 'gradient', from: '#1a1412', to: '#0d0b0a', angle: 160 },
    widgets: [
      place({ type: 'clock', landscape: [0.05, 0.08, 0.36, 0.22], portrait: [0.08, 0.05, 0.84, 0.12], settings: { visualStyle: 'clean', showDate: true } }),
      place({ type: 'generation-progress', landscape: [0.05, 0.62, 0.34, 0.24], portrait: [0.08, 0.2, 0.84, 0.13] }),
      place({ type: 'generation-stats', landscape: [0.05, 0.36, 0.34, 0.22], portrait: [0.08, 0.36, 0.84, 0.12], settings: { days: 7 } }),
      place({ type: 'recent-results', landscape: [0.45, 0.06, 0.5, 0.88], portrait: [0.05, 0.51, 0.9, 0.45], settings: { displayMode: 'masonry', visibleCount: 9 } }),
    ],
  },
  'gallery-wall': {
    background: { kind: 'theme', dim: 0, blur: 0, vignette: 30 },
    widgets: [
      place({ type: 'image-showcase', landscape: [0.05, 0.08, 0.38, 0.84], portrait: [0.06, 0.04, 0.88, 0.5], settings: { playbackMode: 'ken-burns' } }),
      place({ type: 'recent-results', landscape: [0.47, 0.08, 0.48, 0.66], portrait: [0.06, 0.57, 0.88, 0.3], settings: { displayMode: 'masonry', visibleCount: 8 } }),
      place({ type: 'clock', landscape: [0.47, 0.78, 0.3, 0.14], portrait: [0.06, 0.89, 0.6, 0.08], settings: { visualStyle: 'serif', showDate: true } }),
    ],
  },
  'studio-dashboard': {
    background: { kind: 'gradient', from: '#0f1720', to: '#0a0d12', angle: 160 },
    widgets: [
      place({ type: 'clock', landscape: [0.04, 0.06, 0.28, 0.16], portrait: [0.06, 0.04, 0.88, 0.1], settings: { visualStyle: 'mono', showDate: true } }),
      place({ type: 'generation-progress', landscape: [0.04, 0.28, 0.28, 0.22], portrait: [0.06, 0.16, 0.88, 0.12] }),
      place({ type: 'calendar', landscape: [0.04, 0.56, 0.28, 0.38], portrait: [0.06, 0.3, 0.42, 0.2] }),
      place({ type: 'generation-stats', landscape: [0.36, 0.06, 0.29, 0.42], portrait: [0.52, 0.3, 0.42, 0.2], settings: { days: 14 } }),
      place({ type: 'llm-usage', landscape: [0.68, 0.06, 0.28, 0.42], portrait: [0.06, 0.52, 0.88, 0.2], settings: { days: 7 } }),
      place({ type: 'library-stats', landscape: [0.36, 0.54, 0.6, 0.4], portrait: [0.06, 0.74, 0.88, 0.22], settings: { showRatings: true } }),
    ],
  },
  'character-corner': {
    background: { kind: 'gradient', from: '#251d33', to: '#0f0c14', angle: 150 },
    widgets: [
      place({ type: 'clock', landscape: [0.06, 0.1, 0.34, 0.2], portrait: [0.08, 0.06, 0.84, 0.12], settings: { visualStyle: 'glow', showDate: true } }),
      place({ type: 'character-card', landscape: [0.06, 0.62, 0.3, 0.13], portrait: [0.08, 0.6, 0.84, 0.08] }),
      place({ type: 'chat-recent', landscape: [0.06, 0.34, 0.3, 0.26], portrait: [0.08, 0.3, 0.84, 0.28] }),
      place({ type: 'audio-player', landscape: [0.06, 0.8, 0.3, 0.1], portrait: [0.08, 0.72, 0.84, 0.06] }),
      place({ type: 'recent-results', landscape: [0.55, 0.1, 0.39, 0.8], portrait: [0.08, 0.81, 0.84, 0.15], settings: { displayMode: 'stack', visibleCount: 5 } }),
    ],
  },
  'minimal-clock': {
    background: { ...WALLPAPER_DEFAULT_BACKGROUND },
    widgets: [
      place({ type: 'clock', landscape: [0.18, 0.3, 0.64, 0.3], portrait: [0.08, 0.3, 0.84, 0.16], settings: { visualStyle: 'clean', showDate: true }, style: { textAlign: 'center' } }),
      place({ type: 'calendar', landscape: [0.78, 0.68, 0.18, 0.28], portrait: [0.3, 0.6, 0.4, 0.2] }),
    ],
  },
}

/** Build one starter layout for any canvas from fractional placements. */
export function buildWallpaperTemplateLayout(templateId: WallpaperTemplateId, canvasPresetId: string, name: string, custom?: { width: number; height: number }): WallpaperLayoutPreset {
  const canvas = getWallpaperCanvasPreset(canvasPresetId, custom)
  const isPortrait = canvas.height > canvas.width
  const now = new Date().toISOString()
  const template = TEMPLATE_PLACEMENTS[templateId] ?? TEMPLATE_PLACEMENTS['minimal-clock']

  const widgets = template.widgets.map((placement, index) => {
    const [fx, fy, fw, fh] = isPortrait ? placement.portrait : placement.landscape
    const base = createWallpaperWidgetInstance(placement.type, canvas, index + 1)
    return {
      ...base,
      x: Math.round(fx * canvas.width),
      y: Math.round(fy * canvas.height),
      w: Math.round(fw * canvas.width),
      h: Math.round(fh * canvas.height),
      style: { ...base.style, ...placement.style },
      settings: { ...(base.settings as object), ...placement.settings },
    } as unknown as WallpaperWidgetInstance
  })

  return normalizeWallpaperLayoutPreset({
    id: 'wallpaper-layout-draft',
    name,
    canvasPresetId: canvas.id,
    ...(canvas.id === 'custom' ? { canvasWidth: canvas.width, canvasHeight: canvas.height } : {}),
    background: { ...template.background },
    widgets,
    createdAt: now,
    updatedAt: now,
  })
}
