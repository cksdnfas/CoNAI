import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Select } from '@/components/ui/select'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { SettingsField } from '@/features/settings/components/settings-primitives'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { WallpaperEasingPicker } from './wallpaper-easing-picker'
import type { WallpaperEasingPreviewKind } from './wallpaper-easing-picker-preview'
import type {
  WallpaperAnimationEasing,
  WallpaperAnimationEasingPreset,
  WallpaperImageTransitionSpeed,
  WallpaperImageTransitionStyle,
  WallpaperWidgetInstance,
} from './wallpaper-types'
import {
  getWallpaperHoverMotionAmount,
  getWallpaperImageTransitionDurationMs,
  getWallpaperMotionStrengthMultiplier,
} from './wallpaper-widget-utils'

export type WallpaperWidgetSettingsPatchUpdater = (settingsPatch: Partial<WallpaperWidgetInstance['settings']>) => void

interface WallpaperHoverInteractionEditorFieldsProps {
  hoverMotion: number | undefined
  hoverEasing: WallpaperAnimationEasing | undefined
  onHoverMotionChange: (nextValue: number) => void
  onHoverEasingChange: (nextValue: WallpaperAnimationEasing) => void
}

interface WallpaperTransitionAnimationEditorFieldProps {
  label?: string
  transitionStyle: WallpaperImageTransitionStyle | undefined
  transitionSpeed: WallpaperImageTransitionSpeed | undefined
  transitionDurationMs?: number
  transitionEasing: WallpaperAnimationEasing | undefined
  editorContent?: ReactNode
  onTransitionStyleChange: (nextValue: WallpaperImageTransitionStyle) => void
  onTransitionDurationChange: (nextValue: number) => void
  onTransitionEasingChange: (nextValue: WallpaperAnimationEasing) => void
}

interface WallpaperMotionEasingEditorFieldProps {
  label?: string
  easing: WallpaperAnimationEasing | undefined
  fallbackPreset?: WallpaperAnimationEasingPreset
  motionStrength?: number
  motionSpeed?: number
  previewKind?: WallpaperEasingPreviewKind
  summary?: ReactNode
  editorContent?: ReactNode
  onEasingChange: (nextValue: WallpaperAnimationEasing) => void
}

interface WallpaperPreviewOpenAnimationEditorFieldProps {
  scalePercent?: number
  durationMs?: number
  easing: WallpaperAnimationEasing | undefined
  onScalePercentChange: (nextValue: number) => void
  onDurationMsChange: (nextValue: number) => void
  onEasingChange: (nextValue: WallpaperAnimationEasing) => void
}

interface WallpaperPreviewCloseAnimationEditorFieldProps {
  scalePercent?: number
  durationMs?: number
  easing: WallpaperAnimationEasing | undefined
  onScalePercentChange: (nextValue: number) => void
  onDurationMsChange: (nextValue: number) => void
  onEasingChange: (nextValue: WallpaperAnimationEasing) => void
}

/** Clamp numeric inspector input to the allowed range. */
export function clampWallpaperInspectorNumber(value: string, fallback: number, min: number, max: number, decimals = 1) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  const clamped = Math.min(max, Math.max(min, parsed))
  return decimals <= 0 ? Math.round(clamped) : Number(clamped.toFixed(decimals))
}

function normalizeWallpaperTransitionStyle(value: string): WallpaperImageTransitionStyle {
  switch (value) {
    case 'none':
    case 'zoom':
    case 'slide':
    case 'blur':
    case 'flip':
    case 'shuffle':
      return value
    case 'fade':
    default:
      return 'fade'
  }
}

function getWallpaperTransitionStyleLabel(style: WallpaperImageTransitionStyle | undefined, t: (dictionary: { ko: string; en: string }) => string) {
  switch (style ?? 'fade') {
    case 'zoom':
      return t({ ko: '줌', en: 'Zoom' })
    case 'slide':
      return t({ ko: '슬라이드', en: 'Slide' })
    case 'blur':
      return t({ ko: '블러', en: 'Blur' })
    case 'flip':
      return t({ ko: '플립', en: 'Flip' })
    case 'shuffle':
      return t({ ko: '셔플', en: 'Shuffle' })
    case 'none':
      return t({ ko: '없음', en: 'None' })
    case 'fade':
    default:
      return t({ ko: '페이드', en: 'Fade' })
  }
}

function renderWallpaperAnimationEditorCard({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="theme-settings-panel rounded-sm bg-surface-container p-3">
      <div className="mb-2 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{title}</div>
      {children}
    </div>
  )
}

/** Render one card-like section inside the wallpaper widget inspector. */
export function WallpaperInspectorSectionCard({
  title,
  children,
  className,
}: {
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-3 rounded-sm border border-border/70 bg-background/35 p-3', className)}>
      <div className="text-sm font-semibold text-foreground">{title}</div>
      {children}
    </section>
  )
}

/** Render one collapsible block for lower-priority settings inside a section card. */
export function WallpaperInspectorDisclosure({
  title,
  defaultOpen = false,
  children,
}: {
  title: string
  description?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="rounded-sm border border-border/70 bg-background/45">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
        onClick={() => {
          setOpen((current) => !current)
        }}
      >
        <div className="text-xs font-semibold tracking-[0.14em] text-foreground uppercase">{title}</div>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open ? 'rotate-180' : undefined)} />
      </button>

      {open ? <div className="space-y-2 border-t border-border/60 px-3 py-3">{children}</div> : null}
    </div>
  )
}

export function WallpaperTransitionAnimationEditorField({
  label,
  transitionStyle,
  transitionSpeed,
  transitionDurationMs,
  transitionEasing,
  editorContent,
  onTransitionStyleChange,
  onTransitionDurationChange,
  onTransitionEasingChange,
}: WallpaperTransitionAnimationEditorFieldProps) {
  const { t } = useI18n()
  const durationMs = getWallpaperImageTransitionDurationMs(transitionSpeed, transitionDurationMs)
  const summary = `${getWallpaperTransitionStyleLabel(transitionStyle, t)} · ${durationMs}ms`
  const effectiveLabel = label ?? t({ ko: '전환 애니메이션', en: 'Transition animation' })

  return (
    <SettingsField label={effectiveLabel}>
      <WallpaperEasingPicker
        value={transitionEasing}
        fallbackPreset="easeOutCubic"
        previewKind="transition"
        summary={summary}
        previewConfig={{
          transitionStyle: transitionStyle ?? 'fade',
          transitionDurationMs: durationMs,
        }}
        editorContent={(
          <>
            {renderWallpaperAnimationEditorCard({
              title: t({ ko: '전환 옵션', en: 'Transition options' }),
              children: (
                <div className="grid gap-3 sm:grid-cols-2">
                  <SettingsField label={t({ ko: '전환', en: 'Transition' })}>
                    <Select
                      value={transitionStyle ?? 'fade'}
                      onChange={(event) => {
                        onTransitionStyleChange(normalizeWallpaperTransitionStyle(event.target.value))
                      }}
                    >
                      <option value="fade">{t({ ko: '페이드', en: 'Fade' })}</option>
                      <option value="zoom">{t({ ko: '줌', en: 'Zoom' })}</option>
                      <option value="slide">{t({ ko: '슬라이드', en: 'Slide' })}</option>
                      <option value="blur">{t({ ko: '블러', en: 'Blur' })}</option>
                      <option value="flip">{t({ ko: '플립', en: 'Flip' })}</option>
                      <option value="shuffle">{t({ ko: '셔플', en: 'Shuffle' })}</option>
                      <option value="none">{t({ ko: '없음', en: 'None' })}</option>
                    </Select>
                  </SettingsField>
                  <SettingsField label={t({ ko: '전환 시간 (ms)', en: 'Transition duration (ms)' })}>
                    <ScrubbableNumberInput
                      variant="settings"
                      min={80}
                      max={4000}
                      step={10}
                      scrubRatio={0.35}
                      value={durationMs}
                      onChange={(nextValue) => {
                        onTransitionDurationChange(clampWallpaperInspectorNumber(nextValue, durationMs, 80, 4000, 0))
                      }}
                    />
                  </SettingsField>
                </div>
              ),
            })}
            {editorContent}
          </>
        )}
        onChange={onTransitionEasingChange}
      />
    </SettingsField>
  )
}

/** Render the shared hover interaction controls for image-driven widgets. */
export function WallpaperHoverInteractionEditorFields({
  hoverMotion,
  hoverEasing,
  onHoverMotionChange,
  onHoverEasingChange,
}: WallpaperHoverInteractionEditorFieldsProps) {
  const { t } = useI18n()
  const hoverAmount = getWallpaperHoverMotionAmount(hoverMotion ?? 1)

  return (
    <SettingsField label={t({ ko: '호버 애니메이션', en: 'Hover animation' })}>
      <WallpaperEasingPicker
        value={hoverEasing}
        fallbackPreset="easeOutCubic"
        previewKind="hover"
        summary={t({ ko: `강도 ${hoverAmount.toFixed(1)}`, en: `Strength ${hoverAmount.toFixed(1)}` })}
        previewConfig={{ hoverMotion }}
        editorContent={renderWallpaperAnimationEditorCard({
          title: t({ ko: '호버 옵션', en: 'Hover options' }),
          children: (
            <SettingsField label={t({ ko: '호버 반응', en: 'Hover response' })}>
              <ScrubbableNumberInput
                variant="settings"
                min={0}
                max={2.5}
                step={0.1}
                scrubRatio={0.45}
                value={hoverAmount}
                onChange={(nextValue) => {
                  onHoverMotionChange(clampWallpaperInspectorNumber(nextValue, 1, 0, 2.5))
                }}
              />
            </SettingsField>
          ),
        })}
        onChange={onHoverEasingChange}
      />
    </SettingsField>
  )
}

export function WallpaperMotionEasingEditorField({
  label,
  easing,
  fallbackPreset = 'easeOutCubic',
  motionStrength,
  motionSpeed,
  previewKind = 'motion',
  summary,
  editorContent,
  onEasingChange,
}: WallpaperMotionEasingEditorFieldProps) {
  const { t } = useI18n()
  const effectiveLabel = label ?? t({ ko: '모션 이징', en: 'Motion easing' })
  const summaryText = summary ?? [
    motionStrength !== undefined ? t({ ko: `강도 ${getWallpaperMotionStrengthMultiplier(motionStrength).toFixed(1)}`, en: `Strength ${getWallpaperMotionStrengthMultiplier(motionStrength).toFixed(1)}` }) : null,
    motionSpeed !== undefined ? t({ ko: `속도 ${Math.min(20, Math.max(0.2, motionSpeed)).toFixed(1)}`, en: `Speed ${Math.min(20, Math.max(0.2, motionSpeed)).toFixed(1)}` }) : null,
  ].filter(Boolean).join(' · ')

  return (
    <SettingsField label={effectiveLabel}>
      <WallpaperEasingPicker
        value={easing}
        fallbackPreset={fallbackPreset}
        previewKind={previewKind}
        summary={summaryText || undefined}
        previewConfig={{ motionStrength, motionSpeed }}
        editorContent={editorContent}
        onChange={onEasingChange}
      />
    </SettingsField>
  )
}

export function WallpaperPreviewOpenAnimationEditorField({
  scalePercent,
  durationMs,
  easing,
  onScalePercentChange,
  onDurationMsChange,
  onEasingChange,
}: WallpaperPreviewOpenAnimationEditorFieldProps) {
  const { t } = useI18n()
  const resolvedScalePercent = Math.min(100, Math.max(60, Math.round(scalePercent ?? 88)))
  const resolvedDurationMs = Math.min(1200, Math.max(80, Math.round(durationMs ?? 260)))
  const summary = `${resolvedScalePercent}% · ${resolvedDurationMs}ms`

  return (
    <SettingsField label={t({ ko: '클릭 확대 애니메이션', en: 'Click zoom animation' })}>
      <WallpaperEasingPicker
        value={easing}
        fallbackPreset="easeOutCubic"
        previewKind="transition"
        summary={summary}
        previewConfig={{
          transitionStyle: 'zoom',
          transitionDurationMs: resolvedDurationMs,
        }}
        editorContent={renderWallpaperAnimationEditorCard({
          title: t({ ko: '확대 미리보기 옵션', en: 'Zoom preview options' }),
          children: (
            <div className="grid gap-3 sm:grid-cols-2">
              <SettingsField label={t({ ko: '시작 크기 (%)', en: 'Start scale (%)' })}>
                <ScrubbableNumberInput
                  variant="settings"
                  min={60}
                  max={100}
                  step={1}
                  scrubRatio={0.35}
                  value={resolvedScalePercent}
                  onChange={(nextValue) => {
                    onScalePercentChange(clampWallpaperInspectorNumber(nextValue, resolvedScalePercent, 60, 100, 0))
                  }}
                />
              </SettingsField>
              <SettingsField label={t({ ko: '열림 시간 (ms)', en: 'Open duration (ms)' })}>
                <ScrubbableNumberInput
                  variant="settings"
                  min={80}
                  max={1200}
                  step={10}
                  scrubRatio={0.35}
                  value={resolvedDurationMs}
                  onChange={(nextValue) => {
                    onDurationMsChange(clampWallpaperInspectorNumber(nextValue, resolvedDurationMs, 80, 1200, 0))
                  }}
                />
              </SettingsField>
            </div>
          ),
        })}
        onChange={onEasingChange}
      />
    </SettingsField>
  )
}

export function WallpaperPreviewCloseAnimationEditorField({
  scalePercent,
  durationMs,
  easing,
  onScalePercentChange,
  onDurationMsChange,
  onEasingChange,
}: WallpaperPreviewCloseAnimationEditorFieldProps) {
  const { t } = useI18n()
  const resolvedScalePercent = Math.min(100, Math.max(60, Math.round(scalePercent ?? 88)))
  const resolvedDurationMs = Math.min(1200, Math.max(80, Math.round(durationMs ?? 260)))
  const summary = `${resolvedScalePercent}% · ${resolvedDurationMs}ms`

  return (
    <SettingsField label={t({ ko: '클릭 닫힘 애니메이션', en: 'Click close animation' })}>
      <WallpaperEasingPicker
        value={easing}
        fallbackPreset="easeInOutCubic"
        previewKind="transition"
        summary={summary}
        previewConfig={{
          transitionStyle: 'zoom',
          transitionDurationMs: resolvedDurationMs,
        }}
        editorContent={renderWallpaperAnimationEditorCard({
          title: t({ ko: '닫힘 미리보기 옵션', en: 'Close preview options' }),
          children: (
            <div className="grid gap-3 sm:grid-cols-2">
              <SettingsField label={t({ ko: '끝 크기 (%)', en: 'End scale (%)' })}>
                <ScrubbableNumberInput
                  variant="settings"
                  min={60}
                  max={100}
                  step={1}
                  scrubRatio={0.35}
                  value={resolvedScalePercent}
                  onChange={(nextValue) => {
                    onScalePercentChange(clampWallpaperInspectorNumber(nextValue, resolvedScalePercent, 60, 100, 0))
                  }}
                />
              </SettingsField>
              <SettingsField label={t({ ko: '닫힘 시간 (ms)', en: 'Close duration (ms)' })}>
                <ScrubbableNumberInput
                  variant="settings"
                  min={80}
                  max={1200}
                  step={10}
                  scrubRatio={0.35}
                  value={resolvedDurationMs}
                  onChange={(nextValue) => {
                    onDurationMsChange(clampWallpaperInspectorNumber(nextValue, resolvedDurationMs, 80, 1200, 0))
                  }}
                />
              </SettingsField>
            </div>
          ),
        })}
        onChange={onEasingChange}
      />
    </SettingsField>
  )
}
