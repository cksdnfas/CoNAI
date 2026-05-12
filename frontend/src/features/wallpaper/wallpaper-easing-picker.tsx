import { useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Save, Trash2 } from 'lucide-react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { SettingsField, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { cn } from '@/lib/utils'
import type { WallpaperAnimationEasing, WallpaperAnimationEasingPreset } from './wallpaper-types'
import {
  type WallpaperSavedEasingPreset,
  useWallpaperEasingPresetManager,
} from './wallpaper-easing-picker-presets'
import {
  WallpaperEasingPreviewCard,
  WallpaperSavedEasingPresetsSection,
} from './wallpaper-easing-picker-ui'
import {
  clampWallpaperEasingStopPointValue,
  formatWallpaperEasingGraphPointValue,
  WallpaperEasingGraph,
  WallpaperEasingGraphPreview,
  WallpaperEasingPreviewPanel,
  type WallpaperEasingPreviewConfig,
  type WallpaperEasingPreviewKind,
} from './wallpaper-easing-picker-preview'
import {
  WALLPAPER_ANIMATION_EASING_OPTIONS,
  buildWallpaperLinearEasing,
  getWallpaperAnimationEasingLabel,
  getWallpaperEditableEasingStopPoints,
  normalizeWallpaperAnimationEasing,
  type WallpaperEasingStopPoint,
} from './wallpaper-widget-utils'

// Pick a sensible default interior point when the custom editor opens.
function getDefaultSelectedCustomPointIndex(points: WallpaperEasingStopPoint[]) {
  return points.length > 2 ? 1 : null
}

// Keep the point selection on a valid interior stop after edits.
function getNormalizedSelectedCustomPointIndex(index: number | null, points: WallpaperEasingStopPoint[]) {
  if (points.length <= 2) {
    return null
  }

  if (index === null) {
    return getDefaultSelectedCustomPointIndex(points)
  }

  return Math.min(Math.max(index, 1), points.length - 2)
}

interface WallpaperEasingPickerProps {
  value: WallpaperAnimationEasing | undefined
  fallbackPreset?: WallpaperAnimationEasingPreset
  previewKind?: WallpaperEasingPreviewKind
  summary?: ReactNode
  editorContent?: ReactNode
  previewConfig?: WallpaperEasingPreviewConfig
  onChange: (value: WallpaperAnimationEasing) => void
}


export function WallpaperEasingPicker({ value, fallbackPreset = 'easeOutCubic', previewKind = 'transition', summary, editorContent, previewConfig, onChange }: WallpaperEasingPickerProps) {
  const { t } = useI18n()
  const normalizedValue = normalizeWallpaperAnimationEasing(value, fallbackPreset)
  const isCustom = normalizedValue.startsWith('cubic-bezier(') || normalizedValue.startsWith('linear(')
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'preset' | 'custom'>(isCustom ? 'custom' : 'preset')
  const [draftPresetEasing, setDraftPresetEasing] = useState<WallpaperAnimationEasing>(normalizedValue)
  const [customStops, setCustomStops] = useState<WallpaperEasingStopPoint[]>(() => getWallpaperEditableEasingStopPoints(normalizedValue, fallbackPreset))
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(() => getDefaultSelectedCustomPointIndex(getWallpaperEditableEasingStopPoints(normalizedValue, fallbackPreset)))
  const [presetName, setPresetName] = useState('')
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null)
  const [editingPresetName, setEditingPresetName] = useState('')
  const importInputRef = useRef<HTMLInputElement | null>(null)

  const {
    savedPresets,
    sortedSavedPresets,
    importExportMessage,
    importExportError,
    resetImportExportFeedback,
    reloadSavedPresets,
    savePreset,
    removePreset,
    renamePreset,
    togglePinnedPreset,
    exportPresets,
    importPresets,
  } = useWallpaperEasingPresetManager()

  const customEasing = useMemo(() => buildWallpaperLinearEasing(customStops), [customStops])
  const previewEasing = activeTab === 'custom' ? customEasing : draftPresetEasing
  const selectedPoint = selectedPointIndex === null ? null : customStops[selectedPointIndex] ?? null
  const matchingSavedPreset = useMemo(
    () => sortedSavedPresets.find((preset) => preset.easing === normalizedValue) ?? null,
    [normalizedValue, sortedSavedPresets],
  )
  const pickerLabel = matchingSavedPreset?.name ?? getWallpaperAnimationEasingLabel(normalizedValue)

  const handleCustomStopsChange = (nextPoints: WallpaperEasingStopPoint[]) => {
    setCustomStops(nextPoints)
    setSelectedPointIndex((current) => getNormalizedSelectedCustomPointIndex(current, nextPoints))
  }

  const updateCustomPoint = (index: number, axis: 'x' | 'y', nextValue: string) => {
    const parsed = Number(nextValue)
    if (!Number.isFinite(parsed)) {
      return
    }

    const nextPoints = customStops.map((point, pointIndex) => {
      if (pointIndex !== index) {
        return point
      }

      if (axis === 'x') {
        if (pointIndex === 0 || pointIndex === customStops.length - 1) {
          return point
        }

        const previousPoint = customStops[pointIndex - 1]
        const nextPoint = customStops[pointIndex + 1]
        return {
          ...point,
          x: Math.min((nextPoint?.x ?? 1) - 0.02, Math.max((previousPoint?.x ?? 0) + 0.02, clampWallpaperEasingStopPointValue('x', parsed))),
        }
      }

      return {
        ...point,
        y: clampWallpaperEasingStopPointValue('y', parsed),
      }
    })

    handleCustomStopsChange(nextPoints)
    setSelectedPointIndex(index)
  }

  const handleRemoveCustomPoint = (index: number) => {
    const nextPoints = customStops.filter((_, pointIndex) => pointIndex !== index)
    handleCustomStopsChange(nextPoints)
    setSelectedPointIndex((current) => getNormalizedSelectedCustomPointIndex(current === null ? null : Math.min(current, index), nextPoints))
  }

  const handleDuplicateSelectedPoint = () => {
    if (selectedPointIndex === null || selectedPointIndex <= 0 || selectedPointIndex >= customStops.length - 1) {
      return
    }

    const currentPoint = customStops[selectedPointIndex]
    const nextPoint = customStops[selectedPointIndex + 1]
    const previousPoint = customStops[selectedPointIndex - 1]
    const duplicateRightX = (currentPoint.x + nextPoint.x) / 2
    const duplicateLeftX = (previousPoint.x + currentPoint.x) / 2
    const useRightSide = (nextPoint.x - currentPoint.x) >= (currentPoint.x - previousPoint.x)
    const insertIndex = useRightSide ? selectedPointIndex + 1 : selectedPointIndex
    const insertedPoint = {
      x: useRightSide ? duplicateRightX : duplicateLeftX,
      y: currentPoint.y,
    }
    const nextPoints = [
      ...customStops.slice(0, insertIndex),
      insertedPoint,
      ...customStops.slice(insertIndex),
    ]

    handleCustomStopsChange(nextPoints)
    setSelectedPointIndex(insertIndex)
  }

  const handleSplitSelectedSegment = () => {
    if (selectedPointIndex === null || selectedPointIndex <= 0 || selectedPointIndex >= customStops.length - 1) {
      return
    }

    const currentPoint = customStops[selectedPointIndex]
    const nextPoint = customStops[selectedPointIndex + 1]
    const previousPoint = customStops[selectedPointIndex - 1]
    const rightGap = nextPoint.x - currentPoint.x
    const leftGap = currentPoint.x - previousPoint.x
    const splitLeftSide = leftGap > rightGap
    const segmentStart = splitLeftSide ? previousPoint : currentPoint
    const segmentEnd = splitLeftSide ? currentPoint : nextPoint
    const insertIndex = splitLeftSide ? selectedPointIndex : selectedPointIndex + 1
    const insertedPoint = {
      x: (segmentStart.x + segmentEnd.x) / 2,
      y: (segmentStart.y + segmentEnd.y) / 2,
    }
    const nextPoints = [
      ...customStops.slice(0, insertIndex),
      insertedPoint,
      ...customStops.slice(insertIndex),
    ]

    handleCustomStopsChange(nextPoints)
    setSelectedPointIndex(insertIndex)
  }

  const handleNudgeSelectedPoint = (axis: 'x' | 'y', direction: -1 | 1, accelerated = false) => {
    if (selectedPointIndex === null || !selectedPoint) {
      return
    }

    const step = axis === 'x'
      ? accelerated ? 0.05 : 0.01
      : accelerated ? 0.1 : 0.01

    updateCustomPoint(selectedPointIndex, axis, String(selectedPoint[axis] + (direction * step)))
  }

  const handleSelectedPointKeyDown = (event: ReactKeyboardEvent<HTMLElement>, index: number) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      setSelectedPointIndex(index)
      return
    }

    if (event.key === 'Backspace' || event.key === 'Delete') {
      if (index > 0 && index < customStops.length - 1) {
        event.preventDefault()
        handleRemoveCustomPoint(index)
      }
      return
    }

    if (selectedPointIndex !== index) {
      return
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      handleNudgeSelectedPoint('x', -1, event.shiftKey)
    }
    else if (event.key === 'ArrowRight') {
      event.preventDefault()
      handleNudgeSelectedPoint('x', 1, event.shiftKey)
    }
    else if (event.key === 'ArrowUp') {
      event.preventDefault()
      handleNudgeSelectedPoint('y', 1, event.shiftKey)
    }
    else if (event.key === 'ArrowDown') {
      event.preventDefault()
      handleNudgeSelectedPoint('y', -1, event.shiftKey)
    }
  }

  const handleOpenPicker = () => {
    setActiveTab(isCustom ? 'custom' : 'preset')
    setDraftPresetEasing(normalizedValue)
    const nextPoints = getWallpaperEditableEasingStopPoints(normalizedValue, fallbackPreset)
    setCustomStops(nextPoints)
    setSelectedPointIndex(getDefaultSelectedCustomPointIndex(nextPoints))
    setPresetName(matchingSavedPreset?.name ?? '')
    reloadSavedPresets()
    setEditingPresetId(null)
    setEditingPresetName('')
    resetImportExportFeedback()
    setOpen(true)
  }

  const handleSavePreset = () => {
    if (!savePreset(presetName, customEasing)) {
      return
    }

    setPresetName('')
  }

  const handleRemovePreset = (presetId: string) => {
    removePreset(presetId)

    if (editingPresetId === presetId) {
      setEditingPresetId(null)
      setEditingPresetName('')
    }
  }

  const handleStartEditingPreset = (preset: WallpaperSavedEasingPreset) => {
    setEditingPresetId(preset.id)
    setEditingPresetName(preset.name)
  }

  const handleCancelEditingPreset = () => {
    setEditingPresetId(null)
    setEditingPresetName('')
  }

  const handleRenamePreset = (presetId: string) => {
    if (!renamePreset(presetId, editingPresetName)) {
      return
    }

    setEditingPresetId(null)
    setEditingPresetName('')
  }

  const handleImportPresets = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    await importPresets(file)
    event.target.value = ''
  }

  const handleSelectPreset = (easing: WallpaperAnimationEasing) => {
    setDraftPresetEasing(easing)
    const nextPoints = getWallpaperEditableEasingStopPoints(easing, fallbackPreset)
    setCustomStops(nextPoints)
    setSelectedPointIndex(getDefaultSelectedCustomPointIndex(nextPoints))
  }

  const handleApplySelection = () => {
    onChange(activeTab === 'custom' ? customEasing : draftPresetEasing)
    setOpen(false)
  }

  return (
    <>
      <button type="button" className="block w-full text-left" onClick={handleOpenPicker}>
        <WallpaperEasingPreviewCard
          label={pickerLabel}
          description={summary}
          easing={normalizedValue}
          selected={false}
          interactive={false}
          className="hover:border-primary/50 hover:bg-surface-high"
        />
      </button>

      <SettingsModal
        open={open}
        onClose={() => setOpen(false)}
        title={t({ ko: '이징 설정', en: 'Easing settings' })}
        widthClassName="max-w-6xl"
      >
        <div className="space-y-4">
          <SegmentedTabBar
            value={activeTab}
            onChange={(nextValue) => setActiveTab(nextValue as 'preset' | 'custom')}
            size="sm"
            items={[
              { value: 'preset', label: t({ ko: '프리셋', en: 'Preset' }) },
              { value: 'custom', label: t({ ko: '커스텀', en: 'Custom' }) },
            ]}
          />

          {activeTab === 'preset' ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_320px]">
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {WALLPAPER_ANIMATION_EASING_OPTIONS.map((option) => (
                    <WallpaperEasingPreviewCard
                      key={option.value}
                      label={option.label}
                      easing={option.value}
                      selected={draftPresetEasing === option.value}
                      onSelect={() => handleSelectPreset(option.value)}
                    />
                  ))}
                </div>

                <WallpaperSavedEasingPresetsSection
                  importInputRef={importInputRef}
                  savedPresets={savedPresets}
                  sortedSavedPresets={sortedSavedPresets}
                  selectedEasing={draftPresetEasing}
                  editingPresetId={editingPresetId}
                  editingPresetName={editingPresetName}
                  importExportMessage={importExportMessage}
                  importExportError={importExportError}
                  onImportPresets={handleImportPresets}
                  onExportPresets={exportPresets}
                  onStartEditingPreset={handleStartEditingPreset}
                  onEditingPresetNameChange={setEditingPresetName}
                  onCancelEditingPreset={handleCancelEditingPreset}
                  onRenamePreset={handleRenamePreset}
                  onTogglePinnedPreset={togglePinnedPreset}
                  onRemovePreset={handleRemovePreset}
                  onSelectPreset={handleSelectPreset}
                />
              </div>

              <WallpaperEasingPreviewPanel
                previewKind={previewKind}
                easing={previewEasing}
                config={previewConfig}
                editorContent={editorContent}
              />
            </div>
          ) : (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_380px]">
              <div className="space-y-4">
                <WallpaperEasingGraph
                  value={customStops}
                  onChange={handleCustomStopsChange}
                  selectedIndex={selectedPointIndex}
                  onSelectIndex={setSelectedPointIndex}
                />
                <div className="rounded-sm border border-border/70 bg-surface-low px-3 py-2 text-xs text-muted-foreground">
                  {t({ ko: '점을 클릭하면 아래 값이 같이 선택되고, 숫자는 좌우 드래그로도 조절돼. 선택된 점은 방향키로 미세 조정할 수 있어.', en: 'Click a point to select its values below. You can also drag left and right on the numbers, and fine-tune the selected point with the arrow keys.' })}
                </div>
                {selectedPointIndex !== null && selectedPointIndex > 0 && selectedPointIndex < customStops.length - 1 ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-sm border border-border/70 bg-surface-low px-3 py-2">
                    <div className="mr-2 text-xs text-muted-foreground">{t({ ko: `선택된 점 ${selectedPointIndex}`, en: `Selected point ${selectedPointIndex}` })}</div>
                    <Button type="button" size="xs" variant="secondary" onClick={handleDuplicateSelectedPoint}>
                      {t({ ko: '복제', en: 'Duplicate' })}
                    </Button>
                    <Button type="button" size="xs" variant="secondary" onClick={handleSplitSelectedSegment}>
                      {t({ ko: '구간 분할', en: 'Split segment' })}
                    </Button>
                    <Button type="button" size="xs" variant="ghost" onClick={() => handleRemoveCustomPoint(selectedPointIndex)}>
                      {t({ ko: '삭제', en: 'Delete' })}
                    </Button>
                  </div>
                ) : null}
                <div className="space-y-2">
                  {customStops.map((point, index) => {
                    const isEndpoint = index === 0 || index === customStops.length - 1
                    const isSelected = selectedPointIndex === index
                    const pointLabel = index === 0
                      ? t({ ko: '시작', en: 'Start' })
                      : index === customStops.length - 1
                        ? t({ ko: '끝', en: 'End' })
                        : t({ ko: `점 ${index}`, en: `Point ${index}` })

                    return (
                      <div
                        key={`${index}-${point.x}-${point.y}`}
                        role="button"
                        tabIndex={0}
                        className={cn(
                          'grid w-full gap-2 rounded-sm border p-3 text-left transition sm:grid-cols-[minmax(0,120px)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end',
                          isSelected
                            ? 'border-primary bg-[color-mix(in_srgb,var(--primary)_10%,var(--surface-low))]'
                            : 'border-border/70 bg-surface-low hover:border-primary/40 hover:bg-surface-high',
                        )}
                        onClick={() => setSelectedPointIndex(index)}
                        onKeyDown={(event) => handleSelectedPointKeyDown(event, index)}
                        onContextMenu={(event) => {
                          if (isEndpoint) {
                            return
                          }

                          event.preventDefault()
                          setSelectedPointIndex(index)
                          handleRemoveCustomPoint(index)
                        }}
                      >
                        <div className="text-sm font-medium text-foreground">{pointLabel}</div>
                        <SettingsField label={t({ ko: '시간 X', en: 'Time X' })}>
                          <ScrubbableNumberInput
                            variant="settings"
                            step={0.01}
                            min={0}
                            max={1}
                            value={formatWallpaperEasingGraphPointValue(point.x)}
                            disabled={isEndpoint}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(nextValue) => updateCustomPoint(index, 'x', nextValue)}
                          />
                        </SettingsField>
                        <SettingsField label={t({ ko: '값 Y', en: 'Value Y' })}>
                          <ScrubbableNumberInput
                            variant="settings"
                            step={0.01}
                            min={-3}
                            max={3}
                            value={formatWallpaperEasingGraphPointValue(point.y)}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(nextValue) => updateCustomPoint(index, 'y', nextValue)}
                          />
                        </SettingsField>
                        {!isEndpoint ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={(event) => {
                              event.stopPropagation()
                              handleRemoveCustomPoint(index)
                            }}
                            title={t({ ko: `${pointLabel} 삭제`, en: `Delete ${pointLabel}` })}
                            aria-label={t({ ko: `${pointLabel} 삭제`, en: `Delete ${pointLabel}` })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        ) : <div />}
                      </div>
                    )
                  })}
                </div>
              </div>

              <WallpaperEasingPreviewPanel
                previewKind={previewKind}
                easing={previewEasing}
                config={previewConfig}
                editorContent={editorContent}
                extraContent={(
                  <>
                    <div className="theme-settings-panel rounded-sm bg-surface-container p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t({ ko: '현재 커스텀 곡선', en: 'Current custom curve' })}</div>
                      <div className="rounded-sm border border-border/70 bg-background px-3 py-2">
                        <WallpaperEasingGraphPreview easing={customEasing} className="h-16 w-full" />
                      </div>
                      <div className="mt-3 rounded-sm border border-border/70 bg-background px-3 py-2 font-mono text-xs text-foreground break-all">
                        {customEasing}
                      </div>
                    </div>

                    <div className="theme-settings-panel rounded-sm bg-surface-container p-3">
                      <SettingsField label={t({ ko: '프리셋으로 저장', en: 'Save as preset' })} className="gap-2">
                        <div className="flex gap-2">
                          <Input
                            variant="settings"
                            placeholder={t({ ko: '예: 부드러운 진입', en: 'e.g. Smooth intro' })}
                            value={presetName}
                            onChange={(event) => setPresetName(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                handleSavePreset()
                              }
                            }}
                          />
                          <Button type="button" onClick={handleSavePreset} disabled={!presetName.trim()}>
                            <Save className="h-4 w-4" />
                            {t({ ko: '프리셋 저장', en: 'Save preset' })}
                          </Button>
                        </div>
                      </SettingsField>
                    </div>

                  </>
                )}
              />
            </div>
          )}

          <SettingsModalFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t({ ko: '취소', en: 'Cancel' })}
            </Button>
            <Button type="button" onClick={handleApplySelection}>
              {t({ ko: '저장', en: 'Save' })}
            </Button>
          </SettingsModalFooter>
        </div>
      </SettingsModal>
    </>
  )
}
