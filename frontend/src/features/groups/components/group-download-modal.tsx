import { Film, ImageIcon, Images } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import type { GroupDownloadType, GroupFileCounts } from '@/types/group'
import { useI18n } from '@/i18n'

interface GroupDownloadModalProps {
  open: boolean
  title: string
  counts: GroupFileCounts
  isLoading?: boolean
  isDownloading?: boolean
  onClose: () => void
  onDownload: (type: GroupDownloadType) => Promise<void> | void
}

const downloadCards: Array<{
  type: GroupDownloadType
  titleKey: string
  icon: typeof ImageIcon
  countKey: keyof GroupFileCounts
}> = [
  {
    type: 'original',
    titleKey: 'groups.components.group.download.modal.original.images',
    icon: ImageIcon,
    countKey: 'original',
  },
  {
    type: 'video',
    titleKey: 'groups.components.group.download.modal.gif.video',
    icon: Film,
    countKey: 'video',
  },
  {
    type: 'thumbnail',
    titleKey: 'groups.components.group.download.modal.thumbnails',
    icon: Images,
    countKey: 'thumbnail',
  },
]

export function GroupDownloadModal({
  open,
  title,
  counts,
  isLoading = false,
  isDownloading = false,
  onClose,
  onDownload,
}: GroupDownloadModalProps) {
  const { t, formatNumber } = useI18n()

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      widthClassName="max-w-3xl"
    >
      <ModalBody>
        <div className="space-y-2">
          {downloadCards.map((card) => {
            const Icon = card.icon
            const availableCount = counts[card.countKey]

            return (
              <Button
                key={card.type}
                type="button"
                variant="secondary"
                className="h-auto w-full justify-between px-3 py-3 text-left"
                onClick={() => void onDownload(card.type)}
                disabled={isLoading || isDownloading || availableCount <= 0}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-surface-high text-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 text-sm font-semibold text-foreground">{t(card.titleKey)}</span>
                </span>
                <Badge variant={availableCount > 0 ? 'secondary' : 'outline'} className="shrink-0">{t({ ko: '{count}개', en: '{count}' }, { count: formatNumber(availableCount) })}</Badge>
              </Button>
            )
          })}
        </div>

        <ModalFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isLoading || isDownloading}>
            {t({ ko: '취소', en: 'Cancel' })}
          </Button>
        </ModalFooter>
      </ModalBody>
    </Modal>
  )
}
