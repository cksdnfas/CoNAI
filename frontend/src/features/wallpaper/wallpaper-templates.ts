import { getWallpaperCanvasPreset } from './wallpaper-canvas-presets'
import { normalizeWallpaperLayoutPreset, WALLPAPER_DEFAULT_BACKGROUND } from './wallpaper-layout-utils'
import { createWallpaperWidgetInstance, getWallpaperWidgetDefinition } from './wallpaper-widget-registry'
import type { WallpaperBackground, WallpaperLayoutPreset, WallpaperWidgetInstance, WallpaperWidgetStyle, WallpaperWidgetType } from './wallpaper-types'

export type WallpaperTemplateId =
  | 'generation-monitor'
  | 'night-watch'
  | 'spotlight'
  | 'gallery-wall'
  | 'glass-dock'
  | 'studio-dashboard'
  | 'terminal'
  | 'character-corner'
  | 'lounge'
  | 'paper-desk'
  | 'minimal-clock'

export interface WallpaperTemplateDefinition {
  id: WallpaperTemplateId
  name: { ko: string; en: string }
  description: { ko: string; en: string }
}

export const WALLPAPER_TEMPLATES: WallpaperTemplateDefinition[] = [
  {
    id: 'generation-monitor',
    name: { ko: '생성 모니터', en: 'Generation monitor' },
    description: { ko: '진행률 · 최근 생성 · 오늘 생성 수', en: 'Progress, recent generations and today’s count' },
  },
  {
    id: 'night-watch',
    name: { ko: '야간 감시', en: 'Night watch' },
    description: { ko: '큰 진행률 · 큐 막대 · 결과 스택', en: 'Large progress, queue bars and a result stack' },
  },
  {
    id: 'spotlight',
    name: { ko: '최신작 스포트라이트', en: 'Spotlight' },
    description: { ko: '방금 나온 결과 하나를 크게', en: 'The newest result, large' },
  },
  {
    id: 'gallery-wall',
    name: { ko: '갤러리 월', en: 'Gallery wall' },
    description: { ko: '그룹 쇼케이스와 최근 생성 메이슨리', en: 'A group showcase beside recent generations' },
  },
  {
    id: 'glass-dock',
    name: { ko: '글래스 독', en: 'Glass dock' },
    description: { ko: '최근 생성 아래 유리 독 (시계 · 진행률 · 음악 · 통계)', en: 'Recent generations over a glass dock' },
  },
  {
    id: 'studio-dashboard',
    name: { ko: '작업실 대시보드', en: 'Studio dashboard' },
    description: { ko: '생성 통계 · LLM 사용량 · 라이브러리', en: 'Generation stats, LLM usage and the library' },
  },
  {
    id: 'terminal',
    name: { ko: '터미널', en: 'Terminal' },
    description: { ko: '모노 글꼴 패널로 본 생성 · 큐 · LLM · 라이브러리', en: 'Generation, queue, LLM and library in mono panels' },
  },
  {
    id: 'character-corner',
    name: { ko: '캐릭터 코너', en: 'Character corner' },
    description: { ko: '캐릭터 카드 · 최근 대화 · 오디오', en: 'A character, its chat and some music' },
  },
  {
    id: 'lounge',
    name: { ko: '라운지', en: 'Lounge' },
    description: { ko: '아날로그 시계 · 대화 · 게시글 · 음악', en: 'Analog clock, chat, posts and music' },
  },
  {
    id: 'paper-desk',
    name: { ko: '페이퍼 데스크', en: 'Paper desk' },
    description: { ko: '밝은 종이 톤 · 세리프 시계와 달력', en: 'Light paper tones, a serif clock and a calendar' },
  },
  {
    id: 'minimal-clock',
    name: { ko: '미니멀', en: 'Minimal' },
    description: { ko: '큰 시계와 달력', en: 'A large clock and a calendar' },
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

interface TemplateLayout {
  background: WallpaperBackground
  themeMode?: 'dark' | 'light'
  widgets: Placement[]
}

function place(placement: Placement): Placement {
  return placement
}

const TERMINAL_PANEL: Partial<WallpaperWidgetStyle> = {
  variant: 'card',
  backgroundColor: '#08110c',
  backgroundOpacity: 92,
  radius: 4,
  padding: 18,
  fontFamily: 'mono',
  textColor: '#8af5b5',
  accentColor: '#3ddc84',
  showTitle: true,
}

const PAPER_CARD: Partial<WallpaperWidgetStyle> = {
  variant: 'card',
  backgroundColor: '#fffdf8',
  backgroundOpacity: 82,
  radius: 6,
  padding: 22,
  shadow: 'sm',
  fontFamily: 'serif',
  textColor: '#2e2822',
  accentColor: '#b4532a',
}

const DOCK_GLASS: Partial<WallpaperWidgetStyle> = { variant: 'glass', radius: 28, padding: 22, entrance: 'rise' }
const LOUNGE_GLASS: Partial<WallpaperWidgetStyle> = { variant: 'glass', radius: 22 }

const TEMPLATE_PLACEMENTS: Record<WallpaperTemplateId, TemplateLayout> = {
  'generation-monitor': {
    background: { kind: 'gradient', from: '#1a1412', to: '#0d0b0a', angle: 160 },
    widgets: [
      place({ type: 'clock', landscape: [0.05, 0.08, 0.36, 0.22], portrait: [0.08, 0.05, 0.84, 0.12], settings: { visualStyle: 'clean', showDate: true } }),
      place({ type: 'generation-progress', landscape: [0.05, 0.62, 0.34, 0.24], portrait: [0.08, 0.2, 0.84, 0.13] }),
      place({ type: 'generation-stats', landscape: [0.05, 0.36, 0.34, 0.22], portrait: [0.08, 0.36, 0.84, 0.12], settings: { days: 7 } }),
      place({ type: 'recent-results', landscape: [0.45, 0.06, 0.5, 0.88], portrait: [0.05, 0.51, 0.9, 0.45], settings: { displayMode: 'masonry', visibleCount: 9 } }),
    ],
  },
  'night-watch': {
    background: { kind: 'gradient', from: '#0c1424', to: '#04060b', angle: 180, vignette: 45 },
    widgets: [
      place({ type: 'clock', landscape: [0.04, 0.06, 0.3, 0.16], portrait: [0.06, 0.04, 0.88, 0.1], settings: { visualStyle: 'glow', showDate: true, showSeconds: false } }),
      place({ type: 'generation-progress', landscape: [0.04, 0.28, 0.44, 0.34], portrait: [0.06, 0.17, 0.88, 0.22], settings: { maxJobs: 4, showQueueCounts: true, showNodeLabel: true }, style: { variant: 'glass', radius: 24, padding: 24 } }),
      place({ type: 'queue-status', landscape: [0.04, 0.66, 0.44, 0.28], portrait: [0.06, 0.42, 0.88, 0.17], settings: { visualMode: 'bars' } }),
      place({ type: 'recent-results', landscape: [0.55, 0.08, 0.41, 0.84], portrait: [0.1, 0.62, 0.8, 0.34], settings: { displayMode: 'stack', visibleCount: 6, shiftIntervalSec: 12 }, style: { padding: 0 } }),
    ],
  },
  spotlight: {
    background: { kind: 'color', color: '#0a0a0b', vignette: 30 },
    widgets: [
      place({ type: 'recent-results', landscape: [0.2, 0.05, 0.6, 0.7], portrait: [0.05, 0.04, 0.9, 0.62], settings: { displayMode: 'grid', visibleCount: 1 }, style: { padding: 0, entrance: 'zoom' } }),
      place({ type: 'clock', landscape: [0.04, 0.79, 0.26, 0.17], portrait: [0.05, 0.68, 0.9, 0.1], settings: { visualStyle: 'clean', showDate: true } }),
      place({ type: 'generation-progress', landscape: [0.34, 0.79, 0.32, 0.17], portrait: [0.05, 0.79, 0.9, 0.08], settings: { maxJobs: 1, showQueueCounts: false }, style: { variant: 'glass' } }),
      place({ type: 'generation-stats', landscape: [0.7, 0.79, 0.26, 0.17], portrait: [0.05, 0.88, 0.9, 0.08], settings: { display: 'numbers', days: 7 }, style: { variant: 'none' } }),
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
  'glass-dock': {
    background: { kind: 'gradient', from: '#3a1f5c', to: '#0f4c5c', angle: 135 },
    widgets: [
      place({ type: 'recent-results', landscape: [0.03, 0.05, 0.94, 0.64], portrait: [0.05, 0.03, 0.9, 0.58], settings: { displayMode: 'masonry', visibleCount: 10 }, style: { padding: 0 } }),
      place({ type: 'clock', landscape: [0.03, 0.74, 0.22, 0.21], portrait: [0.05, 0.64, 0.9, 0.1], settings: { visualStyle: 'clean', showDate: true }, style: DOCK_GLASS }),
      place({ type: 'generation-progress', landscape: [0.27, 0.74, 0.32, 0.21], portrait: [0.05, 0.76, 0.9, 0.09], style: DOCK_GLASS }),
      place({ type: 'audio-player', landscape: [0.61, 0.74, 0.18, 0.21], portrait: [0.05, 0.87, 0.43, 0.1], style: DOCK_GLASS }),
      place({ type: 'generation-stats', landscape: [0.81, 0.74, 0.16, 0.21], portrait: [0.52, 0.87, 0.43, 0.1], settings: { display: 'numbers', days: 7 }, style: DOCK_GLASS }),
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
  terminal: {
    background: { kind: 'color', color: '#040705' },
    widgets: [
      place({ type: 'clock', landscape: [0.03, 0.05, 0.295, 0.2], portrait: [0.04, 0.03, 0.92, 0.09], settings: { visualStyle: 'mono', showDate: true, showSeconds: true }, style: { ...TERMINAL_PANEL, showTitle: false } }),
      place({ type: 'generation-progress', landscape: [0.03, 0.29, 0.295, 0.32], portrait: [0.04, 0.14, 0.92, 0.14], settings: { maxJobs: 3, showNodeLabel: true }, style: TERMINAL_PANEL }),
      place({ type: 'queue-status', landscape: [0.03, 0.65, 0.295, 0.3], portrait: [0.04, 0.3, 0.45, 0.16], settings: { visualMode: 'tiles' }, style: TERMINAL_PANEL }),
      place({ type: 'generation-stats', landscape: [0.355, 0.05, 0.295, 0.42], portrait: [0.51, 0.3, 0.45, 0.16], settings: { display: 'bars', days: 14 }, style: TERMINAL_PANEL }),
      place({ type: 'llm-usage', landscape: [0.355, 0.51, 0.295, 0.44], portrait: [0.04, 0.48, 0.92, 0.16], settings: { days: 7, metric: 'tokens', showModels: true }, style: TERMINAL_PANEL }),
      place({ type: 'library-stats', landscape: [0.68, 0.05, 0.295, 0.42], portrait: [0.04, 0.66, 0.45, 0.31], settings: { showTopTags: true, tagCount: 6 }, style: TERMINAL_PANEL }),
      place({ type: 'recent-results', landscape: [0.68, 0.51, 0.295, 0.44], portrait: [0.51, 0.66, 0.45, 0.31], settings: { displayMode: 'grid', visibleCount: 4 }, style: TERMINAL_PANEL }),
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
  lounge: {
    background: { kind: 'gradient', from: '#2b1d33', to: '#0f0b14', angle: 160, vignette: 30 },
    widgets: [
      place({ type: 'clock', landscape: [0.04, 0.06, 0.22, 0.3], portrait: [0.06, 0.03, 0.88, 0.16], settings: { visualStyle: 'analog', showDate: true } }),
      place({ type: 'character-card', landscape: [0.04, 0.4, 0.3, 0.16], portrait: [0.06, 0.21, 0.88, 0.08], style: LOUNGE_GLASS }),
      place({ type: 'chat-recent', landscape: [0.04, 0.6, 0.3, 0.34], portrait: [0.06, 0.31, 0.88, 0.26], style: LOUNGE_GLASS }),
      place({ type: 'post-ticker', landscape: [0.37, 0.06, 0.29, 0.88], portrait: [0.06, 0.59, 0.88, 0.14], settings: { count: 5, showCover: true }, style: LOUNGE_GLASS }),
      place({ type: 'recent-results', landscape: [0.69, 0.06, 0.27, 0.6], portrait: [0.06, 0.75, 0.88, 0.12], settings: { displayMode: 'stack', visibleCount: 5 }, style: { padding: 0 } }),
      place({ type: 'audio-player', landscape: [0.69, 0.72, 0.27, 0.22], portrait: [0.06, 0.89, 0.88, 0.08], style: LOUNGE_GLASS }),
    ],
  },
  'paper-desk': {
    background: { kind: 'gradient', from: '#f5f0e8', to: '#e4dacb', angle: 160 },
    themeMode: 'light',
    widgets: [
      place({ type: 'clock', landscape: [0.05, 0.08, 0.42, 0.26], portrait: [0.07, 0.04, 0.86, 0.13], settings: { visualStyle: 'serif', showDate: true }, style: { fontFamily: 'serif', textColor: '#2e2822' } }),
      place({ type: 'calendar', landscape: [0.05, 0.4, 0.24, 0.52], portrait: [0.07, 0.19, 0.86, 0.26], style: PAPER_CARD }),
      place({ type: 'generation-progress', landscape: [0.31, 0.4, 0.21, 0.25], portrait: [0.07, 0.47, 0.86, 0.1], style: PAPER_CARD }),
      place({ type: 'generation-stats', landscape: [0.31, 0.68, 0.21, 0.24], portrait: [0.07, 0.59, 0.86, 0.09], settings: { display: 'numbers', days: 7 }, style: PAPER_CARD }),
      place({ type: 'recent-results', landscape: [0.56, 0.08, 0.39, 0.84], portrait: [0.07, 0.7, 0.86, 0.27], settings: { displayMode: 'masonry', visibleCount: 8 }, style: { ...PAPER_CARD, padding: 14 } }),
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

export interface WallpaperTemplatePreview {
  background: WallpaperBackground
  themeMode?: 'dark' | 'light'
  widgets: Array<{ type: WallpaperWidgetType; spot: Spot; variant: WallpaperWidgetStyle['variant'] }>
}

/** The landscape arrangement of a template, for its picker thumbnail. */
export function getWallpaperTemplatePreview(templateId: WallpaperTemplateId): WallpaperTemplatePreview {
  const template = TEMPLATE_PLACEMENTS[templateId] ?? TEMPLATE_PLACEMENTS['minimal-clock']
  return {
    background: template.background,
    themeMode: template.themeMode,
    widgets: template.widgets.map((placement) => ({
      type: placement.type,
      spot: placement.landscape,
      variant: placement.style?.variant ?? getWallpaperWidgetDefinition(placement.type).defaultStyle?.variant ?? 'none',
    })),
  }
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
    ...(template.themeMode ? { themeMode: template.themeMode } : {}),
    background: { ...template.background },
    widgets,
    createdAt: now,
    updatedAt: now,
  })
}
