import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import type { ImageDownloadType } from '@/lib/api-images'
import { cn } from '@/lib/utils'

interface ImageDownloadOptionMenuProps {
  targetCount: number
  isDownloading?: boolean
  filteredMode?: ImageDownloadType | null
  className?: string
  onSelect: (type: ImageDownloadType) => Promise<void> | void
  onSelectFiltered?: () => Promise<void> | void
}

/** Render a compact download option menu for original, thumbnail, and visible filtered exports. */
export function ImageDownloadOptionMenu({ targetCount, isDownloading = false, filteredMode, className, onSelect, onSelectFiltered }: ImageDownloadOptionMenuProps) {
  const { t } = useI18n()
  const isBatch = targetCount > 1
  const canDownloadFiltered = !isBatch && Boolean(filteredMode && onSelectFiltered)

  return (
    <div className={cn('min-w-[180px] p-1.5', className)} data-no-select-drag="true">
      {canDownloadFiltered ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          onClick={() => void onSelectFiltered?.()}
          disabled={isDownloading}
          data-no-select-drag="true"
        >
          <Download className="h-4 w-4" />
          {isDownloading
            ? t('images.components.image.download.option.menu.preparing')
            : filteredMode === 'original'
              ? t('images.components.image.download.option.menu.filtered.original.download')
              : t('images.components.image.download.option.menu.filtered.thumbnail.download')}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className={cn('w-full justify-start', canDownloadFiltered && 'mt-1 border-t border-border/70 pt-2')}
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
