import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Download } from 'lucide-react'
import { SelectionActionBar } from '@/components/common/selection-action-bar'
import { Button } from '@/components/ui/button'
import type { ImageDownloadType } from '@/lib/api'
import { ImageDownloadOptionMenu } from './image-download-option-menu'

interface ImageSelectionBarProps {
  selectedCount: number
  downloadableCount: number
  isDownloading?: boolean
  showDownloadAction?: boolean
  statusText?: ReactNode
  extraActions?: ReactNode
  onDownload?: () => void
  onDownloadSelect?: (type: ImageDownloadType) => Promise<void> | void
  onClear?: () => void
}

/** Render a minimal bottom action bar for image selection workflows. */
export function ImageSelectionBar({
  selectedCount,
  downloadableCount,
  isDownloading = false,
  showDownloadAction = true,
  statusText,
  extraActions,
  onDownload,
  onDownloadSelect,
  onClear,
}: ImageSelectionBarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLSpanElement | null>(null)

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

  return (
    <SelectionActionBar
      selectedCount={selectedCount}
      description={statusText ?? (downloadableCount > 0
        ? `${downloadableCount.toLocaleString('ko-KR')}개 다운로드 가능`
        : '다운로드 가능한 항목이 없어')}
      onClear={onClear}
      actions={(
        <>
          {extraActions}

          {showDownloadAction ? (
            <span ref={containerRef} className="relative inline-flex">
              <Button
                size="sm"
                onClick={() => {
                  if (onDownloadSelect) {
                    setIsOpen((current) => !current)
                    return
                  }
                  onDownload?.()
                }}
                disabled={downloadableCount <= 0 || isDownloading}
                data-no-select-drag="true"
              >
                <Download className="h-4 w-4" />
                {isDownloading ? '준비 중…' : downloadableCount > 1 ? 'ZIP 다운로드' : '다운로드'}
              </Button>

              {onDownloadSelect && isOpen ? (
                <ImageDownloadOptionMenu
                  targetCount={downloadableCount}
                  isDownloading={isDownloading}
                  className="absolute bottom-full right-0 z-[140] mb-2"
                  onSelect={async (type) => {
                    await onDownloadSelect(type)
                    setIsOpen(false)
                  }}
                />
              ) : null}
            </span>
          ) : null}
        </>
      )}
    />
  )
}
