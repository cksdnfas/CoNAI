import { useState, type ReactNode } from 'react'
import { Film, ImageIcon, Images, LoaderCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal, ModalBody } from '@/components/ui/modal'
import { cn } from '@/lib/utils'
import type { GroupDownloadType, GroupFileCounts } from '@/types/group'
import { useI18n } from '@/i18n'
import { GroupModalFooter } from './group-modal-parts'

interface GroupDownloadModalProps {
  open: boolean
  /** What is downloaded: the group name or the selection size. */
  description?: ReactNode
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
  description,
  counts,
  isLoading = false,
  isDownloading = false,
  onClose,
  onDownload,
}: GroupDownloadModalProps) {
  const { t, formatNumber } = useI18n()
  const [pickedType, setPickedType] = useState<GroupDownloadType | null>(null)
  // The picked type while it still has files, otherwise the first type that has any.
  const activeType = pickedType && counts[pickedType] > 0
    ? pickedType
    : downloadCards.find((card) => counts[card.countKey] > 0)?.type ?? null

  return (
    <Modal
      open={open}
      onClose={onClose}
      appearance="card"
      title={t({ ko: '다운로드', en: 'Download' })}
      description={description}
      widthClassName="max-w-md"
    >
      <ModalBody className="space-y-2" role="radiogroup" aria-label={t({ ko: '받을 파일', en: 'Files to download' })}>
        {downloadCards.map((card) => {
          const Icon = card.icon
          const availableCount = counts[card.countKey]
          const picked = card.type === activeType

          return (
            <Button
              key={card.type}
              type="button"
              variant="ghost"
              role="radio"
              aria-checked={picked}
              onClick={() => setPickedType(card.type)}
              disabled={isLoading || isDownloading || availableCount <= 0}
              className={cn(
                'h-auto w-full justify-start gap-3 rounded-lg border-[1.5px] border-transparent bg-field px-3.5 py-2.5 text-left hover:bg-fill disabled:opacity-45',
                picked && 'border-primary bg-primary/8 hover:bg-primary/12',
              )}
            >
              <span aria-hidden="true" className={cn('relative size-4.5 shrink-0 rounded-full border-2', picked ? 'border-primary after:absolute after:inset-0.5 after:rounded-full after:bg-primary' : 'border-muted-foreground/60')} />
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-high text-foreground">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{t(card.titleKey)}</span>
              <span className="shrink-0 text-sm tabular-nums text-muted-foreground">{t({ ko: '{count}개', en: '{count}' }, { count: formatNumber(availableCount) })}</span>
            </Button>
          )
        })}
      </ModalBody>

      <GroupModalFooter busy={isDownloading}>
        <Button type="button" onClick={() => { if (activeType) void onDownload(activeType) }} disabled={isLoading || isDownloading || !activeType}>
          {isDownloading ? <LoaderCircle className="animate-spin" /> : null}
          {t({ ko: '받기', en: 'Download' })}
        </Button>
      </GroupModalFooter>
    </Modal>
  )
}
