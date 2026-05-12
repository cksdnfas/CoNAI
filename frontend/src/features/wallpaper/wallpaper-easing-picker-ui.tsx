import type { ChangeEvent, ReactNode, RefObject } from 'react'
import { Check, Download, Pencil, Star, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { WallpaperAnimationEasing } from './wallpaper-types'
import {
  MAX_WALLPAPER_SAVED_EASING_PRESETS,
  type WallpaperSavedEasingPreset,
} from './wallpaper-easing-picker-presets'
import { WallpaperEasingGraphPreview } from './wallpaper-easing-picker-preview'

// Render the shared card body used by built-in and saved easing presets.
export function WallpaperEasingPreviewCard({
  label,
  easing,
  selected,
  onSelect,
  leading,
  actions,
  interactive = true,
  description,
  className,
}: {
  label: string
  easing: WallpaperAnimationEasing
  selected: boolean
  onSelect?: () => void
  leading?: ReactNode
  actions?: ReactNode
  interactive?: boolean
  description?: ReactNode
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
              {description ? <div className="mt-0.5 text-[11px] text-muted-foreground">{description}</div> : null}
            </button>
          ) : (
            <div className="min-w-0 flex-1">{titleContent}{description ? <div className="mt-0.5 text-[11px] text-muted-foreground">{description}</div> : null}</div>
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
export function WallpaperSavedEasingPresetsSection({
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
  const { t } = useI18n()

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
        <div className="text-sm font-medium text-foreground">{t({ ko: '내 프리셋', en: 'My presets' })}</div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={() => importInputRef.current?.click()}
            title={t({ ko: '프리셋 가져오기', en: 'Import presets' })}
            aria-label={t({ ko: '프리셋 가져오기', en: 'Import presets' })}
          >
            <Upload className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            onClick={onExportPresets}
            disabled={savedPresets.length === 0}
            title={t({ ko: '프리셋 내보내기', en: 'Export presets' })}
            aria-label={t({ ko: '프리셋 내보내기', en: 'Export presets' })}
          >
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
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => onRenamePreset(preset.id)}
                      disabled={!editingPresetName.trim() || isDuplicateName}
                      title={t({ ko: '이름 저장', en: 'Save name' })}
                      aria-label={t({ ko: '이름 저장', en: 'Save name' })}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      onClick={onCancelEditingPreset}
                      title={t({ ko: '이름 편집 취소', en: 'Cancel name edit' })}
                      aria-label={t({ ko: '이름 편집 취소', en: 'Cancel name edit' })}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="rounded-sm border border-border/70 bg-background/80 px-2 py-1.5">
                  <WallpaperEasingGraphPreview easing={preset.easing} className="h-11 w-full" />
                </div>
                {isDuplicateName ? (
                  <div className="mt-2 text-[11px] text-destructive">{t({ ko: '같은 이름의 프리셋이 이미 있어.', en: 'A preset with the same name already exists.' })}</div>
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
                    title={preset.pinned ? t({ ko: '고정 해제', en: 'Unpin' }) : t({ ko: '고정', en: 'Pin' })}
                    aria-label={preset.pinned ? t({ ko: '고정 해제', en: 'Unpin' }) : t({ ko: '고정', en: 'Pin' })}
                    className={cn('h-6 w-6 p-0', preset.pinned ? 'text-primary' : 'text-muted-foreground')}
                  >
                    <Star className={cn('h-3.5 w-3.5', preset.pinned ? 'fill-current' : '')} />
                  </Button>
                )}
                actions={(
                  <>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => onStartEditingPreset(preset)}
                      title={t({ ko: '이름 편집', en: 'Edit name' })}
                      aria-label={t({ ko: '이름 편집', en: 'Edit name' })}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => onRemovePreset(preset.id)}
                      title={t({ ko: '프리셋 삭제', en: 'Delete preset' })}
                      aria-label={t({ ko: '프리셋 삭제', en: 'Delete preset' })}
                    >
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
          {t({ ko: '아직 저장한 커스텀 프리셋이 없어.', en: 'There are no saved custom presets yet.' })}
        </div>
      )}
    </div>
  )
}
