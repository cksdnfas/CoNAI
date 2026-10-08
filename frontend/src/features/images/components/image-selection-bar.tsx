import { useRef, useState, type ReactNode } from 'react'
import { CheckCheck, Download } from 'lucide-react'
import { SelectionActionBar, SelectionBarAction } from '@/components/common/selection-action-bar'
import { AnchoredPopup } from '@/components/ui/anchored-popup'
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
  /** Number of loaded items; "select all loaded" shows while the selection is smaller. */
  loadedCount?: number
  onSelectAllLoaded?: () => void
}

/**
 * Bottom action bar for image selections. Actions passed in should be SelectionBarAction so every
 * gallery shows the same icon buttons with tooltips.
 */
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
  loadedCount,
  onSelectAllLoaded,
}: ImageSelectionBarProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLSpanElement | null>(null)
  const { t, formatNumber } = useI18n()
  const downloadLabel = isDownloading
    ? t('images.components.image.selection.bar.preparing.download')
    : downloadableCount > 1
      ? t('images.components.image.selection.bar.zip.download')
      : t('images.components.image.selection.bar.download')

  // Only mention downloadability when it differs from the selection; "3 selected / 3 downloadable" is noise.
  const downloadStatusText = !showDownloadAction || downloadableCount === selectedCount
    ? undefined
    : downloadableCount > 0
      ? t('images.components.image.selection.bar.value.downloadable', { count: formatNumber(downloadableCount) })
      : t('images.components.image.selection.bar.no.downloadable.items')

  return (
    <SelectionActionBar
      selectedCount={selectedCount}
      description={statusText ?? downloadStatusText}
      onClear={onClear}
      responsiveActions
      actions={(
        <>
          {onSelectAllLoaded && loadedCount !== undefined && selectedCount < loadedCount ? (
            <SelectionBarAction
              icon={CheckCheck}
              label={t({ ko: '불러온 항목 모두 선택', en: 'Select all loaded' })}
              onClick={onSelectAllLoaded}
            />
          ) : null}

          {extraActions}

          {showDownloadAction ? (
            <span ref={containerRef} className="relative inline-flex">
              <SelectionBarAction
                icon={Download}
                label={downloadLabel}
                variant="default"
                onClick={() => {
                  if (onDownloadSelect) {
                    setIsOpen((current) => !current)
                    return
                  }
                  onDownload?.()
                }}
                disabled={downloadableCount <= 0 || isDownloading}
              />

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
