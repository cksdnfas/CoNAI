import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ImageDownloadType } from '@/lib/api'
import { cn } from '@/lib/utils'

interface ImageDownloadOptionMenuProps {
  targetCount: number
  isDownloading?: boolean
  className?: string
  onSelect: (type: ImageDownloadType) => Promise<void> | void
}

/** Render a compact download option menu for original vs thumbnail. */
export function ImageDownloadOptionMenu({ targetCount, isDownloading = false, className, onSelect }: ImageDownloadOptionMenuProps) {
  const isBatch = targetCount > 1

  return (
    <div className={cn('min-w-[180px] p-1.5', className)} data-no-select-drag="true">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-start"
        onClick={() => void onSelect('original')}
        disabled={isDownloading}
        data-no-select-drag="true"
      >
        <Download className="h-4 w-4" />
        {isDownloading ? '준비 중…' : isBatch ? '원본 다운로드 (ZIP)' : '원본 다운로드'}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-start"
        onClick={() => void onSelect('thumbnail')}
        disabled={isDownloading}
        data-no-select-drag="true"
      >
        <Download className="h-4 w-4" />
        {isDownloading ? '준비 중…' : isBatch ? '썸네일 다운로드 (ZIP)' : '썸네일 다운로드'}
      </Button>
    </div>
  )
}
