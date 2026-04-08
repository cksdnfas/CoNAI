import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import type { GroupWithHierarchy } from '@/types/group'
import { GroupTree } from './group-tree'

export interface GroupExplorerSidebarPanelProps {
  isWideLayout: boolean
  groups: GroupWithHierarchy[]
  selectedGroupId?: number
  isLoading: boolean
  isError: boolean
  errorMessage?: string | null
  onSelectGroup: (groupId: number) => void
}

/** Render the left explorer sidebar for group browsing with loading and error states. */
export function GroupExplorerSidebarPanel({
  isWideLayout,
  groups,
  selectedGroupId,
  isLoading,
  isError,
  errorMessage,
  onSelectGroup,
}: GroupExplorerSidebarPanelProps) {
  return (
    <ExplorerSidebar
      title="Explorer"
      badge={<Badge variant="outline">{groups.length}</Badge>}
      floatingFrame
      floatingLockStorageKey="conai:groups:sidebar-locked"
      className={cn(isWideLayout && 'sticky top-24 self-start flex max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)] flex-col')}
      bodyClassName={cn(isWideLayout && 'min-h-0 flex-1 overflow-y-auto pr-1')}
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
          <AlertTitle>그룹 트리를 불러오지 못했어</AlertTitle>
          <AlertDescription>{errorMessage ?? '알 수 없는 오류가 발생했어.'}</AlertDescription>
        </Alert>
      ) : null}

      {!isLoading && !isError ? (
        <GroupTree groups={groups} selectedGroupId={selectedGroupId} onSelectGroup={onSelectGroup} />
      ) : null}
    </ExplorerSidebar>
  )
}
