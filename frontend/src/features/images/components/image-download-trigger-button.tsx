import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
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
  ariaLabel = '다운로드',
  title = '다운로드',
  children,
}: ImageDownloadTriggerButtonProps) {
  const { showSnackbar } = useSnackbar()
  const [isOpen, setIsOpen] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const containerRef = useRef<HTMLSpanElement | null>(null)
  const compositeHash = typeof image?.composite_hash === 'string' && image.composite_hash.length > 0 ? image.composite_hash : null

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const handleSelect = async (type: 'thumbnail' | 'original') => {
    if (!compositeHash || isDownloading) {
      return
    }

    try {
      setIsDownloading(true)
      await downloadImageSelection([compositeHash], type)
      setIsOpen(false)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '이미지 다운로드에 실패했어.'), tone: 'error' })
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
        aria-label={ariaLabel}
        title={title}
        data-no-select-drag="true"
      >
        {children ?? <Download className="h-4 w-4" />}
      </Button>

      {isOpen ? (
        <ImageDownloadOptionMenu
          targetCount={1}
          isDownloading={isDownloading}
          className="absolute right-0 top-full z-[140] mt-2"
          onSelect={handleSelect}
        />
      ) : null}
    </span>
  )
}
