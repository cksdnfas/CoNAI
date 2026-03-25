import { ArrowLeft, Download, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ImageDetailActionsProps {
  downloadUrl?: string | null
  downloadName: string
  isRefreshing: boolean
  onBack: () => void
  onRefresh: () => void
}

export function ImageDetailActions({ downloadUrl, downloadName, isRefreshing, onBack, onRefresh }: ImageDetailActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="icon-sm" variant="secondary" onClick={onBack} aria-label="피드로 돌아가기" title="피드로 돌아가기">
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button size="icon-sm" variant="outline" onClick={onRefresh} disabled={isRefreshing} aria-label="새로고침" title="새로고침">
        <RefreshCcw className={isRefreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
      </Button>
      {downloadUrl ? (
        <Button size="icon-sm" asChild aria-label="다운로드" title="다운로드">
          <a href={downloadUrl} download={downloadName} aria-label="다운로드" title="다운로드">
            <Download className="h-4 w-4" />
          </a>
        </Button>
      ) : null}
    </div>
  )
}
