import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { DENSITY_PRESETS, FONT_PRESETS, GLASS_PRESETS, RADIUS_PRESETS, SHADOW_PRESETS } from '@/lib/appearance'
import type { AppearanceSettings } from '@/types/settings'
import {
  type AppearanceTabEditorSectionProps,
  EditorSectionLead,
  getBodyFontWeightLabel,
  getDensityLabel,
  getEmphasisFontWeightLabel,
  getFontPresetLabel,
  getGlassLabel,
  getRadiusLabel,
  getShadowLabel,
  getThemeModeLabel,
  UploadedFontCard,
} from './appearance-tab-editor-shared'
import { SettingsField } from './settings-primitives'
import { useI18n } from '@/i18n'

/** Render the general appearance controls for theme, font, and shell layout. */
export function AppearanceGeneralEditorContent({
  appearanceDraft,
  onPatchAppearance,
  onRequestSansFontUpload,
  onRequestMonoFontUpload,
  onClearCustomFont,
  isUploadingFont,
}: AppearanceTabEditorSectionProps) {
  const { t } = useI18n()

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <EditorSectionLead title={t({ ko: '기본', en: 'Basic' })} />
        <div className="grid gap-4 md:grid-cols-2">
          <SettingsField label={t({ ko: '테마 모드', en: 'Theme mode' })}>
            <Select
              variant="settings"
              value={appearanceDraft.themeMode}
              onChange={(event) => onPatchAppearance({ themeMode: event.target.value as AppearanceSettings['themeMode'] })}
            >
              <option value="system">{getThemeModeLabel('system', t)}</option>
              <option value="dark">{getThemeModeLabel('dark', t)}</option>
              <option value="light">{getThemeModeLabel('light', t)}</option>
            </Select>
          </SettingsField>

          <SettingsField label={t({ ko: '밀도', en: 'Density' })}>
            <Select
              variant="settings"
              value={appearanceDraft.density}
              onChange={(event) => onPatchAppearance({ density: event.target.value as AppearanceSettings['density'] })}
            >
              {Object.keys(DENSITY_PRESETS).map((presetKey) => (
                <option key={presetKey} value={presetKey}>
                  {getDensityLabel(presetKey as AppearanceSettings['density'], t)}
                </option>
              ))}
            </Select>
          </SettingsField>
        </div>
      </section>

      <section className="space-y-4">
        <EditorSectionLead title={t({ ko: '폰트', en: 'Font' })} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SettingsField label={t({ ko: '폰트 프리셋', en: 'Font preset' })}>
            <Select
              variant="settings"
              value={appearanceDraft.fontPreset}
              onChange={(event) => onPatchAppearance({ fontPreset: event.target.value as AppearanceSettings['fontPreset'] })}
            >
              {Object.keys(FONT_PRESETS).map((presetKey) => (
                <option key={presetKey} value={presetKey}>
                  {getFontPresetLabel(presetKey as AppearanceSettings['fontPreset'], t)}
                </option>
              ))}
            </Select>
          </SettingsField>

          <SettingsField label={t({ ko: 'UI 배율 (%)', en: 'UI scale (%)' })}>
            <Input
              type="number"
              min={85}
              max={200}
              step={1}
              variant="settings"
              value={appearanceDraft.fontScalePercent}
              onChange={(event) => onPatchAppearance({ fontScalePercent: Number.parseInt(event.target.value || '100', 10) })}
            />
          </SettingsField>

          <SettingsField label={t({ ko: '글자 크기 (%)', en: 'Text size (%)' })}>
            <Input
              type="number"
              min={85}
              max={200}
              step={1}
              variant="settings"
              value={appearanceDraft.textScalePercent}
              onChange={(event) => onPatchAppearance({ textScalePercent: Number.parseInt(event.target.value || '100', 10) })}
            />
          </SettingsField>

          <SettingsField label={t({ ko: '본문 굵기', en: 'Body weight' })}>
            <Select
              variant="settings"
              value={appearanceDraft.bodyFontWeightPreset}
              onChange={(event) => onPatchAppearance({ bodyFontWeightPreset: event.target.value as AppearanceSettings['bodyFontWeightPreset'] })}
            >
              {(['regular', 'medium'] as AppearanceSettings['bodyFontWeightPreset'][]).map((preset) => (
                <option key={preset} value={preset}>
                  {getBodyFontWeightLabel(preset, t)}
                </option>
              ))}
            </Select>
          </SettingsField>

          <SettingsField label={t({ ko: '강조 굵기', en: 'Emphasis weight' })}>
            <Select
              variant="settings"
              value={appearanceDraft.emphasisFontWeightPreset}
              onChange={(event) => onPatchAppearance({ emphasisFontWeightPreset: event.target.value as AppearanceSettings['emphasisFontWeightPreset'] })}
            >
              {(['standard', 'bold'] as AppearanceSettings['emphasisFontWeightPreset'][]).map((preset) => (
                <option key={preset} value={preset}>
                  {getEmphasisFontWeightLabel(preset, t)}
                </option>
              ))}
            </Select>
          </SettingsField>
        </div>

        {appearanceDraft.fontPreset === 'custom' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <SettingsField label={t({ ko: '본문 폰트', en: 'Body font' })}>
              <UploadedFontCard
                label={t({ ko: '본문 폰트 파일', en: 'Body font file' })}
                fileName={appearanceDraft.customFontFileName}
                url={appearanceDraft.customFontUrl}
                onUpload={onRequestSansFontUpload}
                onClear={() => onClearCustomFont('sans')}
                isUploadingFont={isUploadingFont}
              />
            </SettingsField>

            <SettingsField label={t({ ko: '모노 폰트', en: 'Mono font' })}>
              <UploadedFontCard
                label={t({ ko: '모노 폰트 파일', en: 'Mono font file' })}
                fileName={appearanceDraft.customMonoFontFileName}
                url={appearanceDraft.customMonoFontUrl}
                onUpload={onRequestMonoFontUpload}
                onClear={() => onClearCustomFont('mono')}
                isUploadingFont={isUploadingFont}
              />
            </SettingsField>
          </div>
        ) : null}
      </section>

      <section className="space-y-4">
        <EditorSectionLead title={t({ ko: '검색 / 반응형', en: 'Search / responsive' })} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SettingsField label={t({ ko: '데스크톱 본문 2칼럼 전환폭 (px)', en: 'Desktop content two-column breakpoint (px)' })}>
            <Input
              type="number"
              min={768}
              max={1800}
              step={10}
              variant="settings"
              value={appearanceDraft.desktopPageColumnsMinWidth}
              onChange={(event) => onPatchAppearance({ desktopPageColumnsMinWidth: Number.parseInt(event.target.value || '1280', 10) })}
            />
          </SettingsField>
        </div>
      </section>

      <section className="space-y-4">
        <EditorSectionLead title={t({ ko: '카드 / 마감', en: 'Cards / finish' })} />
        <div className="grid gap-4 md:grid-cols-3">
          <SettingsField label={t({ ko: '모서리', en: 'Corners' })}>
            <Select
              variant="settings"
              value={appearanceDraft.radiusPreset}
              onChange={(event) => onPatchAppearance({ radiusPreset: event.target.value as AppearanceSettings['radiusPreset'] })}
            >
              {Object.keys(RADIUS_PRESETS).map((presetKey) => (
                <option key={presetKey} value={presetKey}>
                  {getRadiusLabel(presetKey as AppearanceSettings['radiusPreset'], t)}
                </option>
              ))}
            </Select>
          </SettingsField>

          <SettingsField label={t({ ko: '유리감', en: 'Glass effect' })}>
            <Select
              variant="settings"
              value={appearanceDraft.glassPreset}
              onChange={(event) => onPatchAppearance({ glassPreset: event.target.value as AppearanceSettings['glassPreset'] })}
            >
              {Object.keys(GLASS_PRESETS).map((presetKey) => (
                <option key={presetKey} value={presetKey}>
                  {getGlassLabel(presetKey as AppearanceSettings['glassPreset'], t)}
                </option>
              ))}
            </Select>
          </SettingsField>

          <SettingsField label={t({ ko: '그림자', en: 'Shadow' })}>
            <Select
              variant="settings"
              value={appearanceDraft.shadowPreset}
              onChange={(event) => onPatchAppearance({ shadowPreset: event.target.value as AppearanceSettings['shadowPreset'] })}
            >
              {Object.keys(SHADOW_PRESETS).map((presetKey) => (
                <option key={presetKey} value={presetKey}>
                  {getShadowLabel(presetKey as AppearanceSettings['shadowPreset'], t)}
                </option>
              ))}
            </Select>
          </SettingsField>
        </div>
      </section>
    </div>
  )
}
