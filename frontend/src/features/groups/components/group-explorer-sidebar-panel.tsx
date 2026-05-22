import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { GroupWithHierarchy } from '@/types/group'
import type { GroupCountMaps } from '@/features/groups/group-count-utils'
import { GroupTree } from './group-tree'
import { useI18n } from '@/i18n'

interface GroupExplorerSidebarPanelProps {
  isWideLayout: boolean
  groups: GroupWithHierarchy[]
  countMaps: GroupCountMaps
  selectedGroupId?: number
  isLoading: boolean
  isError: boolean
  errorMessage?: string | null
  headerExtra?: ReactNode
  onSelectGroup: (groupId: number) => void
}

/** Render the left explorer sidebar for group browsing with loading and error states. */
export function GroupExplorerSidebarPanel({
  isWideLayout,
  groups,
  countMaps,
  selectedGroupId,
  isLoading,
  isError,
  errorMessage,
  headerExtra,
  onSelectGroup,
}: GroupExplorerSidebarPanelProps) {
  const { t, formatNumber } = useI18n()

  return (
    <ExplorerSidebar
      title={t({ ko: '탐색기', en: 'Explorer' })}
      badge={<Badge variant="outline">{formatNumber(groups.length)}</Badge>}
      floatingFrame
      floatingLockStorageKey="conai:groups:sidebar-locked"
      className={cn('z-20 isolate', isWideLayout && 'sticky top-24 self-start flex max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)] flex-col')}
      bodyClassName={cn(isWideLayout && 'min-h-0 flex-1 overflow-y-auto pr-1')}
      headerExtra={headerExtra}
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full rounded-sm" />
          ))}
        </div>
      ) : null}

      {isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t('groups.components.group.explorer.sidebar.panel.failed.to.load.the.group.tree')}</AlertTitle>
          <AlertDescription>{errorMessage ?? t('groups.components.group.explorer.sidebar.panel.an.unknown.error.occurred')}</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && !isError ? (
        <GroupTree groups={groups} countMaps={countMaps} selectedGroupId={selectedGroupId} onSelectGroup={onSelectGroup} />
      ) : null}
    </ExplorerSidebar>
  )
}
