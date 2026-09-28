import { FolderOpen } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { LoadingState } from '@/components/ui/loading-state'
import { SectionHeading } from '@/components/common/section-heading'
import type { GroupWithHierarchy } from '@/types/group'
import type { ImageRecord } from '@/types/image'
import type { GroupExplorerCardStyle } from '@conai/shared'
import { getGroupHierarchyTotalCount, type GroupCountMaps } from '@/features/groups/group-count-utils'
import { GroupChildCard } from './group-child-card'
import { useI18n } from '@/i18n'

interface GroupRootGridSectionProps {
  title: string
  groups: GroupWithHierarchy[]
  countMaps: GroupCountMaps
  cardStyle: GroupExplorerCardStyle
  gridClassName: string
  previewSourceKey: 'custom' | 'folders'
  loadPreviewImage: (groupId: number) => Promise<ImageRecord | null>
  onOpenGroup: (groupId: number) => void
  isLoading?: boolean
  error?: unknown
  onRetry?: () => void
}

/** Render the root-level group cards for the current group source. */
export function GroupRootGridSection({
  title,
  groups,
  countMaps,
  cardStyle,
  gridClassName,
  previewSourceKey,
  loadPreviewImage,
  onOpenGroup,
  isLoading = false,
  error = null,
  onRetry,
}: GroupRootGridSectionProps) {
  const hasError = error !== null && error !== undefined
  const { t, formatNumber } = useI18n()

  return (
    <section className="space-y-4">
      <SectionHeading
        heading={title}
        actions={isLoading || hasError ? undefined : <Badge variant="secondary">{t({ ko: '{count}개', en: '{count}' }, { count: formatNumber(groups.length) })}</Badge>}
      />

      {isLoading ? <LoadingState label={t({ ko: '그룹을 불러오는 중…', en: 'Loading groups…' })} /> : null}

      {!isLoading && hasError ? (
        <ErrorState
          title={t({ ko: '그룹을 못 불러왔어', en: "Couldn't load groups" })}
          error={error}
          onRetry={onRetry}
        />
      ) : null}

      {!isLoading && !hasError && groups.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title={t({ ko: '아직 그룹이 없어', en: 'No groups yet' })}
          description={t({ ko: '그룹을 만들거나 감시 폴더를 추가하면 여기에 보여.', en: 'Create a group or add a watched folder to see it here.' })}
        />
      ) : null}

      <div className={gridClassName}>
        {groups.map((group) => (
          <GroupChildCard
            key={group.id}
            group={group}
            previewSourceKey={previewSourceKey}
            loadPreviewImage={loadPreviewImage}
            totalImageCount={getGroupHierarchyTotalCount(group, countMaps)}
            cardStyle={cardStyle}
            onOpen={onOpenGroup}
          />
        ))}
      </div>
    </section>
  )
}
