import { BarChart3, ChevronDown, ChevronUp, Download, FolderPlus, Pencil, Tags, Trash2, Upload, Wrench } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { cn } from '@/lib/utils'
import type { PromptGroupRecord } from '@/types/prompt'
import { useI18n } from '@/i18n'
import { PromptTree } from './prompt-tree'

interface PromptSidebarProps {
  groups: PromptGroupRecord[]
  selectedGroupId?: number | null
  totalCount?: number
  groupsLoading: boolean
  groupsError: string | null
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
  onOpenDanbooruGrouping?: () => void
  canMoveGroupUp?: boolean
  canMoveGroupDown?: boolean
}

export function PromptSidebar({
  groups,
  selectedGroupId,
  totalCount = 0,
  groupsLoading,
  groupsError,
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
  onOpenDanbooruGrouping,
  canMoveGroupUp = false,
  canMoveGroupDown = false,
}: PromptSidebarProps) {
  const { t } = useI18n()

  return (
    <ExplorerSidebar
      title={t({ ko: '그룹', en: 'Groups' })}
      floatingFrame
      floatingLockStorageKey="conai:prompts:sidebar-locked"
      className={cn('sticky top-24 z-30 isolate flex max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)] self-start flex-col')}
      bodyClassName="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
      headerExtra={
        <div className="flex flex-wrap justify-end gap-1.5 pb-1">
          <IconButton size="icon-sm" variant="subtle" onClick={() => onOpenSummary?.()} disabled={!onOpenSummary} label={t('prompts.components.prompt.sidebar.status')}>
            <BarChart3 className="h-4 w-4" />
          </IconButton>
          <IconButton size="icon-sm" variant="subtle" onClick={() => onOpenCollect?.()} disabled={!onOpenCollect || !canCollect} label={canCollect ? t('prompts.components.prompt.sidebar.manual.collect') : t('prompts.components.prompt.sidebar.manual.collect.is.not.available.for.auto')}>
            <Wrench className="h-4 w-4" />
          </IconButton>
          <IconButton size="icon-sm" variant="subtle" onClick={() => onCreateGroup?.()} disabled={!onCreateGroup} label={t('prompts.components.prompt.sidebar.add.group')}>
            <FolderPlus className="h-4 w-4" />
          </IconButton>
          <IconButton size="icon-sm" variant="subtle" onClick={() => onOpenDanbooruGrouping?.()} disabled={!onOpenDanbooruGrouping} label={t({ ko: 'Danbooru 기준 자동 그룹 구성', en: 'Danbooru auto grouping' })}>
            <Tags className="h-4 w-4" />
          </IconButton>
          <IconButton size="icon-sm" variant="subtle" onClick={() => onExportGroups?.()} disabled={!onExportGroups} label={t('prompts.components.prompt.sidebar.export')}>
            <Download className="h-4 w-4" />
          </IconButton>
          <IconButton size="icon-sm" variant="subtle" onClick={() => onImportGroups?.()} disabled={!onImportGroups} label={t('prompts.components.prompt.sidebar.import')}>
            <Upload className="h-4 w-4" />
          </IconButton>
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
          <AlertTitle>{t('prompts.components.prompt.sidebar.failed.to.load.groups')}</AlertTitle>
          <AlertDescription>{groupsError}</AlertDescription>
        </Alert>
      ) : null}

      {!groupsLoading && !groupsError ? (
        <>
          <PromptTree groups={groups} selectedGroupId={selectedGroupId} totalCount={totalCount} onSelectGroup={onSelectGroup} />

          <div className="pt-1">
            <div className="flex flex-wrap justify-end gap-2">
              <IconButton size="icon-sm" variant="subtle" onClick={() => onMoveGroupUp?.()} disabled={!onMoveGroupUp || !canMoveGroupUp} label={t('prompts.components.prompt.sidebar.move.up')}>
                <ChevronUp className="h-4 w-4" />
              </IconButton>
              <IconButton size="icon-sm" variant="subtle" onClick={() => onMoveGroupDown?.()} disabled={!onMoveGroupDown || !canMoveGroupDown} label={t('prompts.components.prompt.sidebar.move.down')}>
                <ChevronDown className="h-4 w-4" />
              </IconButton>
              <IconButton size="icon-sm" variant="subtle" onClick={() => onEditGroup?.()} disabled={!onEditGroup || selectedGroupId == null || selectedGroupId === 0} label={t('prompts.components.prompt.sidebar.edit')}>
                <Pencil className="h-4 w-4" />
              </IconButton>
              <IconButton size="icon-sm" variant="subtle" onClick={() => onDeleteGroup?.()} disabled={!onDeleteGroup || selectedGroupId == null || selectedGroupId === 0} label={t('prompts.components.prompt.sidebar.delete')}>
                <Trash2 className="h-4 w-4" />
              </IconButton>
            </div>
          </div>
        </>
      ) : null}
    </ExplorerSidebar>
  )
}
