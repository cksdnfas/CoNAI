import { Download, ImageIcon, Images } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
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
      <SettingsModalBody>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">대상 {targetCount.toLocaleString('ko-KR')}개</Badge>
          <Badge variant="outline">형식 {isBatch ? 'ZIP' : '파일'}</Badge>
        </div>

        <div className="space-y-2">
          {downloadCards.map((card) => {
            const Icon = card.icon
            return (
              <Button
                key={card.type}
                type="button"
                variant="outline"
                className="h-auto w-full justify-between px-3 py-3 text-left"
                onClick={() => void onSelect(card.type)}
                disabled={isDownloading}
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
                <Badge variant="secondary" className="shrink-0">{card.type === 'thumbnail' ? 'preview' : 'full'}</Badge>
              </Button>
            )
          })}
        </div>

        <SettingsModalFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isDownloading}>
            취소
          </Button>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
  )
}
