import { Check, Paintbrush, Save } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { extractAppearanceTheme, resolveAppearanceColors, resolveSurfacePalette } from '@/lib/appearance'
import { cn } from '@/lib/utils'
import type { AppearancePresetSlot, AppearanceSettings } from '@conai/shared'
import { areThemeSettingsEqual, formatSlotTimestamp } from './appearance-tab.utils'

interface AppearanceTabSlotSectionProps {
  appearanceDraft: AppearanceSettings
  savedAppearance: AppearanceSettings
  isSaving: boolean
  onPatchAppearance: (patch: Partial<AppearanceSettings>) => void
  onSavePresetSlots: (presetSlots: AppearancePresetSlot[]) => void
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
              'rounded-sm p-4 transition-colors',
              isActiveSlot ? 'bg-primary/10 ring-1 ring-primary/40' : 'bg-surface-lowest',
            )}
          >
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  variant="settings"
                  className="min-w-0 flex-1"
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
                <span
                  className={cn(
                    'shrink-0 rounded-sm px-2 py-1 text-2xs font-semibold',
                    isEmptySlot
                      ? 'bg-surface-high text-muted-foreground'
                      : isActiveSlot
                        ? 'bg-primary/14 text-primary'
                        : matchesSavedTheme
                          ? 'bg-success-soft text-success-soft-foreground'
                          : 'bg-surface-highest text-foreground',
                  )}
                >
                  {statusLabel}
                </span>
              </div>

              {slotTheme ? (
                <div className="rounded-sm bg-surface-low px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="h-5 w-5 rounded-full border border-outline-input" style={{ backgroundColor: slotColors?.primary }} />
                    <span className="h-5 w-5 rounded-full border border-outline-input" style={{ backgroundColor: slotColors?.secondary }} />
                    <span className="h-5 flex-1 rounded-sm border border-outline-input" style={{ backgroundColor: slotSurface?.background }} />
                    <span className="h-5 flex-1 rounded-sm border border-outline-input" style={{ backgroundColor: slotSurface?.surfaceContainer }} />
                    <span className="h-5 flex-1 rounded-sm border border-outline-input" style={{ backgroundColor: slotSurface?.surfaceHigh }} />
                  </div>
                </div>
              ) : (
                <div className="rounded-sm bg-surface-low px-3 py-4 text-xs text-muted-foreground">
                  {t({ ko: '저장된 테마 없음', en: 'No saved theme' })}
                </div>
              )}

              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">{formatSlotTimestamp(slot.updatedAt, locale, t('appearanceTabUtils.noSaveHistory'))}</div>
                <IconButton
                  size="icon-sm"
                  variant="secondary"
                  label={t({ ko: '불러오기', en: 'Load' })}
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
                </IconButton>
                <IconButton
                  size="icon-sm"
                  label={overwriteLabel}
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
                </IconButton>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
