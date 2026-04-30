import { Check, Paintbrush, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
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

function getThemeModeLabel(mode: AppearanceSettings['themeMode'], t: ReturnType<typeof useI18n>['t']) {
  switch (mode) {
    case 'system':
      return t({ ko: '시스템', en: 'System' })
    case 'dark':
      return t({ ko: '다크', en: 'Dark' })
    case 'light':
      return t({ ko: '라이트', en: 'Light' })
    default:
      return mode
  }
}

function getDensityLabel(density: AppearanceSettings['density'], t: ReturnType<typeof useI18n>['t']) {
  switch (density) {
    case 'ultra-compact':
      return t({ ko: '아주 촘촘하게', en: 'Ultra compact' })
    case 'compact':
      return t({ ko: '촘촘하게', en: 'Compact' })
    case 'comfortable':
      return t({ ko: '기본', en: 'Default' })
    case 'spacious':
      return t({ ko: '여유롭게', en: 'Spacious' })
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
  const { locale, t } = useI18n()

  return (
    <div className="grid gap-3 xl:grid-cols-3">
      {appearanceDraft.presetSlots.map((slot, index) => {
        const slotTheme = slot.appearance
        const slotColors = slotTheme ? resolveAppearanceColors(slotTheme) : null
        const slotSurface = slotTheme ? resolveSurfacePalette(slotTheme) : null
        const isActiveSlot = areThemeSettingsEqual(appearanceDraft, slotTheme)
        const matchesSavedTheme = areThemeSettingsEqual(savedAppearance, slotTheme)
        const isEmptySlot = !slotTheme
        const overwriteLabel = isEmptySlot ? t({ ko: '현재값 저장', en: 'Save current values' }) : t({ ko: '덮어쓰기', en: 'Overwrite' })
        const statusLabel = isEmptySlot
          ? t({ ko: '비어 있음', en: 'Empty' })
          : isActiveSlot
            ? t('appearanceTabSlotSection.currentValues')
            : matchesSavedTheme
              ? t({ ko: '저장됨', en: 'Saved' })
              : t({ ko: '슬롯', en: 'Slot' })

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
                    {t({ ko: '슬롯 {index}', en: 'Slot {index}' }, { index: index + 1 })}
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
                <div className="text-right text-[11px] text-muted-foreground">{formatSlotTimestamp(slot.updatedAt, locale, t('appearanceTabUtils.noSaveHistory'))}</div>
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
                placeholder={t('appearanceTabSlotSection.slotName')}
              />

              {slotTheme ? (
                <div className="space-y-3 rounded-sm border border-border/70 bg-surface-lowest px-3 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{getThemeModeLabel(slotTheme.themeMode, t)}</span>
                    <span>·</span>
                    <span>{slotTheme.accentPreset}</span>
                    <span>·</span>
                    <span>{slotTheme.surfacePreset}</span>
                    <span>·</span>
                    <span>{getDensityLabel(slotTheme.density, t)}</span>
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
                  {t({ ko: '저장된 테마 없음', en: 'No saved theme' })}
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
                  {t({ ko: '불러오기', en: 'Load' })}
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
                            label: candidate.label.trim() || t({ ko: '슬롯 {index}', en: 'Slot {index}' }, { index: index + 1 }),
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
