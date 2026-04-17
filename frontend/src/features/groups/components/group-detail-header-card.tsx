import { useRef, useState } from 'react'
import { ChevronDown, Download, Ellipsis, FolderPlus, Pencil, Play, Trash2 } from 'lucide-react'
import { PageInset, PageSection } from '@/components/common/page-surface'
import { AnchoredPopup, anchoredPopupBodyClassName, anchoredPopupLabelClassName } from '@/components/ui/anchored-popup'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { GroupRecord, GroupWithHierarchy } from '@/types/group'

export interface GroupDetailHeaderCardProps {
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
  onOpenDownload,
  onOpenCreateModal,
  onOpenEditModal,
  onRunAutoCollect,
  onDeleteGroup,
}: GroupDetailHeaderCardProps) {
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
            {isDownloadingGroup ? '준비 중…' : '다운로드'}
          </Button>
          {isCustomSource ? (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={onOpenCreateModal}>
                <FolderPlus className="h-4 w-4" />
                하위 그룹 추가
              </Button>
              <Button
                ref={moreButtonRef}
                type="button"
                size="icon-sm"
                variant="secondary"
                aria-label="그룹 추가 작업"
                title="추가 작업"
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
                      편집
                    </Button>
                    <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => {
                      setActionsOpen(false)
                      onRunAutoCollect()
                    }} disabled={isAutoCollectPending}>
                      <Play className="h-4 w-4" />
                      {isAutoCollectPending ? '자동수집 실행 중…' : '자동수집 실행'}
                    </Button>
                    <Button type="button" variant="destructive" className="w-full justify-start" onClick={() => {
                      setActionsOpen(false)
                      onDeleteGroup()
                    }} disabled={isDeletePending}>
                      <Trash2 className="h-4 w-4" />
                      삭제
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
        <Badge variant="secondary">이미지 {group.image_count.toLocaleString('ko-KR')}개</Badge>
        <Badge variant="outline">manual {group.manual_added_count?.toLocaleString('ko-KR') ?? 0}</Badge>
        <Badge variant="outline">auto {group.auto_collected_count?.toLocaleString('ko-KR') ?? 0}</Badge>
        {selectedGroupHierarchy?.has_children ? <Badge variant="outline">하위 {selectedGroupHierarchy.child_count.toLocaleString('ko-KR')}</Badge> : null}
      </div>

      {isCustomSource ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className={anchoredPopupLabelClassName}>{group.auto_collect_enabled ? '자동수집 켜짐' : '자동수집 꺼짐'}</span>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDetailsOpen((open) => !open)}>
              상세
              <ChevronDown className={`h-4 w-4 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
            </Button>
          </div>

          {(detailsOpen || isWideLayout) ? (
            <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
              <PageInset>마지막 자동수집: {lastAutoCollectLabel}</PageInset>
              <PageInset>부모 그룹: {parentGroupLabel}</PageInset>
            </div>
          ) : null}
        </>
      ) : null}
    </PageSection>
  )
}
