import { useRef } from 'react'
import { Download, RotateCcw, Sparkles, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE_SETTINGS,
  DENSITY_PRESETS,
  GLASS_PRESETS,
  RADIUS_PRESETS,
  resolveAppearanceColors,
  resolveSurfacePalette,
  SHADOW_PRESETS,
  SURFACE_PRESETS,
} from '@/lib/appearance'
import { cn } from '@/lib/utils'
import type { AppearanceSettings } from '@/types/settings'
import { settingsControlClassName } from './settings-control-classes'
import { SettingsField, SettingsValueTile } from './settings-primitives'

interface AppearanceTabProps {
  appearanceDraft: AppearanceSettings | null
  savedAppearance: AppearanceSettings
  isDirty: boolean
  onPatchAppearance: (patch: Partial<AppearanceSettings>) => void
  onReset: () => void
  onCancel: () => void
  onSave: () => void
  onExport: () => void
  onImport: (file: File) => void | Promise<void>
  isSaving: boolean
}

function isHexColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

export function AppearanceTab({
  appearanceDraft,
  savedAppearance,
  isDirty,
  onPatchAppearance,
  onReset,
  onCancel,
  onSave,
  onExport,
  onImport,
  isSaving,
}: AppearanceTabProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const resolvedColors = appearanceDraft ? resolveAppearanceColors(appearanceDraft) : null
  const resolvedSurface = appearanceDraft ? resolveSurfacePalette(appearanceDraft) : null
  const customPrimaryColorValue = appearanceDraft && isHexColor(appearanceDraft.customPrimaryColor)
    ? appearanceDraft.customPrimaryColor
    : DEFAULT_APPEARANCE_SETTINGS.customPrimaryColor
  const customSecondaryColorValue = appearanceDraft && isHexColor(appearanceDraft.customSecondaryColor)
    ? appearanceDraft.customSecondaryColor
    : DEFAULT_APPEARANCE_SETTINGS.customSecondaryColor

  return (
    <div className="space-y-8">
      <Card className="bg-surface-container">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <CardTitle>Appearance</CardTitle>
              <CardDescription>앱 전체 테마의 색감, 표면 무드, 밀도, 마감값을 조정하고 JSON으로 가져오거나 내보낼 수 있어.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={onExport} disabled={isSaving}>
                <Download className="h-4 w-4" />
                내보내기
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={isSaving}>
                <Upload className="h-4 w-4" />
                가져오기
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onReset} disabled={!appearanceDraft || isSaving}>
                <RotateCcw className="h-4 w-4" />
                기본값
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={!isDirty || isSaving}>
                <X className="h-4 w-4" />
                취소
              </Button>
              <Button type="button" size="sm" onClick={onSave} disabled={!appearanceDraft || !isDirty || isSaving}>
                <Sparkles className="h-4 w-4" />
                저장
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) {
                void onImport(file)
              }
              event.target.value = ''
            }}
          />
          {appearanceDraft ? (
            <>
              <div className="theme-settings-panel rounded-sm border border-border bg-surface-low">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-foreground">Live preview</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      변경값은 즉시 전체 UI에 미리보기로 반영돼. 저장하지 않으면 마지막 저장 상태는 유지돼.
                    </div>
                  </div>
                  <div className={cn(
                    'rounded-full px-3 py-1 text-xs font-semibold',
                    isDirty ? 'bg-primary/12 text-primary' : 'bg-surface-high text-muted-foreground',
                  )}>
                    {isDirty ? 'Unsaved draft' : 'Saved'}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <SettingsValueTile label="Mode" value={appearanceDraft.themeMode} />
                <SettingsValueTile label="Accent" value={appearanceDraft.accentPreset} />
                <SettingsValueTile label="Surface" value={appearanceDraft.surfacePreset} />
                <SettingsValueTile label="Radius" value={appearanceDraft.radiusPreset} />
                <SettingsValueTile label="Glass" value={appearanceDraft.glassPreset} />
                <SettingsValueTile label="Shadow" value={appearanceDraft.shadowPreset} />
                <SettingsValueTile label="Density" value={appearanceDraft.density} />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <SettingsField label="Theme mode">
                  <select
                    value={appearanceDraft.themeMode}
                    onChange={(event) => onPatchAppearance({ themeMode: event.target.value as AppearanceSettings['themeMode'] })}
                    className={settingsControlClassName}
                  >
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
                      value={customPrimaryColorValue}
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
                      value={customSecondaryColorValue}
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
                    const palette = preset.modes[appearanceDraft.themeMode]
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
                </div>
              </div>

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

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <SettingsValueTile
                  label="Applied Colors"
                  value={
                    <div className="flex items-center gap-2">
                      <span className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: resolvedColors?.primary }} />
                      <span className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: resolvedColors?.secondary }} />
                      <span className="text-xs font-medium text-muted-foreground">
                        {resolvedColors?.primary} / {resolvedColors?.secondary}
                      </span>
                    </div>
                  }
                />
                <SettingsValueTile
                  label="Surface Preview"
                  value={
                    <div className="flex items-center gap-2">
                      <span className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: resolvedSurface?.background }} />
                      <span className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: resolvedSurface?.surfaceContainer }} />
                      <span className="h-4 w-4 rounded-full border border-border" style={{ backgroundColor: resolvedSurface?.surfaceHigh }} />
                    </div>
                  }
                />
                <SettingsValueTile
                  label="Current Finish"
                  value={`${RADIUS_PRESETS[appearanceDraft.radiusPreset].label} · ${GLASS_PRESETS[appearanceDraft.glassPreset].label} · ${SHADOW_PRESETS[appearanceDraft.shadowPreset].label}`}
                />
                <SettingsValueTile
                  label="Saved Baseline"
                  value={`${savedAppearance.themeMode} · ${savedAppearance.surfacePreset} · ${savedAppearance.density}`}
                />
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
