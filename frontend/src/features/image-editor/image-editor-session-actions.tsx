import { Crop, Minus, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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
    <Card>
      <CardContent className="space-y-3">
        <div className="border-b border-border/70 pb-4 text-sm font-semibold text-foreground">{t({ ko: '세션 작업', en: 'Session actions' })}</div>
        <Button type="button" variant="secondary" onClick={onMergeVisible} className="w-full justify-start" disabled={!canMergeVisible}>
          {t({ ko: '보이는 레이어 병합', en: 'Merge visible' })}
        </Button>
        <Button type="button" variant="secondary" onClick={onFlattenVisible} className="w-full justify-start" disabled={!canFlattenVisible}>
          {t({ ko: '보이는 레이어 평탄화', en: 'Flatten visible' })}
        </Button>
        <Button type="button" variant="secondary" onClick={onClearActiveDrawLayer} className="w-full justify-start" disabled={!canClearActiveDrawLayer}>
          <Minus className="h-4 w-4" /> {t({ ko: '현재 드로우 레이어 지우기', en: 'Clear active draw layer' })}
        </Button>
        <Button type="button" variant="secondary" onClick={onClearAllDrawLayers} className="w-full justify-start">
          <Minus className="h-4 w-4" /> {t({ ko: '모든 드로우 레이어 지우기', en: 'Clear all draw layers' })}
        </Button>
        <Button type="button" variant="secondary" onClick={onClearSelection} className="w-full justify-start" disabled={!hasSelectionRect}>
          <Square className="h-4 w-4" /> {t({ ko: '선택 해제', en: 'Clear selection' })}
        </Button>

        {selectionRect ? (
          <div className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
            <div className="text-xs font-medium text-foreground">{t({ ko: '선택 범위', en: 'Selection bounds' })}</div>
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
            <Button type="button" variant="secondary" onClick={onCancelCrop} className="w-full justify-start">
              <Crop className="h-4 w-4" /> {t({ ko: '자르기 취소', en: 'Cancel crop' })}
            </Button>

            <div className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
              <div className="text-xs font-medium text-foreground">{t({ ko: '자르기 범위', en: 'Crop bounds' })}</div>
              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1 text-xs text-muted-foreground">X<NumberStepperInput value={Math.round(cropRect.x)} onValueCommit={(nextValue) => onCropRectFieldChange('x', Number(nextValue) || 0)} className="h-8" /></label>
                <label className="space-y-1 text-xs text-muted-foreground">Y<NumberStepperInput value={Math.round(cropRect.y)} onValueCommit={(nextValue) => onCropRectFieldChange('y', Number(nextValue) || 0)} className="h-8" /></label>
                <label className="space-y-1 text-xs text-muted-foreground">W<NumberStepperInput min={1} value={Math.round(cropRect.width)} onValueCommit={(nextValue) => onCropRectFieldChange('width', Number(nextValue) || 1)} className="h-8" /></label>
                <label className="space-y-1 text-xs text-muted-foreground">H<NumberStepperInput min={1} value={Math.round(cropRect.height)} onValueCommit={(nextValue) => onCropRectFieldChange('height', Number(nextValue) || 1)} className="h-8" /></label>
              </div>
            </div>
          </>
        ) : null}
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>
            {t({ ko: '취소', en: 'Cancel' })}
          </Button>
          <Button type="button" className="flex-1" onClick={onSave} disabled={!canSave || saving || loading}>
            {saving ? t({ ko: '저장 중…', en: 'Saving…' }) : t({ ko: '저장', en: 'Save' })}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
