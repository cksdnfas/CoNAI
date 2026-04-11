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
  transitionStyle: WallpaperImageTransitionStyle | undefined
  transitionSpeed: WallpaperImageTransitionSpeed | undefined
  transitionEasing: WallpaperAnimationEasing | undefined
  editorContent?: ReactNode
  onTransitionStyleChange: (nextValue: WallpaperImageTransitionStyle) => void
  onTransitionSpeedChange: (nextValue: WallpaperImageTransitionSpeed) => void
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

function normalizeWallpaperTransitionSpeed(value: string): WallpaperImageTransitionSpeed {
  switch (value) {
    case 'fast':
    case 'slow':
      return value
    case 'normal':
    default:
      return 'normal'
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

function getWallpaperTransitionSpeedLabel(speed: WallpaperImageTransitionSpeed | undefined) {
  switch (speed ?? 'normal') {
    case 'fast':
      return '빠름'
    case 'slow':
      return '느림'
    case 'normal':
    default:
      return '보통'
  }
}

function renderWallpaperAnimationEditorCard({
  title,
  description,
  children,
}: {
  title: string
  description?: string
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
    <section className={cn('space-y-3 rounded-sm border border-border bg-surface-low p-3', className)}>
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
  transitionStyle,
  transitionSpeed,
  transitionEasing,
  editorContent,
  onTransitionStyleChange,
  onTransitionSpeedChange,
  onTransitionEasingChange,
}: WallpaperTransitionAnimationEditorFieldProps) {
  const durationMs = getWallpaperImageTransitionDurationMs(transitionSpeed)
  const summary = `${getWallpaperTransitionStyleLabel(transitionStyle)} · ${getWallpaperTransitionSpeedLabel(transitionSpeed)} · ${durationMs}ms`

  return (
    <SettingsField label="전환 애니메이션">
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
              description: '곡선만 고르지 말고, 전환 방식과 속도도 여기서 같이 맞춰.',
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
                  <SettingsField label="속도">
                    <Select
                      value={transitionSpeed ?? 'normal'}
                      onChange={(event) => {
                        onTransitionSpeedChange(normalizeWallpaperTransitionSpeed(event.target.value))
                      }}
                    >
                      <option value="fast">빠름</option>
                      <option value="normal">보통</option>
                      <option value="slow">느림</option>
                    </Select>
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
          description: '호버 반응량까지 같이 맞춰야 미리보기가 실제 느낌에 가까워져.',
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
