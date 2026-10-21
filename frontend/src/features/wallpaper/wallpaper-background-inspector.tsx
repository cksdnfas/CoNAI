import { useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { MediaCard } from '@/components/common/media-card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { MediaLibraryPicker } from '@/components/media/media-library-picker'
import { useI18n } from '@/i18n'
import { buildApiUrl } from '@/lib/api-client'
import { WALLPAPER_CANVAS_MAX, WALLPAPER_CANVAS_MIN, WALLPAPER_CUSTOM_CANVAS_ID } from './wallpaper-canvas-presets'
import {
  InspectorColor,
  InspectorHeading,
  InspectorNumber,
  InspectorRow,
  InspectorSegments,
  InspectorSlider,
} from './wallpaper-inspector-controls'
import { SwitchLine } from '@/components/ui/switch-line'
import { normalizeWallpaperBackground, resolveWallpaperPresetOptions } from './wallpaper-layout-utils'
import type { WallpaperInspectorGroupOption } from './wallpaper-widget-inspector-editors'
import type { WallpaperBackground, WallpaperBackgroundFit, WallpaperBackgroundKind, WallpaperLayoutPreset, WallpaperParticleKind, WallpaperPresetOptions, WallpaperThemeMode, WallpaperWidgetFont } from './wallpaper-types'

interface WallpaperBackgroundInspectorProps {
  layout: WallpaperLayoutPreset
  groups: WallpaperInspectorGroupOption[]
  onChangeBackground: (background: WallpaperBackground, key: string) => void
  onChangeCanvas: (canvasPresetId: string, custom?: { width: number; height: number }) => void
  onChangeThemeMode: (themeMode: WallpaperThemeMode | undefined) => void
  onChangeOptions: (options: WallpaperPresetOptions, key: string) => void
}

/** Last background per kind this tab session; the inspector unmounts whenever a widget is selected. */
const lastBackgroundByKind = new Map<WallpaperBackgroundKind, WallpaperBackground>()

/** Shown while nothing is selected: the canvas, its theme and its background. */
export function WallpaperBackgroundInspector({ layout, groups, onChangeBackground, onChangeCanvas, onChangeThemeMode, onChangeOptions }: WallpaperBackgroundInspectorProps) {
  const { t } = useI18n()
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const background = layout.background
  const overlay = { dim: background.dim ?? 0, blur: background.blur ?? 0, vignette: background.vignette ?? 0 }
  const isCustom = layout.canvasPresetId === WALLPAPER_CUSTOM_CANVAS_ID
  const options = resolveWallpaperPresetOptions(layout.options)
  const setOption = <K extends keyof WallpaperPresetOptions>(field: K, value: WallpaperPresetOptions[K]) => {
    onChangeOptions({ ...options, [field]: value }, `options.${field}`)
  }
  const hasStillImage = background.kind === 'image' || background.kind === 'group-slideshow'

  const patch = (next: Partial<WallpaperBackground>, field: string) => {
    onChangeBackground(normalizeWallpaperBackground({ ...background, ...next }), `background.${field}`)
  }
  const switchKind = (kind: WallpaperBackgroundKind) => {
    if (kind === background.kind) return
    // Flipping kinds and back restores the earlier color, gradient or image instead of the defaults.
    lastBackgroundByKind.set(background.kind, background)
    onChangeBackground(normalizeWallpaperBackground({ ...lastBackgroundByKind.get(kind), ...overlay, kind } as WallpaperBackground), 'background.kind')
  }
  const fitSegments = (fit: WallpaperBackgroundFit) => (
    <InspectorSegments
      label={t({ ko: '채우기', en: 'Fit' })}
      value={fit}
      items={[
        { value: 'cover', label: t({ ko: '채우기', en: 'Cover' }) },
        { value: 'contain', label: t({ ko: '맞춤', en: 'Contain' }) },
        { value: 'blur-fill', label: t({ ko: '흐림 여백', en: 'Blur fill' }) },
      ]}
      onChange={(value) => patch({ fit: value } as Partial<WallpaperBackground>, 'fit')}
      stacked
    />
  )

  return (
    <div className="space-y-4">
      <div className="text-base font-semibold">{t({ ko: '캔버스', en: 'Canvas' })}</div>
      <div className="space-y-3">
        {/* The size preset lives in the page toolbar (reachable while a widget is selected); custom W/H stay here. */}
        {isCustom ? (
          <div className="grid grid-cols-2 gap-2">
            <InspectorNumber label="W" value={layout.canvasWidth ?? 1920} min={WALLPAPER_CANVAS_MIN} max={WALLPAPER_CANVAS_MAX} onCommit={(width) => onChangeCanvas(WALLPAPER_CUSTOM_CANVAS_ID, { width, height: layout.canvasHeight ?? 1080 })} />
            <InspectorNumber label="H" value={layout.canvasHeight ?? 1080} min={WALLPAPER_CANVAS_MIN} max={WALLPAPER_CANVAS_MAX} onCommit={(height) => onChangeCanvas(WALLPAPER_CUSTOM_CANVAS_ID, { width: layout.canvasWidth ?? 1920, height })} />
          </div>
        ) : null}
        <InspectorSegments
          stacked
          label={t({ ko: '색 테마', en: 'Theme' })}
          value={layout.themeMode ?? 'app'}
          items={[
            { value: 'app', label: t({ ko: '앱 설정', en: 'App' }) },
            { value: 'dark', label: t({ ko: '다크', en: 'Dark' }) },
            { value: 'light', label: t({ ko: '라이트', en: 'Light' }) },
            { value: 'auto', label: t({ ko: '낮밤', en: 'Day/night' }), ariaLabel: t({ ko: '낮엔 라이트, 밤엔 다크', en: 'Light by day, dark at night' }) },
          ]}
          onChange={(value) => onChangeThemeMode(value === 'app' ? undefined : value)}
        />
      </div>

      <div className="text-base font-semibold">{t({ ko: '배경', en: 'Background' })}</div>
      <div className="space-y-3">
        <InspectorRow label={t({ ko: '종류', en: 'Kind' })}>
          <Select aria-label={t({ ko: '배경 종류', en: 'Background kind' })} value={background.kind} onChange={(event) => switchKind(event.target.value as WallpaperBackgroundKind)}>
            <option value="theme">{t({ ko: '테마', en: 'Theme' })}</option>
            <option value="color">{t({ ko: '단색', en: 'Color' })}</option>
            <option value="gradient">{t({ ko: '그라데이션', en: 'Gradient' })}</option>
            <option value="image">{t({ ko: '이미지', en: 'Image' })}</option>
            <option value="video">{t({ ko: '영상', en: 'Video' })}</option>
            <option value="group-slideshow">{t({ ko: '그룹 슬라이드', en: 'Group slides' })}</option>
          </Select>
        </InspectorRow>
        {background.kind === 'color' ? (
          <InspectorColor label={t({ ko: '색', en: 'Color' })} value={background.color} fallback="#131313" onChange={(value) => patch({ color: value ?? '#131313' } as Partial<WallpaperBackground>, 'color')} />
        ) : null}
        {background.kind === 'gradient' ? (
          <>
            <InspectorColor label={t({ ko: '시작', en: 'From' })} value={background.from} fallback="#2d2340" onChange={(value) => patch({ from: value ?? '#2d2340' } as Partial<WallpaperBackground>, 'from')} />
            <InspectorColor label={t({ ko: '끝', en: 'To' })} value={background.to} fallback="#141119" onChange={(value) => patch({ to: value ?? '#141119' } as Partial<WallpaperBackground>, 'to')} />
            <InspectorSlider label={t({ ko: '각도', en: 'Angle' })} value={background.angle} min={0} max={360} unit="°" onChange={(value) => patch({ angle: value } as Partial<WallpaperBackground>, 'angle')} />
          </>
        ) : null}
        {background.kind === 'image' || background.kind === 'video' ? (
          <>
            {background.compositeHash ? (
              <MediaCard
                className="w-full"
                aria-label={background.kind === 'video' ? t({ ko: '라이브러리에서 영상 고르기', en: 'Pick a video from the library' }) : t({ ko: '라이브러리에서 이미지 고르기', en: 'Pick an image from the library' })}
                onClick={() => setIsPickerOpen(true)}
                media={<img src={buildApiUrl(`/api/images/${background.compositeHash}/thumbnail`)} alt="" className="aspect-video w-full object-cover" />}
              />
            ) : (
              <Button type="button" variant="secondary" className="w-full" onClick={() => setIsPickerOpen(true)}>
                <ImagePlus className="size-4" />
                {background.kind === 'video' ? t({ ko: '라이브러리에서 영상 고르기', en: 'Pick a video from the library' }) : t({ ko: '라이브러리에서 이미지 고르기', en: 'Pick an image from the library' })}
              </Button>
            )}
            {fitSegments(background.fit)}
          </>
        ) : null}
        {background.kind === 'group-slideshow' ? (
          <>
            <InspectorRow label={t({ ko: '그룹', en: 'Group' })}>
              <Select value={background.groupId !== null ? String(background.groupId) : ''} onChange={(event) => patch({ groupId: event.target.value ? Number(event.target.value) : null } as Partial<WallpaperBackground>, 'groupId')}>
                <option value="">{t({ ko: '그룹 선택', en: 'Select group' })}</option>
                {groups.map((group) => <option key={group.id} value={group.id}>{`${'　'.repeat(group.depth ?? 0)}${group.name}`}</option>)}
              </Select>
            </InspectorRow>
            <SwitchLine label={t({ ko: '하위 그룹 포함', en: 'Include child groups' })} checked={background.includeChildren} onCheckedChange={(checked) => patch({ includeChildren: checked } as Partial<WallpaperBackground>, 'includeChildren')} />
            <InspectorRow label={t({ ko: '간격', en: 'Interval' })}>
              <Select value={String(background.intervalSec)} onChange={(event) => patch({ intervalSec: Number(event.target.value) } as Partial<WallpaperBackground>, 'intervalSec')}>
                {[30, 60, 180, 300, 600, 1800, 3600].map((seconds) => (
                  <option key={seconds} value={seconds}>{seconds < 60 ? t({ ko: '{n}초', en: '{n}s' }, { n: seconds }) : t({ ko: '{n}분', en: '{n} min' }, { n: seconds / 60 })}</option>
                ))}
              </Select>
            </InspectorRow>
            <InspectorSegments
              label={t({ ko: '전환', en: 'Transition' })}
              value={background.transition}
              items={[
                { value: 'fade', label: t({ ko: '페이드', en: 'Fade' }) },
                { value: 'zoom', label: t({ ko: '줌', en: 'Zoom' }) },
                { value: 'slide', label: t({ ko: '슬라이드', en: 'Slide' }) },
              ]}
              onChange={(value) => patch({ transition: value } as Partial<WallpaperBackground>, 'transition')}
            />
            {fitSegments(background.fit)}
          </>
        ) : null}
        {hasStillImage ? (
          <SwitchLine label={t({ ko: '천천히 확대·이동', en: 'Slow pan and zoom' })} checked={background.kenBurns === true} onCheckedChange={(checked) => patch({ kenBurns: checked }, 'kenBurns')} />
        ) : null}

        {background.kind !== 'theme' ? (
          <>
            <InspectorHeading>{t({ ko: '오버레이', en: 'Overlay' })}</InspectorHeading>
            <InspectorSlider label={t({ ko: '어둡게', en: 'Dim' })} value={overlay.dim} min={0} max={80} unit="%" onChange={(value) => patch({ dim: value }, 'dim')} />
            {background.kind !== 'color' && background.kind !== 'gradient' ? (
              <InspectorSlider label={t({ ko: '흐림', en: 'Blur' })} value={overlay.blur} min={0} max={24} unit="px" onChange={(value) => patch({ blur: value }, 'blur')} />
            ) : null}
            <InspectorSlider label={t({ ko: '비네팅', en: 'Vignette' })} value={overlay.vignette} min={0} max={100} unit="%" onChange={(value) => patch({ vignette: value }, 'vignette')} />
          </>
        ) : null}
      </div>

      <div className="text-base font-semibold">{t({ ko: '스타일', en: 'Style' })}</div>
      <div className="space-y-3">
        <InspectorColor label={t({ ko: '강조색', en: 'Accent' })} value={options.accentColor} fallback="#7c5cff" themeVariable="--primary" nullable onChange={(value) => setOption('accentColor', value)} />
        {background.kind === 'image' || background.kind === 'video' || background.kind === 'group-slideshow' ? (
          <SwitchLine label={t({ ko: '배경에서 강조색 뽑기', en: 'Accent from background' })} checked={options.autoAccent} onCheckedChange={(checked) => setOption('autoAccent', checked)} />
        ) : null}
        <InspectorColor label={t({ ko: '글자색', en: 'Text' })} value={options.textColor} fallback="#f2f2f2" themeVariable="--foreground" nullable onChange={(value) => setOption('textColor', value)} />
        <InspectorRow label={t({ ko: '글꼴', en: 'Font' })}>
          <Select value={options.fontFamily} onChange={(event) => setOption('fontFamily', event.target.value as WallpaperWidgetFont)}>
            <option value="inherit">{t({ ko: '앱 설정', en: 'App' })}</option>
            <option value="sans">{t({ ko: '고딕', en: 'Sans' })}</option>
            <option value="serif">{t({ ko: '명조', en: 'Serif' })}</option>
            <option value="mono">{t({ ko: '고정폭', en: 'Mono' })}</option>
            <option value="display">{t({ ko: '디스플레이', en: 'Display' })}</option>
          </Select>
        </InspectorRow>
      </div>

      <div className="text-base font-semibold">{t({ ko: '효과', en: 'Effects' })}</div>
      <div className="space-y-3">
        <InspectorRow label={t({ ko: '파티클', en: 'Particles' })}>
          <Select value={options.particles} onChange={(event) => setOption('particles', event.target.value as WallpaperParticleKind)}>
            <option value="none">{t({ ko: '없음', en: 'None' })}</option>
            <option value="snow">{t({ ko: '눈', en: 'Snow' })}</option>
            <option value="sakura">{t({ ko: '벚꽃', en: 'Sakura' })}</option>
            <option value="rain">{t({ ko: '비', en: 'Rain' })}</option>
            <option value="dust">{t({ ko: '먼지', en: 'Dust' })}</option>
            <option value="fireflies">{t({ ko: '반딧불', en: 'Fireflies' })}</option>
          </Select>
        </InspectorRow>
        {options.particles !== 'none' ? (
          <InspectorSlider label={t({ ko: '양', en: 'Amount' })} value={options.particleAmount} min={0} max={100} unit="%" onChange={(value) => setOption('particleAmount', value)} />
        ) : null}
        <InspectorSlider label={t({ ko: '패럴랙스', en: 'Parallax' })} value={options.parallax} min={0} max={100} unit="%" onChange={(value) => setOption('parallax', value)} />
      </div>

      <div className="text-base font-semibold">{t({ ko: '동작', en: 'Behavior' })}</div>
      <div className="space-y-3">
        <InspectorSegments
          label={t({ ko: '위젯 표시', en: 'Widgets' })}
          value={options.widgetReveal}
          items={[
            { value: 'always', label: t({ ko: '항상', en: 'Always' }) },
            { value: 'pointer', label: t({ ko: '마우스 가까이', en: 'Near pointer' }) },
          ]}
          onChange={(value) => setOption('widgetReveal', value)}
        />
        {options.widgetReveal === 'pointer' ? (
          <InspectorSlider label={t({ ko: '평소 투명도', en: 'Idle opacity' })} value={options.idleOpacity} min={0} max={100} unit="%" onChange={(value) => setOption('idleOpacity', value)} />
        ) : null}
        <InspectorRow label={t({ ko: 'FPS 상한', en: 'FPS cap' })}>
          <Select value={String(options.fpsLimit)} onChange={(event) => setOption('fpsLimit', Number(event.target.value))}>
            <option value="0">{t({ ko: '제한 없음', en: 'None' })}</option>
            {[60, 30, 24, 15].map((fps) => <option key={fps} value={fps}>{fps}</option>)}
          </Select>
        </InspectorRow>
      </div>

      {isPickerOpen && (background.kind === 'image' || background.kind === 'video') ? (
        <MediaLibraryPicker
          initial={[]}
          maxCount={1}
          mediaKind={background.kind}
          title={background.kind === 'video' ? t({ ko: '배경 영상', en: 'Background video' }) : t({ ko: '배경 이미지', en: 'Background image' })}
          applyLabel={t({ ko: '적용', en: 'Apply' })}
          onClose={() => setIsPickerOpen(false)}
          onPick={(items) => {
            setIsPickerOpen(false)
            if (items[0]) patch({ compositeHash: items[0].compositeHash } as Partial<WallpaperBackground>, 'compositeHash')
          }}
        />
      ) : null}
    </div>
  )
}
