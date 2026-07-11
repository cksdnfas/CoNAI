import { useRef, useState } from 'react'
import { Download, Ellipsis, FolderPlus, FolderTree, Pencil, Play, Trash2 } from 'lucide-react'
import { PageInset } from '@/components/common/page-surface'
import { AnchoredPopup, anchoredPopupBodyClassName } from '@/components/ui/anchored-popup'
import { Button } from '@/components/ui/button'
import type { GroupRecord, GroupWithHierarchy } from '@/types/group'
import { useI18n } from '@/i18n'

interface GroupDetailHeaderCardProps {
  group: GroupRecord
  selectedGroupHierarchy: GroupWithHierarchy | null
  isCustomSource: boolean
  isGroupFileCountsLoading: boolean
  isDownloadingGroup: boolean
  isAutoCollectPending: boolean
  isDeletePending: boolean
  imageCountLabel: string
  onOpenDownload: () => void
  onOpenCreateModal: () => void
  onOpenEditModal: () => void
  onRunAutoCollect: () => void
  onDeleteGroup: () => void
}

/** Render a compact selected-group identity row and keep secondary work in one menu. */
export function GroupDetailHeaderCard({
  group,
  selectedGroupHierarchy,
  isCustomSource,
  isGroupFileCountsLoading,
  isDownloadingGroup,
  isAutoCollectPending,
  isDeletePending,
  imageCountLabel,
  onOpenDownload,
  onOpenCreateModal,
  onOpenEditModal,
  onRunAutoCollect,
  onDeleteGroup,
}: GroupDetailHeaderCardProps) {
  const { t } = useI18n()
  const moreButtonRef = useRef<HTMLButtonElement | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)
  const runAction = (action: () => void) => {
    setActionsOpen(false)
    action()
  }

  return (
    <PageInset className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <FolderTree className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h2 className="truncate text-sm font-semibold text-foreground">{group.name}</h2>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {selectedGroupHierarchy?.has_children
            ? t({ ko: '하위 포함 {count}개', en: '{count} incl. nested' }, { count: imageCountLabel })
            : t({ ko: '이미지 {count}개', en: '{count} images' }, { count: imageCountLabel })}
        </span>
      </div>

      <Button
        ref={moreButtonRef}
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={t({ ko: '그룹 옵션', en: 'Group options' })}
        title={t({ ko: '그룹 옵션', en: 'Group options' })}
        onClick={() => setActionsOpen((open) => !open)}
      >
        <Ellipsis className="h-4 w-4" />
      </Button>
      <AnchoredPopup open={actionsOpen} anchorRef={moreButtonRef} onClose={() => setActionsOpen(false)} align="end" className="min-w-[220px]">
        <div className={anchoredPopupBodyClassName}>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {t({ ko: '그룹 옵션', en: 'Group options' })}
          </div>
          <div className="space-y-1.5">
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              onClick={() => runAction(onOpenDownload)}
              disabled={isGroupFileCountsLoading || isDownloadingGroup}
            >
              <Download className="h-4 w-4" />
              {isDownloadingGroup ? t('groups.components.group.detail.header.card.preparing') : t('groups.components.group.detail.header.card.download')}
            </Button>
            {isCustomSource ? (
              <>
                <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => runAction(onOpenCreateModal)}>
                  <FolderPlus className="h-4 w-4" />
                  {t({ ko: '하위 그룹 추가', en: 'Add child group' })}
                </Button>
                <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => runAction(onOpenEditModal)}>
                  <Pencil className="h-4 w-4" />
                  {t({ ko: '편집', en: 'Edit' })}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => runAction(onRunAutoCollect)}
                  disabled={isAutoCollectPending}
                >
                  <Play className="h-4 w-4" />
                  {isAutoCollectPending ? t('groups.components.group.detail.header.card.auto.collecting') : t('groups.components.group.detail.header.card.run.auto.collect')}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="w-full justify-start"
                  onClick={() => runAction(onDeleteGroup)}
                  disabled={isDeletePending}
                >
                  <Trash2 className="h-4 w-4" />
                  {t({ ko: '삭제', en: 'Delete' })}
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </AnchoredPopup>
    </PageInset>
  )
}
