import type { ReactNode } from 'react'
import { Download } from 'lucide-react'
import { SelectionActionBar } from '@/components/common/selection-action-bar'
import { Button } from '@/components/ui/button'

interface ImageSelectionBarProps {
  selectedCount: number
  downloadableCount: number
  isDownloading?: boolean
  showDownloadAction?: boolean
  statusText?: ReactNode
  extraActions?: ReactNode
  onDownload: () => void
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
  onClear,
}: ImageSelectionBarProps) {
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
            <Button
              size="sm"
              onClick={onDownload}
              disabled={downloadableCount <= 0 || isDownloading}
              data-no-select-drag="true"
            >
              <Download className="h-4 w-4" />
              {isDownloading ? '준비 중…' : downloadableCount > 1 ? 'ZIP 다운로드' : '다운로드'}
            </Button>
          ) : null}
        </>
      )}
    />
  )
}
