import { Download, FolderPlus, Pencil, Play, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SectionHeading } from '@/components/common/section-heading'
import type { GroupRecord, GroupWithHierarchy } from '@/types/group'

export interface GroupDetailHeaderCardProps {
  group: GroupRecord
  selectedGroupHierarchy: GroupWithHierarchy | null
  isCustomSource: boolean
  groupImageCollectionFilter: 'all' | 'manual' | 'auto'
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
  onFilterChange: (value: 'all' | 'manual' | 'auto') => void
}

/** Render the selected-group summary card with actions, badges, and custom-group filters. */
export function GroupDetailHeaderCard({
  group,
  selectedGroupHierarchy,
  isCustomSource,
  groupImageCollectionFilter,
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
  onFilterChange,
}: GroupDetailHeaderCardProps) {
  return (
    <section>
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <SectionHeading
            variant="inside"
            className="border-b border-border/70 px-4 pb-4"
            heading={group.name}
            actions={
              <div className="flex flex-wrap items-center gap-2">
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
                    <Button type="button" size="icon-sm" variant="secondary" onClick={onOpenEditModal} aria-label="그룹 편집" title="편집">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button type="button" size="sm" variant="secondary" onClick={onRunAutoCollect} disabled={isAutoCollectPending}>
                      <Play className="h-4 w-4" />
                      {isAutoCollectPending ? '실행 중…' : '자동수집 실행'}
                    </Button>
                    <Button type="button" size="icon-sm" variant="destructive" onClick={onDeleteGroup} disabled={isDeletePending} aria-label="그룹 삭제" title="삭제">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                ) : null}
              </div>
            }
          />

          <div className="space-y-4 px-4 pt-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">이미지 {group.image_count.toLocaleString('ko-KR')}개</Badge>
              <Badge variant="outline">manual {group.manual_added_count?.toLocaleString('ko-KR') ?? 0}</Badge>
              <Badge variant="outline">auto {group.auto_collected_count?.toLocaleString('ko-KR') ?? 0}</Badge>
              {isCustomSource ? (
                <Badge variant={group.auto_collect_enabled ? 'default' : 'outline'}>
                  {group.auto_collect_enabled ? '자동수집 켜짐' : '자동수집 꺼짐'}
                </Badge>
              ) : null}
              {selectedGroupHierarchy?.has_children ? (
                <Badge variant="outline">하위 그룹 {selectedGroupHierarchy.child_count.toLocaleString('ko-KR')}개</Badge>
              ) : null}
            </div>

            {isCustomSource ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Image filter</span>
                  {(['all', 'manual', 'auto'] as const).map((filterValue) => (
                    <Button
                      key={filterValue}
                      type="button"
                      size="sm"
                      variant={groupImageCollectionFilter === filterValue ? 'default' : 'secondary'}
                      onClick={() => onFilterChange(filterValue)}
                    >
                      {filterValue === 'all' ? '전체' : filterValue === 'manual' ? 'manual만' : 'auto만'}
                    </Button>
                  ))}
                </div>

                <div className="grid gap-3 text-sm text-muted-foreground md:grid-cols-2">
                  <div className="rounded-sm border border-border/70 bg-background/50 px-3 py-2">
                    마지막 자동수집: {lastAutoCollectLabel}
                  </div>
                  <div className="rounded-sm border border-border/70 bg-background/50 px-3 py-2">
                    부모 그룹: {parentGroupLabel}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </section>
  )
}
