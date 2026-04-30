import { Film, ImageIcon, Images } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import type { GroupDownloadType, GroupFileCounts } from '@/types/group'
import { useI18n } from '@/i18n'

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
  titleKey: string
  descriptionKey: string
  icon: typeof ImageIcon
  countKey: keyof GroupFileCounts
}> = [
  {
    type: 'original',
    titleKey: 'groups.components.group.download.modal.original.images',
    descriptionKey: 'groups.components.group.download.modal.download.only.static.original.images.as.a',
    icon: ImageIcon,
    countKey: 'original',
  },
  {
    type: 'video',
    titleKey: 'groups.components.group.download.modal.gif.video',
    descriptionKey: 'groups.components.group.download.modal.download.only.gif.and.video.files',
    icon: Film,
    countKey: 'video',
  },
  {
    type: 'thumbnail',
    titleKey: 'groups.components.group.download.modal.thumbnails',
    descriptionKey: 'groups.components.group.download.modal.download.a.thumbnail.zip.for.quick.review',
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
  const { t, formatNumber } = useI18n()

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={title}
      description={description ?? t('groups.components.group.download.modal.choose.which.file.type.to.download.from')}
      widthClassName="max-w-3xl"
    >
      <SettingsModalBody>
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{t({ ko: '원본 {count}개', en: '{count} originals' }, { count: formatNumber(counts.original) })}</Badge>
          <Badge variant="outline">{t({ ko: 'GIF/동영상 {count}개', en: '{count} GIF/videos' }, { count: formatNumber(counts.video) })}</Badge>
          <Badge variant="outline">{t({ ko: '썸네일 {count}개', en: '{count} thumbnails' }, { count: formatNumber(counts.thumbnail) })}</Badge>
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
                    <span className="block text-sm font-semibold text-foreground">{t(card.titleKey)}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{t(card.descriptionKey)}</span>
                  </span>
                </span>
                <Badge variant={availableCount > 0 ? 'secondary' : 'outline'} className="shrink-0">{t({ ko: '{count}개', en: '{count}' }, { count: formatNumber(availableCount) })}</Badge>
              </Button>
            )
          })}
        </div>

        <SettingsModalFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isLoading || isDownloading}>
            {t({ ko: '취소', en: 'Cancel' })}
          </Button>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
  )
}
