import { useRef } from 'react'
import { AlertTriangle, Check, Download, Paintbrush, RotateCcw, Save, Sparkles, Upload, X } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE_SETTINGS,
  DENSITY_PRESETS,
  GLASS_PRESETS,
  getAppearanceContrastIssues,
  RADIUS_PRESETS,
  extractAppearanceTheme,
  resolveAppearanceColors,
  resolveSurfacePalette,
  SHADOW_PRESETS,
  SURFACE_PRESETS,
} from '@/lib/appearance'
import { cn } from '@/lib/utils'
import type { AppearancePresetSlot, AppearanceSettings } from '@/types/settings'
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
  onSavePresetSlots: (presetSlots: AppearancePresetSlot[]) => void
  isSaving: boolean
}

function isHexColor(value: string) {
  return /^#[0-9a-fA-F]{6}$/.test(value)
}

function areThemesEqual(left: AppearanceSettings | null, right: AppearanceSettings | null) {
  if (!left || !right) {
    return false
  }

  return JSON.stringify(extractAppearanceTheme(left)) === JSON.stringify(extractAppearanceTheme(right))
}

function areThemeSettingsEqual(left: AppearanceSettings | null, right: AppearancePresetSlot['appearance']) {
  if (!left || !right) {
    return false
  }

  return JSON.stringify(extractAppearanceTheme(left)) === JSON.stringify(right)
}

function formatSlotTimestamp(value: string | null) {
  if (!value) {
    return '저장 이력 없음'
  }

  return new Date(value).toLocaleString()
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
  onSavePresetSlots,
  isSaving,
}: AppearanceTabProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const resolvedColors = appearanceDraft ? resolveAppearanceColors(appearanceDraft) : null
  const resolvedSurface = appearanceDraft ? resolveSurfacePalette(appearanceDraft) : null
  const contrastIssues = appearanceDraft ? getAppearanceContrastIssues(appearanceDraft) : []
  const customPrimaryColorValue = appearanceDraft && isHexColor(appearanceDraft.customPrimaryColor)
    ? appearanceDraft.customPrimaryColor
    : DEFAULT_APPEARANCE_SETTINGS.customPrimaryColor
  const customSecondaryColorValue = appearanceDraft && isHexColor(appearanceDraft.customSecondaryColor)
    ? appearanceDraft.customSecondaryColor
    : DEFAULT_APPEARANCE_SETTINGS.customSecondaryColor
  const savedThemeMatchesDraft = areThemesEqual(appearanceDraft, savedAppearance)

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

              {contrastIssues.length > 0 ? (
                <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-950 dark:text-amber-100">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Contrast guardrail</AlertTitle>
                  <AlertDescription>
                    <p>현재 조합은 일부 텍스트/상태 색 대비가 약해 보여. 저장 전 확인하는 편이 좋아.</p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {contrastIssues.map((issue) => (
                        <span key={issue.id} className="rounded-full border border-amber-500/30 bg-background/70 px-2 py-1 text-xs text-foreground">
                          {issue.label}: {issue.ratio}:1
                        </span>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <SettingsValueTile label="Mode" value={appearanceDraft.themeMode} />
                <SettingsValueTile label="Accent" value={appearanceDraft.accentPreset} />
                <SettingsValueTile label="Surface" value={appearanceDraft.surfacePreset} />
                <SettingsValueTile label="Radius" value={appearanceDraft.radiusPreset} />
                <SettingsValueTile label="Glass" value={appearanceDraft.glassPreset} />
                <SettingsValueTile label="Shadow" value={appearanceDraft.shadowPreset} />
                <SettingsValueTile label="Density" value={appearanceDraft.density} />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Saved theme slots</div>
                  <div className="text-xs text-muted-foreground">Quick apply는 미리보기만 바꾸고, Save를 눌러야 실제 화면 설정으로 저장돼.</div>
                </div>
                <div className="grid gap-3 xl:grid-cols-3">
                  {appearanceDraft.presetSlots.map((slot, index) => {
                    const slotTheme = slot.appearance
                    const slotColors = slotTheme ? resolveAppearanceColors(slotTheme) : null
                    const slotSurface = slotTheme ? resolveSurfacePalette(slotTheme) : null
                    const isActiveSlot = areThemeSettingsEqual(appearanceDraft, slotTheme)
                    const matchesSavedTheme = areThemeSettingsEqual(savedAppearance, slotTheme)
                    const isEmptySlot = !slotTheme
                    const overwriteLabel = isEmptySlot ? '현재값 저장' : '현재값으로 덮어쓰기'
                    const slotModeLabel = slotTheme ? slotTheme.themeMode : 'empty'
                    const slotDensityLabel = slotTheme ? DENSITY_PRESETS[slotTheme.density].label : 'Empty'
                    const slotRadiusLabel = slotTheme ? RADIUS_PRESETS[slotTheme.radiusPreset].label : 'Not set'
                    const slotGlassLabel = slotTheme ? GLASS_PRESETS[slotTheme.glassPreset].label : 'Not set'
                    const slotShadowLabel = slotTheme ? SHADOW_PRESETS[slotTheme.shadowPreset].label : 'Not set'
                    const accentLabel = slotTheme
                      ? slotTheme.accentPreset === 'custom'
                        ? 'Custom accent'
                        : APPEARANCE_PRESETS[slotTheme.accentPreset].label
                      : 'No accent'
                    const surfaceLabel = slotTheme ? SURFACE_PRESETS[slotTheme.surfacePreset].label : 'Empty'

                    return (
                      <div
                        key={slot.id}
                        className={cn(
                          'rounded-sm border p-4 transition-colors',
                          isActiveSlot
                            ? 'border-primary bg-surface-high'
                            : 'border-border bg-surface-low',
                        )}
                      >
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-border bg-background/70 px-2 py-1 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                                  Slot {index + 1}
                                </span>
                                <span
                                  className={cn(
                                    'rounded-full px-2 py-1 text-[11px] font-semibold',
                                    isEmptySlot
                                      ? 'bg-surface-high text-muted-foreground'
                                      : isActiveSlot
                                        ? 'bg-primary/14 text-primary'
                                        : matchesSavedTheme
                                          ? 'bg-emerald-500/14 text-emerald-700 dark:text-emerald-300'
                                          : 'bg-surface-highest text-foreground',
                                  )}
                                >
                                  {isEmptySlot ? 'Empty' : isActiveSlot ? 'Active preview' : matchesSavedTheme ? 'Saved baseline' : 'Saved slot'}
                                </span>
                              </div>
                              <input
                                type="text"
                                value={slot.label}
                                onChange={(event) =>
                                  onPatchAppearance({
                                    presetSlots: appearanceDraft.presetSlots.map((candidate) =>
                                      candidate.id === slot.id
                                        ? { ...candidate, label: event.target.value }
                                        : candidate,
                                    ),
                                  })
                                }
                                className={settingsControlClassName}
                                maxLength={32}
                                placeholder="Slot name"
                              />
                            </div>
                            <div className="text-right text-[11px] text-muted-foreground">
                              {formatSlotTimestamp(slot.updatedAt)}
                            </div>
                          </div>

                          {slotTheme ? (
                            <div
                              className="overflow-hidden rounded-sm border border-border/80"
                              style={{
                                background: `linear-gradient(150deg, ${slotSurface?.background} 0%, ${slotSurface?.surfaceContainer} 60%, ${slotSurface?.surfaceHigh} 100%)`,
                              }}
                            >
                              <div className="space-y-3 p-3">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="space-y-1">
                                    <div className="text-sm font-semibold" style={{ color: slotSurface?.foreground }}>
                                      {slot.label.trim() || `Slot ${index + 1}`}
                                    </div>
                                    <div className="text-xs" style={{ color: slotSurface?.mutedForeground }}>
                                      {slotModeLabel} mode · {accentLabel}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="h-3.5 w-3.5 rounded-full border border-white/20" style={{ backgroundColor: slotColors?.primary }} />
                                    <span className="h-3.5 w-3.5 rounded-full border border-white/20" style={{ backgroundColor: slotColors?.secondary }} />
                                  </div>
                                </div>

                                <div className="grid grid-cols-[1.2fr_0.85fr] gap-2">
                                  <div
                                    className="rounded-sm border px-3 py-2"
                                    style={{
                                      backgroundColor: slotSurface?.surfaceContainer,
                                      borderColor: slotSurface?.border,
                                    }}
                                  >
                                    <div className="text-[11px] font-medium" style={{ color: slotSurface?.mutedForeground }}>
                                      Surface mood
                                    </div>
                                    <div className="mt-1 text-sm font-semibold" style={{ color: slotSurface?.foreground }}>
                                      {surfaceLabel}
                                    </div>
                                  </div>
                                  <div
                                    className="rounded-sm border px-3 py-2"
                                    style={{
                                      backgroundColor: slotColors?.primary,
                                      borderColor: slotSurface?.border,
                                      color: '#ffffff',
                                    }}
                                  >
                                    <div className="text-[11px] font-medium text-white/80">Density</div>
                                    <div className="mt-1 text-sm font-semibold">{slotDensityLabel}</div>
                                  </div>
                                </div>

                                <div className="grid grid-cols-3 gap-2">
                                  {[slotSurface?.background, slotSurface?.surfaceContainer, slotSurface?.surfaceHigh].map((color, colorIndex) => (
                                    <span
                                      key={`${slot.id}-surface-${colorIndex}`}
                                      className="h-8 rounded-sm border border-white/10"
                                      style={{ backgroundColor: color }}
                                    />
                                  ))}
                                </div>

                                <div className="grid grid-cols-3 gap-2 text-[11px]">
                                  <div
                                    className="rounded-sm border px-2 py-2"
                                    style={{ backgroundColor: slotSurface?.surfaceLow, borderColor: slotSurface?.border, color: slotSurface?.foreground }}
                                  >
                                    Radius
                                    <div className="mt-1 font-semibold">{slotRadiusLabel}</div>
                                  </div>
                                  <div
                                    className="rounded-sm border px-2 py-2"
                                    style={{ backgroundColor: slotSurface?.surfaceLow, borderColor: slotSurface?.border, color: slotSurface?.foreground }}
                                  >
                                    Glass
                                    <div className="mt-1 font-semibold">{slotGlassLabel}</div>
                                  </div>
                                  <div
                                    className="rounded-sm border px-2 py-2"
                                    style={{ backgroundColor: slotSurface?.surfaceLow, borderColor: slotSurface?.border, color: slotSurface?.foreground }}
                                  >
                                    Shadow
                                    <div className="mt-1 font-semibold">{slotShadowLabel}</div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-sm border border-dashed border-border bg-background/40 px-3 py-5 text-xs text-muted-foreground">
                              <div className="font-semibold text-foreground">빈 슬롯</div>
                              <div className="mt-1">현재 draft를 저장하면 이 자리에 테마 미리보드가 생겨.</div>
                            </div>
                          )}

                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="flex-1 min-w-[9rem]"
                              disabled={!slotTheme || isSaving}
                              onClick={() => {
                                if (!slotTheme) return
                                onPatchAppearance({
                                  ...extractAppearanceTheme(slotTheme),
                                  presetSlots: appearanceDraft.presetSlots,
                                })
                              }}
                            >
                              <Paintbrush className="h-4 w-4" />
                              Quick apply
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              className="flex-1 min-w-[10rem]"
                              disabled={isSaving}
                              onClick={() => {
                                const nextPresetSlots = appearanceDraft.presetSlots.map((candidate) =>
                                  candidate.id === slot.id
                                    ? {
                                        ...candidate,
                                        label: candidate.label.trim() || `Slot ${index + 1}`,
                                        appearance: extractAppearanceTheme(appearanceDraft),
                                        updatedAt: new Date().toISOString(),
                                      }
                                    : candidate,
                                )
                                onSavePresetSlots(nextPresetSlots)
                              }}
                            >
                              {isEmptySlot ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}
                              {overwriteLabel}
                            </Button>
                          </div>

                          <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                            {isActiveSlot ? <span>현재 live preview와 동일</span> : null}
                            {matchesSavedTheme && !savedThemeMatchesDraft ? <span>저장된 baseline과 동일</span> : null}
                            {!isEmptySlot && !isActiveSlot ? <span>Quick apply 후 Save를 눌러야 적용이 고정돼.</span> : null}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
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
