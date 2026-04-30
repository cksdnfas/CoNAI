import { useRef, useState, type ReactNode } from 'react'
import { Download } from 'lucide-react'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { downloadImageSelection } from '@/lib/api'
import type { ImageRecord } from '@/types/image'
import { getErrorMessage } from '@/features/image-generation/image-generation-shared'
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
          onSelect={handleSelect}
        />
      </AnchoredPopup>
    </span>
  )
}
