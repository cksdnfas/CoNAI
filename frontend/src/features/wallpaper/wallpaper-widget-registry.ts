import type { WallpaperCanvasPreset, WallpaperWidgetDefinition, WallpaperWidgetInstance, WallpaperWidgetType } from './wallpaper-types'

export const WALLPAPER_WIDGET_DEFINITIONS: WallpaperWidgetDefinition[] = [
  {
    type: 'clock',
    title: '시계',
    description: '현재 시간을 크게 표시해 주는 위젯이야.',
    defaultSize: { w: 6, h: 4 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 6 },
    defaultSettings: {
      title: '시계',
      showTitle: true,
      showBackground: true,
      timeFormat: '24h',
      showSeconds: true,
      visualStyle: 'glow',
    },
  },
  {
    type: 'queue-status',
    title: '큐 상태',
    description: '생성 대기열과 실행 상태를 보여줘.',
    defaultSize: { w: 8, h: 5 },
    minSize: { w: 6, h: 4 },
    maxSize: { w: 12, h: 8 },
    defaultSettings: {
      title: '큐 상태',
      showTitle: true,
      showBackground: true,
      refreshIntervalSec: 5,
      visualMode: 'tiles',
    },
  },
  {
    type: 'recent-results',
    title: '최근 결과',
    description: '최근 생성 이미지를 빠르게 보여줘.',
    defaultSize: { w: 10, h: 7 },
    minSize: { w: 6, h: 5 },
    maxSize: { w: 16, h: 10 },
    defaultSettings: {
      title: '최근 결과',
      showTitle: true,
      showBackground: true,
      refreshIntervalSec: 10,
      visibleCount: 4,
      displayMode: 'stack',
      shiftIntervalSec: 8,
      imageTransitionStyle: 'zoom',
      imageTransitionSpeed: 'normal',
      imageHoverMotion: 'medium',
    },
  },
  {
    type: 'activity-pulse',
    title: '활동 펄스',
    description: '큐와 결과 흐름을 잔잔하게 시각화해.',
    defaultSize: { w: 10, h: 5 },
    minSize: { w: 7, h: 4 },
    maxSize: { w: 16, h: 8 },
    defaultSettings: {
      title: '활동 펄스',
      showTitle: true,
      showBackground: true,
      refreshIntervalSec: 5,
      motionStrength: 'medium',
      emphasis: 'mixed',
    },
  },
  {
    type: 'group-image-view',
    title: '그룹 이미지',
    description: '선택한 그룹 이미지를 그리드로 보여줘.',
    defaultSize: { w: 10, h: 7 },
    minSize: { w: 8, h: 5 },
    maxSize: { w: 16, h: 12 },
    defaultSettings: {
      title: '그룹 이미지',
      showTitle: true,
      showBackground: true,
      visibleCount: 6,
      motionMode: 'ambient',
      motionStrength: 'medium',
      imageTransitionStyle: 'fade',
      imageTransitionSpeed: 'normal',
      imageHoverMotion: 'medium',
      groupId: null,
      includeChildren: true,
    },
  },
  {
    type: 'image-showcase',
    title: '이미지 쇼케이스',
    description: '대표 이미지나 슬라이드쇼 영역으로 써.',
    defaultSize: { w: 12, h: 8 },
    minSize: { w: 8, h: 5 },
    maxSize: { w: 18, h: 12 },
    defaultSettings: {
      title: '이미지 쇼케이스',
      showTitle: true,
      showBackground: true,
      fitMode: 'cover',
      slideshowIntervalSec: 20,
      playbackMode: 'carousel',
      imageTransitionStyle: 'fade',
      imageTransitionSpeed: 'normal',
      imageHoverMotion: 'medium',
      groupId: null,
      includeChildren: true,
    },
  },
  {
    type: 'floating-collage',
    title: '플로팅 콜라주',
    description: '선택한 그룹 이미지로 떠다니는 콜라주를 만들어.',
    defaultSize: { w: 12, h: 8 },
    minSize: { w: 8, h: 6 },
    maxSize: { w: 18, h: 12 },
    defaultSettings: {
      title: '플로팅 콜라주',
      showTitle: true,
      showBackground: true,
      visibleCount: 5,
      motionStrength: 'medium',
      fitMode: 'cover',
      aspectMode: 'image',
      layoutSpread: 'compact',
      imageHoverMotion: 'medium',
      groupId: null,
      includeChildren: true,
    },
  },
  {
    type: 'text-note',
    title: '텍스트 노트',
    description: '짧은 메모나 라벨을 배치해 둘 수 있어.',
    defaultSize: { w: 7, h: 4 },
    minSize: { w: 4, h: 3 },
    maxSize: { w: 12, h: 8 },
    defaultSettings: {
      title: '텍스트 노트',
      showTitle: true,
      showBackground: true,
      text: '월페이퍼 메모',
    },
  },
]

/** Return the registered wallpaper widget types. */
export function listWallpaperWidgetDefinitions() {
  return WALLPAPER_WIDGET_DEFINITIONS
}

/** Find one wallpaper widget definition by type. */
export function getWallpaperWidgetDefinition<T extends WallpaperWidgetType>(widgetType: T): Extract<WallpaperWidgetDefinition, { type: T }> {
  return (WALLPAPER_WIDGET_DEFINITIONS.find((widget) => widget.type === widgetType) ?? WALLPAPER_WIDGET_DEFINITIONS[0]) as Extract<WallpaperWidgetDefinition, { type: T }>
}

/** Create one placed widget instance using the widget defaults and a simple grid slot. */
export function createWallpaperWidgetInstance<T extends WallpaperWidgetType>(widgetType: T, canvasPreset: WallpaperCanvasPreset, sequence: number): Extract<WallpaperWidgetInstance, { type: T }> {
  const definition = getWallpaperWidgetDefinition(widgetType)
  const slotWidth = Math.max(1, definition.defaultSize.w)
  const itemsPerRow = Math.max(1, Math.floor(canvasPreset.gridColumns / slotWidth))
  const x = (sequence % itemsPerRow) * slotWidth
  const y = Math.floor(sequence / itemsPerRow) * definition.defaultSize.h

  return {
    id: `${widgetType}-${Date.now()}-${sequence}`,
    type: definition.type,
    x,
    y,
    w: definition.defaultSize.w,
    h: definition.defaultSize.h,
    zIndex: sequence + 1,
    locked: false,
    hidden: false,
    settings: { ...definition.defaultSettings },
  } as Extract<WallpaperWidgetInstance, { type: T }>
}
