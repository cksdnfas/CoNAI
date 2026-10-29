import { Bot, FolderOpen } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { MediaCard } from '@/components/common/media-card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tip } from '@/components/ui/tooltip'
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

/** Root view: every top-level group as a cover card (image mosaic + caption line, no card surface). */
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
              <MediaCard
                key={group.id}
                className="w-full"
                onClick={() => onOpenGroup(group.id)}
                mediaClassName="aspect-4/3 w-full"
                media={<GroupCoverMosaic groupId={group.id} sourceKey={sourceKey} imageCount={totalCount} loadCoverImages={loadCoverImages} className="size-full" />}
                leading={<GroupColorDot color={group.color} size="md" />}
                title={group.name}
                meta={<>
                  {group.auto_collect_enabled ? (
                    <Tip content={t({ ko: '자동수집 켜짐', en: 'Auto-collect on' })}>
                      <Bot className="size-3.5 shrink-0 text-primary" aria-label={t({ ko: '자동수집 켜짐', en: 'Auto-collect on' })} />
                    </Tip>
                  ) : null}
                  {formatNumber(totalCount)}
                </>}
              />
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
