import { useMemo, useRef, useState, type ChangeEvent, type ReactNode, type RefObject } from 'react'
import { Check, ChevronRight, Download, Pencil, Save, Star, Trash2, Upload, X } from 'lucide-react'
import { SegmentedTabBar } from '@/components/common/segmented-tab-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsField } from '@/features/settings/components/settings-primitives'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { cn } from '@/lib/utils'
import type { WallpaperAnimationEasing, WallpaperAnimationEasingPreset } from './wallpaper-types'
import {
  MAX_WALLPAPER_SAVED_EASING_PRESETS,
  type WallpaperSavedEasingPreset,
  useWallpaperEasingPresetManager,
} from './wallpaper-easing-picker-presets'
import {
  clampWallpaperBezierControlPointValue,
  formatWallpaperEasingGraphPointValue,
  WallpaperEasingGraph,
  WallpaperEasingGraphPreview,
  WallpaperEasingPreviewPanel,
  type WallpaperEasingPreviewKind,
} from './wallpaper-easing-picker-preview'
import {
  WALLPAPER_ANIMATION_EASING_OPTIONS,
  buildWallpaperCubicBezierEasing,
  getWallpaperAnimationEasingLabel,
  getWallpaperEditableBezierControlPoints,
  normalizeWallpaperAnimationEasing,
  type WallpaperBezierControlPoints,
} from './wallpaper-widget-utils'

interface WallpaperEasingPickerProps {
  value: WallpaperAnimationEasing | undefined
  fallbackPreset?: WallpaperAnimationEasingPreset
  previewKind?: WallpaperEasingPreviewKind
  onChange: (value: WallpaperAnimationEasing) => void
}

// Render the shared card body used by built-in and saved easing presets.
function WallpaperEasingPreviewCard({
  label,
  easing,
  selected,
  onSelect,
  leading,
  actions,
  interactive = true,
  className,
}: {
  label: string
  easing: WallpaperAnimationEasing
  selected: boolean
  onSelect?: () => void
  leading?: ReactNode
  actions?: ReactNode
  interactive?: boolean
  className?: string
}) {
  const cardClassName = cn(
    'rounded-sm border p-2.5 transition',
    selected
      ? 'border-primary bg-[color-mix(in_srgb,var(--primary)_10%,var(--surface-low))]'
      : 'border-border bg-surface-low',
    interactive && 'hover:border-primary/50 hover:bg-surface-high',
    className,
  )

  const titleContent = <div className="truncate text-sm font-medium text-foreground">{label}</div>
  const graphContent = <WallpaperEasingGraphPreview easing={easing} className="h-11 w-full" />

  return (
    <div className={cardClassName}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0 flex flex-1 items-center gap-1.5">
          {leading ? <div className="shrink-0">{leading}</div> : null}
          {interactive && onSelect ? (
            <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
              {titleContent}
            </button>
          ) : (
            <div className="min-w-0 flex-1">{titleContent}</div>
          )}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
      </div>

      {interactive && onSelect ? (
        <button type="button" onClick={onSelect} className="block w-full rounded-sm border border-border/70 bg-background/80 px-2 py-1.5 text-left">
          {graphContent}
        </button>
      ) : (
        <div className="rounded-sm border border-border/70 bg-background/80 px-2 py-1.5">
          {graphContent}
        </div>
      )}
    </div>
  )
}

// Render the saved preset section for the preset tab.
function WallpaperSavedEasingPresetsSection({
  importInputRef,
  savedPresets,
  sortedSavedPresets,
  selectedEasing,
  editingPresetId,
  editingPresetName,
  importExportMessage,
  importExportError,
  onImportPresets,
  onExportPresets,
  onStartEditingPreset,
  onEditingPresetNameChange,
  onCancelEditingPreset,
  onRenamePreset,
  onTogglePinnedPreset,
  onRemovePreset,
  onSelectPreset,
}: {
  importInputRef: RefObject<HTMLInputElement | null>
  savedPresets: WallpaperSavedEasingPreset[]
  sortedSavedPresets: WallpaperSavedEasingPreset[]
  selectedEasing: WallpaperAnimationEasing
  editingPresetId: string | null
  editingPresetName: string
  importExportMessage: string | null
  importExportError: string | null
  onImportPresets: (event: ChangeEvent<HTMLInputElement>) => void
  onExportPresets: () => void
  onStartEditingPreset: (preset: WallpaperSavedEasingPreset) => void
  onEditingPresetNameChange: (value: string) => void
  onCancelEditingPreset: () => void
  onRenamePreset: (presetId: string) => void
  onTogglePinnedPreset: (presetId: string) => void
  onRemovePreset: (presetId: string) => void
  onSelectPreset: (easing: WallpaperAnimationEasing) => void
}) {
  return (
    <div className="space-y-3 border-t border-border/70 pt-4">
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={onImportPresets}
      />
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-foreground">내 프리셋</div>
        <div className="flex items-center gap-2">
          <Button type="button" size="icon-xs" variant="ghost" onClick={() => importInputRef.current?.click()} title="프리셋 가져오기" aria-label="프리셋 가져오기">
            <Upload className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="icon-xs" variant="ghost" onClick={onExportPresets} disabled={savedPresets.length === 0} title="프리셋 내보내기" aria-label="프리셋 내보내기">
            <Download className="h-3.5 w-3.5" />
          </Button>
          <div className="text-xs text-muted-foreground">{savedPresets.length}/{MAX_WALLPAPER_SAVED_EASING_PRESETS}</div>
        </div>
      </div>

      {importExportMessage ? (
        <div className="rounded-sm border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
          {importExportMessage}
        </div>
      ) : null}

      {importExportError ? (
        <div className="rounded-sm border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {importExportError}
        </div>
      ) : null}

      {savedPresets.length > 0 ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {sortedSavedPresets.map((preset) => {
            const isEditing = editingPresetId === preset.id
            const isDuplicateName = editingPresetName.trim().length > 0 && savedPresets.some((candidate) => candidate.id !== preset.id && candidate.name === editingPresetName.trim())

            return isEditing ? (
              <div
                key={preset.id}
                className={cn(
                  'rounded-sm border p-2.5 transition',
                  selectedEasing === preset.easing
                    ? 'border-primary bg-[color-mix(in_srgb,var(--primary)_10%,var(--surface-low))]'
                    : 'border-border bg-surface-low',
                )}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <Input
                    variant="settings"
                    value={editingPresetName}
                    onChange={(event) => onEditingPresetNameChange(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && editingPresetName.trim() && !isDuplicateName) {
                        event.preventDefault()
                        onRenamePreset(preset.id)
                      }
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        onCancelEditingPreset()
                      }
                    }}
                    className="min-w-0 flex-1"
                  />
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button type="button" size="icon-xs" variant="ghost" onClick={() => onRenamePreset(preset.id)} disabled={!editingPresetName.trim() || isDuplicateName} title="이름 저장" aria-label="이름 저장">
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="icon-xs" variant="ghost" onClick={onCancelEditingPreset} title="이름 편집 취소" aria-label="이름 편집 취소">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="rounded-sm border border-border/70 bg-background/80 px-2 py-1.5">
                  <WallpaperEasingGraphPreview easing={preset.easing} className="h-11 w-full" />
                </div>
                {isDuplicateName ? (
                  <div className="mt-2 text-[11px] text-destructive">같은 이름의 프리셋이 이미 있어.</div>
                ) : null}
              </div>
            ) : (
              <WallpaperEasingPreviewCard
                key={preset.id}
                label={preset.name}
                easing={preset.easing}
                selected={selectedEasing === preset.easing}
                onSelect={() => onSelectPreset(preset.easing)}
                leading={(
                  <Button
                    type="button"
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => onTogglePinnedPreset(preset.id)}
                    title={preset.pinned ? '고정 해제' : '고정'}
                    aria-label={preset.pinned ? '고정 해제' : '고정'}
                    className={cn('h-6 w-6 p-0', preset.pinned ? 'text-primary' : 'text-muted-foreground')}
                  >
                    <Star className={cn('h-3.5 w-3.5', preset.pinned ? 'fill-current' : '')} />
                  </Button>
                )}
                actions={(
                  <>
                    <Button type="button" size="icon-xs" variant="ghost" onClick={() => onStartEditingPreset(preset)} title="이름 편집" aria-label="이름 편집">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="icon-xs" variant="ghost" onClick={() => onRemovePreset(preset.id)} title="프리셋 삭제" aria-label="프리셋 삭제">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              />
            )
          })}
        </div>
      ) : (
        <div className="rounded-sm border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
          아직 저장한 커스텀 프리셋이 없어.
        </div>
      )}
    </div>
  )
}

export function WallpaperEasingPicker({ value, fallbackPreset = 'easeOutCubic', previewKind = 'transition', onChange }: WallpaperEasingPickerProps) {
  const normalizedValue = normalizeWallpaperAnimationEasing(value, fallbackPreset)
  const isCustom = normalizedValue.startsWith('cubic-bezier(')
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'preset' | 'custom'>(isCustom ? 'custom' : 'preset')
  const [activePreviewKind, setActivePreviewKind] = useState<WallpaperEasingPreviewKind>(previewKind)
  const [draftPresetEasing, setDraftPresetEasing] = useState<WallpaperAnimationEasing>(normalizedValue)
  const [customPoints, setCustomPoints] = useState<WallpaperBezierControlPoints>(() => getWallpaperEditableBezierControlPoints(normalizedValue, fallbackPreset))
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

  const customEasing = useMemo(() => buildWallpaperCubicBezierEasing(customPoints), [customPoints])
  const previewEasing = activeTab === 'custom' ? customEasing : draftPresetEasing
  const matchingSavedPreset = useMemo(
    () => sortedSavedPresets.find((preset) => preset.easing === normalizedValue) ?? null,
    [normalizedValue, sortedSavedPresets],
  )
  const pickerLabel = matchingSavedPreset?.name ?? getWallpaperAnimationEasingLabel(normalizedValue)

  const updateCustomPoint = (key: keyof WallpaperBezierControlPoints, nextValue: string) => {
    const parsed = Number(nextValue)
    if (!Number.isFinite(parsed)) {
      return
    }

    setCustomPoints((current) => ({
      ...current,
      [key]: clampWallpaperBezierControlPointValue(key, parsed),
    }))
  }

  const handleOpenPicker = () => {
    setActiveTab(isCustom ? 'custom' : 'preset')
    setActivePreviewKind(previewKind)
    setDraftPresetEasing(normalizedValue)
    setCustomPoints(getWallpaperEditableBezierControlPoints(normalizedValue, fallbackPreset))
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
    setCustomPoints(getWallpaperEditableBezierControlPoints(easing, fallbackPreset))
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
          easing={normalizedValue}
          selected={false}
          interactive={false}
          className="hover:border-primary/50 hover:bg-surface-high"
        />
      </button>

      <SettingsModal
        open={open}
        onClose={() => setOpen(false)}
        title="이징 설정"
        widthClassName="max-w-6xl"
      >
        <div className="space-y-4">
          <SegmentedTabBar
            value={activeTab}
            onChange={(nextValue) => setActiveTab(nextValue as 'preset' | 'custom')}
            size="sm"
            items={[
              { value: 'preset', label: '프리셋' },
              { value: 'custom', label: '커스텀' },
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
                activePreviewKind={activePreviewKind}
                easing={previewEasing}
                onChangePreviewKind={setActivePreviewKind}
              />
            </div>
          ) : (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_380px]">
              <div className="space-y-4">
                <WallpaperEasingGraph value={customPoints} onChange={setCustomPoints} />
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {([
                    ['x1', 'X1'],
                    ['y1', 'Y1'],
                    ['x2', 'X2'],
                    ['y2', 'Y2'],
                  ] as const).map(([key, label]) => (
                    <SettingsField key={key} label={label}>
                      <Input
                        variant="settings"
                        type="number"
                        step="0.01"
                        value={formatWallpaperEasingGraphPointValue(customPoints[key])}
                        onChange={(event) => updateCustomPoint(key, event.target.value)}
                      />
                    </SettingsField>
                  ))}
                </div>
              </div>

              <WallpaperEasingPreviewPanel
                activePreviewKind={activePreviewKind}
                easing={previewEasing}
                onChangePreviewKind={setActivePreviewKind}
                extraContent={(
                  <>
                    <div className="theme-settings-panel rounded-sm bg-surface-container p-3">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">현재 커스텀 곡선</div>
                      <div className="rounded-sm border border-border/70 bg-background px-3 py-2">
                        <WallpaperEasingGraphPreview easing={customEasing} className="h-16 w-full" />
                      </div>
                      <div className="mt-3 rounded-sm border border-border/70 bg-background px-3 py-2 font-mono text-xs text-foreground break-all">
                        {customEasing}
                      </div>
                    </div>

                    <div className="theme-settings-panel rounded-sm bg-surface-container p-3">
                      <SettingsField label="프리셋으로 저장" className="gap-2">
                        <div className="flex gap-2">
                          <Input
                            variant="settings"
                            placeholder="예: 부드러운 진입"
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
                            프리셋 저장
                          </Button>
                        </div>
                      </SettingsField>
                    </div>

                  </>
                )}
              />
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button type="button" onClick={handleApplySelection}>
              저장
            </Button>
          </div>
        </div>
      </SettingsModal>
    </>
  )
}
