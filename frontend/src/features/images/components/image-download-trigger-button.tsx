import { useRef, useState, type ReactNode } from 'react'
import { Download } from 'lucide-react'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { downloadImageSelection, type ImageDownloadType } from '@/lib/api-images'
import { downloadGenerationHistorySelection } from '@/lib/api-image-generation-history'
import { prepareDownloadTarget, saveDownloadBlob } from '@/lib/download-utils'
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

/** Render one download button; videos download directly while images open the download option menu. */
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
  const generationHistoryId = typeof image?.generation_history_id === 'number' ? image.generation_history_id : null
  const mediaKind = image ? getImageListMediaKind(image) : null
  const isVideo = mediaKind === 'video'
  const filteredDownloadMode = image && mediaKind === 'image' && hasActivePixelPreviewDownloadOption() ? getVisibleDownloadMode(image) : null

  const handleSelect = async (type: 'thumbnail' | 'original') => {
    if (!compositeHash || isDownloading) {
      return
    }

    try {
      setIsDownloading(true)
      const originalName = getDownloadName(image?.original_file_path, compositeHash)
      const suggestedFileName = type === 'thumbnail'
        ? `${originalName.replace(/\.[^/.]+$/, '') || compositeHash}-thumbnail.webp`
        : originalName
      if (generationHistoryId) {
        await downloadGenerationHistorySelection([generationHistoryId], type, { suggestedFileName })
      } else {
        await downloadImageSelection([compositeHash], type, { suggestedFileName })
      }
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

    try {
      setIsDownloading(true)
      const visibleMode = getVisibleDownloadMode(image)
      const target = await prepareDownloadTarget(getFilteredDownloadName(image, visibleMode))
      if (!target) {
        return
      }

      const { getActivePixelPreviewProfile, renderPixelPreviewPngBlob } = await import('./detail/image-detail-pixel-preview')
      const pixelPreviewProfile = getActivePixelPreviewProfile()
      if (!pixelPreviewProfile) {
        return
      }

      const visibleRenderUrl = getImageDetailRenderUrl(image, visibleMode)
      if (!visibleRenderUrl) {
        return
      }

      const blob = await renderPixelPreviewPngBlob(visibleRenderUrl, pixelPreviewProfile)
      await saveDownloadBlob(target, blob, getFilteredDownloadName(image, visibleMode))
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
        onClick={() => {
          if (isVideo) {
            void handleSelect('original')
            return
          }

          setIsOpen((current) => !current)
        }}
        disabled={isDownloading}
        aria-label={ariaLabel ?? t('images.components.image.download.trigger.button.download')}
        title={title ?? t('images.components.image.download.trigger.button.download')}
        data-no-select-drag="true"
      >
        {children ?? <Download className="h-4 w-4" />}
      </Button>

      {!isVideo ? (
        <AnchoredPopup open={isOpen} anchorRef={containerRef} onClose={() => setIsOpen(false)} align="end" side="bottom" closeOnBack>
          <ImageDownloadOptionMenu
            targetCount={1}
            isDownloading={isDownloading}
            filteredMode={filteredDownloadMode}
            onSelect={handleSelect}
            onSelectFiltered={handleFilteredSelect}
          />
        </AnchoredPopup>
      ) : null}
    </span>
  )
}
