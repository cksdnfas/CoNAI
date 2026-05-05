import { BarChart3, ChevronDown, ChevronUp, Download, FolderPlus, Pencil, Tags, Trash2, Upload, Wrench } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  const { t, formatNumber } = useI18n()
  const visibleGroupCount = groups.filter((group) => group.id === 0 || Boolean(group.is_visible)).length

  return (
    <ExplorerSidebar
      title="Groups"
      badge={<Badge variant="outline">{formatNumber(visibleGroupCount)}</Badge>}
      floatingFrame
      floatingLockStorageKey="conai:prompts:sidebar-locked"
      className={cn('sticky top-24 z-30 isolate flex max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)] self-start flex-col')}
      bodyClassName="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1"
      headerExtra={
        <div className="flex flex-wrap justify-end gap-2 border-b border-white/5 pb-3">
          <Button type="button" size="icon-sm" variant="outline" className="bg-surface-low" onClick={() => onOpenSummary?.()} disabled={!onOpenSummary} aria-label={t('prompts.components.prompt.sidebar.status')} title={t('prompts.components.prompt.sidebar.status')}>
            <BarChart3 className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon-sm" variant="outline" className="bg-surface-low" onClick={() => onOpenCollect?.()} disabled={!onOpenCollect || !canCollect} aria-label={t('prompts.components.prompt.sidebar.manual.collect')} title={canCollect ? t('prompts.components.prompt.sidebar.manual.collect') : t('prompts.components.prompt.sidebar.manual.collect.is.not.available.for.auto')}>
            <Wrench className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon-sm" variant="outline" className="bg-surface-low" onClick={() => onCreateGroup?.()} disabled={!onCreateGroup} aria-label={t('prompts.components.prompt.sidebar.add.group')} title={t('prompts.components.prompt.sidebar.add.group')}>
            <FolderPlus className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon-sm" variant="outline" className="bg-surface-low" onClick={() => onOpenDanbooruGrouping?.()} disabled={!onOpenDanbooruGrouping} aria-label={t({ ko: 'Danbooru 기준 자동 그룹 구성', en: 'Danbooru auto grouping' })} title={t({ ko: 'Danbooru 기준 자동 그룹 구성', en: 'Danbooru auto grouping' })}>
            <Tags className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon-sm" variant="outline" className="bg-surface-low" onClick={() => onExportGroups?.()} disabled={!onExportGroups} aria-label={t('prompts.components.prompt.sidebar.export')} title={t('prompts.components.prompt.sidebar.export')}>
            <Download className="h-4 w-4" />
          </Button>
          <Button type="button" size="icon-sm" variant="outline" className="bg-surface-low" onClick={() => onImportGroups?.()} disabled={!onImportGroups} aria-label={t('prompts.components.prompt.sidebar.import')} title={t('prompts.components.prompt.sidebar.import')}>
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
          <AlertTitle>{t('prompts.components.prompt.sidebar.failed.to.load.groups')}</AlertTitle>
          <AlertDescription>{groupsError}</AlertDescription>
        </Alert>
      ) : null}

      {!groupsLoading && !groupsError ? (
        <>
          <PromptTree groups={groups} selectedGroupId={selectedGroupId} totalCount={totalCount} onSelectGroup={onSelectGroup} />

          <div className="border-t border-white/5 pt-3">
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" size="icon-sm" variant="outline" className="bg-surface-low" onClick={() => onMoveGroupUp?.()} disabled={!onMoveGroupUp || !canMoveGroupUp} aria-label={t('prompts.components.prompt.sidebar.move.up')} title={t('prompts.components.prompt.sidebar.move.up')}>
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon-sm" variant="outline" className="bg-surface-low" onClick={() => onMoveGroupDown?.()} disabled={!onMoveGroupDown || !canMoveGroupDown} aria-label={t('prompts.components.prompt.sidebar.move.down')} title={t('prompts.components.prompt.sidebar.move.down')}>
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon-sm" variant="outline" className="bg-surface-low" onClick={() => onEditGroup?.()} disabled={!onEditGroup || selectedGroupId == null || selectedGroupId === 0} aria-label={t('prompts.components.prompt.sidebar.edit')} title={t('prompts.components.prompt.sidebar.edit')}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button type="button" size="icon-sm" variant="outline" className="bg-surface-low" onClick={() => onDeleteGroup?.()} disabled={!onDeleteGroup || selectedGroupId == null || selectedGroupId === 0} aria-label={t('prompts.components.prompt.sidebar.delete')} title={t('prompts.components.prompt.sidebar.delete')}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </ExplorerSidebar>
  )
}
