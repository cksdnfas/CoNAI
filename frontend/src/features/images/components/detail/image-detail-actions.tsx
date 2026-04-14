import { ArrowLeft, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ImageRecord } from '@/types/image'
import { ImageDownloadTriggerButton } from '../image-download-trigger-button'
import { ImageEditAction } from './image-edit-action'
import { ImageGroupAssignAction } from './image-group-assign-action'

interface ImageDetailActionsProps {
  downloadUrl?: string | null
  downloadName: string
  image?: ImageRecord
  isRefreshing: boolean
  onBack: () => void
  onRefresh: () => void
}

export function ImageDetailActions({ downloadUrl, downloadName, image, isRefreshing, onBack, onRefresh }: ImageDetailActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="icon-sm" variant="secondary" onClick={onBack} aria-label="피드로 돌아가기" title="피드로 돌아가기">
        <ArrowLeft className="h-4 w-4" />
      </Button>
      <Button size="icon-sm" variant="outline" onClick={onRefresh} disabled={isRefreshing} aria-label="새로고침" title="새로고침">
        <RefreshCcw className={isRefreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
      </Button>
      <ImageEditAction image={image} />
      <ImageGroupAssignAction image={image} />
      {downloadUrl ? <ImageDownloadTriggerButton image={image} /> : null}
    </div>
  )
}
