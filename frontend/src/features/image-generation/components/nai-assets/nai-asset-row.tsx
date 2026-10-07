import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import type { ReactNode } from 'react'
import { ImageIcon, ImagePlus, MoreHorizontal, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/i18n'
import type { SelectedImageDraft } from '../../image-generation-shared'

type NaiAssetRowProps = {
  image?: SelectedImageDraft
  title: string
  /** Second line under the title: status badge or an inline type picker. */
  meta?: ReactNode
  strength: string
  strengthMin: number
  onStrengthCommit: (value: string) => void
  /** Settings shown at the top of the row menu (information extracted, fidelity, raw encoding). */
  menuFields?: ReactNode
  onReplaceImage: () => void
  onSave?: () => void
  saveDisabled?: boolean
  saveTitle?: string
  onRemove: () => void
}

/** One compact vibe/reference row: thumbnail, name + status, strength, and a menu for the rest. */
export function NaiAssetRow({
  image,
  title,
  meta,
  strength,
  strengthMin,
  onStrengthCommit,
  menuFields,
  onReplaceImage,
  onSave,
  saveDisabled = false,
  saveTitle,
  onRemove,
}: NaiAssetRowProps) {
  const { t } = useI18n()
  const { canUpdateWorkflows } = useFeaturePermissions()
  const { canViewImages } = useImagePermissions()
  const strengthLabel = t({ ko: '강도', en: 'Strength' })

  return (
    <div className="flex items-center gap-3 py-2">
      {image ? (
        <img src={image.dataUrl} alt="" className="size-11 shrink-0 rounded-sm bg-checker object-cover" />
      ) : (
        <div className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-field text-muted-foreground">
          <ImageIcon className="size-4" />
        </div>
      )}

      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="truncate text-sm font-medium" title={title}>{title}</div>
        {meta ? <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">{meta}</div> : null}
      </div>

      <NumberStepperInput
        aria-label={strengthLabel}
        title={strengthLabel}
        min={strengthMin}
        max={1}
        step={0.01}
        value={strength}
        onValueCommit={onStrengthCommit}
        className="w-32 min-w-0 shrink-0"
      />

      <Popover>
        <PopoverTrigger asChild>
          <IconButton size="icon-sm" variant="ghost" label={t({ ko: '더 보기', en: 'More' })}>
            <MoreHorizontal />
          </IconButton>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 space-y-3 p-3">
          {menuFields ? <div className="space-y-3">{menuFields}</div> : null}
          <div className="-mx-1 grid">
            <PopoverClose asChild>
              <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={onReplaceImage}>
                <ImagePlus />
                {t({ ko: '이미지 교체', en: 'Replace image' })}
              </Button>
            </PopoverClose>
            {onSave ? (
              <PopoverClose asChild>
                <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={onSave} disabled={!canUpdateWorkflows || !canViewImages || saveDisabled} title={saveTitle}>
                  <Save />
                  {t({ ko: '라이브러리에 저장', en: 'Save to library' })}
                </Button>
              </PopoverClose>
            ) : null}
            <PopoverClose asChild>
              <Button type="button" variant="ghost" size="sm" className="justify-start text-destructive hover:text-destructive" onClick={onRemove}>
                <Trash2 />
                {t('image-generation.components.nai.common.remove')}
              </Button>
            </PopoverClose>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
