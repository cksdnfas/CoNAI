import { useRef, useState, type ReactNode } from 'react'
import { Download } from 'lucide-react'
import { SelectionActionBar } from '@/components/common/selection-action-bar'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import type { ImageDownloadType } from '@/lib/api-images'
import { ImageDownloadOptionMenu } from './image-download-option-menu'

interface ImageSelectionBarProps {
  selectedCount: number
  downloadableCount: number
  isDownloading?: boolean
  showDownloadAction?: boolean
  statusText?: ReactNode
  extraActions?: ReactNode
  trailingActions?: ReactNode
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
  trailingActions,
  onDownload,
  onDownloadSelect,
  onClear,
}: ImageSelectionBarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLSpanElement | null>(null)
  const { t, formatNumber } = useI18n()
  const downloadLabel = isDownloading
    ? t('images.components.image.selection.bar.preparing.download')
    : downloadableCount > 1
      ? t('images.components.image.selection.bar.zip.download')
      : t('images.components.image.selection.bar.download')

  return (
    <SelectionActionBar
      selectedCount={selectedCount}
      description={statusText ?? (downloadableCount > 0
        ? t('images.components.image.selection.bar.value.downloadable', { count: formatNumber(downloadableCount) })
        : t('images.components.image.selection.bar.no.downloadable.items'))}
      onClear={onClear}
      compactActions
      actions={(
        <>
          {extraActions}

          {showDownloadAction ? (
            <span ref={containerRef} className="relative inline-flex">
              <Button
                size="icon-sm"
                onClick={() => {
                  if (onDownloadSelect) {
                    setIsOpen((current) => !current)
                    return
                  }
                  onDownload?.()
                }}
                disabled={downloadableCount <= 0 || isDownloading}
                title={downloadLabel}
                aria-label={downloadLabel}
                data-no-select-drag="true"
              >
                <Download className="h-4 w-4" />
              </Button>

              {onDownloadSelect ? (
                <AnchoredPopup open={isOpen} anchorRef={containerRef} onClose={() => setIsOpen(false)} align="end" side="top" closeOnBack>
                  <ImageDownloadOptionMenu
                    targetCount={downloadableCount}
                    isDownloading={isDownloading}
                    onSelect={async (type) => {
                      await onDownloadSelect(type)
                      setIsOpen(false)
                    }}
                  />
                </AnchoredPopup>
              ) : null}
            </span>
          ) : null}

          {trailingActions}
        </>
      )}
    />
  )
}
