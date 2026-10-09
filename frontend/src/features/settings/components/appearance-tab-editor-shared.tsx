import { Upload, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { cn } from '@/lib/utils'
import type { AppearanceSettings } from '@conai/shared'
import type { AppearanceTabColorValues } from './appearance-tab.types'
import { SettingRow } from '@/components/ui/setting-row'
import { ChatFilledLabel } from './settings-filled-label'
import { SETTINGS_CONTROL_CLASS } from './settings-rows'
import { useI18n, type TranslationInput } from '@/i18n'

export interface AppearanceTabEditorSectionProps {
  appearanceDraft: AppearanceSettings
  colorValues: AppearanceTabColorValues
  onPatchAppearance: (patch: Partial<AppearanceSettings>) => void
  onRequestSansFontUpload: () => void
  onRequestMonoFontUpload: () => void
  onClearCustomFont: (target: 'sans' | 'mono') => void
  isUploadingFont: boolean
}

type Translate = ReturnType<typeof useI18n>['t']

function translatedLabel(input: TranslationInput, t?: Translate) {
  return t ? t(input) : typeof input === 'string' ? input : input.ko ?? input.en ?? ''
}

/** Map theme mode values to localized labels. */
export function getThemeModeLabel(mode: AppearanceSettings['themeMode'], t?: Translate) {
  switch (mode) {
    case 'system':
      return translatedLabel({ ko: '시스템', en: 'System' }, t)
    case 'dark':
      return translatedLabel({ ko: '다크', en: 'Dark' }, t)
    case 'light':
      return translatedLabel({ ko: '라이트', en: 'Light' }, t)
    default:
      return mode
  }
}

/** Map density values to localized labels. */
export function getDensityLabel(density: AppearanceSettings['density'], t?: Translate) {
  switch (density) {
    case 'ultra-compact':
      return translatedLabel({ ko: '아주 촘촘하게', en: 'Ultra compact' }, t)
    case 'compact':
      return translatedLabel({ ko: '촘촘하게', en: 'Compact' }, t)
    case 'comfortable':
      return translatedLabel({ ko: '기본', en: 'Default' }, t)
    case 'spacious':
      return translatedLabel({ ko: '여유롭게', en: 'Spacious' }, t)
    default:
      return String(density)
  }
}

/** Map accent preset values to localized labels. */
export function getAccentPresetLabel(preset: AppearanceSettings['accentPreset'], t?: Translate) {
  switch (preset) {
    case 'conai':
      return 'CoNAI'
    case 'ocean':
      return translatedLabel({ ko: '오션', en: 'Ocean' }, t)
    case 'forest':
      return translatedLabel({ ko: '포레스트', en: 'Forest' }, t)
    case 'custom':
      return translatedLabel({ ko: '사용자 지정', en: 'Custom' }, t)
    default:
      return preset
  }
}

/** Map surface preset values to localized labels. */
export function getSurfacePresetLabel(preset: AppearanceSettings['surfacePreset'], t?: Translate) {
  switch (preset) {
    case 'studio':
      return translatedLabel({ ko: '스튜디오', en: 'Studio' }, t)
    case 'midnight':
      return translatedLabel({ ko: '미드나이트', en: 'Midnight' }, t)
    case 'paper':
      return translatedLabel({ ko: '페이퍼', en: 'Paper' }, t)
    case 'custom':
      return translatedLabel({ ko: '사용자 지정', en: 'Custom' }, t)
    default:
      return preset
  }
}

/** Map radius preset values to localized labels. */
export function getRadiusLabel(preset: AppearanceSettings['radiusPreset'], t?: Translate) {
  switch (preset) {
    case 'sharp':
      return translatedLabel({ ko: '각짐', en: 'Sharp' }, t)
    case 'balanced':
      return translatedLabel({ ko: '균형', en: 'Balanced' }, t)
    case 'soft':
      return translatedLabel({ ko: '부드러움', en: 'Soft' }, t)
    default:
      return String(preset)
  }
}

/** Map glass preset values to localized labels. */
export function getGlassLabel(preset: AppearanceSettings['glassPreset'], t?: Translate) {
  switch (preset) {
    case 'subtle':
      return translatedLabel({ ko: '은은함', en: 'Subtle' }, t)
    case 'balanced':
      return translatedLabel({ ko: '균형', en: 'Balanced' }, t)
    case 'immersive':
      return translatedLabel({ ko: '강하게', en: 'Immersive' }, t)
    default:
      return String(preset)
  }
}

/** Map shadow preset values to localized labels. */
export function getShadowLabel(preset: AppearanceSettings['shadowPreset'], t?: Translate) {
  switch (preset) {
    case 'soft':
      return translatedLabel({ ko: '부드러움', en: 'Soft' }, t)
    case 'balanced':
      return translatedLabel({ ko: '균형', en: 'Balanced' }, t)
    case 'dramatic':
      return translatedLabel({ ko: '강하게', en: 'Dramatic' }, t)
    default:
      return String(preset)
  }
}

/** Map font preset values to localized labels. */
export function getFontPresetLabel(preset: AppearanceSettings['fontPreset'], t?: Translate) {
  switch (preset) {
    case 'manrope':
      return translatedLabel({ ko: '기본 폰트', en: 'Default font' }, t)
    case 'system':
      return translatedLabel({ ko: '시스템 폰트', en: 'System font' }, t)
    case 'custom':
      return translatedLabel({ ko: '사용자 지정', en: 'Custom' }, t)
    default:
      return String(preset)
  }
}

/** Map body font weight preset values to localized labels. */
export function getBodyFontWeightLabel(preset: AppearanceSettings['bodyFontWeightPreset'], t?: Translate) {
  switch (preset) {
    case 'regular':
      return translatedLabel({ ko: '기본', en: 'Default' }, t)
    case 'medium':
      return translatedLabel({ ko: '약간 굵게', en: 'Medium' }, t)
    default:
      return String(preset)
  }
}

/** Map emphasis font weight preset values to localized labels. */
export function getEmphasisFontWeightLabel(preset: AppearanceSettings['emphasisFontWeightPreset'], t?: Translate) {
  switch (preset) {
    case 'standard':
      return translatedLabel({ ko: '기본', en: 'Default' }, t)
    case 'bold':
      return translatedLabel({ ko: '볼드', en: 'Bold' }, t)
    default:
      return String(preset)
  }
}

/** Map related-image ratio values to localized labels. */
export function getRelatedImageAspectRatioLabel(ratio: AppearanceSettings['detailRelatedImageAspectRatio'], t?: Translate) {
  switch (ratio) {
    case 'original':
      return translatedLabel({ ko: '원본 비율', en: 'Original ratio' }, t)
    case 'square':
      return translatedLabel({ ko: '정사각형', en: 'Square' }, t)
    case 'portrait':
      return translatedLabel({ ko: '세로형 (4:5)', en: 'Portrait (4:5)' }, t)
    case 'landscape':
      return translatedLabel({ ko: '가로형 (3:2)', en: 'Landscape (3:2)' }, t)
    default:
      return String(ratio)
  }
}

/** Map group-explorer card style values to localized labels. */
export function getGroupExplorerCardStyleLabel(style: AppearanceSettings['groupExplorerCardStyle'], t?: Translate) {
  switch (style) {
    case 'compact-row':
      return translatedLabel({ ko: '기본 목록형', en: 'Default list' }, t)
    case 'media-tile':
      return translatedLabel({ ko: '미디어 타일형', en: 'Media tile' }, t)
    default:
      return String(style)
  }
}


/** A 1-6 card count as a setting row (related-image grids). */
export function RelatedImageColumnRow({
  label,
  fieldId,
  value,
  onChange,
}: {
  label: string
  /** Chat page field id, for the assistant-filled dot. */
  fieldId?: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <SettingRow label={fieldId ? <ChatFilledLabel fieldId={fieldId}>{label}</ChatFilledLabel> : label} controlClassName={SETTINGS_CONTROL_CLASS}>
      <NumberStepperInput
        min={1}
        max={6}
        step={1}
        value={value}
        variant="settings"
        aria-label={label}
        onValueCommit={(nextValue) => onChange(Number.parseInt(nextValue || '1', 10))}
      />
    </SettingRow>
  )
}

/** Build a readable label for an uploaded font file. */
export function getUploadedFontDisplayName(fileName: string, url: string) {
  if (fileName.trim()) {
    return fileName.trim()
  }

  if (!url.trim()) {
    return ''
  }

  const segments = url.split('/').filter(Boolean)
  return segments.at(-1) ?? url
}

/** One custom font slot as a row: file name, upload and clear. */
export function UploadedFontRow({
  label,
  fileName,
  url,
  onUpload,
  onClear,
  isUploadingFont,
}: {
  label: string
  fileName: string
  url: string
  onUpload: () => void
  onClear: () => void
  isUploadingFont: boolean
}) {
  const { t } = useI18n()
  const displayName = getUploadedFontDisplayName(fileName, url)
  const hasUploadedFont = Boolean(url.trim())

  return (
    <SettingRow label={label}>
      <span className={cn('min-w-0 max-w-56 truncate text-xs', hasUploadedFont ? 'text-foreground' : 'text-muted-foreground')} title={url || undefined}>
        {displayName || t({ ko: '파일 없음', en: 'No file' })}
      </span>
      <IconButton
        size="icon-sm"
        variant="ghost"
        onClick={onUpload}
        disabled={isUploadingFont}
        label={t({ ko: '{label} 업로드', en: 'Upload {label}' }, { label })}
      >
        <Upload className="h-4 w-4" />
      </IconButton>
      <IconButton
        size="icon-sm"
        variant="ghost"
        onClick={onClear}
        disabled={!hasUploadedFont}
        label={t({ ko: '{label} 해제', en: 'Clear {label}' }, { label })}
      >
        <X className="h-4 w-4" />
      </IconButton>
    </SettingRow>
  )
}

/** The paired color picker and hex input used by appearance colors (compact, fits a row's control slot). */
export function AppearanceColorControl({
  colorValue,
  textValue,
  placeholder,
  onChangeColor,
  onChangeText,
  ariaLabel,
}: {
  colorValue: string
  textValue: string
  placeholder: string
  onChangeColor: (value: string) => void
  onChangeText: (value: string) => void
  ariaLabel?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={colorValue}
        aria-label={ariaLabel}
        onChange={(event) => onChangeColor(event.target.value)}
        className="h-9 w-10 shrink-0 cursor-pointer rounded-sm bg-field p-1"
      />
      <Input variant="settings" type="text" className="w-32 font-mono" value={textValue} aria-label={ariaLabel} onChange={(event) => onChangeText(event.target.value)} placeholder={placeholder} />
    </div>
  )
}

/** A color setting as a row. */
export function AppearanceColorRow({
  label,
  fieldId,
  ...control
}: {
  label: string
  /** Chat page field id, for the assistant-filled dot. */
  fieldId?: string
  colorValue: string
  textValue: string
  placeholder: string
  onChangeColor: (value: string) => void
  onChangeText: (value: string) => void
}) {
  return (
    <SettingRow label={fieldId ? <ChatFilledLabel fieldId={fieldId}>{label}</ChatFilledLabel> : label}>
      <AppearanceColorControl ariaLabel={label} {...control} />
    </SettingRow>
  )
}
