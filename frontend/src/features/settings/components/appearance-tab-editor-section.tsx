import { Upload } from 'lucide-react'
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
  isUploadingFont: boolean
}

export function AppearanceTabEditorSection({
  appearanceDraft,
  colorValues,
  onPatchAppearance,
  onRequestSansFontUpload,
  onRequestMonoFontUpload,
  isUploadingFont,
}: AppearanceTabEditorSectionProps) {
  return (
    <>
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
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={onRequestSansFontUpload} disabled={isUploadingFont}>
                  <Upload className="h-4 w-4" />
                  웹폰트 업로드
                </Button>
                {appearanceDraft.customFontUrl ? <span className="text-xs text-muted-foreground break-all">{appearanceDraft.customFontUrl}</span> : null}
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
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={onRequestMonoFontUpload} disabled={isUploadingFont}>
                  <Upload className="h-4 w-4" />
                  모노 폰트 업로드
                </Button>
                {appearanceDraft.customMonoFontUrl ? <span className="text-xs text-muted-foreground break-all">{appearanceDraft.customMonoFontUrl}</span> : null}
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
    </>
  )
}
