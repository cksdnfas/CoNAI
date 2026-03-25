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
      <Button variant="secondary" onClick={onBack}>
        <ArrowLeft className="h-4 w-4" />
        피드로 돌아가기
      </Button>
      <Button variant="outline" onClick={onRefresh} disabled={isRefreshing}>
        <RefreshCcw className="h-4 w-4" />
        새로고침
      </Button>
      {downloadUrl ? (
        <Button asChild>
          <a href={downloadUrl} download={downloadName}>
            <Download className="h-4 w-4" />
            다운로드
          </a>
        </Button>
      ) : null}
    </div>
  )
}
