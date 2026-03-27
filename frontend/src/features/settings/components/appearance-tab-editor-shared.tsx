import { Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { AppearanceSettings } from '@/types/settings'
import type { AppearanceTabColorValues } from './appearance-tab.types'
import { SettingsField } from './settings-primitives'

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

export const APPEARANCE_EDITOR_TABS: Array<{ value: AppearanceEditorTab; label: string }> = [
  { value: 'general', label: '일반' },
  { value: 'list', label: '목록' },
  { value: 'color', label: '색상' },
]

/** Render a compact section title inside the appearance editor. */
export function EditorSectionLead({ title }: { title: string }) {
  return <div className="text-sm font-semibold text-foreground">{title}</div>
}

/** Map theme mode values to localized labels. */
export function getThemeModeLabel(mode: AppearanceSettings['themeMode']) {
  switch (mode) {
    case 'system':
      return '시스템'
    case 'dark':
      return '다크'
    case 'light':
      return '라이트'
    default:
      return mode
  }
}

/** Map density values to localized labels. */
export function getDensityLabel(density: AppearanceSettings['density']) {
  switch (density) {
    case 'compact':
      return '촘촘하게'
    case 'comfortable':
      return '기본'
    case 'spacious':
      return '여유롭게'
    default:
      return String(density)
  }
}

/** Map accent preset values to localized labels. */
export function getAccentPresetLabel(preset: AppearanceSettings['accentPreset']) {
  switch (preset) {
    case 'conai':
      return 'CoNAI'
    case 'ocean':
      return '오션'
    case 'forest':
      return '포레스트'
    case 'custom':
      return '사용자 지정'
    default:
      return preset
  }
}

/** Map surface preset values to localized labels. */
export function getSurfacePresetLabel(preset: AppearanceSettings['surfacePreset']) {
  switch (preset) {
    case 'studio':
      return '스튜디오'
    case 'midnight':
      return '미드나이트'
    case 'paper':
      return '페이퍼'
    case 'custom':
      return '사용자 지정'
    default:
      return preset
  }
}

/** Map radius preset values to localized labels. */
export function getRadiusLabel(preset: AppearanceSettings['radiusPreset']) {
  switch (preset) {
    case 'sharp':
      return '각짐'
    case 'balanced':
      return '균형'
    case 'soft':
      return '부드러움'
    default:
      return String(preset)
  }
}

/** Map glass preset values to localized labels. */
export function getGlassLabel(preset: AppearanceSettings['glassPreset']) {
  switch (preset) {
    case 'subtle':
      return '은은함'
    case 'balanced':
      return '균형'
    case 'immersive':
      return '강하게'
    default:
      return String(preset)
  }
}

/** Map shadow preset values to localized labels. */
export function getShadowLabel(preset: AppearanceSettings['shadowPreset']) {
  switch (preset) {
    case 'soft':
      return '부드러움'
    case 'balanced':
      return '균형'
    case 'dramatic':
      return '강하게'
    default:
      return String(preset)
  }
}

/** Map font preset values to localized labels. */
export function getFontPresetLabel(preset: AppearanceSettings['fontPreset']) {
  switch (preset) {
    case 'manrope':
      return '기본 폰트'
    case 'system':
      return '시스템 폰트'
    case 'custom':
      return '사용자 지정'
    default:
      return String(preset)
  }
}

/** Map body font weight preset values to localized labels. */
export function getBodyFontWeightLabel(preset: AppearanceSettings['bodyFontWeightPreset']) {
  switch (preset) {
    case 'regular':
      return '기본'
    case 'medium':
      return '약간 굵게'
    default:
      return String(preset)
  }
}

/** Map emphasis font weight preset values to localized labels. */
export function getEmphasisFontWeightLabel(preset: AppearanceSettings['emphasisFontWeightPreset']) {
  switch (preset) {
    case 'standard':
      return '기본'
    case 'bold':
      return '볼드'
    default:
      return String(preset)
  }
}

/** Map related-image ratio values to localized labels. */
export function getRelatedImageAspectRatioLabel(ratio: AppearanceSettings['detailRelatedImageAspectRatio']) {
  switch (ratio) {
    case 'original':
      return '원본 비율'
    case 'square':
      return '정사각형'
    case 'portrait':
      return '세로형 (4:5)'
    case 'landscape':
      return '가로형 (3:2)'
    default:
      return String(ratio)
  }
}

/** Render a compact slider for related-image column counts. */
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
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={6}
            step={1}
            value={value}
            onChange={(event) => onChange(Number(event.target.value))}
            className="w-full"
          />
          <span className="w-8 text-right text-sm font-semibold text-foreground">{value}</span>
        </div>
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
            aria-label={`${label} 업로드`}
            title={`${label} 업로드`}
          >
            <Upload className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            onClick={onClear}
            disabled={!hasUploadedFont}
            aria-label={`${label} 해제`}
            title={`${label} 해제`}
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
          {hasUploadedFont ? '연결됨' : '없음'}
        </span>
        <span className="min-w-0 break-all text-xs text-foreground">{displayName || '파일 없음'}</span>
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

/** Render the tab switch button used by the appearance editor. */
export function AppearanceEditorTabButton({
  label,
  isActive,
  onClick,
}: {
  label: string
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-sm px-3 py-1.5 text-xs font-semibold transition-colors',
        isActive ? 'bg-surface-high text-foreground' : 'text-muted-foreground hover:bg-surface-high hover:text-foreground',
      )}
      aria-pressed={isActive}
    >
      {label}
    </button>
  )
}
