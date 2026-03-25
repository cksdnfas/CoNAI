import { Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { getThemeToneStyle, type ThemeTone } from '@/lib/theme-tones'
import { cn } from '@/lib/utils'
import type { AppearanceSettings } from '@/types/settings'
import type { AppearanceTabColorValues } from './appearance-tab.types'
import { settingsControlClassName } from './settings-control-classes'
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

/** Render a compact section heading with optional helper copy. */
function EditorSectionLead({
  step,
  title,
  description,
}: {
  step: string
  title: string
  description: string
}) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">{step}</div>
      <div className="text-sm font-semibold text-foreground">{title}</div>
      <div className="text-xs text-muted-foreground">{description}</div>
    </div>
  )
}

/** Prefer the saved original upload name and fall back to the stored URL basename. */
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

/** Render a reusable upload status card for sans/mono custom fonts. */
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
        <div>
          <div className="text-xs font-semibold text-foreground">{label}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {hasUploadedFont ? '업로드된 폰트가 현재 draft에 연결되어 있어.' : '아직 업로드된 폰트가 없어. family 문자열만 써도 동작해.'}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onUpload} disabled={isUploadingFont}>
            <Upload className="h-4 w-4" />
            업로드
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onClear} disabled={!hasUploadedFont}>
            <X className="h-4 w-4" />
            해제
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={cn(
          'rounded-full px-2 py-1 text-[11px] font-semibold',
          hasUploadedFont ? 'bg-primary/12 text-primary' : 'bg-surface-high text-muted-foreground',
        )}>
          {hasUploadedFont ? 'Uploaded' : 'Not linked'}
        </span>
        <span className="min-w-0 break-all text-xs text-foreground">
          {displayName || '파일 없음'}
        </span>
      </div>
      {hasUploadedFont ? <div className="mt-2 break-all text-[11px] text-muted-foreground">{url}</div> : null}
    </div>
  )
}

/** Render live tone samples so badge color edits are immediately visible. */
function BadgeTonePreview({ tone, label, example }: { tone: ThemeTone; label: string; example: string }) {
  return (
    <div className="rounded-sm border border-border/70 bg-surface-lowest px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-foreground">{label}</div>
        <span className="rounded-full px-2 py-1 text-[11px] font-semibold" style={getThemeToneStyle(tone)}>
          {label}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full border border-border bg-background px-2.5 py-1.5 text-xs text-foreground">
          sample chip
        </span>
        <span className="rounded-full px-2.5 py-1.5 text-xs font-semibold" style={getThemeToneStyle(tone)}>
          {example}
        </span>
      </div>
    </div>
  )
}

export function AppearanceTabEditorSection({
  appearanceDraft,
  colorValues,
  onPatchAppearance,
  onRequestSansFontUpload,
  onRequestMonoFontUpload,
  onClearCustomFont,
  isUploadingFont,
}: AppearanceTabEditorSectionProps) {
  return (
    <div className="space-y-8">
      <div className="rounded-sm border border-border/70 bg-surface-low px-4 py-4">
        <div className="text-sm font-semibold text-foreground">추천 설정 순서</div>
        <div className="mt-2 grid gap-2 text-xs text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
          <div>1. 기본 모드와 밀도를 고른다</div>
          <div>2. Accent / Surface mood를 정한다</div>
          <div>3. Finish, 폰트, 반응형 폭을 다듬는다</div>
          <div>4. 배지색 확인 후 Save로 고정한다</div>
        </div>
      </div>

      <section className="space-y-4">
        <EditorSectionLead
          step="Step 1"
          title="Base theme"
          description="전체 톤을 가장 크게 바꾸는 시작점이야. 모드와 밀도를 먼저 잡으면 뒤 조정이 편해져."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <SettingsField label="Theme mode">
            <select
              value={appearanceDraft.themeMode}
              onChange={(event) => onPatchAppearance({ themeMode: event.target.value as AppearanceSettings['themeMode'] })}
              className={settingsControlClassName}
            >
              <option value="system">system</option>
              <option value="dark">dark</option>
              <option value="light">light</option>
            </select>
            <div className="mt-2 text-xs text-muted-foreground">system은 OS 테마를 따라가고, 새 기본값도 여기야.</div>
          </SettingsField>

          <SettingsField label="Density">
            <select
              value={appearanceDraft.density}
              onChange={(event) => onPatchAppearance({ density: event.target.value as AppearanceSettings['density'] })}
              className={settingsControlClassName}
            >
              {Object.entries(DENSITY_PRESETS).map(([presetKey, preset]) => (
                <option key={presetKey} value={presetKey}>{preset.label}</option>
              ))}
            </select>
            <div className="mt-2 text-xs text-muted-foreground">
              {DENSITY_PRESETS[appearanceDraft.density].description}
            </div>
          </SettingsField>
        </div>
      </section>

      <section className="space-y-4">
        <EditorSectionLead
          step="Step 2"
          title="Accent colors"
          description="브랜드 인상과 강조색을 정하는 단계야. custom으로 가면 primary / secondary를 직접 잡을 수 있어."
        />
        <div className="space-y-3">
          <div className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Accent preset</div>
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
                    <div>
                      <div className="text-sm font-semibold text-foreground">{preset.label}</div>
                      <div className="mt-1 text-xs">{preset.description}</div>
                    </div>
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
                <div>
                  <div className="text-sm font-semibold text-foreground">Custom</div>
                  <div className="mt-1 text-xs">직접 지정한 primary / secondary 색상 사용</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: appearanceDraft.customPrimaryColor }} />
                  <span className="h-5 w-5 rounded-full border border-border" style={{ backgroundColor: appearanceDraft.customSecondaryColor }} />
                </div>
              </div>
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <SettingsField label="Custom primary">
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={colorValues.customPrimaryColorValue}
                onChange={(event) => onPatchAppearance({ customPrimaryColor: event.target.value })}
                className="h-10 w-16 rounded-sm border border-border bg-surface-lowest p-1"
              />
              <input
                type="text"
                value={appearanceDraft.customPrimaryColor}
                onChange={(event) => onPatchAppearance({ customPrimaryColor: event.target.value })}
                className={settingsControlClassName}
                placeholder={DEFAULT_APPEARANCE_SETTINGS.customPrimaryColor}
              />
            </div>
          </SettingsField>

          <SettingsField label="Custom secondary">
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={colorValues.customSecondaryColorValue}
                onChange={(event) => onPatchAppearance({ customSecondaryColor: event.target.value })}
                className="h-10 w-16 rounded-sm border border-border bg-surface-lowest p-1"
              />
              <input
                type="text"
                value={appearanceDraft.customSecondaryColor}
                onChange={(event) => onPatchAppearance({ customSecondaryColor: event.target.value })}
                className={settingsControlClassName}
                placeholder={DEFAULT_APPEARANCE_SETTINGS.customSecondaryColor}
              />
            </div>
          </SettingsField>
        </div>
      </section>

      <section className="space-y-4">
        <EditorSectionLead
          step="Step 3"
          title="Surface mood & finish"
          description="화면 배경, 카드, 떠 있는 패널의 무드와 마감감을 여기서 정리해."
        />
        <div className="space-y-3">
          <div className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Surface mood</div>
          <div className="grid gap-3 md:grid-cols-3">
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
                  <div className="space-y-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">{preset.label}</div>
                      <div className="mt-1 text-xs">{preset.description}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-5 flex-1 rounded-sm border border-border" style={{ backgroundColor: palette.background }} />
                      <span className="h-5 flex-1 rounded-sm border border-border" style={{ backgroundColor: palette.surfaceContainer }} />
                      <span className="h-5 flex-1 rounded-sm border border-border" style={{ backgroundColor: palette.surfaceHigh }} />
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
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">Custom mood</div>
                  <div className="mt-1 text-xs">배경 / 컨테이너 / 높은 표면 색을 직접 지정해서 분위기를 만든다</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-5 flex-1 rounded-sm border border-border" style={{ backgroundColor: appearanceDraft.customSurfaceBackgroundColor }} />
                  <span className="h-5 flex-1 rounded-sm border border-border" style={{ backgroundColor: appearanceDraft.customSurfaceContainerColor }} />
                  <span className="h-5 flex-1 rounded-sm border border-border" style={{ backgroundColor: appearanceDraft.customSurfaceHighColor }} />
                </div>
              </div>
            </button>
          </div>
        </div>

        {appearanceDraft.surfacePreset === 'custom' ? (
          <div className="grid gap-4 md:grid-cols-3">
            <SettingsField label="Custom background">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={colorValues.customSurfaceBackgroundColorValue}
                  onChange={(event) => onPatchAppearance({ customSurfaceBackgroundColor: event.target.value })}
                  className="h-10 w-16 rounded-sm border border-border bg-surface-lowest p-1"
                />
                <input
                  type="text"
                  value={appearanceDraft.customSurfaceBackgroundColor}
                  onChange={(event) => onPatchAppearance({ customSurfaceBackgroundColor: event.target.value })}
                  className={settingsControlClassName}
                  placeholder={DEFAULT_APPEARANCE_SETTINGS.customSurfaceBackgroundColor}
                />
              </div>
            </SettingsField>

            <SettingsField label="Custom container">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={colorValues.customSurfaceContainerColorValue}
                  onChange={(event) => onPatchAppearance({ customSurfaceContainerColor: event.target.value })}
                  className="h-10 w-16 rounded-sm border border-border bg-surface-lowest p-1"
                />
                <input
                  type="text"
                  value={appearanceDraft.customSurfaceContainerColor}
                  onChange={(event) => onPatchAppearance({ customSurfaceContainerColor: event.target.value })}
                  className={settingsControlClassName}
                  placeholder={DEFAULT_APPEARANCE_SETTINGS.customSurfaceContainerColor}
                />
              </div>
            </SettingsField>

            <SettingsField label="Custom elevated surface">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={colorValues.customSurfaceHighColorValue}
                  onChange={(event) => onPatchAppearance({ customSurfaceHighColor: event.target.value })}
                  className="h-10 w-16 rounded-sm border border-border bg-surface-lowest p-1"
                />
                <input
                  type="text"
                  value={appearanceDraft.customSurfaceHighColor}
                  onChange={(event) => onPatchAppearance({ customSurfaceHighColor: event.target.value })}
                  className={settingsControlClassName}
                  placeholder={DEFAULT_APPEARANCE_SETTINGS.customSurfaceHighColor}
                />
              </div>
            </SettingsField>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-3">
          <SettingsField label="Radius">
            <select
              value={appearanceDraft.radiusPreset}
              onChange={(event) => onPatchAppearance({ radiusPreset: event.target.value as AppearanceSettings['radiusPreset'] })}
              className={settingsControlClassName}
            >
              {Object.entries(RADIUS_PRESETS).map(([presetKey, preset]) => (
                <option key={presetKey} value={presetKey}>{preset.label}</option>
              ))}
            </select>
            <div className="mt-2 text-xs text-muted-foreground">
              {RADIUS_PRESETS[appearanceDraft.radiusPreset].description}
            </div>
          </SettingsField>

          <SettingsField label="Glass">
            <select
              value={appearanceDraft.glassPreset}
              onChange={(event) => onPatchAppearance({ glassPreset: event.target.value as AppearanceSettings['glassPreset'] })}
              className={settingsControlClassName}
            >
              {Object.entries(GLASS_PRESETS).map(([presetKey, preset]) => (
                <option key={presetKey} value={presetKey}>{preset.label}</option>
              ))}
            </select>
            <div className="mt-2 text-xs text-muted-foreground">
              {GLASS_PRESETS[appearanceDraft.glassPreset].description}
            </div>
          </SettingsField>

          <SettingsField label="Shadow">
            <select
              value={appearanceDraft.shadowPreset}
              onChange={(event) => onPatchAppearance({ shadowPreset: event.target.value as AppearanceSettings['shadowPreset'] })}
              className={settingsControlClassName}
            >
              {Object.entries(SHADOW_PRESETS).map(([presetKey, preset]) => (
                <option key={presetKey} value={presetKey}>{preset.label}</option>
              ))}
            </select>
            <div className="mt-2 text-xs text-muted-foreground">
              {SHADOW_PRESETS[appearanceDraft.shadowPreset].description}
            </div>
          </SettingsField>
        </div>
      </section>

      <section className="space-y-4">
        <EditorSectionLead
          step="Step 4"
          title="Typography & responsive layout"
          description="폰트, 검색 UI 크기, 데스크톱 전환폭처럼 실제 사용감에 영향을 주는 부분이야."
        />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SettingsField label="Font preset">
            <select
              value={appearanceDraft.fontPreset}
              onChange={(event) => onPatchAppearance({ fontPreset: event.target.value as AppearanceSettings['fontPreset'] })}
              className={settingsControlClassName}
            >
              {Object.entries(FONT_PRESETS).map(([presetKey, preset]) => (
                <option key={presetKey} value={presetKey}>{preset.label}</option>
              ))}
            </select>
            <div className="mt-2 text-xs text-muted-foreground">
              {FONT_PRESETS[appearanceDraft.fontPreset].description}
            </div>
          </SettingsField>

          <SettingsField label="Font scale (%)">
            <input
              type="number"
              min={85}
              max={125}
              step={1}
              value={appearanceDraft.fontScalePercent}
              onChange={(event) => onPatchAppearance({ fontScalePercent: Number.parseInt(event.target.value || '100', 10) })}
              className={settingsControlClassName}
            />
            <div className="mt-2 text-xs text-muted-foreground">본문과 컨트롤 기본 글자 크기를 전체적으로 확대/축소한다.</div>
          </SettingsField>

          <SettingsField label="Search box width (px)">
            <input
              type="number"
              min={240}
              max={640}
              step={10}
              value={appearanceDraft.searchBoxWidth}
              onChange={(event) => onPatchAppearance({ searchBoxWidth: Number.parseInt(event.target.value || '380', 10) })}
              className={settingsControlClassName}
            />
          </SettingsField>

          <SettingsField label="Search drawer width (px)">
            <input
              type="number"
              min={320}
              max={720}
              step={10}
              value={appearanceDraft.searchDrawerWidth}
              onChange={(event) => onPatchAppearance({ searchDrawerWidth: Number.parseInt(event.target.value || '420', 10) })}
              className={settingsControlClassName}
            />
          </SettingsField>
        </div>

        {appearanceDraft.fontPreset === 'custom' ? (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <SettingsField label="Custom font family">
                <input
                  type="text"
                  value={appearanceDraft.customFontFamily}
                  onChange={(event) => onPatchAppearance({ customFontFamily: event.target.value })}
                  className={settingsControlClassName}
                  placeholder={DEFAULT_APPEARANCE_SETTINGS.customFontFamily}
                />
                <div className="mt-2 text-xs text-muted-foreground">설치된 폰트명 또는 이미 로드된 CSS font-family 문자열을 입력해.</div>
                <div className="mt-3">
                  <UploadedFontCard
                    label="본문 폰트 파일"
                    fileName={appearanceDraft.customFontFileName}
                    url={appearanceDraft.customFontUrl}
                    onUpload={onRequestSansFontUpload}
                    onClear={() => onClearCustomFont('sans')}
                    isUploadingFont={isUploadingFont}
                  />
                </div>
              </SettingsField>

              <SettingsField label="Custom mono font family">
                <input
                  type="text"
                  value={appearanceDraft.customMonoFontFamily}
                  onChange={(event) => onPatchAppearance({ customMonoFontFamily: event.target.value })}
                  className={settingsControlClassName}
                  placeholder={DEFAULT_APPEARANCE_SETTINGS.customMonoFontFamily}
                />
                <div className="mt-2 text-xs text-muted-foreground">코드/숫자 표시에 쓰는 모노 폰트 체인을 지정해.</div>
                <div className="mt-3">
                  <UploadedFontCard
                    label="모노 폰트 파일"
                    fileName={appearanceDraft.customMonoFontFileName}
                    url={appearanceDraft.customMonoFontUrl}
                    onUpload={onRequestMonoFontUpload}
                    onClear={() => onClearCustomFont('mono')}
                    isUploadingFont={isUploadingFont}
                  />
                </div>
              </SettingsField>
            </div>

            <div className="rounded-sm border border-border/60 bg-surface-lowest px-4 py-3 text-xs text-muted-foreground">
              업로드는 ttf / otf / woff / woff2 형식을 지원해. 업로드된 파일은 즉시 미리보기에 반영되고, Save를 눌러야 현재 테마 설정으로 저장돼.
            </div>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-2">
          <SettingsField label="Desktop search breakpoint (px)">
            <input
              type="number"
              min={640}
              max={1600}
              step={10}
              value={appearanceDraft.desktopSearchMinWidth}
              onChange={(event) => onPatchAppearance({ desktopSearchMinWidth: Number.parseInt(event.target.value || '768', 10) })}
              className={settingsControlClassName}
            />
            <div className="mt-2 text-xs text-muted-foreground">이 너비 이상에서 상단 검색 입력창을 그대로 보여준다.</div>
          </SettingsField>

          <SettingsField label="Desktop nav breakpoint (px)">
            <input
              type="number"
              min={768}
              max={1800}
              step={10}
              value={appearanceDraft.desktopNavMinWidth}
              onChange={(event) => onPatchAppearance({ desktopNavMinWidth: Number.parseInt(event.target.value || '1024', 10) })}
              className={settingsControlClassName}
            />
            <div className="mt-2 text-xs text-muted-foreground">이 너비 이상에서 상단 내비게이션 라벨을 펼친다.</div>
          </SettingsField>
        </div>
      </section>

      <section className="space-y-4">
        <EditorSectionLead
          step="Step 5"
          title="Search badge colors"
          description="검색 스코프/히스토리/관련 배지에 들어가는 색이야. 아래 샘플에서 바로 체감할 수 있어."
        />
        <div className="space-y-3">
          <div className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Search badge colors</div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <SettingsField label="긍정 배지">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={colorValues.positiveBadgeColorValue}
                  onChange={(event) => onPatchAppearance({ positiveBadgeColor: event.target.value })}
                  className="h-10 w-16 rounded-sm border border-border bg-surface-lowest p-1"
                />
                <input
                  type="text"
                  value={appearanceDraft.positiveBadgeColor}
                  onChange={(event) => onPatchAppearance({ positiveBadgeColor: event.target.value })}
                  className={settingsControlClassName}
                  placeholder={DEFAULT_APPEARANCE_SETTINGS.positiveBadgeColor}
                />
              </div>
            </SettingsField>

            <SettingsField label="부정 배지">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={colorValues.negativeBadgeColorValue}
                  onChange={(event) => onPatchAppearance({ negativeBadgeColor: event.target.value })}
                  className="h-10 w-16 rounded-sm border border-border bg-surface-lowest p-1"
                />
                <input
                  type="text"
                  value={appearanceDraft.negativeBadgeColor}
                  onChange={(event) => onPatchAppearance({ negativeBadgeColor: event.target.value })}
                  className={settingsControlClassName}
                  placeholder={DEFAULT_APPEARANCE_SETTINGS.negativeBadgeColor}
                />
              </div>
            </SettingsField>

            <SettingsField label="오토 배지">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={colorValues.autoBadgeColorValue}
                  onChange={(event) => onPatchAppearance({ autoBadgeColor: event.target.value })}
                  className="h-10 w-16 rounded-sm border border-border bg-surface-lowest p-1"
                />
                <input
                  type="text"
                  value={appearanceDraft.autoBadgeColor}
                  onChange={(event) => onPatchAppearance({ autoBadgeColor: event.target.value })}
                  className={settingsControlClassName}
                  placeholder={DEFAULT_APPEARANCE_SETTINGS.autoBadgeColor}
                />
              </div>
            </SettingsField>

            <SettingsField label="평가 배지">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={colorValues.ratingBadgeColorValue}
                  onChange={(event) => onPatchAppearance({ ratingBadgeColor: event.target.value })}
                  className="h-10 w-16 rounded-sm border border-border bg-surface-lowest p-1"
                />
                <input
                  type="text"
                  value={appearanceDraft.ratingBadgeColor}
                  onChange={(event) => onPatchAppearance({ ratingBadgeColor: event.target.value })}
                  className={settingsControlClassName}
                  placeholder={DEFAULT_APPEARANCE_SETTINGS.ratingBadgeColor}
                />
              </div>
            </SettingsField>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <BadgeTonePreview tone="positive" label="긍정" example="sunset lighting" />
          <BadgeTonePreview tone="negative" label="부정" example="low quality" />
          <BadgeTonePreview tone="auto" label="오토" example="auto tags" />
          <BadgeTonePreview tone="rating" label="평가" example="safe · 0.92" />
        </div>
      </section>
    </div>
  )
}
