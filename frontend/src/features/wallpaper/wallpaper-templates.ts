import { getWallpaperCanvasPreset } from './wallpaper-canvas-presets'
import { normalizeWallpaperLayoutPreset } from './wallpaper-layout-utils'
import { createWallpaperWidgetInstance } from './wallpaper-widget-registry'
import type { WallpaperLayoutPreset, WallpaperWidgetInstance } from './wallpaper-types'

export type WallpaperTemplateId = 'minimal-clock' | 'daily-focus' | 'studio-status' | 'recent-gallery'

export interface WallpaperTemplateDefinition {
  id: WallpaperTemplateId
  name: { ko: string; en: string }
  description: { ko: string; en: string }
  accent: string
}

export const WALLPAPER_TEMPLATES: WallpaperTemplateDefinition[] = [
  {
    id: 'minimal-clock',
    name: { ko: '미니멀 클록', en: 'Minimal Clock' },
    description: { ko: '큰 클린 시계 하나로 시작하는 가장 가벼운 구성', en: 'A lightweight starting point with one large clean clock' },
    accent: 'linear-gradient(135deg, #12151c, #283244)',
  },
  {
    id: 'daily-focus',
    name: { ko: '데일리 포커스', en: 'Daily Focus' },
    description: { ko: '에디토리얼 시계와 짧은 메모를 조합한 구성', en: 'An editorial clock paired with a short note' },
    accent: 'linear-gradient(135deg, #171717, #3b3128)',
  },
  {
    id: 'studio-status',
    name: { ko: '스튜디오 상태판', en: 'Studio Status' },
    description: { ko: '시계, 워크플로 상태, 실행 흐름을 한 화면에 배치', en: 'Clock, workflow status, and activity in one view' },
    accent: 'linear-gradient(135deg, #111827, #164e63)',
  },
  {
    id: 'recent-gallery',
    name: { ko: '최근 갤러리', en: 'Recent Gallery' },
    description: { ko: '최근 생성 이미지를 중심에 두고 작은 시계를 배치', en: 'Recent generated images take center stage with a compact clock' },
    accent: 'linear-gradient(135deg, #1f1728, #4c1d3d)',
  },
]

function withFrame<T extends WallpaperWidgetInstance>(widget: T, frame: Pick<T, 'x' | 'y' | 'w' | 'h'>): T {
  return { ...widget, ...frame }
}

/** Build one safe starter layout using only existing, proven widget runtimes. */
export function buildWallpaperTemplateLayout(templateId: WallpaperTemplateId, canvasPresetId: string, name: string): WallpaperLayoutPreset {
  const canvas = getWallpaperCanvasPreset(canvasPresetId)
  const isPortrait = canvas.height > canvas.width
  const now = new Date().toISOString()
  const clock = createWallpaperWidgetInstance('clock', canvas, 0)

  let widgets: WallpaperWidgetInstance[]
  switch (templateId) {
    case 'daily-focus': {
      const note = createWallpaperWidgetInstance('text-note', canvas, 1)
      widgets = [
        withFrame({ ...clock, settings: { ...clock.settings, visualStyle: 'editorial', showSeconds: false, showDate: true } }, isPortrait
          ? { x: 2, y: 6, w: 14, h: 6 }
          : { x: 2, y: 4, w: 14, h: 5 }),
        withFrame({ ...note, settings: { ...note.settings, text: 'Make something worth keeping.' } }, isPortrait
          ? { x: 3, y: 13, w: 12, h: 4 }
          : { x: 3, y: 10, w: 10, h: 3 }),
      ]
      break
    }
    case 'studio-status': {
      const queue = createWallpaperWidgetInstance('queue-status', canvas, 1)
      const pulse = createWallpaperWidgetInstance('activity-pulse', canvas, 2)
      widgets = isPortrait
        ? [
            withFrame({ ...clock, settings: { ...clock.settings, visualStyle: 'glass', showSeconds: false, showDate: true } }, { x: 2, y: 2, w: 14, h: 5 }),
            withFrame(queue, { x: 2, y: 9, w: 14, h: 8 }),
            withFrame(pulse, { x: 2, y: 19, w: 14, h: 7 }),
          ]
        : [
            withFrame({ ...clock, settings: { ...clock.settings, visualStyle: 'glass', showSeconds: false, showDate: true } }, { x: 1, y: 1, w: 10, h: 4 }),
            withFrame(queue, { x: 1, y: 6, w: 10, h: 7 }),
            withFrame(pulse, { x: 13, y: 3, w: 10, h: 8 }),
          ]
      break
    }
    case 'recent-gallery': {
      const gallery = createWallpaperWidgetInstance('recent-results', canvas, 1)
      widgets = isPortrait
        ? [
            withFrame({ ...clock, settings: { ...clock.settings, visualStyle: 'clean', showSeconds: false, showDate: true } }, { x: 2, y: 2, w: 14, h: 4 }),
            withFrame(gallery, { x: 1, y: 8, w: 16, h: 18 }),
          ]
        : [
            withFrame({ ...clock, settings: { ...clock.settings, visualStyle: 'clean', showSeconds: false, showDate: true } }, { x: 1, y: 1, w: 9, h: 3 }),
            withFrame(gallery, { x: 8, y: 2, w: 15, h: 11 }),
          ]
      break
    }
    case 'minimal-clock':
    default:
      widgets = [withFrame({ ...clock, settings: { ...clock.settings, visualStyle: 'clean', showSeconds: false, showDate: true } }, isPortrait
        ? { x: 2, y: 10, w: 14, h: 6 }
        : { x: 3, y: 5, w: 16, h: 5 })]
      break
  }

  return normalizeWallpaperLayoutPreset({
    id: 'wallpaper-layout-draft',
    name,
    canvasPresetId: canvas.id,
    widgets,
    createdAt: now,
    updatedAt: now,
  }, canvas)
}
