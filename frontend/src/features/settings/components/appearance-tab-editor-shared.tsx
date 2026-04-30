import { Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { cn } from '@/lib/utils'
import type { AppearanceSettings } from '@/types/settings'
import type { AppearanceTabColorValues } from './appearance-tab.types'
import { SettingsField } from './settings-primitives'
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

export type AppearanceEditorTab = 'general' | 'list' | 'color'

export const APPEARANCE_EDITOR_TABS: Array<{ value: AppearanceEditorTab; label: TranslationInput }> = [
  { value: 'general', label: { ko: '일반', en: 'General' } },
  { value: 'list', label: { ko: '목록', en: 'List' } },
  { value: 'color', label: { ko: '색상', en: 'Color' } },
]

type Translate = ReturnType<typeof useI18n>['t']

function translatedLabel(input: TranslationInput, t?: Translate) {
  return t ? t(input) : typeof input === 'string' ? input : input.ko ?? input.en ?? ''
}

/** Render a compact section title inside the appearance editor. */
export function EditorSectionLead({ title }: { title: string }) {
  return <div className="text-sm font-semibold text-foreground">{title}</div>
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

/** Render a compact drag-enabled number input for related-image column counts. */
export function RelatedImageColumnSlider({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <SettingsField label={label}>
      <div className="space-y-2">
        <ScrubbableNumberInput
          min={1}
          max={6}
          step={1}
          value={value}
          variant="settings"
          onChange={(nextValue) => onChange(Number.parseInt(nextValue || '1', 10))}
        />
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>1</span>
          <span>6</span>
        </div>
      </div>
    </SettingsField>
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

/** Render upload and clear actions for a custom font target. */
export function UploadedFontCard({
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
    <div className="rounded-sm border border-border/70 bg-surface-lowest px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-foreground">{label}</div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={onUpload}
            disabled={isUploadingFont}
            aria-label={t({ ko: '{label} 업로드', en: 'Upload {label}' }, { label })}
            title={t({ ko: '{label} 업로드', en: 'Upload {label}' }, { label })}
          >
            <Upload className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={onClear}
            disabled={!hasUploadedFont}
            aria-label={t({ ko: '{label} 해제', en: 'Clear {label}' }, { label })}
            title={t({ ko: '{label} 해제', en: 'Clear {label}' }, { label })}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-full px-2 py-1 text-[11px] font-semibold',
            hasUploadedFont ? 'bg-primary/12 text-primary' : 'bg-surface-high text-muted-foreground',
          )}
        >
          {hasUploadedFont ? t({ ko: '연결됨', en: 'Linked' }) : t({ ko: '없음', en: 'None' })}
        </span>
        <span className="min-w-0 break-all text-xs text-foreground">{displayName || t({ ko: '파일 없음', en: 'No file' })}</span>
      </div>
      {hasUploadedFont ? <div className="mt-2 break-all text-[11px] text-muted-foreground">{url}</div> : null}
    </div>
  )
}

/** Render the paired color picker and text input used by appearance colors. */
export function AppearanceColorControl({
  colorValue,
  textValue,
  placeholder,
  onChangeColor,
  onChangeText,
}: {
  colorValue: string
  textValue: string
  placeholder: string
  onChangeColor: (value: string) => void
  onChangeText: (value: string) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="color"
        value={colorValue}
        onChange={(event) => onChangeColor(event.target.value)}
        className="h-10 w-16 rounded-sm border border-border bg-surface-lowest p-1"
      />
      <Input variant="settings" type="text" value={textValue} onChange={(event) => onChangeText(event.target.value)} placeholder={placeholder} />
    </div>
  )
}
