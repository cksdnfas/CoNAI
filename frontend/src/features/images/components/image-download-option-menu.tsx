import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import type { ImageDownloadType } from '@/lib/api'
import { cn } from '@/lib/utils'

interface ImageDownloadOptionMenuProps {
  targetCount: number
  isDownloading?: boolean
  className?: string
  onSelect: (type: ImageDownloadType) => Promise<void> | void
}

/** Render a compact download option menu for original vs thumbnail. */
export function ImageDownloadOptionMenu({ targetCount, isDownloading = false, className, onSelect }: ImageDownloadOptionMenuProps) {
  const { t } = useI18n()
  const isBatch = targetCount > 1

  return (
    <div className={cn('min-w-[180px] p-1.5', className)} data-no-select-drag="true">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-start"
        onClick={() => void onSelect('original')}
        disabled={isDownloading}
        data-no-select-drag="true"
      >
        <Download className="h-4 w-4" />
        {isDownloading
          ? t('images.components.image.download.option.menu.preparing')
          : isBatch
            ? t('images.components.image.download.option.menu.original.download.zip')
            : t('images.components.image.download.option.menu.original.download')}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-start"
        onClick={() => void onSelect('thumbnail')}
        disabled={isDownloading}
        data-no-select-drag="true"
      >
        <Download className="h-4 w-4" />
        {isDownloading
          ? t('images.components.image.download.option.menu.preparing')
          : isBatch
            ? t('images.components.image.download.option.menu.thumbnails.download.zip')
            : t('images.components.image.download.option.menu.thumbnails.download')}
      </Button>
    </div>
  )
}
