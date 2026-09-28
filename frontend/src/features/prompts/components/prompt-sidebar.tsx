import { BarChart3, ChevronDown, ChevronUp, Download, Ellipsis, Inbox, Layers, Pencil, Plus, Tags, Trash2, Upload, Wrench } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { SidebarGroupLabel, SidebarItem, SidebarNav } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'
import { Tip } from '@/components/ui/tooltip'
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
  onExportGroups?: () => void
  onImportGroups?: () => void
  onOpenSummary?: () => void
  onOpenCollect?: () => void
  onOpenDanbooruGrouping?: () => void
}

/** Group tree of the prompt list: "All", then the group folders. Library tools sit behind the label's menu. */
export function PromptSidebar({
  groups,
  selectedGroupId,
  totalCount = 0,
  groupsLoading,
  groupsError,
  canCollect = true,
  onSelectGroup,
  onCreateGroup,
  onExportGroups,
  onImportGroups,
  onOpenSummary,
  onOpenCollect,
  onOpenDanbooruGrouping,
}: PromptSidebarProps) {
  const { t, formatNumber } = useI18n()
  const moreLabel = t({ ko: '그룹 도구', en: 'Group tools' })

  return (
    <SidebarNav>
      <SidebarGroupLabel
        actions={(
          <>
            <IconButton size="icon-xs" variant="ghost" onClick={() => onCreateGroup?.()} disabled={!onCreateGroup} label={t('prompts.components.prompt.sidebar.add.group')}>
              <Plus />
            </IconButton>
            <DropdownMenu>
              <Tip content={moreLabel}>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-xs" aria-label={moreLabel}>
                    <Ellipsis />
                  </Button>
                </DropdownMenuTrigger>
              </Tip>
              <DropdownMenuContent align="end" className="min-w-48">
                <DropdownMenuItem onSelect={() => onOpenSummary?.()} disabled={!onOpenSummary}>
                  <BarChart3 />
                  {t('prompts.components.prompt.sidebar.status')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onOpenCollect?.()} disabled={!onOpenCollect || !canCollect}>
                  <Wrench />
                  {canCollect ? t('prompts.components.prompt.sidebar.manual.collect') : t('prompts.components.prompt.sidebar.manual.collect.is.not.available.for.auto')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onOpenDanbooruGrouping?.()} disabled={!onOpenDanbooruGrouping}>
                  <Tags />
                  {t({ ko: 'Danbooru 기준 자동 그룹 구성', en: 'Danbooru auto grouping' })}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => onExportGroups?.()} disabled={!onExportGroups}>
                  <Download />
                  {t('prompts.components.prompt.sidebar.export')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onImportGroups?.()} disabled={!onImportGroups}>
                  <Upload />
                  {t('prompts.components.prompt.sidebar.import')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      >
        {t({ ko: '그룹', en: 'Groups' })}
      </SidebarGroupLabel>

      <SidebarItem
        icon={Layers}
        label={t({ ko: '전체', en: 'All' })}
        count={formatNumber(totalCount)}
        active={selectedGroupId == null}
        onClick={() => onSelectGroup(undefined)}
      />

      {groupsLoading ? Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="my-0.5 h-8 w-full rounded-sm" />) : null}

      {groupsError ? (
        <Alert variant="destructive" className="mt-2">
          <AlertTitle>{t('prompts.components.prompt.sidebar.failed.to.load.groups')}</AlertTitle>
          <AlertDescription>{groupsError}</AlertDescription>
        </Alert>
      ) : null}

      {!groupsLoading && !groupsError ? (
        <PromptTree
          groups={groups}
          selectedGroupId={selectedGroupId}
          onSelectGroup={onSelectGroup}
          getIcon={(group) => (group.id === 0 ? Inbox : undefined)}
        />
      ) : null}
    </SidebarNav>
  )
}

interface PromptGroupActionsProps {
  onEditGroup?: () => void
  onDeleteGroup?: () => void
  onMoveGroupUp?: () => void
  onMoveGroupDown?: () => void
}

/** Actions for the selected group, shown in the sidebar's bottom row. */
export function PromptGroupActions({ onEditGroup, onDeleteGroup, onMoveGroupUp, onMoveGroupDown }: PromptGroupActionsProps) {
  const { t } = useI18n()

  if (!onEditGroup && !onDeleteGroup && !onMoveGroupUp && !onMoveGroupDown) {
    return null
  }

  return (
    <div className="flex items-center gap-0.5">
      <IconButton size="icon-xs" variant="ghost" onClick={() => onMoveGroupUp?.()} disabled={!onMoveGroupUp} label={t('prompts.components.prompt.sidebar.move.up')}>
        <ChevronUp />
      </IconButton>
      <IconButton size="icon-xs" variant="ghost" onClick={() => onMoveGroupDown?.()} disabled={!onMoveGroupDown} label={t('prompts.components.prompt.sidebar.move.down')}>
        <ChevronDown />
      </IconButton>
      <IconButton size="icon-xs" variant="ghost" onClick={() => onEditGroup?.()} disabled={!onEditGroup} label={t('prompts.components.prompt.sidebar.edit')}>
        <Pencil />
      </IconButton>
      <IconButton size="icon-xs" variant="ghost" onClick={() => onDeleteGroup?.()} disabled={!onDeleteGroup} label={t('prompts.components.prompt.sidebar.delete')}>
        <Trash2 />
      </IconButton>
    </div>
  )
}
