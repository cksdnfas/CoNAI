import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { FONT_PRESETS, GLASS_PRESETS, RADIUS_PRESETS, SHADOW_PRESETS } from '@/lib/appearance'
import type { AppearanceSettings } from '@conai/shared'
import {
  type AppearanceTabEditorSectionProps,
  getBodyFontWeightLabel,
  getEmphasisFontWeightLabel,
  getFontPresetLabel,
  getGlassLabel,
  getRadiusLabel,
  getShadowLabel,
  UploadedFontRow,
} from './appearance-tab-editor-shared'
import { SETTINGS_CONTROL_CLASS } from './settings-rows'
import { useI18n } from '@/i18n'

/** Font preset, scales, weights and the custom font files. */
export function AppearanceFontRows({
  appearanceDraft,
  onPatchAppearance,
  onRequestSansFontUpload,
  onRequestMonoFontUpload,
  onClearCustomFont,
  isUploadingFont,
}: AppearanceTabEditorSectionProps) {
  const { t } = useI18n()
  const labels = {
    preset: t({ ko: '폰트', en: 'Font' }),
    uiScale: t({ ko: 'UI 배율 (%)', en: 'UI scale (%)' }),
    textScale: t({ ko: '글자 크기 (%)', en: 'Text size (%)' }),
    body: t({ ko: '본문 굵기', en: 'Body weight' }),
    emphasis: t({ ko: '강조 굵기', en: 'Emphasis weight' }),
  }

  return (
    <>
      <SettingRow label={labels.preset} controlClassName={SETTINGS_CONTROL_CLASS}>
        <Select
          variant="settings"
          aria-label={labels.preset}
          value={appearanceDraft.fontPreset}
          onChange={(event) => onPatchAppearance({ fontPreset: event.target.value as AppearanceSettings['fontPreset'] })}
        >
          {Object.keys(FONT_PRESETS).map((presetKey) => (
            <option key={presetKey} value={presetKey}>
              {getFontPresetLabel(presetKey as AppearanceSettings['fontPreset'], t)}
            </option>
          ))}
        </Select>
      </SettingRow>

      {appearanceDraft.fontPreset === 'custom' ? (
        <>
          <UploadedFontRow
            label={t({ ko: '본문 폰트 파일', en: 'Body font file' })}
            fileName={appearanceDraft.customFontFileName}
            url={appearanceDraft.customFontUrl}
            onUpload={onRequestSansFontUpload}
            onClear={() => onClearCustomFont('sans')}
            isUploadingFont={isUploadingFont}
          />
          <UploadedFontRow
            label={t({ ko: '모노 폰트 파일', en: 'Mono font file' })}
            fileName={appearanceDraft.customMonoFontFileName}
            url={appearanceDraft.customMonoFontUrl}
            onUpload={onRequestMonoFontUpload}
            onClear={() => onClearCustomFont('mono')}
            isUploadingFont={isUploadingFont}
          />
        </>
      ) : null}

      <SettingRow label={labels.uiScale} controlClassName={SETTINGS_CONTROL_CLASS}>
        <NumberStepperInput
          min={85}
          max={200}
          step={1}
          variant="settings"
          aria-label={labels.uiScale}
          value={appearanceDraft.fontScalePercent}
          onValueCommit={(nextValue) => onPatchAppearance({ fontScalePercent: Number.parseInt(nextValue || '100', 10) })}
        />
      </SettingRow>

      <SettingRow label={labels.textScale} controlClassName={SETTINGS_CONTROL_CLASS}>
        <NumberStepperInput
          min={85}
          max={200}
          step={1}
          variant="settings"
          aria-label={labels.textScale}
          value={appearanceDraft.textScalePercent}
          onValueCommit={(nextValue) => onPatchAppearance({ textScalePercent: Number.parseInt(nextValue || '100', 10) })}
        />
      </SettingRow>

      <SettingRow label={labels.body} controlClassName={SETTINGS_CONTROL_CLASS}>
        <Select
          variant="settings"
          aria-label={labels.body}
          value={appearanceDraft.bodyFontWeightPreset}
          onChange={(event) => onPatchAppearance({ bodyFontWeightPreset: event.target.value as AppearanceSettings['bodyFontWeightPreset'] })}
        >
          {(['regular', 'medium'] as AppearanceSettings['bodyFontWeightPreset'][]).map((preset) => (
            <option key={preset} value={preset}>
              {getBodyFontWeightLabel(preset, t)}
            </option>
          ))}
        </Select>
      </SettingRow>

      <SettingRow label={labels.emphasis} controlClassName={SETTINGS_CONTROL_CLASS}>
        <Select
          variant="settings"
          aria-label={labels.emphasis}
          value={appearanceDraft.emphasisFontWeightPreset}
          onChange={(event) => onPatchAppearance({ emphasisFontWeightPreset: event.target.value as AppearanceSettings['emphasisFontWeightPreset'] })}
        >
          {(['standard', 'bold'] as AppearanceSettings['emphasisFontWeightPreset'][]).map((preset) => (
            <option key={preset} value={preset}>
              {getEmphasisFontWeightLabel(preset, t)}
            </option>
          ))}
        </Select>
      </SettingRow>
    </>
  )
}

/** Layout breakpoint, corners, glass, shadow and the selection outline. */
export function AppearanceFinishRows({
  appearanceDraft,
  onPatchAppearance,
}: AppearanceTabEditorSectionProps) {
  const { t } = useI18n()
  const labels = {
    columns: t({ ko: '데스크톱 본문 2칼럼 전환폭 (px)', en: 'Desktop content two-column breakpoint (px)' }),
    radius: t({ ko: '모서리', en: 'Corners' }),
    glass: t({ ko: '유리감', en: 'Glass effect' }),
    shadow: t({ ko: '그림자', en: 'Shadow' }),
    selection: t({ ko: '선택 테두리 두께 (px)', en: 'Selection border width (px)' }),
  }

  return (
    <>
      <SettingRow label={labels.columns} controlClassName={SETTINGS_CONTROL_CLASS}>
        <NumberStepperInput
          min={768}
          max={1800}
          step={10}
          variant="settings"
          aria-label={labels.columns}
          value={appearanceDraft.desktopPageColumnsMinWidth}
          onValueCommit={(nextValue) => onPatchAppearance({ desktopPageColumnsMinWidth: Number.parseInt(nextValue || '1280', 10) })}
        />
      </SettingRow>

      <SettingRow label={labels.radius} controlClassName={SETTINGS_CONTROL_CLASS}>
        <Select
          variant="settings"
          aria-label={labels.radius}
          value={appearanceDraft.radiusPreset}
          onChange={(event) => onPatchAppearance({ radiusPreset: event.target.value as AppearanceSettings['radiusPreset'] })}
        >
          {Object.keys(RADIUS_PRESETS).map((presetKey) => (
            <option key={presetKey} value={presetKey}>
              {getRadiusLabel(presetKey as AppearanceSettings['radiusPreset'], t)}
            </option>
          ))}
        </Select>
      </SettingRow>

      <SettingRow label={labels.glass} controlClassName={SETTINGS_CONTROL_CLASS}>
        <Select
          variant="settings"
          aria-label={labels.glass}
          value={appearanceDraft.glassPreset}
          onChange={(event) => onPatchAppearance({ glassPreset: event.target.value as AppearanceSettings['glassPreset'] })}
        >
          {Object.keys(GLASS_PRESETS).map((presetKey) => (
            <option key={presetKey} value={presetKey}>
              {getGlassLabel(presetKey as AppearanceSettings['glassPreset'], t)}
            </option>
          ))}
        </Select>
      </SettingRow>

      <SettingRow label={labels.shadow} controlClassName={SETTINGS_CONTROL_CLASS}>
        <Select
          variant="settings"
          aria-label={labels.shadow}
          value={appearanceDraft.shadowPreset}
          onChange={(event) => onPatchAppearance({ shadowPreset: event.target.value as AppearanceSettings['shadowPreset'] })}
        >
          {Object.keys(SHADOW_PRESETS).map((presetKey) => (
            <option key={presetKey} value={presetKey}>
              {getShadowLabel(presetKey as AppearanceSettings['shadowPreset'], t)}
            </option>
          ))}
        </Select>
      </SettingRow>

      <SettingRow label={labels.selection} controlClassName={SETTINGS_CONTROL_CLASS}>
        <NumberStepperInput
          min={1}
          max={8}
          step={1}
          variant="settings"
          aria-label={labels.selection}
          value={appearanceDraft.selectionOutlineWidth}
          onValueCommit={(nextValue) => onPatchAppearance({ selectionOutlineWidth: Number.parseInt(nextValue || '3', 10) })}
        />
      </SettingRow>
    </>
  )
}
