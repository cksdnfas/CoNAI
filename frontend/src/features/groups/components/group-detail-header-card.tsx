import { useRef, useState } from 'react'
import { ChevronDown, Download, Ellipsis, FolderPlus, Pencil, Play, Trash2 } from 'lucide-react'
import { PageInset, PageSection } from '@/components/common/page-surface'
import { AnchoredPopup, anchoredPopupBodyClassName, anchoredPopupLabelClassName } from '@/components/ui/anchored-popup'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { GroupRecord, GroupWithHierarchy } from '@/types/group'
import { useI18n } from '@/i18n'

interface GroupDetailHeaderCardProps {
  group: GroupRecord
  selectedGroupHierarchy: GroupWithHierarchy | null
  isCustomSource: boolean
  isWideLayout: boolean
  isGroupFileCountsLoading: boolean
  isDownloadingGroup: boolean
  isAutoCollectPending: boolean
  isDeletePending: boolean
  lastAutoCollectLabel: string
  parentGroupLabel: string
  imageCountLabel: string
  onOpenDownload: () => void
  onOpenCreateModal: () => void
  onOpenEditModal: () => void
  onRunAutoCollect: () => void
  onDeleteGroup: () => void
}

/** Render the selected-group summary card with compact identity, primary actions, and collapsible details. */
export function GroupDetailHeaderCard({
  group,
  selectedGroupHierarchy,
  isCustomSource,
  isWideLayout,
  isGroupFileCountsLoading,
  isDownloadingGroup,
  isAutoCollectPending,
  isDeletePending,
  lastAutoCollectLabel,
  parentGroupLabel,
  imageCountLabel,
  onOpenDownload,
  onOpenCreateModal,
  onOpenEditModal,
  onRunAutoCollect,
  onDeleteGroup,
}: GroupDetailHeaderCardProps) {
  const { t, formatNumber } = useI18n()
  const moreButtonRef = useRef<HTMLButtonElement | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)

  return (
    <PageSection
      title={group.name}
      actions={
        <>
          <Button type="button" size="sm" variant="secondary" onClick={onOpenDownload} disabled={isGroupFileCountsLoading || isDownloadingGroup}>
            <Download className="h-4 w-4" />
            {isDownloadingGroup ? t('groups.components.group.detail.header.card.preparing') : t('groups.components.group.detail.header.card.download')}
          </Button>
          {isCustomSource ? (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={onOpenCreateModal}>
                <FolderPlus className="h-4 w-4" />
                {t({ ko: '하위 그룹 추가', en: 'Add child group' })}
              </Button>
              <Button
                ref={moreButtonRef}
                type="button"
                size="icon-sm"
                variant="secondary"
                aria-label={t('groups.components.group.detail.header.card.group.add.actions')}
                title={t('groups.components.group.detail.header.card.add.actions')}
                onClick={() => setActionsOpen((open) => !open)}
              >
                <Ellipsis className="h-4 w-4" />
              </Button>
              <AnchoredPopup open={actionsOpen} anchorRef={moreButtonRef} onClose={() => setActionsOpen(false)} align="end" className="min-w-[220px]">
                <div className={anchoredPopupBodyClassName}>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Group actions</div>
                  <div className="space-y-1.5">
                    <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => {
                      setActionsOpen(false)
                      onOpenEditModal()
                    }}>
                      <Pencil className="h-4 w-4" />
                      {t({ ko: '편집', en: 'Edit' })}
                    </Button>
                    <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => {
                      setActionsOpen(false)
                      onRunAutoCollect()
                    }} disabled={isAutoCollectPending}>
                      <Play className="h-4 w-4" />
                      {isAutoCollectPending ? t('groups.components.group.detail.header.card.auto.collecting') : t('groups.components.group.detail.header.card.run.auto.collect')}
                    </Button>
                    <Button type="button" variant="destructive" className="w-full justify-start" onClick={() => {
                      setActionsOpen(false)
                      onDeleteGroup()
                    }} disabled={isDeletePending}>
                      <Trash2 className="h-4 w-4" />
                      {t({ ko: '삭제', en: 'Delete' })}
                    </Button>
                  </div>
                </div>
              </AnchoredPopup>
            </>
          ) : null}
        </>
      }
      bodyClassName="space-y-3"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary">{t({ ko: '이미지 {count}개', en: '{count} images' }, { count: imageCountLabel })}</Badge>
        <Badge variant="outline">manual {formatNumber(group.manual_added_count ?? 0)}</Badge>
        <Badge variant="outline">auto {formatNumber(group.auto_collected_count ?? 0)}</Badge>
        {selectedGroupHierarchy?.has_children ? <Badge variant="outline">{t({ ko: '하위 {count}', en: 'Children {count}' }, { count: formatNumber(selectedGroupHierarchy.child_count) })}</Badge> : null}
      </div>

      {isCustomSource ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className={anchoredPopupLabelClassName}>{group.auto_collect_enabled ? t('groups.components.group.detail.header.card.auto.collect.on') : t('groups.components.group.detail.header.card.auto.collect.off')}</span>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDetailsOpen((open) => !open)}>
              {t({ ko: '상세', en: 'Details' })}
              <ChevronDown className={`h-4 w-4 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
            </Button>
          </div>

          {(detailsOpen || isWideLayout) ? (
            <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
              <PageInset>{t({ ko: '마지막 자동수집: {lastAutoCollectLabel}', en: 'Last auto-collect: {lastAutoCollectLabel}' }, { lastAutoCollectLabel })}</PageInset>
              <PageInset>{t({ ko: '부모 그룹: {parentGroupLabel}', en: 'Parent group: {parentGroupLabel}' }, { parentGroupLabel })}</PageInset>
            </div>
          ) : null}
        </>
      ) : null}
    </PageSection>
  )
}
