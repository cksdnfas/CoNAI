import { Button } from '@/components/ui/button'
import type { SelectedImageDraft } from '../image-generation-shared'

export interface NaiSelectedImageCardProps {
  image: SelectedImageDraft
  alt: string
  onRemove: () => void
}

/** Render a compact selected-image preview card for NAI image inputs and assets. */
export function NaiSelectedImageCard({ image, alt, onRemove }: NaiSelectedImageCardProps) {
  return (
    <div className="space-y-3 rounded-sm border border-border bg-surface-lowest p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{image.fileName}</div>
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
          제거
        </Button>
      </div>
      <div className="flex justify-center rounded-sm border border-border bg-surface-low p-3">
        <img src={image.dataUrl} alt={alt} className="max-h-56 w-full rounded-sm object-contain" />
      </div>
    </div>
  )
}
