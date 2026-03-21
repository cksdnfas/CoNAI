import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ImageSelectionBarProps {
  selectedCount: number
  downloadableCount: number
  isDownloading?: boolean
  onDownload: () => void
}

/** Render a minimal bottom action bar for image selection workflows. */
export function ImageSelectionBar({
  selectedCount,
  downloadableCount,
  isDownloading = false,
  onDownload,
}: ImageSelectionBarProps) {
  if (selectedCount <= 0) {
    return null
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div
        className={cn(
          'pointer-events-auto flex items-center gap-4 rounded-full bg-surface-container/92 px-5 py-3 text-sm text-foreground shadow-[0_0_40px_rgba(14,14,14,0.28)] backdrop-blur-[18px]',
        )}
      >
        <div className="flex flex-col leading-tight">
          <span className="font-semibold">{selectedCount.toLocaleString('ko-KR')} selected</span>
          <span className="text-xs text-muted-foreground">
            {downloadableCount > 0
              ? `${downloadableCount.toLocaleString('ko-KR')} downloadable`
              : 'No downloadable items'}
          </span>
        </div>

        <Button
          size="sm"
          onClick={onDownload}
          disabled={downloadableCount <= 0 || isDownloading}
          data-no-select-drag="true"
        >
          <Download className="h-4 w-4" />
          {isDownloading ? 'Preparing…' : downloadableCount > 1 ? 'Download ZIP' : 'Download'}
        </Button>
      </div>
    </div>
  )
}
