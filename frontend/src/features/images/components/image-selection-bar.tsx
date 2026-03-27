import type { ReactNode } from 'react'
import { Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

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
  if (selectedCount <= 0) {
    return null
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div
        className={cn(
          'theme-floating-panel theme-selection-bar pointer-events-auto flex items-center gap-3 rounded-full text-sm text-foreground',
        )}
      >
        <div className="flex flex-col leading-tight">
          <span className="font-semibold">{selectedCount.toLocaleString('ko-KR')}개 선택됨</span>
          <span className="text-xs text-muted-foreground">
            {statusText ?? (downloadableCount > 0
              ? `${downloadableCount.toLocaleString('ko-KR')}개 다운로드 가능`
              : '다운로드 가능한 항목이 없어')}
          </span>
        </div>

        {onClear ? (
          <Button size="sm" variant="secondary" onClick={onClear} data-no-select-drag="true">
            <X className="h-4 w-4" />
            선택 해제
          </Button>
        ) : null}

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
      </div>
    </div>
  )
}
