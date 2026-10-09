import { BrushCleaning, Combine, Eraser, Layers2, SquareDashed, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import type { ImageEditorCropRect } from './image-editor-types'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'

interface ImageEditorSessionActionsProps {
  canFlattenVisible: boolean
  canMergeVisible: boolean
  canClearActiveDrawLayer: boolean
  hasSelectionRect: boolean
  selectionRect: ImageEditorCropRect | null
  cropRect: ImageEditorCropRect | null
  saving: boolean
  loading: boolean
  canSave: boolean
  onMergeVisible: () => void
  onFlattenVisible: () => void
  onClearActiveDrawLayer: () => void
  onClearAllDrawLayers: () => void
  onClearSelection: () => void
  onSelectionRectFieldChange: (field: 'x' | 'y' | 'width' | 'height', value: number) => void
  onCropRectFieldChange: (field: 'x' | 'y' | 'width' | 'height', value: number) => void
  onCancelCrop: () => void
  onClose: () => void
  onSave: () => void
}

/** Render the session-level action panel for destructive or global editor actions. */
export function ImageEditorSessionActions({
  canFlattenVisible,
  canMergeVisible,
  canClearActiveDrawLayer,
  hasSelectionRect,
  selectionRect,
  cropRect,
  saving,
  loading,
  canSave,
  onMergeVisible,
  onFlattenVisible,
  onClearActiveDrawLayer,
  onClearAllDrawLayers,
  onClearSelection,
  onSelectionRectFieldChange,
  onCropRectFieldChange,
  onCancelCrop,
  onClose,
  onSave,
}: ImageEditorSessionActionsProps) {
  const { t } = useI18n()

  return (
    <section className="space-y-3 border-t border-line pt-4 xl:border-t-0 xl:pt-0">
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="flex flex-wrap items-center gap-1">
            <IconButton variant="ghost" size="icon-sm" onClick={onMergeVisible} disabled={!canMergeVisible} label={t({ ko: '보이는 레이어 병합', en: 'Merge visible' })}>
              <Combine className="h-4 w-4" />
            </IconButton>
            <IconButton variant="ghost" size="icon-sm" onClick={onFlattenVisible} disabled={!canFlattenVisible} label={t({ ko: '보이는 레이어 평탄화', en: 'Flatten visible' })}>
              <Layers2 className="h-4 w-4" />
            </IconButton>
            <IconButton variant="ghost" size="icon-sm" onClick={onClearActiveDrawLayer} disabled={!canClearActiveDrawLayer} label={t({ ko: '현재 드로우 레이어 지우기', en: 'Clear active draw layer' })}>
              <Eraser className="h-4 w-4" />
            </IconButton>
            <IconButton variant="ghost" size="icon-sm" onClick={onClearAllDrawLayers} label={t({ ko: '모든 드로우 레이어 지우기', en: 'Clear all draw layers' })}>
              <BrushCleaning className="h-4 w-4" />
            </IconButton>
            <IconButton variant="ghost" size="icon-sm" onClick={onClearSelection} disabled={!hasSelectionRect} label={t({ ko: '선택 해제', en: 'Clear selection' })}>
              <SquareDashed className="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        {selectionRect ? (
          <div className="space-y-2 border-t border-line pt-3" role="group" aria-label={t({ ko: '선택 범위', en: 'Selection bounds' })}>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1 text-xs text-muted-foreground">X<NumberStepperInput value={Math.round(selectionRect.x)} onValueCommit={(nextValue) => onSelectionRectFieldChange('x', Number(nextValue) || 0)} className="h-8" /></label>
              <label className="space-y-1 text-xs text-muted-foreground">Y<NumberStepperInput value={Math.round(selectionRect.y)} onValueCommit={(nextValue) => onSelectionRectFieldChange('y', Number(nextValue) || 0)} className="h-8" /></label>
              <label className="space-y-1 text-xs text-muted-foreground">W<NumberStepperInput min={1} value={Math.round(selectionRect.width)} onValueCommit={(nextValue) => onSelectionRectFieldChange('width', Number(nextValue) || 1)} className="h-8" /></label>
              <label className="space-y-1 text-xs text-muted-foreground">H<NumberStepperInput min={1} value={Math.round(selectionRect.height)} onValueCommit={(nextValue) => onSelectionRectFieldChange('height', Number(nextValue) || 1)} className="h-8" /></label>
            </div>
          </div>
        ) : null}

        {cropRect ? (
          <>
            <div className="space-y-2 border-t border-line pt-3" role="group" aria-label={t({ ko: '자르기 범위', en: 'Crop bounds' })}>
              <div className="flex items-center justify-end gap-2">
                <IconButton variant="ghost" size="icon-xs" onClick={onCancelCrop} label={t({ ko: '자르기 취소', en: 'Cancel crop' })}>
                  <X className="h-3.5 w-3.5" />
                </IconButton>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs text-muted-foreground">X<NumberStepperInput value={Math.round(cropRect.x)} onValueCommit={(nextValue) => onCropRectFieldChange('x', Number(nextValue) || 0)} className="h-8" /></label>
                <label className="space-y-1 text-xs text-muted-foreground">Y<NumberStepperInput value={Math.round(cropRect.y)} onValueCommit={(nextValue) => onCropRectFieldChange('y', Number(nextValue) || 0)} className="h-8" /></label>
                <label className="space-y-1 text-xs text-muted-foreground">W<NumberStepperInput min={1} value={Math.round(cropRect.width)} onValueCommit={(nextValue) => onCropRectFieldChange('width', Number(nextValue) || 1)} className="h-8" /></label>
                <label className="space-y-1 text-xs text-muted-foreground">H<NumberStepperInput min={1} value={Math.round(cropRect.height)} onValueCommit={(nextValue) => onCropRectFieldChange('height', Number(nextValue) || 1)} className="h-8" /></label>
              </div>
            </div>
          </>
        ) : null}
        {/* Below xl the modal layout pins these actions in a sticky footer instead. */}
        <div className="hidden justify-end gap-2 pt-2 xl:flex">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {t({ ko: '취소', en: 'Cancel' })}
          </Button>
          <Button type="button" onClick={onSave} disabled={!canSave || saving || loading}>
            {saving ? t({ ko: '저장 중…', en: 'Saving…' }) : t({ ko: '저장', en: 'Save' })}
          </Button>
        </div>
    </section>
  )
}
