import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { APPEARANCE_PRESETS, DEFAULT_APPEARANCE_SETTINGS, SURFACE_PRESETS, resolveCustomSurfaceToneColors } from '@/lib/appearance'
import type { AppearanceSettings } from '@conai/shared'
import {
  type AppearanceTabEditorSectionProps,
  AppearanceColorControl,
  EditorSectionLead,
  getAccentPresetLabel,
  getSurfacePresetLabel,
} from './appearance-tab-editor-shared'
import { Field } from '@/components/ui/field'
import { useI18n } from '@/i18n'

/** One selectable preset tile: tonal tray, primary tint + ring when chosen. */
function PresetOptionButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Button
      type="button"
      variant="nav"
      data-active={active}
      aria-pressed={active}
      onClick={onClick}
      className="block h-auto bg-surface-lowest px-4 py-4 data-[active=true]:ring-1 data-[active=true]:ring-primary/45"
    >
      {children}
    </Button>
  )
}

/** Render the color-focused appearance controls for presets and custom palettes. */
export function AppearanceColorEditorContent({
  appearanceDraft,
  colorValues,
  onPatchAppearance,
}: AppearanceTabEditorSectionProps) {
  const { t } = useI18n()
  const defaultSurfaceToneColors = resolveCustomSurfaceToneColors(DEFAULT_APPEARANCE_SETTINGS)

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <EditorSectionLead title={t({ ko: '강조색', en: 'Accent colors' })} />
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(APPEARANCE_PRESETS).map(([presetKey, preset]) => {
            const isActive = appearanceDraft.accentPreset === presetKey

            return (
              <PresetOptionButton
                key={presetKey}
                active={isActive}
                onClick={() => onPatchAppearance({ accentPreset: presetKey as AppearanceSettings['accentPreset'] })}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-foreground">{getAccentPresetLabel(presetKey as AppearanceSettings['accentPreset'], t)}</div>
                  <div className="flex items-center gap-2">
                    <span className="h-5 w-5 rounded-full border border-outline-input" style={{ backgroundColor: preset.primary }} />
                    <span className="h-5 w-5 rounded-full border border-outline-input" style={{ backgroundColor: preset.secondary }} />
                  </div>
                </div>
              </PresetOptionButton>
            )
          })}

          <PresetOptionButton
            active={appearanceDraft.accentPreset === 'custom'}
            onClick={() => onPatchAppearance({ accentPreset: 'custom' })}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-foreground">{getAccentPresetLabel('custom', t)}</div>
              <div className="flex items-center gap-2">
                <span className="h-5 w-5 rounded-full border border-outline-input" style={{ backgroundColor: appearanceDraft.customPrimaryColor }} />
                <span className="h-5 w-5 rounded-full border border-outline-input" style={{ backgroundColor: appearanceDraft.customSecondaryColor }} />
              </div>
            </div>
          </PresetOptionButton>
        </div>

        {appearanceDraft.accentPreset === 'custom' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t({ ko: '기본 강조색', en: 'Primary accent' })}>
              <AppearanceColorControl
                colorValue={colorValues.customPrimaryColorValue}
                textValue={appearanceDraft.customPrimaryColor}
                onChangeColor={(value) => onPatchAppearance({ customPrimaryColor: value })}
                onChangeText={(value) => onPatchAppearance({ customPrimaryColor: value })}
                placeholder={DEFAULT_APPEARANCE_SETTINGS.customPrimaryColor}
              />
            </Field>

            <Field label={t({ ko: '보조 강조색', en: 'Secondary accent' })}>
              <AppearanceColorControl
                colorValue={colorValues.customSecondaryColorValue}
                textValue={appearanceDraft.customSecondaryColor}
                onChangeColor={(value) => onPatchAppearance({ customSecondaryColor: value })}
                onChangeText={(value) => onPatchAppearance({ customSecondaryColor: value })}
                placeholder={DEFAULT_APPEARANCE_SETTINGS.customSecondaryColor}
              />
            </Field>
          </div>
        ) : null}
      </section>

      <section className="space-y-4">
        <EditorSectionLead title={t({ ko: '표면 / 마감', en: 'Surfaces / finish' })} />
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(SURFACE_PRESETS).map(([presetKey, preset]) => {
            const palette = preset.modes[appearanceDraft.themeMode === 'system' ? 'dark' : appearanceDraft.themeMode]
            const isActive = appearanceDraft.surfacePreset === presetKey

            return (
              <PresetOptionButton
                key={presetKey}
                active={isActive}
                onClick={() => onPatchAppearance({ surfacePreset: presetKey as AppearanceSettings['surfacePreset'] })}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-foreground">{getSurfacePresetLabel(presetKey as AppearanceSettings['surfacePreset'], t)}</div>
                  <div className="flex items-center gap-2">
                    <span className="h-5 w-5 rounded-full border border-outline-input" style={{ backgroundColor: palette.background }} />
                    <span className="h-5 w-5 rounded-full border border-outline-input" style={{ backgroundColor: palette.surfaceContainer }} />
                    <span className="h-5 w-5 rounded-full border border-outline-input" style={{ backgroundColor: palette.surfaceHigh }} />
                  </div>
                </div>
              </PresetOptionButton>
            )
          })}

          <PresetOptionButton
            active={appearanceDraft.surfacePreset === 'custom'}
            onClick={() => onPatchAppearance({ surfacePreset: 'custom' })}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-foreground">{getSurfacePresetLabel('custom', t)}</div>
              <div className="flex items-center gap-2">
                <span className="h-5 w-5 rounded-full border border-outline-input" style={{ backgroundColor: appearanceDraft.customSurfaceBackgroundColor }} />
                <span className="h-5 w-5 rounded-full border border-outline-input" style={{ backgroundColor: appearanceDraft.customSurfaceContainerColor }} />
                <span className="h-5 w-5 rounded-full border border-outline-input" style={{ backgroundColor: appearanceDraft.customSurfaceHighColor }} />
              </div>
            </div>
          </PresetOptionButton>
        </div>

        {appearanceDraft.surfacePreset === 'custom' ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <Field label={t({ ko: '배경', en: 'Background' })}>
              <AppearanceColorControl
                colorValue={colorValues.customSurfaceBackgroundColorValue}
                textValue={appearanceDraft.customSurfaceBackgroundColor}
                onChangeColor={(value) => onPatchAppearance({ customSurfaceBackgroundColor: value })}
                onChangeText={(value) => onPatchAppearance({ customSurfaceBackgroundColor: value })}
                placeholder={DEFAULT_APPEARANCE_SETTINGS.customSurfaceBackgroundColor}
              />
            </Field>

            <Field label={t({ ko: '사이드바 바탕', en: 'Sidebar background' })}>
              <AppearanceColorControl
                colorValue={colorValues.customSurfaceLowestColorValue}
                textValue={appearanceDraft.customSurfaceLowestColor ?? ''}
                onChangeColor={(value) => onPatchAppearance({ customSurfaceLowestColor: value })}
                onChangeText={(value) => onPatchAppearance({ customSurfaceLowestColor: value || undefined })}
                placeholder={defaultSurfaceToneColors.surfaceLowest}
              />
            </Field>

            <Field label={t({ ko: '컨테이너 1', en: 'Container 1' })}>
              <AppearanceColorControl
                colorValue={colorValues.customSurfaceContainerColorValue}
                textValue={appearanceDraft.customSurfaceContainerColor}
                onChangeColor={(value) => onPatchAppearance({ customSurfaceContainerColor: value })}
                onChangeText={(value) => onPatchAppearance({ customSurfaceContainerColor: value })}
                placeholder={DEFAULT_APPEARANCE_SETTINGS.customSurfaceContainerColor}
              />
            </Field>

            <Field label={t({ ko: '컨테이너 2', en: 'Container 2' })}>
              <AppearanceColorControl
                colorValue={colorValues.customSurfaceLowColorValue}
                textValue={appearanceDraft.customSurfaceLowColor ?? ''}
                onChangeColor={(value) => onPatchAppearance({ customSurfaceLowColor: value })}
                onChangeText={(value) => onPatchAppearance({ customSurfaceLowColor: value || undefined })}
                placeholder={defaultSurfaceToneColors.surfaceLow}
              />
            </Field>

            <Field label={t({ ko: '호버 / 활성', en: 'Hover / active' })}>
              <AppearanceColorControl
                colorValue={colorValues.customSurfaceHighColorValue}
                textValue={appearanceDraft.customSurfaceHighColor}
                onChangeColor={(value) => onPatchAppearance({ customSurfaceHighColor: value })}
                onChangeText={(value) => onPatchAppearance({ customSurfaceHighColor: value })}
                placeholder={DEFAULT_APPEARANCE_SETTINGS.customSurfaceHighColor}
              />
            </Field>
          </div>
        ) : null}
      </section>

      <section className="space-y-4">
        <EditorSectionLead title={t({ ko: '배지 색상', en: 'Badge colors' })} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Field label={t({ ko: '긍정 배지', en: 'Positive badge' })}>
            <AppearanceColorControl
              colorValue={colorValues.positiveBadgeColorValue}
              textValue={appearanceDraft.positiveBadgeColor}
              onChangeColor={(value) => onPatchAppearance({ positiveBadgeColor: value })}
              onChangeText={(value) => onPatchAppearance({ positiveBadgeColor: value })}
              placeholder={DEFAULT_APPEARANCE_SETTINGS.positiveBadgeColor}
            />
          </Field>

          <Field label={t({ ko: '부정 배지', en: 'Negative badge' })}>
            <AppearanceColorControl
              colorValue={colorValues.negativeBadgeColorValue}
              textValue={appearanceDraft.negativeBadgeColor}
              onChangeColor={(value) => onPatchAppearance({ negativeBadgeColor: value })}
              onChangeText={(value) => onPatchAppearance({ negativeBadgeColor: value })}
              placeholder={DEFAULT_APPEARANCE_SETTINGS.negativeBadgeColor}
            />
          </Field>

          <Field label={t({ ko: '오토 배지', en: 'Auto badge' })}>
            <AppearanceColorControl
              colorValue={colorValues.autoBadgeColorValue}
              textValue={appearanceDraft.autoBadgeColor}
              onChangeColor={(value) => onPatchAppearance({ autoBadgeColor: value })}
              onChangeText={(value) => onPatchAppearance({ autoBadgeColor: value })}
              placeholder={DEFAULT_APPEARANCE_SETTINGS.autoBadgeColor}
            />
          </Field>

          <Field label={t({ ko: '평가 배지', en: 'Rating badge' })}>
            <AppearanceColorControl
              colorValue={colorValues.ratingBadgeColorValue}
              textValue={appearanceDraft.ratingBadgeColor}
              onChangeColor={(value) => onPatchAppearance({ ratingBadgeColor: value })}
              onChangeText={(value) => onPatchAppearance({ ratingBadgeColor: value })}
              placeholder={DEFAULT_APPEARANCE_SETTINGS.ratingBadgeColor}
            />
          </Field>
        </div>
      </section>
    </div>
  )
}
