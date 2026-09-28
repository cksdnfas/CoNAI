import { Check, Paintbrush, Save } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { ListRow } from '@/components/ui/list-row'
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

/** Saved theme slots as hairline rows: palette preview, editable name, status, load / overwrite. */
export function AppearanceTabSlotSection({
  appearanceDraft,
  savedAppearance,
  isSaving,
  onPatchAppearance,
  onSavePresetSlots,
}: AppearanceTabSlotSectionProps) {
  const { locale, t } = useI18n()

  return (
    <div>
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
              : null

        return (
          <ListRow
            key={slot.id}
            size="lg"
            className="flex-wrap gap-y-2"
            leading={slotTheme ? (
              <span aria-hidden className="flex h-6 w-16 overflow-hidden rounded-sm shadow-[inset_0_0_0_1px_var(--line)]">
                <span className="flex-1" style={{ backgroundColor: slotSurface?.background }} />
                <span className="flex-1" style={{ backgroundColor: slotSurface?.surfaceHigh }} />
                <span className="flex-1" style={{ backgroundColor: slotColors?.primary }} />
                <span className="flex-1" style={{ backgroundColor: slotColors?.secondary }} />
              </span>
            ) : (
              <span aria-hidden className="block h-6 w-16 rounded-sm bg-fill" />
            )}
            trailing={(
              <>
                <span className="hidden text-xs sm:inline">{formatSlotTimestamp(slot.updatedAt, locale, t('appearanceTabUtils.noSaveHistory'))}</span>
                <IconButton
                  size="icon-sm"
                  variant="ghost"
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
                  variant="ghost"
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
              </>
            )}
          >
            <Input
              type="text"
              className="h-8 w-full min-w-0 max-w-52"
              value={slot.label}
              aria-label={t('appearanceTabSlotSection.slotName')}
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
            {statusLabel ? (
              <span className={cn('shrink-0 text-xs', isActiveSlot ? 'font-medium text-primary' : 'text-muted-foreground')}>{statusLabel}</span>
            ) : null}
          </ListRow>
        )
      })}
    </div>
  )
}
