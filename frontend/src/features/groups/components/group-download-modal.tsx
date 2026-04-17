import { Download, Film, ImageIcon, Images } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import type { GroupDownloadType, GroupFileCounts } from '@/types/group'

interface GroupDownloadModalProps {
  open: boolean
  title: string
  description?: string
  counts: GroupFileCounts
  isLoading?: boolean
  isDownloading?: boolean
  onClose: () => void
  onDownload: (type: GroupDownloadType) => Promise<void> | void
}

const downloadCards: Array<{
  type: GroupDownloadType
  title: string
  description: string
  icon: typeof ImageIcon
  countKey: keyof GroupFileCounts
}> = [
  {
    type: 'original',
    title: '원본 이미지',
    description: '정적 이미지 원본만 ZIP으로 묶어 내려받아.',
    icon: ImageIcon,
    countKey: 'original',
  },
  {
    type: 'video',
    title: 'GIF / 동영상',
    description: 'GIF와 동영상 파일만 따로 내려받아.',
    icon: Film,
    countKey: 'video',
  },
  {
    type: 'thumbnail',
    title: '썸네일',
    description: '빠른 검수용으로 썸네일 ZIP을 받아.',
    icon: Images,
    countKey: 'thumbnail',
  },
]

export function GroupDownloadModal({
  open,
  title,
  description,
  counts,
  isLoading = false,
  isDownloading = false,
  onClose,
  onDownload,
}: GroupDownloadModalProps) {
  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={title}
      description={description ?? '현재 범위에서 내려받을 파일 종류를 골라줘.'}
      widthClassName="max-w-3xl"
    >
      <SettingsModalBody>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">원본 {counts.original.toLocaleString('ko-KR')}개</Badge>
          <Badge variant="outline">GIF/동영상 {counts.video.toLocaleString('ko-KR')}개</Badge>
          <Badge variant="outline">썸네일 {counts.thumbnail.toLocaleString('ko-KR')}개</Badge>
        </div>

        <div className="space-y-2">
          {downloadCards.map((card) => {
            const Icon = card.icon
            const availableCount = counts[card.countKey]

            return (
              <Button
                key={card.type}
                type="button"
                variant="outline"
                className="h-auto w-full justify-between px-3 py-3 text-left"
                onClick={() => void onDownload(card.type)}
                disabled={isLoading || isDownloading || availableCount <= 0}
              >
                <span className="flex min-w-0 items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm border border-border/70 bg-surface-low/45 text-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-foreground">{card.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{card.description}</span>
                  </span>
                </span>
                <Badge variant={availableCount > 0 ? 'secondary' : 'outline'} className="shrink-0">{availableCount.toLocaleString('ko-KR')}개</Badge>
              </Button>
            )
          })}
        </div>

        <SettingsModalFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isLoading || isDownloading}>
            취소
          </Button>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
  )
}
