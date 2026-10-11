import type { TranslationDictionary } from '@/i18n'
import {
  WALLPAPER_WIDGET_TYPES,
  type WallpaperWidgetType,
  type WallpaperLayoutPreset as WallpaperLayoutPresetWire,
  type WallpaperWidgetInstance as WallpaperWidgetInstanceWire,
} from '@conai/shared'

export type { WallpaperWidgetType }

export interface WallpaperCanvasPreset {
  id: string
  name: string
  width: number
  height: number
  aspectRatioLabel: string
  /** Grid of the layout-version-1 editor, kept only to convert old presets. */
  gridColumns: number
  gridRows: number
}

export interface WallpaperWidgetSize {
  w: number
  h: number
}

/** Canvas pixels (layout version 2). */
export interface WallpaperWidgetFrame extends WallpaperWidgetSize {
  x: number
  y: number
}

export type WallpaperWidgetVariant = 'none' | 'card' | 'glass' | 'outline'
export type WallpaperWidgetShadow = 'none' | 'sm' | 'md' | 'lg'
export type WallpaperWidgetFont = 'inherit' | 'sans' | 'serif' | 'mono' | 'display'
export type WallpaperWidgetFontWeight = 'light' | 'regular' | 'bold'
export type WallpaperWidgetEntrance = 'none' | 'fade' | 'rise' | 'zoom'

/** The frame look every widget shares; widget-specific options live in `settings`. */
export interface WallpaperWidgetStyle {
  variant: WallpaperWidgetVariant
  /** Fill for card/glass; null = theme surface. */
  backgroundColor: string | null
  /** 0-100 */
  backgroundOpacity: number
  radius: number
  padding: number
  shadow: WallpaperWidgetShadow
  /** Backdrop blur in px (glass, card). */
  blur: number
  fontFamily: WallpaperWidgetFont
  fontWeight: WallpaperWidgetFontWeight
  /** null = theme foreground. */
  textColor: string | null
  /** Bars, progress and highlights inside the widget; null = theme primary. */
  accentColor: string | null
  textAlign: 'left' | 'center' | 'right'
  /** 0-100 */
  opacity: number
  /** 50-200: draws the title and body at this percent of their size inside the same frame. */
  scale: number
  showTitle: boolean
  entrance: WallpaperWidgetEntrance
  /** 0-100: how far the widget follows the pointer when the wallpaper uses parallax. */
  depth: number
  /** HH:MM window the live wallpaper shows the widget in; null = always. `until` before `from` wraps midnight. */
  showFrom: string | null
  showUntil: string | null
}

export interface WallpaperBaseWidgetSettings {
  title: string
  imagePreviewOpenScalePercent?: number
  imagePreviewOpenDurationMs?: number
  imagePreviewOpenEasing?: WallpaperAnimationEasing
  imagePreviewCloseScalePercent?: number
  imagePreviewCloseDurationMs?: number
  imagePreviewCloseEasing?: WallpaperAnimationEasing
  /** 'open' opens the image page of CoNAI in the browser. */
  imageClickAction?: 'preview' | 'none' | 'open'
  pauseOnHover?: boolean
}

export type WallpaperImageTransitionStyle = 'none' | 'fade' | 'zoom' | 'slide' | 'blur' | 'flip' | 'shuffle'
export type WallpaperImageTransitionSpeed = 'fast' | 'normal' | 'slow'
export type WallpaperAnimationEasingPreset = 'linear' | 'easeInOutSine' | 'easeOutCubic' | 'easeInOutCubic' | 'easeOutExpo' | 'easeOutBack' | 'easeOutBounce'
export type WallpaperAnimationEasing = WallpaperAnimationEasingPreset | `cubic-bezier(${string})` | `linear(${string})`
export type WallpaperImageHoverMotion = number
export type WallpaperFloatingCollageSwapMode = 'time' | 'bounce'
export type WallpaperClockVisualStyle = 'clean' | 'serif' | 'glow' | 'split' | 'analog' | 'mono' | 'glass' | 'editorial' | 'minimal'
export type WallpaperGenerationService = 'all' | 'novelai' | 'comfyui' | 'codex'

export interface WallpaperClockWidgetSettings extends WallpaperBaseWidgetSettings {
  timeFormat: '12h' | '24h'
  showSeconds: boolean
  showDate?: boolean
  visualStyle: WallpaperClockVisualStyle
}

export interface WallpaperCalendarWidgetSettings extends WallpaperBaseWidgetSettings {
  weekStart: 'sun' | 'mon'
  showOutsideDays: boolean
}

export interface WallpaperQueueStatusWidgetSettings extends WallpaperBaseWidgetSettings {
  refreshIntervalSec: number
  visualMode: 'tiles' | 'bars' | 'rings'
}

export interface WallpaperRecentResultsWidgetSettings extends WallpaperBaseWidgetSettings {
  service: WallpaperGenerationService
  refreshIntervalSec: number
  visibleCount: number
  displayMode: 'grid' | 'stack' | 'masonry'
  shiftIntervalSec: number
  imageTransitionStyle: WallpaperImageTransitionStyle
  imageTransitionSpeed: WallpaperImageTransitionSpeed
  imageTransitionDurationMs?: number
  imageTransitionEasing: WallpaperAnimationEasing
  imageHoverMotion: WallpaperImageHoverMotion
  hoverEasing: WallpaperAnimationEasing
}

export interface WallpaperActivityPulseWidgetSettings extends WallpaperBaseWidgetSettings {
  refreshIntervalSec: number
  motionStrength: number
  emphasis: 'mixed' | 'queue' | 'results'
}

export interface WallpaperGroupSourceWidgetSettings extends WallpaperBaseWidgetSettings {
  groupId: number | null
  includeChildren: boolean
  /** Minutes between fresh random draws from the group; 0 keeps the first draw. */
  poolRefreshMinutes?: number
}

export interface WallpaperGroupImageViewWidgetSettings extends WallpaperGroupSourceWidgetSettings {
  visibleCount: number
  layoutMode?: 'grid' | 'filmstrip' | 'masonry'
  slideshowIntervalSec: number
  motionMode: 'static' | 'ambient' | 'pointer'
  motionStrength: number
  motionEasing: WallpaperAnimationEasing
  imageTransitionStyle: WallpaperImageTransitionStyle
  imageTransitionSpeed: WallpaperImageTransitionSpeed
  imageTransitionDurationMs?: number
  imageTransitionEasing: WallpaperAnimationEasing
  imageHoverMotion: WallpaperImageHoverMotion
  hoverEasing: WallpaperAnimationEasing
}

export interface WallpaperImageShowcaseWidgetSettings extends WallpaperGroupSourceWidgetSettings {
  fitMode: 'cover' | 'contain' | 'scale-down'
  slideshowIntervalSec: number
  playbackMode: 'static' | 'carousel' | 'ken-burns'
  imageTransitionStyle: WallpaperImageTransitionStyle
  imageTransitionSpeed: WallpaperImageTransitionSpeed
  imageTransitionDurationMs?: number
  imageTransitionEasing: WallpaperAnimationEasing
  imageHoverMotion: WallpaperImageHoverMotion
  hoverEasing: WallpaperAnimationEasing
}

export interface WallpaperFloatingCollageWidgetSettings extends WallpaperGroupSourceWidgetSettings {
  visibleCount: number
  motionStrength: number
  motionEasing: WallpaperAnimationEasing
  motionSpeed: number
  imageScalePercent: number
  fitMode: 'cover' | 'contain'
  aspectMode: 'slot' | 'image'
  imageSwapMode: WallpaperFloatingCollageSwapMode
  imageTransitionStyle?: WallpaperImageTransitionStyle
  imageTransitionDurationMs?: number
  imageTransitionEasing: WallpaperAnimationEasing
  swapIntervalSec: number
  swapBounceCount: number
  imageHoverMotion: WallpaperImageHoverMotion
  hoverEasing: WallpaperAnimationEasing
}

export interface WallpaperTextNoteWidgetSettings extends WallpaperBaseWidgetSettings {
  text: string
  /** Font size in layout units (px on a 1080p canvas). */
  fontSize: number
}

export interface WallpaperGenerationProgressWidgetSettings extends WallpaperBaseWidgetSettings {
  service: WallpaperGenerationService
  maxJobs: number
  showQueueCounts: boolean
  showNodeLabel: boolean
}

export interface WallpaperGenerationStatsWidgetSettings extends WallpaperBaseWidgetSettings {
  days: number
  display: 'bars' | 'numbers'
}

export interface WallpaperLlmUsageWidgetSettings extends WallpaperBaseWidgetSettings {
  days: number
  metric: 'tokens' | 'requests'
  showModels: boolean
}

export interface WallpaperLibraryStatsWidgetSettings extends WallpaperBaseWidgetSettings {
  showTopTags: boolean
  tagCount: number
  showRatings: boolean
}

export interface WallpaperCharacterCardWidgetSettings extends WallpaperBaseWidgetSettings {
  profileId: number | null
  showAvatar: boolean
  showLastMessage: boolean
  showTyping: boolean
  showUnread: boolean
  showCharacterBackground: boolean
  messageLines: 1 | 3 | 0
}

export interface WallpaperChatRecentWidgetSettings extends WallpaperBaseWidgetSettings {
  /** The chat the panel opens on: this character's latest chat; null = the latest chat. */
  profileId: number | null
}

/** The app's chat panel opened on its chat list. */
export type WallpaperChatInboxWidgetSettings = WallpaperBaseWidgetSettings

export interface WallpaperAudioPlayerWidgetSettings extends WallpaperBaseWidgetSettings {
  audioGroupId: string | null
  autoplay: boolean
  shuffle: boolean
  volume: number
}

export interface WallpaperPostTickerWidgetSettings extends WallpaperBaseWidgetSettings {
  count: number
  showCover: boolean
}

export interface WallpaperPromptOfDayWidgetSettings extends WallpaperBaseWidgetSettings {
  template: string
  rerollMinutes: number
  typeface: 'serif' | 'sans'
}

export interface WallpaperAudioVisualizerWidgetSettings extends WallpaperBaseWidgetSettings {
  shape: 'bars' | 'mirror' | 'wave' | 'circle'
  /** 8-64 */
  barCount: number
  /** 50-300 % */
  sensitivity: number
  /** 0-90 %: how slowly peaks fall back. */
  smoothing: number
  /** null = accent */
  color: string | null
}

export interface WallpaperNowPlayingWidgetSettings extends WallpaperBaseWidgetSettings {
  layout: 'row' | 'stack'
  showArt: boolean
  hideWhenIdle: boolean
}

export interface WallpaperSystemMonitorWidgetSettings extends WallpaperBaseWidgetSettings {
  /** 'host' = this PC through Lively; 'comfyui' = GPU memory of the ComfyUI servers. */
  source: 'host' | 'comfyui'
  display: 'bars' | 'rings'
  showNetwork: boolean
}

export interface WallpaperQuickRunWidgetSettings extends WallpaperBaseWidgetSettings {
  /** Workflow schedule whose "run now" the button presses. */
  scheduleId: number | null
  /** Schedule name when it was picked (the live page cannot list schedules). */
  scheduleName: string
  /** Button text; empty = schedule name. */
  label: string
}

export interface WallpaperWidgetSettingsMap {
  clock: WallpaperClockWidgetSettings
  calendar: WallpaperCalendarWidgetSettings
  'queue-status': WallpaperQueueStatusWidgetSettings
  'recent-results': WallpaperRecentResultsWidgetSettings
  'activity-pulse': WallpaperActivityPulseWidgetSettings
  'group-image-view': WallpaperGroupImageViewWidgetSettings
  'image-showcase': WallpaperImageShowcaseWidgetSettings
  'floating-collage': WallpaperFloatingCollageWidgetSettings
  'text-note': WallpaperTextNoteWidgetSettings
  'generation-progress': WallpaperGenerationProgressWidgetSettings
  'generation-stats': WallpaperGenerationStatsWidgetSettings
  'llm-usage': WallpaperLlmUsageWidgetSettings
  'library-stats': WallpaperLibraryStatsWidgetSettings
  'character-card': WallpaperCharacterCardWidgetSettings
  'chat-recent': WallpaperChatRecentWidgetSettings
  'chat-inbox': WallpaperChatInboxWidgetSettings
  'audio-player': WallpaperAudioPlayerWidgetSettings
  'post-ticker': WallpaperPostTickerWidgetSettings
  'prompt-of-day': WallpaperPromptOfDayWidgetSettings
  'audio-visualizer': WallpaperAudioVisualizerWidgetSettings
  'now-playing': WallpaperNowPlayingWidgetSettings
  'system-monitor': WallpaperSystemMonitorWidgetSettings
  'quick-run': WallpaperQuickRunWidgetSettings
}

export type WallpaperWidgetCategory = 'basic' | 'images' | 'generation' | 'chat-media'

interface WallpaperWidgetDefinitionBase<T extends WallpaperWidgetType> {
  type: T
  category: WallpaperWidgetCategory
  title: TranslationDictionary
  description: TranslationDictionary
  searchKeywords?: readonly string[]
  /** Pixels on a 1080p canvas; scaled by the canvas short side. */
  defaultSize: WallpaperWidgetSize
  minSize: WallpaperWidgetSize
  defaultStyle?: Partial<WallpaperWidgetStyle>
  defaultSettings: WallpaperWidgetSettingsMap[T]
  /** Kept for old layouts but not offered in the library. */
  hidden?: boolean
}

export type WallpaperWidgetDefinition = {
  [T in WallpaperWidgetType]: WallpaperWidgetDefinitionBase<T>
}[WallpaperWidgetType]

interface WallpaperWidgetInstanceBase<T extends WallpaperWidgetType> extends WallpaperWidgetFrame {
  id: string
  type: T
  zIndex: number
  locked: boolean
  hidden: boolean
  rotation: number
  style: WallpaperWidgetStyle
  settings: WallpaperWidgetSettingsMap[T]
}

export type WallpaperWidgetInstance = {
  [T in WallpaperWidgetType]: WallpaperWidgetInstanceBase<T>
}[WallpaperWidgetType]

export type WallpaperGroupSourceWidgetInstance =
  | Extract<WallpaperWidgetInstance, { type: 'group-image-view' }>
  | Extract<WallpaperWidgetInstance, { type: 'image-showcase' }>
  | Extract<WallpaperWidgetInstance, { type: 'floating-collage' }>

export function isWallpaperGroupSourceWidget(widget: WallpaperWidgetInstance): widget is WallpaperGroupSourceWidgetInstance {
  return widget.type === 'group-image-view' || widget.type === 'image-showcase' || widget.type === 'floating-collage'
}

export function isWallpaperPreviewableImageWidget(widget: WallpaperWidgetInstance): widget is Extract<WallpaperWidgetInstance, { type: 'recent-results' | 'group-image-view' | 'image-showcase' | 'floating-collage' }> {
  return widget.type === 'recent-results' || widget.type === 'group-image-view' || widget.type === 'image-showcase' || widget.type === 'floating-collage'
}

export type WallpaperBackgroundFit = 'cover' | 'contain' | 'blur-fill'

export interface WallpaperBackgroundOverlay {
  /** 0-80: black veil over the background. */
  dim?: number
  /** 0-24 px */
  blur?: number
  /** 0-100 */
  vignette?: number
  /** Slow pan and zoom on still images (image and slideshow backgrounds). */
  kenBurns?: boolean
}

export type WallpaperParticleKind = 'none' | 'snow' | 'sakura' | 'rain' | 'dust' | 'fireflies'
export type WallpaperThemeMode = 'dark' | 'light' | 'auto'

/** Preset-wide look, effects and behavior. Widgets with their own color or font keep them. */
export interface WallpaperPresetOptions {
  /** Accent for every widget without its own; null = app theme. */
  accentColor: string | null
  /** Take the accent from the background image instead. */
  autoAccent: boolean
  /** Text color for every widget without its own; null = theme. */
  textColor: string | null
  fontFamily: WallpaperWidgetFont
  particles: WallpaperParticleKind
  /** 0-100 */
  particleAmount: number
  /** 0-100: how far widgets (by depth) and the background shift with the pointer. */
  parallax: number
  /** 'pointer' fades widgets until the pointer comes near them (clean desktop). */
  widgetReveal: 'always' | 'pointer'
  /** 0-100: widget opacity while faded. */
  idleOpacity: number
  /** Frame cap for scripted animation; 0 = display rate. */
  fpsLimit: number
}

export type WallpaperBackground = WallpaperBackgroundOverlay & (
  | { kind: 'theme' }
  | { kind: 'color'; color: string }
  | { kind: 'gradient'; from: string; to: string; angle: number }
  | { kind: 'image'; compositeHash: string | null; fit: WallpaperBackgroundFit }
  | { kind: 'video'; compositeHash: string | null; fit: WallpaperBackgroundFit }
  | {
      kind: 'group-slideshow'
      groupId: number | null
      includeChildren: boolean
      intervalSec: number
      order: 'random' | 'latest'
      transition: 'fade' | 'zoom' | 'slide'
      fit: WallpaperBackgroundFit
    }
)

export type WallpaperBackgroundKind = WallpaperBackground['kind']

export interface WallpaperLayoutPreset {
  id: string
  name: string
  canvasPresetId: string
  /** Set when canvasPresetId is 'custom'. */
  canvasWidth?: number
  canvasHeight?: number
  themeMode?: WallpaperThemeMode
  background: WallpaperBackground
  /** Absent on presets saved before options existed; read through resolveWallpaperPresetOptions. */
  options?: WallpaperPresetOptions
  widgets: WallpaperWidgetInstance[]
  createdAt: string
  updatedAt: string
  /** Wire widgets unknown to this frontend build; hidden in the editor but preserved on save. */
  unsupportedWidgets?: WallpaperWidgetInstanceWire[]
}

export const WALLPAPER_WIDGET_TYPE_SET = new Set<string>(WALLPAPER_WIDGET_TYPES)
export type { WallpaperLayoutPresetWire, WallpaperWidgetInstanceWire }
