import { Bot, FolderOpen, Image as ImageIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { OverlayCard } from '@/components/common/overlay-card'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n'
import type { GroupWithHierarchy } from '@/types/group'
import type { ImageRecord } from '@/types/image'
import { getGroupHierarchyTotalCount, type GroupCountMaps } from '@/features/groups/group-count-utils'
import { GroupColorDot } from './group-color-dot'
import { GroupCoverMosaic } from './group-cover-mosaic'

interface GroupRootOverviewProps {
  groups: GroupWithHierarchy[]
  countMaps: GroupCountMaps
  sourceKey: 'custom' | 'folders'
  loadCoverImages: (groupId: number) => Promise<ImageRecord[]>
  onOpenGroup: (groupId: number) => void
  isLoading?: boolean
  error?: unknown
  onRetry?: () => void
}

/** Root view: every top-level group as an overlay cover card (image mosaic with its name and count over it). */
export function GroupRootOverview({
  groups,
  countMaps,
  sourceKey,
  loadCoverImages,
  onOpenGroup,
  isLoading = false,
  error = null,
  onRetry,
}: GroupRootOverviewProps) {
  const { t, formatNumber } = useI18n()
  const hasError = error !== null && error !== undefined

  return (
    <section className="space-y-4">
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="aspect-4/3 w-full" />)}
        </div>
      ) : null}

      {!isLoading && hasError ? (
        <ErrorState title={t({ ko: '그룹을 못 불러왔어', en: "Couldn't load groups" })} error={error} onRetry={onRetry} />
      ) : null}

      {!isLoading && !hasError && groups.length === 0 ? (
        <EmptyState icon={FolderOpen} title={t({ ko: '아직 그룹이 없어', en: 'No groups yet' })} />
      ) : null}

      {!isLoading && !hasError && groups.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {groups.map((group) => {
            const totalCount = getGroupHierarchyTotalCount(group, countMaps)
            return (
              <OverlayCard
                key={group.id}
                onOpen={() => onOpenGroup(group.id)}
                mediaClassName="aspect-4/3"
                media={<GroupCoverMosaic groupId={group.id} sourceKey={sourceKey} imageCount={totalCount} loadCoverImages={loadCoverImages} className="size-full" />}
                label={group.name}
                leading={<GroupColorDot color={group.color} size="md" className="mb-1.5" />}
                title={group.name}
                meta={<span className="flex items-center gap-1" aria-label={t({ ko: '이미지 {count}장', en: '{count} images' }, { count: formatNumber(totalCount) })}><ImageIcon />{formatNumber(totalCount)}</span>}
                topStart={group.auto_collect_enabled ? <Badge variant="overlay" size="sm"><Bot />{t({ ko: '자동수집', en: 'Auto-collect' })}</Badge> : undefined}
              />
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
