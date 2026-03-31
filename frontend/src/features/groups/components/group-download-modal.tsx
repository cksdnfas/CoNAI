import { Download, Film, ImageIcon, Images } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SettingsModal } from '@/features/settings/components/settings-modal'
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
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">원본 {counts.original.toLocaleString('ko-KR')}개</Badge>
          <Badge variant="outline">GIF/동영상 {counts.video.toLocaleString('ko-KR')}개</Badge>
          <Badge variant="outline">썸네일 {counts.thumbnail.toLocaleString('ko-KR')}개</Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {downloadCards.map((card) => {
            const Icon = card.icon
            const availableCount = counts[card.countKey]

            return (
              <Card key={card.type} >
                <CardHeader className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-surface-highest text-foreground">
                      <Icon className="h-5 w-5" />
                    </div>
                    <Badge variant={availableCount > 0 ? 'secondary' : 'outline'}>{availableCount.toLocaleString('ko-KR')}개</Badge>
                  </div>
                  <div className="space-y-2">
                    <CardTitle className="text-base">{card.title}</CardTitle>
                    <CardDescription>{card.description}</CardDescription>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button
                    type="button"
                    className="w-full"
                    onClick={() => void onDownload(card.type)}
                    disabled={isLoading || isDownloading || availableCount <= 0}
                  >
                    <Download className="h-4 w-4" />
                    {isDownloading ? '준비 중…' : 'ZIP 다운로드'}
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </SettingsModal>
  )
}
