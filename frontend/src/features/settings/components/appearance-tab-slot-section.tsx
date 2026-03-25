import { Check, Paintbrush, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  APPEARANCE_PRESETS,
  DENSITY_PRESETS,
  GLASS_PRESETS,
  RADIUS_PRESETS,
  SHADOW_PRESETS,
  SURFACE_PRESETS,
  extractAppearanceTheme,
  resolveAppearanceColors,
  resolveSurfacePalette,
} from '@/lib/appearance'
import { getThemeToneStyle } from '@/lib/theme-tones'
import { cn } from '@/lib/utils'
import type { AppearancePresetSlot, AppearanceSettings } from '@/types/settings'
import { settingsControlClassName } from './settings-control-classes'
import { areThemeSettingsEqual, formatSlotTimestamp } from './appearance-tab.utils'

interface AppearanceTabSlotSectionProps {
  appearanceDraft: AppearanceSettings
  savedAppearance: AppearanceSettings
  savedThemeMatchesDraft: boolean
  isSaving: boolean
  onPatchAppearance: (patch: Partial<AppearanceSettings>) => void
  onSavePresetSlots: (presetSlots: AppearancePresetSlot[]) => void
}

export function AppearanceTabSlotSection({
  appearanceDraft,
  savedAppearance,
  savedThemeMatchesDraft,
  isSaving,
  onPatchAppearance,
  onSavePresetSlots,
}: AppearanceTabSlotSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Saved theme slots</div>
        <div className="text-xs text-muted-foreground">Quick apply는 미리보기만 바꾸고, Save를 눌러야 실제 화면 설정으로 저장돼.</div>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        {appearanceDraft.presetSlots.map((slot, index) => {
          const slotTheme = slot.appearance
          const slotColors = slotTheme ? resolveAppearanceColors(slotTheme) : null
          const slotSurface = slotTheme ? resolveSurfacePalette(slotTheme) : null
          const isActiveSlot = areThemeSettingsEqual(appearanceDraft, slotTheme)
          const matchesSavedTheme = areThemeSettingsEqual(savedAppearance, slotTheme)
          const isEmptySlot = !slotTheme
          const overwriteLabel = isEmptySlot ? '현재값 저장' : '현재값으로 덮어쓰기'
          const slotModeLabel = slotTheme ? slotTheme.themeMode : 'empty'
          const slotDensityLabel = slotTheme ? DENSITY_PRESETS[slotTheme.density].label : 'Empty'
          const slotRadiusLabel = slotTheme ? RADIUS_PRESETS[slotTheme.radiusPreset].label : 'Not set'
          const slotGlassLabel = slotTheme ? GLASS_PRESETS[slotTheme.glassPreset].label : 'Not set'
          const slotShadowLabel = slotTheme ? SHADOW_PRESETS[slotTheme.shadowPreset].label : 'Not set'
          const accentLabel = slotTheme
            ? slotTheme.accentPreset === 'custom'
              ? 'Custom accent'
              : APPEARANCE_PRESETS[slotTheme.accentPreset].label
            : 'No accent'
          const surfaceLabel = slotTheme
            ? slotTheme.surfacePreset === 'custom'
              ? 'Custom surface'
              : SURFACE_PRESETS[slotTheme.surfacePreset].label
            : 'Empty'

          return (
            <div
              key={slot.id}
              className={cn(
                'rounded-sm border p-4 transition-colors',
                isActiveSlot
                  ? 'border-primary bg-surface-high'
                  : 'border-border bg-surface-low',
              )}
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-border bg-background/70 px-2 py-1 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                        Slot {index + 1}
                      </span>
                      <span
                        className={cn(
                          'rounded-full px-2 py-1 text-[11px] font-semibold',
                          isEmptySlot
                            ? 'bg-surface-high text-muted-foreground'
                            : isActiveSlot
                              ? 'bg-primary/14 text-primary'
                              : matchesSavedTheme
                                ? ''
                                : 'bg-surface-highest text-foreground',
                        )}
                        style={matchesSavedTheme && !isEmptySlot && !isActiveSlot ? getThemeToneStyle('positive') : undefined}
                      >
                        {isEmptySlot ? 'Empty' : isActiveSlot ? 'Active preview' : matchesSavedTheme ? 'Saved baseline' : 'Saved slot'}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={slot.label}
                      onChange={(event) =>
                        onPatchAppearance({
                          presetSlots: appearanceDraft.presetSlots.map((candidate) =>
                            candidate.id === slot.id
                              ? { ...candidate, label: event.target.value }
                              : candidate,
                          ),
                        })
                      }
                      className={settingsControlClassName}
                      maxLength={32}
                      placeholder="Slot name"
                    />
                  </div>
                  <div className="text-right text-[11px] text-muted-foreground">
                    {formatSlotTimestamp(slot.updatedAt)}
                  </div>
                </div>

                {slotTheme ? (
                  <div
                    className="overflow-hidden rounded-sm border border-border/80"
                    style={{
                      background: `linear-gradient(150deg, ${slotSurface?.background} 0%, ${slotSurface?.surfaceContainer} 60%, ${slotSurface?.surfaceHigh} 100%)`,
                    }}
                  >
                    <div className="space-y-3 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="text-sm font-semibold" style={{ color: slotSurface?.foreground }}>
                            {slot.label.trim() || `Slot ${index + 1}`}
                          </div>
                          <div className="text-xs" style={{ color: slotSurface?.mutedForeground }}>
                            {slotModeLabel} mode · {accentLabel}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="h-3.5 w-3.5 rounded-full border border-white/20" style={{ backgroundColor: slotColors?.primary }} />
                          <span className="h-3.5 w-3.5 rounded-full border border-white/20" style={{ backgroundColor: slotColors?.secondary }} />
                        </div>
                      </div>

                      <div className="grid grid-cols-[1.2fr_0.85fr] gap-2">
                        <div
                          className="rounded-sm border px-3 py-2"
                          style={{
                            backgroundColor: slotSurface?.surfaceContainer,
                            borderColor: slotSurface?.border,
                          }}
                        >
                          <div className="text-[11px] font-medium" style={{ color: slotSurface?.mutedForeground }}>
                            Surface mood
                          </div>
                          <div className="mt-1 text-sm font-semibold" style={{ color: slotSurface?.foreground }}>
                            {surfaceLabel}
                          </div>
                        </div>
                        <div
                          className="rounded-sm border px-3 py-2"
                          style={{
                            backgroundColor: slotColors?.primary,
                            borderColor: slotSurface?.border,
                            color: '#ffffff',
                          }}
                        >
                          <div className="text-[11px] font-medium text-white/80">Density</div>
                          <div className="mt-1 text-sm font-semibold">{slotDensityLabel}</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2">
                        {[slotSurface?.background, slotSurface?.surfaceContainer, slotSurface?.surfaceHigh].map((color, colorIndex) => (
                          <span
                            key={`${slot.id}-surface-${colorIndex}`}
                            className="h-8 rounded-sm border border-white/10"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <div
                          className="rounded-sm border px-2 py-2"
                          style={{ backgroundColor: slotSurface?.surfaceLow, borderColor: slotSurface?.border, color: slotSurface?.foreground }}
                        >
                          Radius
                          <div className="mt-1 font-semibold">{slotRadiusLabel}</div>
                        </div>
                        <div
                          className="rounded-sm border px-2 py-2"
                          style={{ backgroundColor: slotSurface?.surfaceLow, borderColor: slotSurface?.border, color: slotSurface?.foreground }}
                        >
                          Glass
                          <div className="mt-1 font-semibold">{slotGlassLabel}</div>
                        </div>
                        <div
                          className="rounded-sm border px-2 py-2"
                          style={{ backgroundColor: slotSurface?.surfaceLow, borderColor: slotSurface?.border, color: slotSurface?.foreground }}
                        >
                          Shadow
                          <div className="mt-1 font-semibold">{slotShadowLabel}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-sm border border-dashed border-border bg-background/40 px-3 py-5 text-xs text-muted-foreground">
                    <div className="font-semibold text-foreground">빈 슬롯</div>
                    <div className="mt-1">현재 draft를 저장하면 이 자리에 테마 미리보드가 생겨.</div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="flex-1 min-w-[9rem]"
                    disabled={!slotTheme || isSaving}
                    onClick={() => {
                      if (!slotTheme) return
                      onPatchAppearance({
                        ...extractAppearanceTheme(slotTheme),
                        presetSlots: appearanceDraft.presetSlots,
                      })
                    }}
                  >
                    <Paintbrush className="h-4 w-4" />
                    Quick apply
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="flex-1 min-w-[10rem]"
                    disabled={isSaving}
                    onClick={() => {
                      const nextPresetSlots = appearanceDraft.presetSlots.map((candidate) =>
                        candidate.id === slot.id
                          ? {
                              ...candidate,
                              label: candidate.label.trim() || `Slot ${index + 1}`,
                              appearance: extractAppearanceTheme(appearanceDraft),
                              updatedAt: new Date().toISOString(),
                            }
                          : candidate,
                      )
                      onSavePresetSlots(nextPresetSlots)
                    }}
                  >
                    {isEmptySlot ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                    {overwriteLabel}
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                  {isActiveSlot ? <span>현재 live preview와 동일</span> : null}
                  {matchesSavedTheme && !savedThemeMatchesDraft ? <span>저장된 baseline과 동일</span> : null}
                  {!isEmptySlot && !isActiveSlot ? <span>Quick apply 후 Save를 눌러야 적용이 고정돼.</span> : null}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
