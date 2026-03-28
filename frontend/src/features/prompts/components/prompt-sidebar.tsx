import { FolderPlus, Pencil, Trash2, ChevronUp, ChevronDown, Download, Upload } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import type { PromptGroupRecord } from '@/types/prompt'
import { PromptTree } from './prompt-tree'

interface PromptSidebarProps {
  groups: PromptGroupRecord[]
  selectedGroupId?: number | null
  totalCount?: number
  groupsLoading: boolean
  groupsError: string | null
  onSelectGroup: (groupId?: number | null) => void
  onCreateGroup?: () => void
  onEditGroup?: () => void
  onDeleteGroup?: () => void
  onMoveGroupUp?: () => void
  onMoveGroupDown?: () => void
  onExportGroups?: () => void
  onImportGroups?: () => void
  canMoveGroupUp?: boolean
  canMoveGroupDown?: boolean
}

export function PromptSidebar({
  groups,
  selectedGroupId,
  totalCount = 0,
  groupsLoading,
  groupsError,
  onSelectGroup,
  onCreateGroup,
  onEditGroup,
  onDeleteGroup,
  onMoveGroupUp,
  onMoveGroupDown,
  onExportGroups,
  onImportGroups,
  canMoveGroupUp = false,
  canMoveGroupDown = false,
}: PromptSidebarProps) {
  return (
    <ExplorerSidebar
      title="Groups"
      badge={<Badge variant="outline">{groups.length}</Badge>}
      className="min-[800px]:sticky min-[800px]:top-24 min-[800px]:self-start"
      headerExtra={
        <div className="space-y-2 border-b border-white/5 pb-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => onCreateGroup?.()} disabled={!onCreateGroup}>
              <FolderPlus className="h-4 w-4" />
              그룹 추가
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => onEditGroup?.()} disabled={!onEditGroup || selectedGroupId == null || selectedGroupId === 0}>
              <Pencil className="h-4 w-4" />
              편집
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => onMoveGroupUp?.()} disabled={!onMoveGroupUp || !canMoveGroupUp}>
              <ChevronUp className="h-4 w-4" />
              위로
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => onMoveGroupDown?.()} disabled={!onMoveGroupDown || !canMoveGroupDown}>
              <ChevronDown className="h-4 w-4" />
              아래로
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => onDeleteGroup?.()} disabled={!onDeleteGroup || selectedGroupId == null || selectedGroupId === 0}>
              <Trash2 className="h-4 w-4" />
              삭제
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => onExportGroups?.()} disabled={!onExportGroups}>
              <Download className="h-4 w-4" />
              Export
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => onImportGroups?.()} disabled={!onImportGroups}>
              <Upload className="h-4 w-4" />
              Import
            </Button>
          </div>
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
        <PromptTree groups={groups} selectedGroupId={selectedGroupId} totalCount={totalCount} onSelectGroup={onSelectGroup} />
      ) : null}
    </ExplorerSidebar>
  )
}
