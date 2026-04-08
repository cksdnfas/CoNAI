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

/** Render the general appearance controls for theme, font, and shell layout. */
export function AppearanceGeneralEditorContent({
  appearanceDraft,
  onPatchAppearance,
  onRequestSansFontUpload,
  onRequestMonoFontUpload,
  onClearCustomFont,
  isUploadingFont,
}: AppearanceTabEditorSectionProps) {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <EditorSectionLead title="기본" />
        <div className="grid gap-4 md:grid-cols-2">
          <SettingsField label="테마 모드">
            <Select
              variant="settings"
              value={appearanceDraft.themeMode}
              onChange={(event) => onPatchAppearance({ themeMode: event.target.value as AppearanceSettings['themeMode'] })}
            >
              <option value="system">{getThemeModeLabel('system')}</option>
              <option value="dark">{getThemeModeLabel('dark')}</option>
              <option value="light">{getThemeModeLabel('light')}</option>
            </Select>
          </SettingsField>

          <SettingsField label="밀도">
            <Select
              variant="settings"
              value={appearanceDraft.density}
              onChange={(event) => onPatchAppearance({ density: event.target.value as AppearanceSettings['density'] })}
            >
              {Object.keys(DENSITY_PRESETS).map((presetKey) => (
                <option key={presetKey} value={presetKey}>
                  {getDensityLabel(presetKey as AppearanceSettings['density'])}
                </option>
              ))}
            </Select>
          </SettingsField>
        </div>
      </section>

      <section className="space-y-4">
        <EditorSectionLead title="폰트" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SettingsField label="폰트 프리셋">
            <Select
              variant="settings"
              value={appearanceDraft.fontPreset}
              onChange={(event) => onPatchAppearance({ fontPreset: event.target.value as AppearanceSettings['fontPreset'] })}
            >
              {Object.keys(FONT_PRESETS).map((presetKey) => (
                <option key={presetKey} value={presetKey}>
                  {getFontPresetLabel(presetKey as AppearanceSettings['fontPreset'])}
                </option>
              ))}
            </Select>
          </SettingsField>

          <SettingsField label="UI 배율 (%)">
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

          <SettingsField label="글자 크기 (%)">
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

          <SettingsField label="본문 굵기">
            <Select
              variant="settings"
              value={appearanceDraft.bodyFontWeightPreset}
              onChange={(event) => onPatchAppearance({ bodyFontWeightPreset: event.target.value as AppearanceSettings['bodyFontWeightPreset'] })}
            >
              {(['regular', 'medium'] as AppearanceSettings['bodyFontWeightPreset'][]).map((preset) => (
                <option key={preset} value={preset}>
                  {getBodyFontWeightLabel(preset)}
                </option>
              ))}
            </Select>
          </SettingsField>

          <SettingsField label="강조 굵기">
            <Select
              variant="settings"
              value={appearanceDraft.emphasisFontWeightPreset}
              onChange={(event) => onPatchAppearance({ emphasisFontWeightPreset: event.target.value as AppearanceSettings['emphasisFontWeightPreset'] })}
            >
              {(['standard', 'bold'] as AppearanceSettings['emphasisFontWeightPreset'][]).map((preset) => (
                <option key={preset} value={preset}>
                  {getEmphasisFontWeightLabel(preset)}
                </option>
              ))}
            </Select>
          </SettingsField>
        </div>

        {appearanceDraft.fontPreset === 'custom' ? (
          <div className="grid gap-4 md:grid-cols-2">
            <SettingsField label="본문 폰트">
              <UploadedFontCard
                label="본문 폰트 파일"
                fileName={appearanceDraft.customFontFileName}
                url={appearanceDraft.customFontUrl}
                onUpload={onRequestSansFontUpload}
                onClear={() => onClearCustomFont('sans')}
                isUploadingFont={isUploadingFont}
              />
            </SettingsField>

            <SettingsField label="모노 폰트">
              <UploadedFontCard
                label="모노 폰트 파일"
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
        <EditorSectionLead title="검색 / 반응형" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SettingsField label="검색창 너비 (px)">
            <Input
              type="number"
              min={240}
              max={640}
              step={10}
              variant="settings"
              value={appearanceDraft.searchBoxWidth}
              onChange={(event) => onPatchAppearance({ searchBoxWidth: Number.parseInt(event.target.value || '380', 10) })}
            />
          </SettingsField>

          <SettingsField label="검색 패널 너비 (px)">
            <Input
              type="number"
              min={320}
              max={720}
              step={10}
              variant="settings"
              value={appearanceDraft.searchDrawerWidth}
              onChange={(event) => onPatchAppearance({ searchDrawerWidth: Number.parseInt(event.target.value || '420', 10) })}
            />
          </SettingsField>

          <SettingsField label="데스크톱 본문 2칼럼 전환폭 (px)">
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
        <EditorSectionLead title="카드 / 마감" />
        <div className="grid gap-4 md:grid-cols-3">
          <SettingsField label="모서리">
            <Select
              variant="settings"
              value={appearanceDraft.radiusPreset}
              onChange={(event) => onPatchAppearance({ radiusPreset: event.target.value as AppearanceSettings['radiusPreset'] })}
            >
              {Object.keys(RADIUS_PRESETS).map((presetKey) => (
                <option key={presetKey} value={presetKey}>
                  {getRadiusLabel(presetKey as AppearanceSettings['radiusPreset'])}
                </option>
              ))}
            </Select>
          </SettingsField>

          <SettingsField label="유리감">
            <Select
              variant="settings"
              value={appearanceDraft.glassPreset}
              onChange={(event) => onPatchAppearance({ glassPreset: event.target.value as AppearanceSettings['glassPreset'] })}
            >
              {Object.keys(GLASS_PRESETS).map((presetKey) => (
                <option key={presetKey} value={presetKey}>
                  {getGlassLabel(presetKey as AppearanceSettings['glassPreset'])}
                </option>
              ))}
            </Select>
          </SettingsField>

          <SettingsField label="그림자">
            <Select
              variant="settings"
              value={appearanceDraft.shadowPreset}
              onChange={(event) => onPatchAppearance({ shadowPreset: event.target.value as AppearanceSettings['shadowPreset'] })}
            >
              {Object.keys(SHADOW_PRESETS).map((presetKey) => (
                <option key={presetKey} value={presetKey}>
                  {getShadowLabel(presetKey as AppearanceSettings['shadowPreset'])}
                </option>
              ))}
            </Select>
          </SettingsField>
        </div>
      </section>
    </div>
  )
}
