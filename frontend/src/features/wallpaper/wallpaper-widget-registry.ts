import type { TranslationInput } from '@/i18n'
import type {
  WallpaperCanvasPreset,
  WallpaperWidgetCategory,
  WallpaperWidgetDefinition,
  WallpaperWidgetInstance,
  WallpaperWidgetStyle,
  WallpaperWidgetType,
} from './wallpaper-types'

/** Short side of the reference canvas (1080p) the default sizes are drawn for. */
const REFERENCE_SHORT_SIDE = 1080

export const WALLPAPER_DEFAULT_WIDGET_STYLE: WallpaperWidgetStyle = {
  variant: 'none',
  backgroundColor: null,
  backgroundOpacity: 72,
  radius: 16,
  padding: 16,
  shadow: 'none',
  blur: 14,
  fontFamily: 'inherit',
  fontWeight: 'regular',
  textColor: null,
  accentColor: null,
  textAlign: 'left',
  opacity: 100,
  showTitle: false,
  entrance: 'fade',
  depth: 40,
  showFrom: null,
  showUntil: null,
}

const PREVIEW_ANIMATION_DEFAULTS = {
  imageClickAction: 'preview' as const,
  imagePreviewOpenScalePercent: 88,
  imagePreviewOpenDurationMs: 260,
  imagePreviewOpenEasing: 'easeOutCubic' as const,
  imagePreviewCloseScalePercent: 88,
  imagePreviewCloseDurationMs: 260,
  imagePreviewCloseEasing: 'easeInOutCubic' as const,
}

export const WALLPAPER_WIDGET_CATEGORIES: Array<{ id: WallpaperWidgetCategory; title: { ko: string; en: string } }> = [
  { id: 'generation', title: { ko: '생성 · 모니터링', en: 'Generation & monitoring' } },
  { id: 'images', title: { ko: '이미지', en: 'Images' } },
  { id: 'chat-media', title: { ko: '채팅 · 미디어', en: 'Chat & media' } },
  { id: 'basic', title: { ko: '기본', en: 'Basics' } },
]

export const WALLPAPER_WIDGET_DEFINITIONS: WallpaperWidgetDefinition[] = [
  {
    type: 'generation-progress',
    category: 'generation',
    title: { ko: '생성 진행률', en: 'Generation progress' },
    description: { ko: '지금 생성 중인 작업의 진행률과 대기열', en: 'Running jobs, their progress and the queue' },
    searchKeywords: ['queue', 'progress', 'nai', 'comfyui', 'codex', 'job', '대기열', '진행'],
    defaultSize: { w: 520, h: 200 },
    minSize: { w: 240, h: 90 },
    defaultStyle: { variant: 'glass' },
    defaultSettings: { title: '', service: 'all', maxJobs: 3, showQueueCounts: true, showNodeLabel: true },
  },
  {
    type: 'recent-results',
    category: 'generation',
    title: { ko: '최근 생성', en: 'Recent generations' },
    description: { ko: 'NAI · ComfyUI · Codex · 워크플로 결과', en: 'NAI, ComfyUI, Codex and workflow results' },
    searchKeywords: ['recent', 'results', 'latest', 'generated', 'history', '최근', '결과'],
    defaultSize: { w: 720, h: 480 },
    minSize: { w: 200, h: 160 },
    defaultSettings: {
      title: '',
      service: 'all',
      refreshIntervalSec: 30,
      visibleCount: 6,
      displayMode: 'masonry',
      shiftIntervalSec: 8,
      imageTransitionStyle: 'zoom',
      imageTransitionSpeed: 'normal',
      imageTransitionDurationMs: 340,
      imageTransitionEasing: 'easeOutCubic',
      imageHoverMotion: 1,
      hoverEasing: 'easeOutCubic',
      ...PREVIEW_ANIMATION_DEFAULTS,
    },
  },
  {
    type: 'generation-stats',
    category: 'generation',
    title: { ko: '생성 통계', en: 'Generation stats' },
    description: { ko: '기간별 생성 수 · 성공 · 실패', en: 'Generations per day, completed and failed' },
    searchKeywords: ['stats', 'count', 'chart', '통계', '집계'],
    defaultSize: { w: 520, h: 280 },
    minSize: { w: 240, h: 140 },
    defaultStyle: { variant: 'glass' },
    defaultSettings: { title: '', days: 7, display: 'bars' },
  },
  {
    type: 'llm-usage',
    category: 'generation',
    title: { ko: 'LLM 사용량', en: 'LLM usage' },
    description: { ko: '요청 수 · 토큰 · 모델별 집계', en: 'Requests, tokens and models' },
    searchKeywords: ['llm', 'token', 'usage', 'model', 'chat', '토큰', '사용량'],
    defaultSize: { w: 520, h: 300 },
    minSize: { w: 240, h: 140 },
    defaultStyle: { variant: 'glass' },
    defaultSettings: { title: '', days: 7, metric: 'tokens', showModels: true },
  },
  {
    type: 'queue-status',
    category: 'generation',
    title: { ko: '워크플로 상태', en: 'Workflow status' },
    description: { ko: '그래프 워크플로의 대기 · 실행 · 실패', en: 'Queued, running and failed graph runs' },
    searchKeywords: ['queue', 'status', 'workflow', 'run', 'graph'],
    defaultSize: { w: 560, h: 360 },
    minSize: { w: 260, h: 180 },
    defaultSettings: { title: '', refreshIntervalSec: 15, visualMode: 'tiles' },
  },
  {
    type: 'library-stats',
    category: 'generation',
    title: { ko: '라이브러리 통계', en: 'Library stats' },
    description: { ko: '이미지 수 · 상위 태그 · 등급 분포', en: 'Image count, top tags and ratings' },
    searchKeywords: ['library', 'tags', 'count', 'rating', '라이브러리', '태그'],
    defaultSize: { w: 480, h: 300 },
    minSize: { w: 220, h: 120 },
    defaultSettings: { title: '', showTopTags: true, tagCount: 8, showRatings: false },
  },
  {
    type: 'image-showcase',
    category: 'images',
    title: { ko: '이미지 쇼케이스', en: 'Image showcase' },
    description: { ko: '그룹 이미지 슬라이드쇼', en: 'A slideshow from a group' },
    searchKeywords: ['showcase', 'slideshow', 'carousel', 'hero'],
    defaultSize: { w: 560, h: 720 },
    minSize: { w: 160, h: 160 },
    defaultStyle: { radius: 20, shadow: 'lg', padding: 0 },
    defaultSettings: {
      title: '',
      fitMode: 'cover',
      slideshowIntervalSec: 20,
      playbackMode: 'carousel',
      imageTransitionStyle: 'fade',
      imageTransitionSpeed: 'normal',
      imageTransitionDurationMs: 340,
      imageTransitionEasing: 'easeOutCubic',
      imageHoverMotion: 1,
      hoverEasing: 'easeOutCubic',
      pauseOnHover: true,
      ...PREVIEW_ANIMATION_DEFAULTS,
      groupId: null,
      includeChildren: true,
      poolRefreshMinutes: 10,
    },
  },
  {
    type: 'group-image-view',
    category: 'images',
    title: { ko: '그룹 이미지', en: 'Group images' },
    description: { ko: '그룹 이미지를 메이슨리 · 필름스트립으로', en: 'Group images in masonry or a filmstrip' },
    searchKeywords: ['group', 'gallery', 'grid', 'album', 'masonry'],
    defaultSize: { w: 720, h: 480 },
    minSize: { w: 200, h: 160 },
    defaultSettings: {
      title: '',
      visibleCount: 8,
      layoutMode: 'masonry',
      slideshowIntervalSec: 12,
      motionMode: 'ambient',
      motionStrength: 1,
      motionEasing: 'easeOutCubic',
      imageTransitionStyle: 'fade',
      imageTransitionSpeed: 'normal',
      imageTransitionDurationMs: 340,
      imageTransitionEasing: 'easeOutCubic',
      imageHoverMotion: 1,
      hoverEasing: 'easeOutCubic',
      pauseOnHover: true,
      ...PREVIEW_ANIMATION_DEFAULTS,
      groupId: null,
      includeChildren: true,
      poolRefreshMinutes: 10,
    },
  },
  {
    type: 'floating-collage',
    category: 'images',
    title: { ko: '플로팅 콜라주', en: 'Floating collage' },
    description: { ko: '그룹 이미지가 떠다니는 콜라주', en: 'Group images drifting around' },
    searchKeywords: ['floating', 'collage', 'motion', 'ambient'],
    defaultSize: { w: 900, h: 600 },
    minSize: { w: 280, h: 200 },
    defaultSettings: {
      title: '',
      visibleCount: 5,
      motionStrength: 1,
      motionEasing: 'linear',
      motionSpeed: 1,
      imageScalePercent: 100,
      fitMode: 'cover',
      aspectMode: 'image',
      imageSwapMode: 'bounce',
      imageTransitionStyle: 'fade',
      imageTransitionDurationMs: 340,
      imageTransitionEasing: 'easeOutCubic',
      swapIntervalSec: 12,
      swapBounceCount: 3,
      imageHoverMotion: 1,
      hoverEasing: 'easeOutCubic',
      ...PREVIEW_ANIMATION_DEFAULTS,
      groupId: null,
      includeChildren: true,
      poolRefreshMinutes: 10,
    },
  },
  {
    type: 'character-card',
    category: 'chat-media',
    title: { ko: '캐릭터 카드', en: 'Character card' },
    description: { ko: '캐릭터와 마지막 대화 · 입력 중', en: 'A character with its last message' },
    searchKeywords: ['chat', 'character', 'profile', 'avatar', '캐릭터', '채팅'],
    defaultSize: { w: 460, h: 140 },
    minSize: { w: 200, h: 80 },
    defaultStyle: { variant: 'glass' },
    defaultSettings: { title: '', profileId: null, showAvatar: true, showLastMessage: true, showTyping: true, showUnread: false, showCharacterBackground: false, messageLines: 1 },
  },
  {
    type: 'chat-recent',
    category: 'chat-media',
    title: { ko: '최근 대화', en: 'Recent chat' },
    description: { ko: '앱 채팅 그대로, 최근 대화가 열린 채로', en: 'The app chat, opened on the latest chat' },
    searchKeywords: ['chat', 'message', 'conversation', '대화'],
    defaultSize: { w: 460, h: 320 },
    minSize: { w: 220, h: 140 },
    defaultSettings: { title: '', profileId: null },
  },
  {
    type: 'chat-inbox',
    category: 'chat-media',
    title: { ko: '채팅', en: 'Chat' },
    description: { ko: '앱 채팅 그대로, 채팅 목록부터', en: 'The app chat, starting on the chat list' },
    searchKeywords: ['chat', 'inbox', 'list', 'messenger', '채팅', '목록', '메신저'],
    defaultSize: { w: 520, h: 460 },
    minSize: { w: 260, h: 220 },
    defaultSettings: { title: '' },
  },
  {
    type: 'audio-player',
    category: 'chat-media',
    title: { ko: '오디오 플레이어', en: 'Audio player' },
    description: { ko: '오디오 그룹을 반복 재생', en: 'Loops an audio group' },
    searchKeywords: ['audio', 'music', 'sound', 'ambient', '오디오', '음악'],
    defaultSize: { w: 560, h: 120 },
    minSize: { w: 240, h: 72 },
    defaultStyle: { variant: 'glass' },
    defaultSettings: { title: '', audioGroupId: null, autoplay: true, shuffle: true, volume: 60 },
  },
  {
    type: 'post-ticker',
    category: 'chat-media',
    title: { ko: '게시글', en: 'Posts' },
    description: { ko: '게시판 최신 글', en: 'Latest board posts' },
    searchKeywords: ['posts', 'board', 'news', '게시판', '글'],
    defaultSize: { w: 480, h: 280 },
    minSize: { w: 220, h: 100 },
    defaultSettings: { title: '', count: 3, showCover: true },
  },
  {
    type: 'prompt-of-day',
    category: 'chat-media',
    title: { ko: '오늘의 프롬프트', en: 'Prompt of the day' },
    description: { ko: '와일드카드로 뽑는 프롬프트', en: 'A prompt rolled from wildcards' },
    searchKeywords: ['prompt', 'wildcard', 'idea', '프롬프트', '와일드카드'],
    defaultSize: { w: 520, h: 200 },
    minSize: { w: 200, h: 80 },
    defaultSettings: { title: '', template: '', rerollMinutes: 60, typeface: 'serif' },
  },
  {
    type: 'audio-visualizer',
    category: 'chat-media',
    title: { ko: '오디오 비주얼라이저', en: 'Audio visualizer' },
    description: { ko: 'PC 소리에 맞춰 움직이는 막대 · 파형 (Lively · Wallpaper Engine)', en: 'Bars or a wave moving with PC audio (Lively, Wallpaper Engine)' },
    searchKeywords: ['audio', 'visualizer', 'spectrum', 'music', 'beat', '오디오', '음악', '비주얼라이저'],
    defaultSize: { w: 720, h: 200 },
    minSize: { w: 160, h: 60 },
    defaultSettings: { title: '', shape: 'bars', barCount: 40, sensitivity: 120, smoothing: 60, color: null },
  },
  {
    type: 'now-playing',
    category: 'chat-media',
    title: { ko: '지금 재생 중', en: 'Now playing' },
    description: { ko: 'PC에서 재생 중인 곡 (Lively · Wallpaper Engine)', en: 'The song playing on the PC (Lively, Wallpaper Engine)' },
    searchKeywords: ['music', 'song', 'track', 'spotify', 'now playing', '음악', '곡'],
    defaultSize: { w: 520, h: 140 },
    minSize: { w: 200, h: 64 },
    defaultStyle: { variant: 'glass' },
    defaultSettings: { title: '', layout: 'row', showArt: true, hideWhenIdle: false },
  },
  {
    type: 'clock',
    category: 'basic',
    title: { ko: '시계', en: 'Clock' },
    description: { ko: '클린 · 세리프 · 글로우 · 분할 · 아날로그 · 모노', en: 'Clean, serif, glow, split, analog, mono' },
    searchKeywords: ['time', 'timer', 'watch', '시간'],
    defaultSize: { w: 640, h: 240 },
    minSize: { w: 140, h: 70 },
    defaultSettings: { title: '', timeFormat: '24h', showSeconds: false, showDate: true, visualStyle: 'clean' },
  },
  {
    type: 'calendar',
    category: 'basic',
    title: { ko: '달력', en: 'Calendar' },
    description: { ko: '이번 달 달력', en: 'This month' },
    searchKeywords: ['calendar', 'date', 'month', '날짜'],
    defaultSize: { w: 360, h: 340 },
    minSize: { w: 180, h: 170 },
    defaultSettings: { title: '', weekStart: 'sun', showOutsideDays: false },
  },
  {
    type: 'text-note',
    category: 'basic',
    title: { ko: '텍스트', en: 'Text' },
    description: { ko: '문구 · 라벨', en: 'A line of text' },
    searchKeywords: ['text', 'note', 'memo', 'label', '메모'],
    defaultSize: { w: 480, h: 140 },
    minSize: { w: 80, h: 40 },
    defaultSettings: { title: '', text: '', fontSize: 40 },
  },
  {
    type: 'system-monitor',
    category: 'generation',
    title: { ko: '시스템 모니터', en: 'System monitor' },
    description: { ko: 'PC 사용률 (Lively) · ComfyUI GPU 메모리', en: 'PC usage (Lively) or ComfyUI GPU memory' },
    searchKeywords: ['cpu', 'gpu', 'vram', 'ram', 'system', 'comfyui', '시스템', '메모리'],
    defaultSize: { w: 460, h: 220 },
    minSize: { w: 200, h: 100 },
    defaultStyle: { variant: 'glass' },
    defaultSettings: { title: '', source: 'comfyui', display: 'bars', showNetwork: false },
  },
  {
    type: 'quick-run',
    category: 'generation',
    title: { ko: '빠른 실행', en: 'Quick run' },
    description: { ko: '워크플로 예약을 바탕화면에서 바로 실행', en: 'Run a workflow schedule from the wallpaper' },
    searchKeywords: ['run', 'generate', 'button', 'schedule', 'workflow', '실행', '생성', '버튼'],
    defaultSize: { w: 360, h: 120 },
    minSize: { w: 140, h: 56 },
    defaultStyle: { variant: 'glass' },
    defaultSettings: { title: '', scheduleId: null, scheduleName: '', label: '' },
  },
  {
    type: 'activity-pulse',
    category: 'generation',
    title: { ko: '실행 펄스', en: 'Activity pulse' },
    description: { ko: '그래프 실행 흐름 시각화', en: 'A calm visualization of graph runs' },
    defaultSize: { w: 640, h: 320 },
    minSize: { w: 280, h: 160 },
    hidden: true,
    defaultSettings: { title: '', refreshIntervalSec: 15, motionStrength: 1, emphasis: 'mixed' },
  },
]

const DEFINITION_BY_TYPE = new Map(WALLPAPER_WIDGET_DEFINITIONS.map((definition) => [definition.type, definition]))

/** Widgets offered in the library (legacy-only ones stay renderable but are not listed). */
export function listWallpaperWidgetDefinitions() {
  return WALLPAPER_WIDGET_DEFINITIONS.filter((definition) => !definition.hidden)
}

/** Find one wallpaper widget definition by type. */
export function getWallpaperWidgetDefinition<T extends WallpaperWidgetType>(widgetType: T): Extract<WallpaperWidgetDefinition, { type: T }> {
  return (DEFINITION_BY_TYPE.get(widgetType) ?? WALLPAPER_WIDGET_DEFINITIONS[0]) as Extract<WallpaperWidgetDefinition, { type: T }>
}

/** The user's title, else the localized widget name. */
export function getWallpaperWidgetDisplayTitle(widget: Pick<WallpaperWidgetInstance, 'type' | 'settings'>, t: (input: TranslationInput) => string) {
  const title = typeof widget.settings.title === 'string' ? widget.settings.title.trim() : ''
  return title || t(getWallpaperWidgetDefinition(widget.type).title)
}

/**
 * Canvas px per layout unit. Widgets are stored in canvas px but drawn in units of a 1080p screen, so text and
 * controls keep the same proportion on a 4K, ultrawide or portrait canvas.
 */
export function getWallpaperCanvasScale(canvas: Pick<WallpaperCanvasPreset, 'width' | 'height'>) {
  return Math.min(canvas.width, canvas.height) / REFERENCE_SHORT_SIDE
}

export function getWallpaperWidgetMinSize(widgetType: WallpaperWidgetType, canvas: Pick<WallpaperCanvasPreset, 'width' | 'height'>) {
  const scale = getWallpaperCanvasScale(canvas)
  const { minSize } = getWallpaperWidgetDefinition(widgetType)
  return { w: Math.max(24, Math.round(minSize.w * scale)), h: Math.max(24, Math.round(minSize.h * scale)) }
}

/** Create one widget at its reference size, centered on `center` (canvas px) or the canvas middle. */
export function createWallpaperWidgetInstance<T extends WallpaperWidgetType>(
  widgetType: T,
  canvas: WallpaperCanvasPreset,
  sequence: number,
  center?: { x: number; y: number },
): Extract<WallpaperWidgetInstance, { type: T }> {
  const definition = getWallpaperWidgetDefinition(widgetType)
  const scale = getWallpaperCanvasScale(canvas)
  const w = Math.min(canvas.width, Math.round(definition.defaultSize.w * scale))
  const h = Math.min(canvas.height, Math.round(definition.defaultSize.h * scale))
  const cx = center?.x ?? canvas.width / 2
  const cy = center?.y ?? canvas.height / 2
  return {
    id: `${widgetType}-${Date.now().toString(36)}-${sequence}-${Math.random().toString(36).slice(2, 6)}`,
    type: definition.type,
    x: Math.round(Math.min(canvas.width - w, Math.max(0, cx - w / 2))),
    y: Math.round(Math.min(canvas.height - h, Math.max(0, cy - h / 2))),
    w,
    h,
    zIndex: sequence,
    locked: false,
    hidden: false,
    rotation: 0,
    style: { ...WALLPAPER_DEFAULT_WIDGET_STYLE, ...definition.defaultStyle },
    settings: { ...definition.defaultSettings },
  } as Extract<WallpaperWidgetInstance, { type: T }>
}
