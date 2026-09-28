import type { ReactNode } from 'react'
import { Bot, FolderOpen } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Heading } from '@/components/ui/heading'
import { Panel } from '@/components/ui/panel'
import { Skeleton } from '@/components/ui/skeleton'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import type { GroupWithHierarchy } from '@/types/group'
import type { ImageRecord } from '@/types/image'
import { getGroupHierarchyTotalCount, type GroupCountMaps } from '@/features/groups/group-count-utils'
import { GroupColorDot } from './group-color-dot'
import { GroupCoverMosaic } from './group-cover-mosaic'

interface GroupRootOverviewProps {
  title: string
  groups: GroupWithHierarchy[]
  countMaps: GroupCountMaps
  sourceKey: 'custom' | 'folders'
  loadPreviewImages: (groupId: number, params?: { includeChildren?: boolean; count?: number }) => Promise<ImageRecord[]>
  actions?: ReactNode
  onOpenGroup: (groupId: number) => void
  isLoading?: boolean
  error?: unknown
  onRetry?: () => void
}

/** Root view: every top-level group as a cover card. */
export function GroupRootOverview({
  title,
  groups,
  countMaps,
  sourceKey,
  loadPreviewImages,
  actions,
  onOpenGroup,
  isLoading = false,
  error = null,
  onRetry,
}: GroupRootOverviewProps) {
  const { t, formatNumber } = useI18n()
  const hasError = error !== null && error !== undefined

  return (
    <section className="space-y-4">
      <div className="flex min-h-10 items-center justify-between gap-3">
        <Heading level={2} as="h1">{title}</Heading>
        {actions ? <div className="flex items-center gap-1.5">{actions}</div> : null}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="aspect-[4/3] w-full rounded-sm" />)}
        </div>
      ) : null}

      {!isLoading && hasError ? (
        <ErrorState title={t({ ko: '그룹을 못 불러왔어', en: "Couldn't load groups" })} error={error} onRetry={onRetry} />
      ) : null}

      {!isLoading && !hasError && groups.length === 0 ? (
        <EmptyState icon={FolderOpen} title={t({ ko: '아직 그룹이 없어', en: 'No groups yet' })} />
      ) : null}

      {!isLoading && !hasError && groups.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {groups.map((group) => {
            const totalCount = getGroupHierarchyTotalCount(group, countMaps)
            return (
              <Panel key={group.id} asChild tone="container" padding="none" interactive className="group block w-full overflow-hidden text-left">
                <button type="button" onClick={() => onOpenGroup(group.id)}>
                  <GroupCoverMosaic
                    groupId={group.id}
                    sourceKey={sourceKey}
                    imageCount={totalCount}
                    loadPreviewImages={loadPreviewImages}
                    className="aspect-[4/3] w-full"
                  />
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <GroupColorDot color={group.color} size="md" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{group.name}</span>
                    {group.auto_collect_enabled ? (
                      <Tip content={t({ ko: '자동수집 켜짐', en: 'Auto-collect on' })}>
                        <Bot className="size-3.5 shrink-0 text-primary" aria-label={t({ ko: '자동수집 켜짐', en: 'Auto-collect on' })} />
                      </Tip>
                    ) : null}
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatNumber(totalCount)}</span>
                  </div>
                </button>
              </Panel>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
