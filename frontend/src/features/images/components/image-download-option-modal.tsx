import { Download, ImageIcon, Images } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import type { ImageDownloadType } from '@/lib/api'

interface ImageDownloadOptionModalProps {
  open: boolean
  targetCount: number
  isDownloading?: boolean
  onClose: () => void
  onSelect: (type: ImageDownloadType) => Promise<void> | void
}

const downloadCards: Array<{
  type: ImageDownloadType
  title: string
  description: string
  icon: typeof ImageIcon
}> = [
  {
    type: 'thumbnail',
    title: '썸네일',
    description: '가벼운 검수용 이미지를 내려받아.',
    icon: Images,
  },
  {
    type: 'original',
    title: '원본',
    description: '원본 파일 그대로 내려받아.',
    icon: ImageIcon,
  },
]

/** Render a compact global download-choice modal for hash-based image surfaces. */
export function ImageDownloadOptionModal({ open, targetCount, isDownloading = false, onClose, onSelect }: ImageDownloadOptionModalProps) {
  const isBatch = targetCount > 1

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title="다운로드 방식 선택"
      description={isBatch ? `${targetCount.toLocaleString('ko-KR')}개를 ZIP으로 받을 방식을 골라줘.` : '받을 파일 종류를 골라줘.'}
      widthClassName="max-w-xl"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">대상 {targetCount.toLocaleString('ko-KR')}개</Badge>
          <Badge variant="outline">형식 {isBatch ? 'ZIP' : '파일'}</Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {downloadCards.map((card) => {
            const Icon = card.icon
            return (
              <Card key={card.type}>
                <CardHeader className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-sm bg-surface-highest text-foreground">
                      <Icon className="h-5 w-5" />
                    </div>
                    <Badge variant="secondary">{card.type === 'thumbnail' ? 'preview' : 'full'}</Badge>
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
                    onClick={() => void onSelect(card.type)}
                    disabled={isDownloading}
                  >
                    <Download className="h-4 w-4" />
                    {isDownloading ? '준비 중…' : (isBatch ? `${card.title} ZIP 다운로드` : `${card.title} 다운로드`)}
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
