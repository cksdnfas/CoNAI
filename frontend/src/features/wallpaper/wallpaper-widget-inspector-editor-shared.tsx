import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { SettingsField } from '@/features/settings/components/settings-primitives'
import { WallpaperEasingPicker } from './wallpaper-easing-picker'
import type { WallpaperAnimationEasing, WallpaperWidgetInstance } from './wallpaper-types'
import { getWallpaperHoverMotionAmount } from './wallpaper-widget-utils'

export type WallpaperWidgetSettingsPatchUpdater = (settingsPatch: Partial<WallpaperWidgetInstance['settings']>) => void

interface WallpaperHoverInteractionEditorFieldsProps {
  hoverMotion: number | undefined
  hoverEasing: WallpaperAnimationEasing | undefined
  onHoverMotionChange: (nextValue: number) => void
  onHoverEasingChange: (nextValue: WallpaperAnimationEasing) => void
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

/** Render a shared subsection label inside widget-specific editor blocks. */
export function WallpaperInspectorSubsectionLabel({ label }: { label: string }) {
  return <div className="pt-1 text-[10px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{label}</div>
}

/** Render the shared hover interaction controls for image-driven widgets. */
export function WallpaperHoverInteractionEditorFields({
  hoverMotion,
  hoverEasing,
  onHoverMotionChange,
  onHoverEasingChange,
}: WallpaperHoverInteractionEditorFieldsProps) {
  return (
    <>
      <SettingsField label="호버 반응">
        <ScrubbableNumberInput
          variant="settings"
          min={0}
          max={2.5}
          step={0.1}
          scrubRatio={0.45}
          value={getWallpaperHoverMotionAmount(hoverMotion ?? 1)}
          onChange={(nextValue) => {
            onHoverMotionChange(clampWallpaperInspectorNumber(nextValue, 1, 0, 2.5))
          }}
        />
      </SettingsField>
      <SettingsField label="호버 이징">
        <WallpaperEasingPicker
          value={hoverEasing}
          fallbackPreset="easeOutCubic"
          previewKind="hover"
          onChange={onHoverEasingChange}
        />
      </SettingsField>
    </>
  )
}
