import { BarChart3, ChevronDown, ChevronUp, Download, FolderPlus, Pencil, Trash2, Upload, Wrench } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { cn } from '@/lib/utils'
import type { PromptGroupRecord } from '@/types/prompt'
import { PromptTree } from './prompt-tree'

interface PromptSidebarProps {
  groups: PromptGroupRecord[]
  selectedGroupId?: number | null
  totalCount?: number
  groupsLoading: boolean
  groupsError: string | null
  isDesktopPageLayout?: boolean
  canCollect?: boolean
  onSelectGroup: (groupId?: number | null) => void
  onCreateGroup?: () => void
  onEditGroup?: () => void
  onDeleteGroup?: () => void
  onMoveGroupUp?: () => void
  onMoveGroupDown?: () => void
  onExportGroups?: () => void
  onImportGroups?: () => void
  onOpenSummary?: () => void
  onOpenCollect?: () => void
  canMoveGroupUp?: boolean
  canMoveGroupDown?: boolean
}

export function PromptSidebar({
  groups,
  selectedGroupId,
  totalCount = 0,
  groupsLoading,
  groupsError,
  isDesktopPageLayout = false,
  canCollect = true,
  onSelectGroup,
  onCreateGroup,
  onEditGroup,
  onDeleteGroup,
  onMoveGroupUp,
  onMoveGroupDown,
  onExportGroups,
  onImportGroups,
  onOpenSummary,
  onOpenCollect,
  canMoveGroupUp = false,
  canMoveGroupDown = false,
}: PromptSidebarProps) {
  return (
    <ExplorerSidebar
      title="Groups"
      badge={<Badge variant="outline">{groups.length}</Badge>}
      floatingFrame
      className={cn('sticky top-24 z-30 isolate self-start', isDesktopPageLayout && 'flex max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)] flex-col')}
      bodyClassName={cn('space-y-4', isDesktopPageLayout && 'min-h-0 flex-1 overflow-y-auto pr-1')}
      headerExtra={
        <div className="flex flex-wrap gap-2 border-b border-white/5 pb-3">
          <Button type="button" size="icon-sm" variant="outline" className="bg-surface-container" onClick={() => onOpenSummary?.()} disabled={!onOpenSummary} aria-label="상태" title="상태">
            <BarChart3 className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon-sm" variant="outline" className="bg-surface-container" onClick={() => onOpenCollect?.()} disabled={!onOpenCollect || !canCollect} aria-label="수동 수집" title={canCollect ? '수동 수집' : 'Auto에서는 수동 수집 불가'}>
            <Wrench className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon-sm" variant="outline" className="bg-surface-container" onClick={() => onCreateGroup?.()} disabled={!onCreateGroup} aria-label="그룹 추가" title="그룹 추가">
            <FolderPlus className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon-sm" variant="outline" className="bg-surface-container" onClick={() => onExportGroups?.()} disabled={!onExportGroups} aria-label="내보내기" title="내보내기">
            <Download className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon-sm" variant="outline" className="bg-surface-container" onClick={() => onImportGroups?.()} disabled={!onImportGroups} aria-label="가져오기" title="가져오기">
            <Upload className="h-4 w-4" />
          </Button>
        </div>
      }
    >
      {groupsLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full rounded-sm" />
          ))}
        </div>
      ) : null}

      {groupsError ? (
        <Alert variant="destructive">
          <AlertTitle>그룹을 불러오지 못했어</AlertTitle>
          <AlertDescription>{groupsError}</AlertDescription>
        </Alert>
      ) : null}

      {!groupsLoading && !groupsError ? (
        <>
          <PromptTree groups={groups} selectedGroupId={selectedGroupId} totalCount={totalCount} onSelectGroup={onSelectGroup} />

          <div className="border-t border-white/5 pt-3">
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="icon-sm" variant="outline" className="bg-surface-container" onClick={() => onMoveGroupUp?.()} disabled={!onMoveGroupUp || !canMoveGroupUp} aria-label="위로 이동" title="위로 이동">
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon-sm" variant="outline" className="bg-surface-container" onClick={() => onMoveGroupDown?.()} disabled={!onMoveGroupDown || !canMoveGroupDown} aria-label="아래로 이동" title="아래로 이동">
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon-sm" variant="outline" className="bg-surface-container" onClick={() => onEditGroup?.()} disabled={!onEditGroup || selectedGroupId == null || selectedGroupId === 0} aria-label="편집" title="편집">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon-sm" variant="outline" className="bg-surface-container" onClick={() => onDeleteGroup?.()} disabled={!onDeleteGroup || selectedGroupId == null || selectedGroupId === 0} aria-label="삭제" title="삭제">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </ExplorerSidebar>
  )
}
