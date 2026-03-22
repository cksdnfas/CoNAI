import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { ImageRecord } from '@/types/image'
import { formatBytes } from './image-detail-utils'

interface ImageDetailMetaCardProps {
  image: ImageRecord
}

export function ImageDetailMetaCard({ image }: ImageDetailMetaCardProps) {
  return (
    <Card className="bg-surface-container">
      <CardContent className="space-y-3 p-6 text-sm text-muted-foreground">
        {image.is_processing ? (
          <div className="flex items-center justify-end">
            <Badge variant="secondary">Processing</Badge>
          </div>
        ) : null}

        <div className="rounded-sm bg-surface-high p-4">
          <p className="text-[11px] uppercase tracking-[0.18em]">Composite hash</p>
          <p className="mt-2 break-all font-mono text-foreground">{image.composite_hash || '—'}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-sm bg-surface-high p-4">
            <p className="text-[11px] uppercase tracking-[0.18em]">Dimensions</p>
            <p className="mt-2 text-foreground">{image.width && image.height ? `${image.width} × ${image.height}` : '—'}</p>
          </div>
          <div className="rounded-sm bg-surface-high p-4">
            <p className="text-[11px] uppercase tracking-[0.18em]">File size</p>
            <p className="mt-2 text-foreground">{formatBytes(image.file_size)}</p>
          </div>
          {image.ai_metadata?.model_name ? (
            <div className="rounded-sm bg-surface-high p-4 sm:col-span-2">
              <p className="text-[11px] uppercase tracking-[0.18em]">Model</p>
              <p className="mt-2 text-foreground">{image.ai_metadata.model_name}</p>
            </div>
          ) : null}
          {image.original_file_path ? (
            <div className="rounded-sm bg-surface-high p-4 sm:col-span-2">
              <p className="text-[11px] uppercase tracking-[0.18em]">Path</p>
              <p className="mt-2 break-all font-mono text-xs text-foreground/88">{image.original_file_path}</p>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
