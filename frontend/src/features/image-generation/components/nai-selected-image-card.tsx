import type { SelectedImageDraft } from '../image-generation-shared'

export interface NaiSelectedImageCardProps {
  image: SelectedImageDraft
  alt: string
}

/** Render a compact selected-image preview for NAI image inputs and assets. */
export function NaiSelectedImageCard({ image, alt }: NaiSelectedImageCardProps) {
  return (
    <div className="space-y-2">
      <div className="truncate text-xs text-muted-foreground">{image.fileName}</div>
      <div className="flex justify-center rounded-sm border border-border bg-surface-lowest p-3">
        <img src={image.dataUrl} alt={alt} className="max-h-56 w-full rounded-sm object-contain" />
      </div>
    </div>
  )
}
