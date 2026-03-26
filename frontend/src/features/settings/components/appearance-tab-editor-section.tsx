import { useState } from 'react'
import { Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE_SETTINGS,
  DENSITY_PRESETS,
  FONT_PRESETS,
  GLASS_PRESETS,
  RADIUS_PRESETS,
  SHADOW_PRESETS,
  SURFACE_PRESETS,
} from '@/lib/appearance'
import { cn } from '@/lib/utils'
import type { AppearanceSettings } from '@/types/settings'
import type { AppearanceTabColorValues } from './appearance-tab.types'
import { SettingsField } from './settings-primitives'

interface AppearanceTabEditorSectionProps {
  appearanceDraft: AppearanceSettings
  colorValues: AppearanceTabColorValues
  onPatchAppearance: (patch: Partial<AppearanceSettings>) => void
  onRequestSansFontUpload: () => void
  onRequestMonoFontUpload: () => void
  onClearCustomFont: (target: 'sans' | 'mono') => void
  isUploadingFont: boolean
}

type AppearanceEditorTab = 'general' | 'list' | 'color'

const APPEARANCE_EDITOR_TABS: Array<{ value: AppearanceEditorTab; label: string }> = [
  { value: 'general', label: '일반' },
  { value: 'list', label: '목록' },
  { value: 'color', label: '색상' },
]

function EditorSectionLead({ title }: { title: string }) {
  return <div className="text-sm font-semibold text-foreground">{title}</div>
}

function getThemeModeLabel(mode: AppearanceSettings['themeMode']) {
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

function getDensityLabel(density: AppearanceSettings['density']) {
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

function getAccentPresetLabel(preset: AppearanceSettings['accentPreset']) {
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

function getSurfacePresetLabel(preset: AppearanceSettings['surfacePreset']) {
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

function getRadiusLabel(preset: AppearanceSettings['radiusPreset']) {
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

function getGlassLabel(preset: AppearanceSettings['glassPreset']) {
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

function getShadowLabel(preset: AppearanceSettings['shadowPreset']) {
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

function getFontPresetLabel(preset: AppearanceSettings['fontPreset']) {
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

function getRelatedImageAspectRatioLabel(ratio: AppearanceSettings['detailRelatedImageAspectRatio']) {
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

function RelatedImageColumnSlider({
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

function getUploadedFontDisplayName(fileName: string, url: string) {
  if (fileName.trim()) {
    return fileName.trim()
  }

  if (!url.trim()) {
    return ''
  }

  const segments = url.split('/').filter(Boolean)
  return segments.at(-1) ?? url
}

function UploadedFontCard({
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

function AppearanceColorControl({
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

function AppearanceEditorTabButton({
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

function AppearanceGeneralEditorContent({
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
        <div className="grid gap-4 md:grid-cols-3">
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
              max={125}
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
              max={125}
              step={1}
              variant="settings"
              value={appearanceDraft.textScalePercent}
              onChange={(event) => onPatchAppearance({ textScalePercent: Number.parseInt(event.target.value || '100', 10) })}
            />
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
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
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

          <SettingsField label="데스크톱 검색 전환폭 (px)">
            <Input
              type="number"
              min={640}
              max={1600}
              step={10}
              variant="settings"
              value={appearanceDraft.desktopSearchMinWidth}
              onChange={(event) => onPatchAppearance({ desktopSearchMinWidth: Number.parseInt(event.target.value || '768', 10) })}
            />
          </SettingsField>

          <SettingsField label="데스크톱 메뉴 전환폭 (px)">
            <Input
              type="number"
              min={768}
              max={1800}
              step={10}
              variant="settings"
              value={appearanceDraft.desktopNavMinWidth}
              onChange={(event) => onPatchAppearance({ desktopNavMinWidth: Number.parseInt(event.target.value || '1024', 10) })}
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

function AppearanceListEditorContent({
  appearanceDraft,
  onPatchAppearance,
}: AppearanceTabEditorSectionProps) {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <EditorSectionLead title="유사 / 중복 이미지" />
        <div className="grid gap-4 lg:grid-cols-2">
          <RelatedImageColumnSlider
            label="모바일 한 줄 카드 수"
            value={appearanceDraft.detailRelatedImageMobileColumns}
            onChange={(value) => onPatchAppearance({ detailRelatedImageMobileColumns: value })}
          />

          <RelatedImageColumnSlider
            label="데스크톱 한 줄 카드 수"
            value={appearanceDraft.detailRelatedImageColumns}
            onChange={(value) => onPatchAppearance({ detailRelatedImageColumns: value })}
          />

          <SettingsField label="카드 비율">
            <Select
              variant="settings"
              value={appearanceDraft.detailRelatedImageAspectRatio}
              onChange={(event) => onPatchAppearance({ detailRelatedImageAspectRatio: event.target.value as AppearanceSettings['detailRelatedImageAspectRatio'] })}
            >
              {(['original', 'square', 'portrait', 'landscape'] as AppearanceSettings['detailRelatedImageAspectRatio'][]).map((ratio) => (
                <option key={ratio} value={ratio}>
                  {getRelatedImageAspectRatioLabel(ratio)}
                </option>
              ))}
            </Select>
          </SettingsField>
        </div>
      </section>
    </div>
  )
}

function AppearanceColorEditorContent({
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

export function AppearanceTabEditorSection(props: AppearanceTabEditorSectionProps) {
  const [activeTab, setActiveTab] = useState<AppearanceEditorTab>('general')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2 border-b border-white/5 pb-2">
        {APPEARANCE_EDITOR_TABS.map((tab) => (
          <AppearanceEditorTabButton
            key={tab.value}
            label={tab.label}
            isActive={activeTab === tab.value}
            onClick={() => setActiveTab(tab.value)}
          />
        ))}
      </div>

      {activeTab === 'general' ? <AppearanceGeneralEditorContent {...props} /> : null}
      {activeTab === 'list' ? <AppearanceListEditorContent {...props} /> : null}
      {activeTab === 'color' ? <AppearanceColorEditorContent {...props} /> : null}
    </div>
  )
}
