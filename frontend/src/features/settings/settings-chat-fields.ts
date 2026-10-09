import { CHAT_PAGE_LIMITS, HEADER_NAVIGATION_ITEM_KEYS, MAX_RECYCLE_BIN_RETENTION_DAYS } from '@conai/shared'
import type {
  AppearanceSettings,
  ChatPageField,
  ChatPageValue,
  GeneralSettings,
  GenerationThrottleSettings,
  HeaderNavigationItemKey,
  ImageSaveSettings,
  KaloscopeSettings,
  MetadataExtractionSettings,
  TaggerSettings,
  ThumbnailSettings,
  VideoOptimizationSettings,
} from '@conai/shared'
import type { TranslationDictionary, useI18n } from '@/i18n'
import type { RatingWeightsRecord } from '@/lib/api-settings'
import { APPEARANCE_PRESETS, DENSITY_PRESETS, FONT_PRESETS, GLASS_PRESETS, RADIUS_PRESETS, SHADOW_PRESETS, SURFACE_PRESETS } from '@/lib/appearance-presets'
import { DEFAULT_HEADER_NAVIGATION_SETTINGS } from '@/lib/settings-defaults'
import type { RatingTierRecord } from '@/features/search/search-types'
import type { SettingsTab } from './settings-tabs'
import { VIDEO_OPTIMIZATION_PRESETS } from './video-optimization-presets'

/**
 * The settings drafts a connected chat reads and fills. Field ids are `<section>.<path>` (general fields keep their
 * bare path); a fill only changes the draft, and the page save bar still saves it.
 */
export type SettingsChatSources = {
  general: GeneralSettings | null
  appearance: AppearanceSettings | null
  metadata: MetadataExtractionSettings | null
  imageSave: ImageSaveSettings | null
  thumbnail: ThumbnailSettings | null
  videoOptimization: VideoOptimizationSettings | null
  generationThrottle: GenerationThrottleSettings | null
  tagger: TaggerSettings | null
  kaloscope: KaloscopeSettings | null
  ratingWeights: RatingWeightsRecord | null
  ratingTiers: RatingTierRecord[] | null
  taggerModels: string[]
}

type ObjectSection = Exclude<keyof SettingsChatSources, 'ratingTiers' | 'taggerModels'>

export type SettingsChatSetters = { [K in ObjectSection]: (next: NonNullable<SettingsChatSources[K]>) => void } & {
  ratingTier: (tierId: number, patch: Partial<Pick<RatingTierRecord, 'tier_name' | 'min_score' | 'color' | 'feed_visibility'>>) => void
}

type Translate = ReturnType<typeof useI18n>['t']
type FieldSpec = Omit<ChatPageField, 'id' | 'value' | 'label'> & { path: string; label: TranslationDictionary; fallback?: ChatPageValue; group?: TranslationDictionary }

const toggle = (path: string, label: TranslationDictionary): FieldSpec => ({ path, label, type: 'boolean', fallback: false })
const count = (path: string, label: TranslationDictionary, min: number, max?: number): FieldSpec => ({ path, label, type: 'number', integer: true, min, ...(max === undefined ? {} : { max }) })
const choice = (path: string, label: TranslationDictionary, options: readonly string[]): FieldSpec => ({ path, label, type: 'select', options: [...options] })
const color = (path: string, label: TranslationDictionary): FieldSpec => ({ path, label: { ko: `${label.ko} (#rrggbb)`, en: `${label.en} (#rrggbb)` }, type: 'text', fallback: '' })

function grouped(group: TranslationDictionary, specs: FieldSpec[]): FieldSpec[] {
  return specs.map((spec) => ({ ...spec, group }))
}

const HEADER_NAVIGATION_LABELS: Record<HeaderNavigationItemKey, TranslationDictionary> = {
  access: { ko: '이용 가능 페이지', en: 'Available pages' },
  home: { ko: '홈', en: 'Home' },
  groups: { ko: '그룹', en: 'Groups' },
  prompts: { ko: '프롬프트', en: 'Prompts' },
  generation: { ko: '생성', en: 'Generation' },
  audio: { ko: '오디오', en: 'Audio' },
  posts: { ko: '게시판', en: 'Posts' },
  sprite: { ko: '스프라이트', en: 'Sprites' },
  chat: { ko: '채팅', en: 'Chat' },
  upload: { ko: '업로드', en: 'Upload' },
  files: { ko: '파일 보관함', en: 'Files' },
  wallpaper: { ko: '월페이퍼', en: 'Wallpaper' },
  settings: { ko: '설정', en: 'Settings' },
  search: { ko: '검색', en: 'Search' },
  queue: { ko: '대기열', en: 'Queue' },
  account: { ko: '사용자', en: 'User' },
}

const GENERAL_BASIC: FieldSpec[] = [
  choice('language', { ko: '언어', en: 'Language' }, ['ko', 'en']),
  toggle('promptForDownloadLocation', { ko: '다운로드할 때 파일명과 위치 확인', en: 'Ask for file name and save location' }),
  { ...toggle('enableGallery', { ko: '갤러리 기능 사용', en: 'Enable gallery features' }), fallback: true },
  { ...toggle('showRatingBadges', { ko: '등급 배지 표시', en: 'Show rating badges' }), fallback: true },
  ...HEADER_NAVIGATION_ITEM_KEYS.map((key): FieldSpec => ({ ...toggle(`headerNavigation.${key}`, HEADER_NAVIGATION_LABELS[key]), fallback: true, group: { ko: '상단 메뉴', en: 'Header menu' } })),
]

const APPEARANCE: FieldSpec[] = grouped({ ko: '테마', en: 'Theme' }, [
  choice('themeMode', { ko: '모드', en: 'Mode' }, ['light', 'dark', 'system']),
  choice('accentPreset', { ko: '강조색', en: 'Accent' }, [...Object.keys(APPEARANCE_PRESETS), 'custom']),
  color('customPrimaryColor', { ko: '기본 강조색 (강조색 custom일 때)', en: 'Primary accent (custom accent)' }),
  color('customSecondaryColor', { ko: '보조 강조색 (강조색 custom일 때)', en: 'Secondary accent (custom accent)' }),
  choice('surfacePreset', { ko: '표면', en: 'Surfaces' }, [...Object.keys(SURFACE_PRESETS), 'custom']),
  color('customSurfaceBackgroundColor', { ko: '배경 (표면 custom일 때)', en: 'Background (custom surfaces)' }),
  color('customSurfaceLowestColor', { ko: '사이드바 바탕 (표면 custom일 때, 비우면 자동)', en: 'Sidebar background (custom surfaces, empty = auto)' }),
  color('customSurfaceContainerColor', { ko: '컨테이너 1 (표면 custom일 때)', en: 'Container 1 (custom surfaces)' }),
  color('customSurfaceLowColor', { ko: '컨테이너 2 (표면 custom일 때, 비우면 자동)', en: 'Container 2 (custom surfaces, empty = auto)' }),
  color('customSurfaceHighColor', { ko: '호버 / 활성 (표면 custom일 때)', en: 'Hover / active (custom surfaces)' }),
  choice('density', { ko: '밀도', en: 'Density' }, Object.keys(DENSITY_PRESETS)),
  choice('fontPreset', { ko: '폰트', en: 'Font' }, Object.keys(FONT_PRESETS)),
  count('fontScalePercent', { ko: 'UI 배율 (%)', en: 'UI scale (%)' }, 85, 200),
  count('textScalePercent', { ko: '글자 크기 (%)', en: 'Text size (%)' }, 85, 200),
  choice('bodyFontWeightPreset', { ko: '본문 굵기', en: 'Body weight' }, ['regular', 'medium']),
  choice('emphasisFontWeightPreset', { ko: '강조 굵기', en: 'Emphasis weight' }, ['standard', 'bold']),
  count('desktopPageColumnsMinWidth', { ko: '데스크톱 본문 2칼럼 전환폭 (px)', en: 'Desktop content two-column breakpoint (px)' }, 768, 1800),
  choice('radiusPreset', { ko: '모서리', en: 'Corners' }, Object.keys(RADIUS_PRESETS)),
  choice('glassPreset', { ko: '유리감', en: 'Glass effect' }, Object.keys(GLASS_PRESETS)),
  choice('shadowPreset', { ko: '그림자', en: 'Shadow' }, Object.keys(SHADOW_PRESETS)),
  count('selectionOutlineWidth', { ko: '선택 테두리 두께 (px)', en: 'Selection border width (px)' }, 1, 8),
  choice('groupExplorerCardStyle', { ko: '그룹 카드 스타일', en: 'Group card style' }, ['compact-row', 'media-tile']),
  count('detailRelatedImageMobileColumns', { ko: '유사 이미지 한 줄 카드 수 (모바일)', en: 'Similar images per row (mobile)' }, 1, 6),
  count('detailRelatedImageColumns', { ko: '유사 이미지 한 줄 카드 수 (데스크톱)', en: 'Similar images per row (desktop)' }, 1, 6),
  choice('detailRelatedImageAspectRatio', { ko: '유사 이미지 카드 비율', en: 'Similar image card ratio' }, ['original', 'square', 'portrait', 'landscape']),
  color('positiveBadgeColor', { ko: '긍정 배지', en: 'Positive badge' }),
  color('negativeBadgeColor', { ko: '부정 배지', en: 'Negative badge' }),
  color('autoBadgeColor', { ko: '오토 배지', en: 'Auto badge' }),
  color('ratingBadgeColor', { ko: '평가 배지', en: 'Rating badge' }),
])

/** Optional theme colours the editor stores as missing when emptied. */
const OPTIONAL_APPEARANCE_COLORS = new Set(['customSurfaceLowestColor', 'customSurfaceLowColor'])

const GENERAL_LIBRARY: FieldSpec[] = [
  { ...choice('imageSimilarityCheckMode', { ko: '유사/중복 검사 (manual 수동 · always 상세 열 때 자동)', en: 'Similar/duplicate check (manual · always on detail open)' }, ['manual', 'always']), fallback: 'always' },
]

const METADATA: FieldSpec[] = grouped({ ko: '메타데이터', en: 'Metadata' }, [
  toggle('enableSecondaryExtraction', { ko: 'PNG 숨은 생성 정보 찾기', en: 'Look for hidden generation info in PNGs' }),
  choice('stealthScanMode', { ko: '숨은 정보 탐색 방식 (fast 빠르게 · full 전체 · skip 찾지 않음)', en: 'Hidden info scan (fast · full · skip)' }, ['fast', 'full', 'skip']),
  { path: 'stealthMaxFileSizeMB', label: { ko: '숨은 정보 탐색 최대 파일 크기 (MB)', en: 'Hidden info scan max file size (MB)' }, type: 'number', min: 1 },
  { path: 'stealthMaxResolutionMP', label: { ko: '숨은 정보 탐색 최대 해상도 (MP)', en: 'Hidden info scan max resolution (MP)' }, type: 'number', min: 1 },
  toggle('skipStealthForComfyUI', { ko: 'ComfyUI 이미지로 확인되면 숨은 정보 찾기 생략', en: 'Skip the hidden info scan for images identified as ComfyUI' }),
  toggle('skipStealthForWebUI', { ko: 'WebUI 이미지로 확인되면 숨은 정보 찾기 생략', en: 'Skip the hidden info scan for images identified as WebUI' }),
])

const IMAGE_SAVE: FieldSpec[] = grouped({ ko: '이미지 저장', en: 'Image saving' }, [
  choice('defaultFormat', { ko: '기본 포맷', en: 'Default format' }, ['original', 'png', 'jpeg', 'webp']),
  count('quality', { ko: '품질', en: 'Quality' }, 1, 100),
  toggle('resizeEnabled', { ko: '저장 전에 크기 조정', en: 'Resize before saving' }),
  count('maxWidth', { ko: '최대 가로', en: 'Max width' }, 64, 16384),
  count('maxHeight', { ko: '최대 세로', en: 'Max height' }, 64, 16384),
  toggle('alwaysShowDialog', { ko: '매번 팝업으로 확인 (끄면 설정값 자동 적용)', en: 'Confirm with a dialog every time (off = apply automatically)' }),
  toggle('applyToGenerationAttachments', { ko: '생성 첨부에 적용', en: 'Apply to generation attachments' }),
  toggle('applyToEditorSave', { ko: '에디터 저장에 적용', en: 'Apply to editor saves' }),
  toggle('applyToCanvasSave', { ko: '캔버스 저장에 적용', en: 'Apply to canvas saves' }),
  toggle('applyToUpload', { ko: '업로드에 적용', en: 'Apply to uploads' }),
  toggle('applyToWorkflowOutputs', { ko: '워크플로 출력에 적용', en: 'Apply to workflow outputs' }),
])

const THUMBNAIL: FieldSpec[] = grouped({ ko: '썸네일', en: 'Thumbnail' }, [
  choice('size', { ko: '썸네일 크기', en: 'Thumbnail size' }, ['original', '2048', '1080', '720', '512']),
  count('quality', { ko: '썸네일 품질', en: 'Thumbnail quality' }, 60, 100),
])

const VIDEO_OPTIMIZATION: FieldSpec[] = grouped({ ko: '비디오 최적화', en: 'Video optimization' }, [
  toggle('enabled', { ko: '비디오 최적화 사용', en: 'Enable video optimization' }),
  choice('preset', { ko: '프리셋 (고르면 화질·오디오도 그 값으로)', en: 'Preset (also sets quality and audio)' }, VIDEO_OPTIMIZATION_PRESETS.map((preset) => preset.value)),
  count('audioBitrateKbps', { ko: '오디오 비트레이트(kbps)', en: 'Audio bitrate (kbps)' }, 32, 320),
  count('crf', { ko: '화질 (CRF)', en: 'Quality (CRF)' }, 18, 40),
  toggle('applyToUpload', { ko: '업로드 비디오에 적용', en: 'Apply to uploaded videos' }),
  toggle('applyToGeneratedOutputs', { ko: '생성 결과 비디오에 적용', en: 'Apply to generated output videos' }),
  toggle('applyToBackupImports', { ko: '백업 유입 비디오에 적용', en: 'Apply to backup-imported videos' }),
])

function pacingSpecs(service: 'novelai' | 'codex', group: TranslationDictionary): FieldSpec[] {
  return grouped(group, [
    count(`${service}.maxConcurrentJobs`, { ko: '동시 실행 수', en: 'Concurrent jobs' }, 1, 8),
    count(`${service}.scheduleWindowMinutes`, { ko: '기간(분)', en: 'Window (minutes)' }, 1, 1440),
    count(`${service}.scheduleJobCount`, { ko: '생성횟수', en: 'Job count' }, 1, 10000),
    choice(`${service}.scheduleMode`, { ko: '분배 (even 균등 · random 비균등)', en: 'Distribution (even · random)' }, ['even', 'random']),
    count(`${service}.minStartIntervalSeconds`, { ko: '최소 간격(초)', en: 'Min gap (seconds)' }, 0, 3600),
  ])
}

const GENERATION_THROTTLE: FieldSpec[] = [
  ...grouped({ ko: '예약 작업', en: 'Reservations' }, [
    count('reservations.maxConcurrentJobs', { ko: '예약 동시 실행 수', en: 'Reservation concurrency' }, 1, 12),
    choice('reservations.userQueuePolicy', { ko: '사용자 대기열이 있을 때 (continue_limited 예약은 1개만 계속 · hold_until_empty 새 예약 시작 보류)', en: 'When a user queue exists (continue_limited · hold_until_empty)' }, ['continue_limited', 'hold_until_empty']),
  ]),
  ...pacingSpecs('novelai', { ko: 'NovelAI 생성 텀', en: 'NovelAI pacing' }),
  ...pacingSpecs('codex', { ko: 'Codex 생성 텀', en: 'Codex pacing' }),
]

const DEVICES = ['auto', 'cpu', 'cuda']
const TAGGER: FieldSpec[] = grouped({ ko: 'WD Tagger', en: 'WD Tagger' }, [
  toggle('enabled', { ko: 'WD Tagger 활성화', en: 'Enable WD Tagger' }),
  toggle('autoTagOnUpload', { ko: '업로드 시 자동 태깅', en: 'Auto tag on upload' }),
  choice('model', { ko: '모델', en: 'Model' }, ['vit', 'swinv2', 'convnext']),
  choice('device', { ko: '실행 장치', en: 'Device' }, DEVICES),
  { path: 'generalThreshold', label: { ko: '일반 태그 기준값', en: 'General tag threshold' }, type: 'number', min: 0, max: 1 },
  { path: 'characterThreshold', label: { ko: '캐릭터 기준값', en: 'Character threshold' }, type: 'number', min: 0, max: 1 },
  // The server runs this executable, so a chat may read it but never fill it.
  { path: 'pythonPath', label: { ko: 'Python 실행 파일', en: 'Python executable' }, type: 'text', editable: false, fallback: '' },
  toggle('keepModelLoaded', { ko: '모델 메모리 유지', en: 'Keep model in memory' }),
  count('autoUnloadMinutes', { ko: '자동 언로드(분)', en: 'Auto unload (minutes)' }, 1),
])

const KALOSCOPE: FieldSpec[] = grouped({ ko: 'Kaloscope', en: 'Kaloscope' }, [
  toggle('enabled', { ko: 'Kaloscope 활성화', en: 'Enable Kaloscope' }),
  toggle('autoTagOnUpload', { ko: '새 이미지 자동 처리', en: 'Process new images automatically' }),
  choice('device', { ko: '실행 장치', en: 'Device' }, DEVICES),
  count('topK', { ko: '작가 후보 수', en: 'Artist candidates' }, 1, 200),
  toggle('keepModelLoaded', { ko: '모델 메모리 유지', en: 'Keep model in memory' }),
  count('autoUnloadMinutes', { ko: '자동 언로드(분)', en: 'Auto unload (minutes)' }, 1),
  { path: 'artistLinkUrlTemplate', label: { ko: 'Artist 링크 URL', en: 'Artist link URL' }, type: 'text', fallback: '' },
])

const RATING_WEIGHTS: FieldSpec[] = (['general', 'sensitive', 'questionable', 'explicit'] as const).map((key): FieldSpec => ({
  path: `${key}_weight`,
  label: { ko: `${key[0].toUpperCase()}${key.slice(1)} 가중치`, en: `${key[0].toUpperCase()}${key.slice(1)} weight` },
  type: 'number',
  min: 0,
  group: { ko: '평가 가중치', en: 'Rating weights' },
}))

const SAFETY: FieldSpec[] = grouped({ ko: '안전 및 정리', en: 'Safety and cleanup' }, [
  toggle('deleteProtection.enabled', { ko: '삭제할 때 휴지통으로 보호', en: 'Protect deleted files with the recycle bin' }),
  count('deleteProtection.recycleBinRetentionDays', { ko: '휴지통 보관 기간 (일, 0이면 자동 비우기 끔)', en: 'Keep in recycle bin (days, 0 = never empty automatically)' }, 0, MAX_RECYCLE_BIN_RETENTION_DAYS),
  { ...count('generationHistoryMaxItems', { ko: '생성 히스토리 최대 항목 수', en: 'Generation history maximum items' }, 1, 1_000_000), fallback: 10_000 },
  toggle('autoCleanupCanvasOnShutdown', { ko: '종료 시 캔버스 임시 데이터 자동 정리', en: 'Clean up temporary canvas data on exit' }),
  toggle('applyRatingSafetyToGenerationHistory', { ko: '생성 히스토리에도 등급 표시 규칙 적용', en: 'Apply rating visibility rules to generation history' }),
])

const SECTION_SPECS: Record<ObjectSection, FieldSpec[]> = {
  general: [...GENERAL_BASIC, ...GENERAL_LIBRARY, ...SAFETY],
  appearance: APPEARANCE,
  metadata: METADATA,
  imageSave: IMAGE_SAVE,
  thumbnail: THUMBNAIL,
  videoOptimization: VIDEO_OPTIMIZATION,
  generationThrottle: GENERATION_THROTTLE,
  tagger: TAGGER,
  kaloscope: KALOSCOPE,
  ratingWeights: RATING_WEIGHTS,
}

/** What each settings tab shows, by section and (for general settings) by the fields that tab renders. */
const TAB_SECTIONS: Partial<Record<SettingsTab, Array<[ObjectSection, FieldSpec[]]>>> = {
  general: [['general', GENERAL_BASIC], ['appearance', APPEARANCE]],
  library: [['general', GENERAL_LIBRARY], ['metadata', METADATA]],
  media: [['imageSave', IMAGE_SAVE], ['thumbnail', THUMBNAIL], ['videoOptimization', VIDEO_OPTIMIZATION]],
  auto: [['tagger', TAGGER], ['kaloscope', KALOSCOPE], ['ratingWeights', RATING_WEIGHTS]],
  generation: [['generationThrottle', GENERATION_THROTTLE]],
  system: [['general', SAFETY]],
}

const TIER_FIELDS = ['tier_name', 'min_score', 'color', 'feed_visibility'] as const

function fieldId(section: ObjectSection | 'ratingTiers', path: string) {
  return section === 'general' ? path : `${section}.${path}`
}

function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined), source)
}

function writePath<T>(source: T, path: string, value: unknown): T {
  const [head, ...rest] = path.split('.')
  const base = (source && typeof source === 'object' ? source : {}) as Record<string, unknown>
  return { ...base, [head]: rest.length > 0 ? writePath(base[head], rest.join('.'), value) : value } as T
}

function buildField(section: ObjectSection, source: object, spec: FieldSpec, t: Translate): ChatPageField {
  const { path, label, fallback, group, ...rest } = spec
  const current = readPath(source, path)
  return { ...rest, id: fieldId(section, path), label: group ? `${t(group)} · ${t(label)}` : t(label), value: (current ?? fallback ?? '') as ChatPageValue }
}

/** The registered inputs for one settings tab; sections whose draft has not loaded yet are left out. */
export function settingsChatFields(tab: SettingsTab, sources: SettingsChatSources, t: Translate): ChatPageField[] {
  const fields: ChatPageField[] = []
  for (const [section, specs] of TAB_SECTIONS[tab] ?? []) {
    const source = sources[section]
    if (!source) continue
    for (const spec of specs) {
      const field = buildField(section, source, spec, t)
      fields.push(section === 'tagger' && spec.path === 'model' && sources.taggerModels.length > 0 ? { ...field, options: sources.taggerModels } : field)
    }
  }
  if (tab === 'auto' && sources.ratingTiers) {
    // Tiers are a list; four inputs each, as many as the snapshot has room for.
    const room = Math.max(0, Math.floor((CHAT_PAGE_LIMITS.fields - fields.length) / TIER_FIELDS.length))
    sources.ratingTiers.slice(0, room).forEach((tier, index) => {
      const group = `${t({ ko: '평가 등급', en: 'Rating tier' })} ${index + 1}${tier.tier_name ? ` (${tier.tier_name})` : ''}`
      fields.push(
        { id: `ratingTiers.${tier.id}.tier_name`, label: `${group} · ${t({ ko: '등급 이름', en: 'Tier name' })}`, type: 'text', value: tier.tier_name },
        { id: `ratingTiers.${tier.id}.min_score`, label: `${group} · ${t({ ko: '최소 점수 (앞 등급의 최대 점수도 이 값으로)', en: 'Minimum score (also the previous tier maximum)' })}`, type: 'number', min: 0, value: tier.min_score },
        { id: `ratingTiers.${tier.id}.color`, label: `${group} · ${t({ ko: '색상 (#rrggbb)', en: 'Color (#rrggbb)' })}`, type: 'text', value: tier.color ?? '' },
        { id: `ratingTiers.${tier.id}.feed_visibility`, label: `${group} · ${t({ ko: '피드 표시 (show · blur · hide)', en: 'Feed visibility (show · blur · hide)' })}`, type: 'select', options: ['show', 'blur', 'hide'], value: tier.feed_visibility ?? 'show' },
      )
    })
  }
  return fields
}

/** Resolve a field id back to its section and path, or null for an id no settings tab lets a chat fill. */
function locate(id: string): { section: ObjectSection; path: string } | null {
  const dot = id.indexOf('.')
  const head = dot > 0 ? id.slice(0, dot) : ''
  const [section, path] = head && head !== 'general' && head in SECTION_SPECS ? [head as ObjectSection, id.slice(dot + 1)] : ['general' as const, id]
  return SECTION_SPECS[section].some((spec) => spec.path === path && spec.editable !== false) ? { section, path } : null
}

/** Fill the drafts once per section, so several inputs of one section in one patch all land. */
export function applySettingsChatPatch(patch: Record<string, ChatPageValue>, sources: SettingsChatSources, setters: SettingsChatSetters) {
  const next = new Map<ObjectSection, object>()
  const tiers = new Map<number, Record<string, unknown>>()
  for (const [id, value] of Object.entries(patch)) {
    const tier = /^ratingTiers\.(\d+)\.(\w+)$/.exec(id)
    if (tier && (TIER_FIELDS as readonly string[]).includes(tier[2])) {
      const tierId = Number(tier[1])
      tiers.set(tierId, { ...tiers.get(tierId), [tier[2]]: value })
      continue
    }
    const target = locate(id)
    if (!target) continue
    let base = next.get(target.section) ?? sources[target.section]
    if (!base) continue
    if (target.section === 'general' && target.path.startsWith('headerNavigation.')) {
      // Older saved settings may miss newer menu keys; the editor treats a missing key as shown.
      base = writePath(base, 'headerNavigation', { ...DEFAULT_HEADER_NAVIGATION_SETTINGS, ...(base as GeneralSettings).headerNavigation })
    }
    const stored = target.section === 'appearance' && OPTIONAL_APPEARANCE_COLORS.has(target.path) && value === '' ? undefined : value
    let updated = writePath(base, target.path, stored)
    if (target.section === 'videoOptimization' && target.path === 'preset') {
      const preset = VIDEO_OPTIMIZATION_PRESETS.find((item) => item.value === value)
      if (preset) {
        updated = { ...updated, ...('videoOptimization.crf' in patch ? {} : { crf: preset.crf }), ...('videoOptimization.audioBitrateKbps' in patch ? {} : { audioBitrateKbps: preset.audioBitrateKbps }) }
      }
    }
    next.set(target.section, updated)
  }
  for (const [section, value] of next) (setters[section] as (draft: object) => void)(value)
  for (const [tierId, tierPatch] of tiers) setters.ratingTier(tierId, tierPatch)
}
