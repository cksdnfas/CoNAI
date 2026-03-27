import { cn } from '@/lib/utils'
import { APPEARANCE_PRESETS, DEFAULT_APPEARANCE_SETTINGS, SURFACE_PRESETS } from '@/lib/appearance'
import type { AppearanceSettings } from '@/types/settings'
import {
  type AppearanceTabEditorSectionProps,
  AppearanceColorControl,
  EditorSectionLead,
  getAccentPresetLabel,
  getSurfacePresetLabel,
} from './appearance-tab-editor-shared'
import { SettingsField } from './settings-primitives'

/** Render the color-focused appearance controls for presets and custom palettes. */
export function AppearanceColorEditorContent({
  appearanceDraft,
  colorValues,
  onPatchAppearance,
}: AppearanceTabEditorSectionProps) {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <EditorSectionLead title="강조색" />
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(APPEARANCE_PRESETS).map(([presetKey, preset]) => {
            const isActive = appearanceDraft.accentPreset === presetKey

            return (
              <button
                key={presetKey}
                type="button"
                onClick={() => onPatchAppearance({ accentPreset: presetKey as AppearanceSettings['accentPreset'] })}
                className={cn(
                  'rounded-sm border px-4 py-4 text-left transition-colors',
                  isActive
                    ? 'border-primary bg-surface-high text-foreground'
                    : 'border-border bg-surface-low text-muted-foreground hover:bg-surface-high',
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-foreground">{getAccentPresetLabel(presetKey as AppearanceSettings['accentPreset'])}</div>
                  <div className="flex items-center gap-2">
                    <span className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: preset.primary }} />
                    <span className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: preset.secondary }} />
                  </div>
                </div>
              </button>
            )
          })}

          <button
            type="button"
            onClick={() => onPatchAppearance({ accentPreset: 'custom' })}
            className={cn(
              'rounded-sm border px-4 py-4 text-left transition-colors',
              appearanceDraft.accentPreset === 'custom'
                ? 'border-primary bg-surface-high text-foreground'
                : 'border-border bg-surface-low text-muted-foreground hover:bg-surface-high',
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-foreground">{getAccentPresetLabel('custom')}</div>
              <div className="flex items-center gap-2">
                <span className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: appearanceDraft.customPrimaryColor }} />
                <span className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: appearanceDraft.customSecondaryColor }} />
              </div>
            </div>
          </button>
        </div>

        {appearanceDraft.accentPreset === 'custom' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <SettingsField label="기본 강조색">
              <AppearanceColorControl
                colorValue={colorValues.customPrimaryColorValue}
                textValue={appearanceDraft.customPrimaryColor}
                onChangeColor={(value) => onPatchAppearance({ customPrimaryColor: value })}
                onChangeText={(value) => onPatchAppearance({ customPrimaryColor: value })}
                placeholder={DEFAULT_APPEARANCE_SETTINGS.customPrimaryColor}
              />
            </SettingsField>

            <SettingsField label="보조 강조색">
              <AppearanceColorControl
                colorValue={colorValues.customSecondaryColorValue}
                textValue={appearanceDraft.customSecondaryColor}
                onChangeColor={(value) => onPatchAppearance({ customSecondaryColor: value })}
                onChangeText={(value) => onPatchAppearance({ customSecondaryColor: value })}
                placeholder={DEFAULT_APPEARANCE_SETTINGS.customSecondaryColor}
              />
            </SettingsField>
          </div>
        ) : null}
      </section>

      <section className="space-y-4">
        <EditorSectionLead title="표면 / 마감" />
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(SURFACE_PRESETS).map(([presetKey, preset]) => {
            const palette = preset.modes[appearanceDraft.themeMode === 'system' ? 'dark' : appearanceDraft.themeMode]
            const isActive = appearanceDraft.surfacePreset === presetKey

            return (
              <button
                key={presetKey}
                type="button"
                onClick={() => onPatchAppearance({ surfacePreset: presetKey as AppearanceSettings['surfacePreset'] })}
                className={cn(
                  'rounded-sm border px-4 py-4 text-left transition-colors',
                  isActive
                    ? 'border-primary bg-surface-high text-foreground'
                    : 'border-border bg-surface-low text-muted-foreground hover:bg-surface-high',
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-foreground">{getSurfacePresetLabel(presetKey as AppearanceSettings['surfacePreset'])}</div>
                  <div className="flex items-center gap-2">
                    <span className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: palette.background }} />
                    <span className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: palette.surfaceContainer }} />
                    <span className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: palette.surfaceHigh }} />
                  </div>
                </div>
              </button>
            )
          })}

          <button
            type="button"
            onClick={() => onPatchAppearance({ surfacePreset: 'custom' })}
            className={cn(
              'rounded-sm border px-4 py-4 text-left transition-colors',
              appearanceDraft.surfacePreset === 'custom'
                ? 'border-primary bg-surface-high text-foreground'
                : 'border-border bg-surface-low text-muted-foreground hover:bg-surface-high',
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-foreground">{getSurfacePresetLabel('custom')}</div>
              <div className="flex items-center gap-2">
                <span className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: appearanceDraft.customSurfaceBackgroundColor }} />
                <span className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: appearanceDraft.customSurfaceContainerColor }} />
                <span className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: appearanceDraft.customSurfaceHighColor }} />
              </div>
            </div>
          </button>
        </div>

        {appearanceDraft.surfacePreset === 'custom' ? (
          <div className="grid gap-4 md:grid-cols-3">
            <SettingsField label="배경">
              <AppearanceColorControl
                colorValue={colorValues.customSurfaceBackgroundColorValue}
                textValue={appearanceDraft.customSurfaceBackgroundColor}
                onChangeColor={(value) => onPatchAppearance({ customSurfaceBackgroundColor: value })}
                onChangeText={(value) => onPatchAppearance({ customSurfaceBackgroundColor: value })}
                placeholder={DEFAULT_APPEARANCE_SETTINGS.customSurfaceBackgroundColor}
              />
            </SettingsField>

            <SettingsField label="컨테이너">
              <AppearanceColorControl
                colorValue={colorValues.customSurfaceContainerColorValue}
                textValue={appearanceDraft.customSurfaceContainerColor}
                onChangeColor={(value) => onPatchAppearance({ customSurfaceContainerColor: value })}
                onChangeText={(value) => onPatchAppearance({ customSurfaceContainerColor: value })}
                placeholder={DEFAULT_APPEARANCE_SETTINGS.customSurfaceContainerColor}
              />
            </SettingsField>

            <SettingsField label="강조 표면">
              <AppearanceColorControl
                colorValue={colorValues.customSurfaceHighColorValue}
                textValue={appearanceDraft.customSurfaceHighColor}
                onChangeColor={(value) => onPatchAppearance({ customSurfaceHighColor: value })}
                onChangeText={(value) => onPatchAppearance({ customSurfaceHighColor: value })}
                placeholder={DEFAULT_APPEARANCE_SETTINGS.customSurfaceHighColor}
              />
            </SettingsField>
          </div>
        ) : null}
      </section>

      <section className="space-y-4">
        <EditorSectionLead title="배지 색상" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SettingsField label="긍정 배지">
            <AppearanceColorControl
              colorValue={colorValues.positiveBadgeColorValue}
              textValue={appearanceDraft.positiveBadgeColor}
              onChangeColor={(value) => onPatchAppearance({ positiveBadgeColor: value })}
              onChangeText={(value) => onPatchAppearance({ positiveBadgeColor: value })}
              placeholder={DEFAULT_APPEARANCE_SETTINGS.positiveBadgeColor}
            />
          </SettingsField>

          <SettingsField label="부정 배지">
            <AppearanceColorControl
              colorValue={colorValues.negativeBadgeColorValue}
              textValue={appearanceDraft.negativeBadgeColor}
              onChangeColor={(value) => onPatchAppearance({ negativeBadgeColor: value })}
              onChangeText={(value) => onPatchAppearance({ negativeBadgeColor: value })}
              placeholder={DEFAULT_APPEARANCE_SETTINGS.negativeBadgeColor}
            />
          </SettingsField>

          <SettingsField label="오토 배지">
            <AppearanceColorControl
              colorValue={colorValues.autoBadgeColorValue}
              textValue={appearanceDraft.autoBadgeColor}
              onChangeColor={(value) => onPatchAppearance({ autoBadgeColor: value })}
              onChangeText={(value) => onPatchAppearance({ autoBadgeColor: value })}
              placeholder={DEFAULT_APPEARANCE_SETTINGS.autoBadgeColor}
            />
          </SettingsField>

          <SettingsField label="평가 배지">
            <AppearanceColorControl
              colorValue={colorValues.ratingBadgeColorValue}
              textValue={appearanceDraft.ratingBadgeColor}
              onChangeColor={(value) => onPatchAppearance({ ratingBadgeColor: value })}
              onChangeText={(value) => onPatchAppearance({ ratingBadgeColor: value })}
              placeholder={DEFAULT_APPEARANCE_SETTINGS.ratingBadgeColor}
            />
          </SettingsField>
        </div>
      </section>
    </div>
  )
}
