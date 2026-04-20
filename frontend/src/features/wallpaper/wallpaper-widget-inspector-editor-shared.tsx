import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Select } from '@/components/ui/select'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { SettingsField } from '@/features/settings/components/settings-primitives'
import { cn } from '@/lib/utils'
import { WallpaperEasingPicker } from './wallpaper-easing-picker'
import type { WallpaperEasingPreviewKind } from './wallpaper-easing-picker-preview'
import type {
  WallpaperAnimationEasing,
  WallpaperAnimationEasingPreset,
  WallpaperImageHoverMotion,
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

function getWallpaperTransitionStyleLabel(style: WallpaperImageTransitionStyle | undefined) {
  switch (style ?? 'fade') {
    case 'zoom':
      return '줌'
    case 'slide':
      return '슬라이드'
    case 'blur':
      return '블러'
    case 'flip':
      return '플립'
    case 'shuffle':
      return '셔플'
    case 'none':
      return '없음'
    case 'fade':
    default:
      return '페이드'
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
  description,
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

/** Render one compact helper line under a settings control. */
export function WallpaperInspectorFieldHint({ children }: { children: ReactNode }) {
  return <div className="text-[11px] leading-5 text-muted-foreground">{children}</div>
}

/** Render one collapsible block for lower-priority settings inside a section card. */
export function WallpaperInspectorDisclosure({
  title,
  description,
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
  label = '전환 애니메이션',
  transitionStyle,
  transitionSpeed,
  transitionDurationMs,
  transitionEasing,
  editorContent,
  onTransitionStyleChange,
  onTransitionDurationChange,
  onTransitionEasingChange,
}: WallpaperTransitionAnimationEditorFieldProps) {
  const durationMs = getWallpaperImageTransitionDurationMs(transitionSpeed, transitionDurationMs)
  const summary = `${getWallpaperTransitionStyleLabel(transitionStyle)} · ${durationMs}ms`

  return (
    <SettingsField label={label}>
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
              title: '전환 옵션',
              children: (
                <div className="grid gap-3 sm:grid-cols-2">
                  <SettingsField label="전환">
                    <Select
                      value={transitionStyle ?? 'fade'}
                      onChange={(event) => {
                        onTransitionStyleChange(normalizeWallpaperTransitionStyle(event.target.value))
                      }}
                    >
                      <option value="fade">페이드</option>
                      <option value="zoom">줌</option>
                      <option value="slide">슬라이드</option>
                      <option value="blur">블러</option>
                      <option value="flip">플립</option>
                      <option value="shuffle">셔플</option>
                      <option value="none">없음</option>
                    </Select>
                  </SettingsField>
                  <SettingsField label="전환 시간 (ms)">
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
  const hoverAmount = getWallpaperHoverMotionAmount(hoverMotion ?? 1)

  return (
    <SettingsField label="호버 애니메이션">
      <WallpaperEasingPicker
        value={hoverEasing}
        fallbackPreset="easeOutCubic"
        previewKind="hover"
        summary={`강도 ${hoverAmount.toFixed(1)}`}
        previewConfig={{ hoverMotion }}
        editorContent={renderWallpaperAnimationEditorCard({
          title: '호버 옵션',
          children: (
            <SettingsField label="호버 반응">
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
  label = '모션 이징',
  easing,
  fallbackPreset = 'easeOutCubic',
  motionStrength,
  motionSpeed,
  previewKind = 'motion',
  summary,
  editorContent,
  onEasingChange,
}: WallpaperMotionEasingEditorFieldProps) {
  const summaryText = summary ?? [
    motionStrength !== undefined ? `강도 ${getWallpaperMotionStrengthMultiplier(motionStrength).toFixed(1)}` : null,
    motionSpeed !== undefined ? `속도 ${Math.min(20, Math.max(0.2, motionSpeed)).toFixed(1)}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <SettingsField label={label}>
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
  const resolvedScalePercent = Math.min(100, Math.max(60, Math.round(scalePercent ?? 88)))
  const resolvedDurationMs = Math.min(1200, Math.max(80, Math.round(durationMs ?? 260)))
  const summary = `${resolvedScalePercent}% · ${resolvedDurationMs}ms`

  return (
    <SettingsField label="클릭 확대 애니메이션">
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
          title: '확대 미리보기 옵션',
          children: (
            <div className="grid gap-3 sm:grid-cols-2">
              <SettingsField label="시작 크기 (%)">
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
              <SettingsField label="열림 시간 (ms)">
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
  const resolvedScalePercent = Math.min(100, Math.max(60, Math.round(scalePercent ?? 88)))
  const resolvedDurationMs = Math.min(1200, Math.max(80, Math.round(durationMs ?? 260)))
  const summary = `${resolvedScalePercent}% · ${resolvedDurationMs}ms`

  return (
    <SettingsField label="클릭 닫힘 애니메이션">
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
          title: '닫힘 미리보기 옵션',
          children: (
            <div className="grid gap-3 sm:grid-cols-2">
              <SettingsField label="끝 크기 (%)">
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
              <SettingsField label="닫힘 시간 (ms)">
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
