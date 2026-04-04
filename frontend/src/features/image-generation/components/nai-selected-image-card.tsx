import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
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
      <InlineMediaPreview
        src={image.dataUrl}
        mimeType={image.mimeType}
        fileName={image.fileName}
        alt={alt}
        frameClassName="p-3"
        mediaClassName="max-h-56 w-full object-contain"
      />
    </div>
  )
}
