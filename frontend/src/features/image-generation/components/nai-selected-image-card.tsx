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
    <div className="theme-surface-nested space-y-2 rounded-sm border border-border p-3">
      <div className="text-xs text-muted-foreground">{image.fileName}</div>
      <img src={image.dataUrl} alt={alt} className="max-h-48 rounded-sm border border-border object-contain" />
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="ghost" onClick={onRemove}>
          제거
        </Button>
      </div>
    </div>
  )
}
