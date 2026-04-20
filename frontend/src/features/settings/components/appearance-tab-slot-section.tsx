import { Check, Paintbrush, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { extractAppearanceTheme, resolveAppearanceColors, resolveSurfacePalette } from '@/lib/appearance'
import { cn } from '@/lib/utils'
import type { AppearancePresetSlot, AppearanceSettings } from '@/types/settings'
import { areThemeSettingsEqual, formatSlotTimestamp } from './appearance-tab.utils'

interface AppearanceTabSlotSectionProps {
  appearanceDraft: AppearanceSettings
  savedAppearance: AppearanceSettings
  isSaving: boolean
  onPatchAppearance: (patch: Partial<AppearanceSettings>) => void
  onSavePresetSlots: (presetSlots: AppearancePresetSlot[]) => void
}

function getThemeModeLabel(mode: AppearanceSettings['themeMode']) {
  switch (mode) {
    case 'system':
      return '시스템'
    case 'dark':
      return '다크'
    case 'light':
      return '라이트'
    default:
      return mode
  }
}

function getDensityLabel(density: AppearanceSettings['density']) {
  switch (density) {
    case 'ultra-compact':
      return '아주 촘촘하게'
    case 'compact':
      return '촘촘하게'
    case 'comfortable':
      return '기본'
    case 'spacious':
      return '여유롭게'
    default:
      return String(density)
  }
}

export function AppearanceTabSlotSection({
  appearanceDraft,
  savedAppearance,
  isSaving,
  onPatchAppearance,
  onSavePresetSlots,
}: AppearanceTabSlotSectionProps) {
  return (
    <div className="grid gap-3 xl:grid-cols-3">
      {appearanceDraft.presetSlots.map((slot, index) => {
          const slotTheme = slot.appearance
          const slotColors = slotTheme ? resolveAppearanceColors(slotTheme) : null
          const slotSurface = slotTheme ? resolveSurfacePalette(slotTheme) : null
          const isActiveSlot = areThemeSettingsEqual(appearanceDraft, slotTheme)
          const matchesSavedTheme = areThemeSettingsEqual(savedAppearance, slotTheme)
          const isEmptySlot = !slotTheme
          const overwriteLabel = isEmptySlot ? '현재값 저장' : '덮어쓰기'
          const statusLabel = isEmptySlot
            ? '비어 있음'
            : isActiveSlot
              ? '현재값'
              : matchesSavedTheme
                ? '저장됨'
                : '슬롯'

          return (
            <div
              key={slot.id}
              className={cn(
                'rounded-sm border p-4 transition-colors',
                isActiveSlot ? 'border-primary bg-surface-high' : 'border-border bg-surface-low',
              )}
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="rounded-full border border-border bg-background/70 px-2 py-1 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                      슬롯 {index + 1}
                    </span>
                    <span
                      className={cn(
                        'rounded-full px-2 py-1 text-[11px] font-semibold',
                        isEmptySlot
                          ? 'bg-surface-high text-muted-foreground'
                          : isActiveSlot
                            ? 'bg-primary/14 text-primary'
                            : matchesSavedTheme
                              ? 'bg-emerald-500/14 text-emerald-300'
                              : 'bg-surface-highest text-foreground',
                      )}
                    >
                      {statusLabel}
                    </span>
                  </div>
                  <div className="text-right text-[11px] text-muted-foreground">{formatSlotTimestamp(slot.updatedAt)}</div>
                </div>

                <Input
                  type="text"
                  variant="settings"
                  value={slot.label}
                  onChange={(event) =>
                    onPatchAppearance({
                      presetSlots: appearanceDraft.presetSlots.map((candidate) =>
                        candidate.id === slot.id ? { ...candidate, label: event.target.value } : candidate,
                      ),
                    })
                  }
                  maxLength={32}
                  placeholder="슬롯 이름"
                />

                {slotTheme ? (
                  <div className="space-y-3 rounded-sm border border-border/70 bg-surface-lowest px-3 py-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{getThemeModeLabel(slotTheme.themeMode)}</span>
                      <span>·</span>
                      <span>{slotTheme.accentPreset}</span>
                      <span>·</span>
                      <span>{slotTheme.surfacePreset}</span>
                      <span>·</span>
                      <span>{getDensityLabel(slotTheme.density)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: slotColors?.primary }} />
                      <span className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: slotColors?.secondary }} />
                      <span className="h-5 flex-1 rounded-sm border border-border" style={{ backgroundColor: slotSurface?.background }} />
                      <span className="h-5 flex-1 rounded-sm border border-border" style={{ backgroundColor: slotSurface?.surfaceContainer }} />
                      <span className="h-5 flex-1 rounded-sm border border-border" style={{ backgroundColor: slotSurface?.surfaceHigh }} />
                    </div>
                  </div>
                ) : (
                  <div className="rounded-sm border border-dashed border-border bg-background/40 px-3 py-4 text-xs text-muted-foreground">
                    저장된 테마 없음
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
                    불러오기
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
                              label: candidate.label.trim() || `슬롯 ${index + 1}`,
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
              </div>
            </div>
          )
        })}
    </div>
  )
}
