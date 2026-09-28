import type { CSSProperties, ReactNode } from 'react'
import { Monitor, Moon, Pipette, Sun } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { IconButton } from '@/components/ui/icon-button'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { APPEARANCE_PRESETS, DEFAULT_APPEARANCE_SETTINGS, DENSITY_PRESETS, SURFACE_PRESETS, resolveCustomSurfaceToneColors } from '@/lib/appearance'
import { cn } from '@/lib/utils'
import type { AppearanceSettings } from '@conai/shared'
import {
  type AppearanceTabEditorSectionProps,
  AppearanceColorRow,
  getAccentPresetLabel,
  getDensityLabel,
  getSurfacePresetLabel,
  getThemeModeLabel,
} from './appearance-tab-editor-shared'
import { SETTINGS_CONTROL_CLASS } from './settings-rows'
import { useI18n } from '@/i18n'

/** One round colour swatch; the chosen one gets a ring. */
function Swatch({ active, label, onClick, style, children }: { active: boolean; label: string; onClick: () => void; style: CSSProperties; children?: ReactNode }) {
  return (
    <IconButton variant="ghost" size="icon-sm" label={label} aria-pressed={active} onClick={onClick}>
      <span
        aria-hidden
        className={cn(
          'flex size-5 items-center justify-center rounded-full text-white shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] transition-shadow',
          active && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
        )}
        style={style}
      >
        {children}
      </span>
    </IconButton>
  )
}

/** Theme mode, accent and surface palettes, density; custom colours unfold as extra rows. */
export function AppearanceThemeRows({
  appearanceDraft,
  colorValues,
  onPatchAppearance,
}: AppearanceTabEditorSectionProps) {
  const { t } = useI18n()
  const defaultSurfaceToneColors = resolveCustomSurfaceToneColors(DEFAULT_APPEARANCE_SETTINGS)
  const paletteMode = appearanceDraft.themeMode === 'system' ? 'dark' : appearanceDraft.themeMode
  const densityLabel = t({ ko: '밀도', en: 'Density' })

  return (
    <>
      <SettingRow label={t({ ko: '모드', en: 'Mode' })}>
        <SegmentedControl
          size="sm"
          ariaLabel={t({ ko: '테마 모드', en: 'Theme mode' })}
          value={appearanceDraft.themeMode}
          onChange={(value) => onPatchAppearance({ themeMode: value as AppearanceSettings['themeMode'] })}
          items={[
            { value: 'light', label: <><Sun className="h-4 w-4" />{getThemeModeLabel('light', t)}</> },
            { value: 'dark', label: <><Moon className="h-4 w-4" />{getThemeModeLabel('dark', t)}</> },
            { value: 'system', label: <><Monitor className="h-4 w-4" />{getThemeModeLabel('system', t)}</> },
          ]}
        />
      </SettingRow>

      <SettingRow label={t({ ko: '강조색', en: 'Accent' })} controlClassName="gap-1">
        {Object.entries(APPEARANCE_PRESETS).map(([presetKey, preset]) => (
          <Swatch
            key={presetKey}
            active={appearanceDraft.accentPreset === presetKey}
            label={getAccentPresetLabel(presetKey as AppearanceSettings['accentPreset'], t)}
            onClick={() => onPatchAppearance({ accentPreset: presetKey as AppearanceSettings['accentPreset'] })}
            style={{ backgroundColor: preset.primary }}
          />
        ))}
        <Swatch
          active={appearanceDraft.accentPreset === 'custom'}
          label={getAccentPresetLabel('custom', t)}
          onClick={() => onPatchAppearance({ accentPreset: 'custom' })}
          style={{ backgroundColor: appearanceDraft.customPrimaryColor }}
        >
          <Pipette className="size-3" />
        </Swatch>
      </SettingRow>

      {appearanceDraft.accentPreset === 'custom' ? (
        <>
          <AppearanceColorRow
            label={t({ ko: '기본 강조색', en: 'Primary accent' })}
            colorValue={colorValues.customPrimaryColorValue}
            textValue={appearanceDraft.customPrimaryColor}
            onChangeColor={(value) => onPatchAppearance({ customPrimaryColor: value })}
            onChangeText={(value) => onPatchAppearance({ customPrimaryColor: value })}
            placeholder={DEFAULT_APPEARANCE_SETTINGS.customPrimaryColor}
          />
          <AppearanceColorRow
            label={t({ ko: '보조 강조색', en: 'Secondary accent' })}
            colorValue={colorValues.customSecondaryColorValue}
            textValue={appearanceDraft.customSecondaryColor}
            onChangeColor={(value) => onPatchAppearance({ customSecondaryColor: value })}
            onChangeText={(value) => onPatchAppearance({ customSecondaryColor: value })}
            placeholder={DEFAULT_APPEARANCE_SETTINGS.customSecondaryColor}
          />
        </>
      ) : null}

      <SettingRow label={t({ ko: '표면', en: 'Surfaces' })} controlClassName="gap-1">
        {Object.entries(SURFACE_PRESETS).map(([presetKey, preset]) => {
          const palette = preset.modes[paletteMode]
          return (
            <Swatch
              key={presetKey}
              active={appearanceDraft.surfacePreset === presetKey}
              label={getSurfacePresetLabel(presetKey as AppearanceSettings['surfacePreset'], t)}
              onClick={() => onPatchAppearance({ surfacePreset: presetKey as AppearanceSettings['surfacePreset'] })}
              style={{ background: `linear-gradient(135deg, ${palette.background} 50%, ${palette.surfaceHigh} 50%)` }}
            />
          )
        })}
        <Swatch
          active={appearanceDraft.surfacePreset === 'custom'}
          label={getSurfacePresetLabel('custom', t)}
          onClick={() => onPatchAppearance({ surfacePreset: 'custom' })}
          style={{ background: `linear-gradient(135deg, ${appearanceDraft.customSurfaceBackgroundColor} 50%, ${appearanceDraft.customSurfaceHighColor} 50%)` }}
        >
          <Pipette className="size-3" />
        </Swatch>
      </SettingRow>

      {appearanceDraft.surfacePreset === 'custom' ? (
        <>
          <AppearanceColorRow
            label={t({ ko: '배경', en: 'Background' })}
            colorValue={colorValues.customSurfaceBackgroundColorValue}
            textValue={appearanceDraft.customSurfaceBackgroundColor}
            onChangeColor={(value) => onPatchAppearance({ customSurfaceBackgroundColor: value })}
            onChangeText={(value) => onPatchAppearance({ customSurfaceBackgroundColor: value })}
            placeholder={DEFAULT_APPEARANCE_SETTINGS.customSurfaceBackgroundColor}
          />
          <AppearanceColorRow
            label={t({ ko: '사이드바 바탕', en: 'Sidebar background' })}
            colorValue={colorValues.customSurfaceLowestColorValue}
            textValue={appearanceDraft.customSurfaceLowestColor ?? ''}
            onChangeColor={(value) => onPatchAppearance({ customSurfaceLowestColor: value })}
            onChangeText={(value) => onPatchAppearance({ customSurfaceLowestColor: value || undefined })}
            placeholder={defaultSurfaceToneColors.surfaceLowest}
          />
          <AppearanceColorRow
            label={t({ ko: '컨테이너 1', en: 'Container 1' })}
            colorValue={colorValues.customSurfaceContainerColorValue}
            textValue={appearanceDraft.customSurfaceContainerColor}
            onChangeColor={(value) => onPatchAppearance({ customSurfaceContainerColor: value })}
            onChangeText={(value) => onPatchAppearance({ customSurfaceContainerColor: value })}
            placeholder={DEFAULT_APPEARANCE_SETTINGS.customSurfaceContainerColor}
          />
          <AppearanceColorRow
            label={t({ ko: '컨테이너 2', en: 'Container 2' })}
            colorValue={colorValues.customSurfaceLowColorValue}
            textValue={appearanceDraft.customSurfaceLowColor ?? ''}
            onChangeColor={(value) => onPatchAppearance({ customSurfaceLowColor: value })}
            onChangeText={(value) => onPatchAppearance({ customSurfaceLowColor: value || undefined })}
            placeholder={defaultSurfaceToneColors.surfaceLow}
          />
          <AppearanceColorRow
            label={t({ ko: '호버 / 활성', en: 'Hover / active' })}
            colorValue={colorValues.customSurfaceHighColorValue}
            textValue={appearanceDraft.customSurfaceHighColor}
            onChangeColor={(value) => onPatchAppearance({ customSurfaceHighColor: value })}
            onChangeText={(value) => onPatchAppearance({ customSurfaceHighColor: value })}
            placeholder={DEFAULT_APPEARANCE_SETTINGS.customSurfaceHighColor}
          />
        </>
      ) : null}

      <SettingRow label={densityLabel} controlClassName={SETTINGS_CONTROL_CLASS}>
        <Select
          variant="settings"
          aria-label={densityLabel}
          value={appearanceDraft.density}
          onChange={(event) => onPatchAppearance({ density: event.target.value as AppearanceSettings['density'] })}
        >
          {Object.keys(DENSITY_PRESETS).map((presetKey) => (
            <option key={presetKey} value={presetKey}>
              {getDensityLabel(presetKey as AppearanceSettings['density'], t)}
            </option>
          ))}
        </Select>
      </SettingRow>
    </>
  )
}

/** Badge colours as rows. */
export function AppearanceBadgeColorRows({
  appearanceDraft,
  colorValues,
  onPatchAppearance,
}: AppearanceTabEditorSectionProps) {
  const { t } = useI18n()

  return (
    <>
      <AppearanceColorRow
        label={t({ ko: '긍정 배지', en: 'Positive badge' })}
        colorValue={colorValues.positiveBadgeColorValue}
        textValue={appearanceDraft.positiveBadgeColor}
        onChangeColor={(value) => onPatchAppearance({ positiveBadgeColor: value })}
        onChangeText={(value) => onPatchAppearance({ positiveBadgeColor: value })}
        placeholder={DEFAULT_APPEARANCE_SETTINGS.positiveBadgeColor}
      />
      <AppearanceColorRow
        label={t({ ko: '부정 배지', en: 'Negative badge' })}
        colorValue={colorValues.negativeBadgeColorValue}
        textValue={appearanceDraft.negativeBadgeColor}
        onChangeColor={(value) => onPatchAppearance({ negativeBadgeColor: value })}
        onChangeText={(value) => onPatchAppearance({ negativeBadgeColor: value })}
        placeholder={DEFAULT_APPEARANCE_SETTINGS.negativeBadgeColor}
      />
      <AppearanceColorRow
        label={t({ ko: '오토 배지', en: 'Auto badge' })}
        colorValue={colorValues.autoBadgeColorValue}
        textValue={appearanceDraft.autoBadgeColor}
        onChangeColor={(value) => onPatchAppearance({ autoBadgeColor: value })}
        onChangeText={(value) => onPatchAppearance({ autoBadgeColor: value })}
        placeholder={DEFAULT_APPEARANCE_SETTINGS.autoBadgeColor}
      />
      <AppearanceColorRow
        label={t({ ko: '평가 배지', en: 'Rating badge' })}
        colorValue={colorValues.ratingBadgeColorValue}
        textValue={appearanceDraft.ratingBadgeColor}
        onChangeColor={(value) => onPatchAppearance({ ratingBadgeColor: value })}
        onChangeText={(value) => onPatchAppearance({ ratingBadgeColor: value })}
        placeholder={DEFAULT_APPEARANCE_SETTINGS.ratingBadgeColor}
      />
    </>
  )
}
