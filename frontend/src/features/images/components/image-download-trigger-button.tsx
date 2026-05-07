import { useRef, useState, type ReactNode } from 'react'
import { Download } from 'lucide-react'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { downloadImageSelection, type ImageDownloadType } from '@/lib/api-images'
import { triggerBlobDownload } from '@/lib/api-client'
import { getErrorMessage } from '@/lib/error-message'
import type { ImageRecord } from '@/types/image'
import { getImageListMediaKind } from './image-list/image-list-utils'
import { getDownloadName, getImageDetailRenderUrl, loadImageDetailRenderMode } from './detail/image-detail-utils'
import { ImageDownloadOptionMenu } from './image-download-option-menu'

interface ImageDownloadTriggerButtonProps {
  image?: ImageRecord | null
  size?: 'default' | 'sm' | 'lg' | 'icon' | 'icon-sm'
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
  className?: string
  ariaLabel?: string
  title?: string
  children?: ReactNode
}

function getVisibleDownloadMode(image: ImageRecord): ImageDownloadType {
  const preferredMode = loadImageDetailRenderMode()
  if (preferredMode === 'original') {
    return image.image_url ? 'original' : 'thumbnail'
  }

  return image.thumbnail_url ? 'thumbnail' : 'original'
}

const IMAGE_PIXEL_PREVIEW_MODE_STORAGE_KEY = 'conai:image-detail-media:pixel-preview-enabled'

function getFilteredDownloadName(image: ImageRecord, mode: ImageDownloadType) {
  const downloadName = getDownloadName(image.original_file_path, image.composite_hash)
  const baseName = downloadName.replace(/\.[^/.]+$/, '') || (image.composite_hash ? String(image.composite_hash) : 'image')
  return `${baseName}-filtered-${mode}.png`
}

function hasActivePixelPreviewDownloadOption() {
  if (typeof window === 'undefined') {
    return false
  }

  const savedValue = window.localStorage.getItem(IMAGE_PIXEL_PREVIEW_MODE_STORAGE_KEY)
  return savedValue === 'soft' || savedValue === 'medium' || savedValue === 'strong' || savedValue === 'custom' || savedValue === 'true'
}

/** Render one download button that opens the global thumbnail/original choice modal. */
export function ImageDownloadTriggerButton({
  image,
  size = 'icon-sm',
  variant = 'default',
  className,
  ariaLabel,
  title,
  children,
}: ImageDownloadTriggerButtonProps) {
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const [isOpen, setIsOpen] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const containerRef = useRef<HTMLSpanElement | null>(null)
  const compositeHash = typeof image?.composite_hash === 'string' && image.composite_hash.length > 0 ? image.composite_hash : null
  const filteredDownloadMode = image && getImageListMediaKind(image) === 'image' && hasActivePixelPreviewDownloadOption() ? getVisibleDownloadMode(image) : null

  const handleSelect = async (type: 'thumbnail' | 'original') => {
    if (!compositeHash || isDownloading) {
      return
    }

    try {
      setIsDownloading(true)
      await downloadImageSelection([compositeHash], type)
      setIsOpen(false)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t('images.components.image.download.trigger.button.image.download.failed')), tone: 'error' })
    } finally {
      setIsDownloading(false)
    }
  }

  const handleFilteredSelect = async () => {
    if (!image || !compositeHash || isDownloading) {
      return
    }

    const { getActivePixelPreviewProfile, renderPixelPreviewPngBlob } = await import('./detail/image-detail-pixel-preview')
    const pixelPreviewProfile = getActivePixelPreviewProfile()
    if (!pixelPreviewProfile) {
      return
    }

    const visibleMode = getVisibleDownloadMode(image)
    const visibleRenderUrl = getImageDetailRenderUrl(image, visibleMode)
    if (!visibleRenderUrl) {
      return
    }

    try {
      setIsDownloading(true)
      const blob = await renderPixelPreviewPngBlob(visibleRenderUrl, pixelPreviewProfile)
      triggerBlobDownload(blob, getFilteredDownloadName(image, visibleMode))
      setIsOpen(false)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t('images.components.image.download.trigger.button.image.download.failed')), tone: 'error' })
    } finally {
      setIsDownloading(false)
    }
  }

  if (!compositeHash) {
    return null
  }

  return (
    <span ref={containerRef} className="relative inline-flex">
      <Button
        type="button"
        size={size}
        variant={variant}
        className={className}
        onClick={() => setIsOpen((current) => !current)}
        aria-label={ariaLabel ?? t('images.components.image.download.trigger.button.download')}
        title={title ?? t('images.components.image.download.trigger.button.download')}
        data-no-select-drag="true"
      >
        {children ?? <Download className="h-4 w-4" />}
      </Button>

      <AnchoredPopup open={isOpen} anchorRef={containerRef} onClose={() => setIsOpen(false)} align="end" side="bottom" closeOnBack>
        <ImageDownloadOptionMenu
          targetCount={1}
          isDownloading={isDownloading}
          filteredMode={filteredDownloadMode}
          onSelect={handleSelect}
          onSelectFiltered={handleFilteredSelect}
        />
      </AnchoredPopup>
    </span>
  )
}
