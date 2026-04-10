import { useMemo, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import { Check, ChevronRight, Download, Pencil, Pin, Save, Sparkles, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
  WallpaperEasingPreviewPanel,
  type WallpaperEasingPreviewKind,
} from './wallpaper-easing-picker-preview'
import {
  WALLPAPER_ANIMATION_EASING_OPTIONS,
  buildWallpaperCubicBezierEasing,
  getWallpaperAnimationEasingCss,
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

// Render the saved preset section for the preset tab.
function WallpaperSavedEasingPresetsSection({
  importInputRef,
  savedPresets,
  sortedSavedPresets,
  normalizedValue,
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
  normalizedValue: WallpaperAnimationEasing
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
    <div className="rounded-sm border border-border bg-surface-low p-3">
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={onImportPresets}
      />
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">내 프리셋</div>
          <div className="text-xs text-muted-foreground">커스텀 탭에서 저장한 이징을 여기서 다시 바로 쓸 수 있어.</div>
        </div>
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
        <div className="mb-3 rounded-sm border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary">
          {importExportMessage}
        </div>
      ) : null}

      {importExportError ? (
        <div className="mb-3 rounded-sm border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {importExportError}
        </div>
      ) : null}

      {savedPresets.length > 0 ? (
        <div className="space-y-2">
          {sortedSavedPresets.map((preset) => {
            const isEditing = editingPresetId === preset.id
            const isDuplicateName = editingPresetName.trim().length > 0 && savedPresets.some((candidate) => candidate.id !== preset.id && candidate.name === editingPresetName.trim())

            return (
              <div key={preset.id} className="flex items-center gap-2 rounded-sm border border-border/70 bg-background p-2">
                {isEditing ? (
                  <div className="min-w-0 flex-1 space-y-2 rounded-sm px-2 py-2">
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
                    />
                    <div className="truncate text-[11px] text-muted-foreground">{preset.easing}</div>
                    {isDuplicateName ? (
                      <div className="text-[11px] text-destructive">같은 이름의 프리셋이 이미 있어.</div>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    className={cn(
                      'min-w-0 flex-1 rounded-sm px-2 py-2 text-left transition hover:bg-surface-low',
                      normalizedValue === preset.easing ? 'bg-[color-mix(in_srgb,var(--primary)_10%,var(--surface-low))]' : '',
                    )}
                    onClick={() => onSelectPreset(preset.easing)}
                  >
                    <div className="flex items-center gap-2">
                      <div className="truncate text-sm font-medium text-foreground">{preset.name}</div>
                      {preset.pinned ? (
                        <span className="rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">고정</span>
                      ) : null}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">{preset.easing}</div>
                  </button>
                )}

                {isEditing ? (
                  <>
                    <Button type="button" size="icon-xs" variant="ghost" onClick={() => onRenamePreset(preset.id)} disabled={!editingPresetName.trim() || isDuplicateName} title="이름 저장" aria-label="이름 저장">
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="icon-xs" variant="ghost" onClick={onCancelEditingPreset} title="이름 편집 취소" aria-label="이름 편집 취소">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <Button type="button" size="icon-xs" variant="ghost" onClick={() => onStartEditingPreset(preset)} title="이름 편집" aria-label="이름 편집">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}

                <Button
                  type="button"
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => onTogglePinnedPreset(preset.id)}
                  title={preset.pinned ? '고정 해제' : '위로 고정'}
                  aria-label={preset.pinned ? '고정 해제' : '위로 고정'}
                  className={preset.pinned ? 'text-primary' : ''}
                >
                  <Pin className="h-3.5 w-3.5" />
                </Button>

                <Button type="button" size="icon-xs" variant="ghost" onClick={() => onRemovePreset(preset.id)} title="프리셋 삭제" aria-label="프리셋 삭제">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
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
  const previewEasing = activeTab === 'custom' ? customEasing : normalizedValue
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
    onChange(easing)
    setOpen(false)
  }

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        className="w-full justify-between"
        onClick={handleOpenPicker}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 text-secondary" />
          <span className="truncate">{pickerLabel}</span>
        </span>
        <ChevronRight className="h-4 w-4 opacity-70" />
      </Button>

      <SettingsModal
        open={open}
        onClose={() => setOpen(false)}
        title="이징 설정"
        description="프리셋은 바로 적용하고, 커스텀은 그래프를 직접 만져서 cubic-bezier를 만들 수 있어."
        widthClassName="max-w-6xl"
      >
        <div className="space-y-4">
          <div className="inline-flex rounded-sm border border-border bg-surface-low p-1">
            <Button type="button" size="sm" variant={activeTab === 'preset' ? 'default' : 'ghost'} onClick={() => setActiveTab('preset')}>
              프리셋
            </Button>
            <Button type="button" size="sm" variant={activeTab === 'custom' ? 'default' : 'ghost'} onClick={() => setActiveTab('custom')}>
              커스텀
            </Button>
          </div>

          {activeTab === 'preset' ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_360px]">
              <div className="space-y-4">
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-2">
                  {WALLPAPER_ANIMATION_EASING_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleSelectPreset(option.value)}
                      className={cn(
                        'rounded-sm border p-3 text-left transition',
                        normalizedValue === option.value
                          ? 'border-primary bg-[color-mix(in_srgb,var(--primary)_10%,var(--surface-low))]'
                          : 'border-border bg-surface-low hover:border-primary/50 hover:bg-surface-high',
                      )}
                    >
                      <div className="text-sm font-medium text-foreground">{option.label}</div>
                      <div className="mt-1 text-xs text-muted-foreground break-all">{getWallpaperAnimationEasingCss(option.value)}</div>
                    </button>
                  ))}
                </div>

                <WallpaperSavedEasingPresetsSection
                  importInputRef={importInputRef}
                  savedPresets={savedPresets}
                  sortedSavedPresets={sortedSavedPresets}
                  normalizedValue={normalizedValue}
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
                extraContent={(
                  <div className="rounded-sm border border-border bg-surface-low p-3 text-xs leading-5 text-muted-foreground">
                    <div>프리셋은 바로 적용돼.</div>
                    <div>완전히 다른 감각을 만들고 싶으면 커스텀 탭에서 그래프를 직접 만지면 돼.</div>
                  </div>
                )}
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
                    <label key={key} className="space-y-1 text-xs text-muted-foreground">
                      <span>{label}</span>
                      <Input
                        variant="settings"
                        type="number"
                        step="0.01"
                        value={formatWallpaperEasingGraphPointValue(customPoints[key])}
                        onChange={(event) => updateCustomPoint(key, event.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </div>

              <WallpaperEasingPreviewPanel
                activePreviewKind={activePreviewKind}
                easing={previewEasing}
                onChangePreviewKind={setActivePreviewKind}
                extraContent={(
                  <>
                    <div className="rounded-sm border border-border bg-surface-low p-3">
                      <div className="mb-2 text-xs text-muted-foreground">현재 커스텀 값</div>
                      <div className="rounded-sm border border-border/70 bg-background px-3 py-2 font-mono text-xs text-foreground break-all">
                        {customEasing}
                      </div>
                    </div>

                    <div className="rounded-sm border border-border bg-surface-low p-3">
                      <div className="mb-2 text-xs text-muted-foreground">프리셋으로 저장</div>
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
                          저장
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-sm border border-border bg-surface-low p-3 text-xs leading-5 text-muted-foreground">
                      <div>X는 시간 흐름, Y는 진행 느낌이야.</div>
                      <div>위로 올리면 초반에 더 빨리 치고 나가고, 아래로 내리면 더 눌렀다가 나가.</div>
                      <div>`easeOutBounce` 같은 다중 튕김 계열은 프리셋으로 두고, 커스텀은 bezier 기반으로 다루는 게 안정적이야.</div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                        닫기
                      </Button>
                      <Button
                        type="button"
                        onClick={() => {
                          onChange(customEasing)
                          setOpen(false)
                        }}
                      >
                        커스텀 적용
                      </Button>
                    </div>
                  </>
                )}
              />
            </div>
          )}
        </div>
      </SettingsModal>
    </>
  )
}
