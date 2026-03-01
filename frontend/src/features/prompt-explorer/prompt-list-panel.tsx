import { useMemo, useState } from 'react'
import { ArrowRightLeft, CheckSquare, Folder, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import type { PromptRecord } from '@/services/prompt-api'
import { groupPromptsByGroup } from '@/features/prompt-explorer/utils'
import { MovePromptsDialog } from '@/features/prompt-explorer/move-prompts-dialog'
import type { PromptGroupWithChildren } from '@/features/prompt-explorer/types'

interface PromptListPanelProps {
  type: 'positive' | 'negative' | 'auto'
  prompts: PromptRecord[]
  groups: PromptGroupWithChildren[]
  subGroups: PromptGroupWithChildren[]
  selectedGroupName: string | null
  selectedGroupId: number | null
  selectedPromptIds: Set<number>
  searching: boolean
  loading: boolean
  onTogglePrompt: (promptId: number, multiSelect: boolean) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onOpenGroup: (group: PromptGroupWithChildren) => void
  onDeleteSelected: () => Promise<void>
  onMoveSelected: (targetGroupId: number | null) => Promise<void>
  onDeleteSelectedGroup: () => Promise<void>
}

export function PromptListPanel({
  type,
  prompts,
  groups,
  subGroups,
  selectedGroupName,
  selectedGroupId,
  selectedPromptIds,
  searching,
  loading,
  onTogglePrompt,
  onSelectAll,
  onClearSelection,
  onOpenGroup,
  onDeleteSelected,
  onMoveSelected,
  onDeleteSelectedGroup,
}: PromptListPanelProps) {
  const [moveDialogOpen, setMoveDialogOpen] = useState(false)
  const selectedCount = selectedPromptIds.size

  const groupedSearchResults = useMemo(() => {
    if (!searching) {
      return null
    }
    return groupPromptsByGroup(prompts, groups)
  }, [groups, prompts, searching])

  const title = searching
    ? `Search Results (${prompts.length})`
    : `${selectedGroupName ?? 'All Prompts'} (${prompts.length})`

  return (
    <section className="flex h-full min-h-0 flex-col rounded-md border" data-testid={`prompt-list-${type}`}>
      <div className="flex flex-wrap items-center gap-1 p-2">
        <p className="mr-2 text-sm font-semibold">{title}</p>
        <Button type="button" variant="outline" size="sm" className="h-8 px-2" onClick={onSelectAll}>
          <CheckSquare className="mr-1 h-3.5 w-3.5" />
          Select all
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8 px-2" onClick={onClearSelection} disabled={selectedCount === 0}>
          Clear
        </Button>

        {!searching && selectedGroupId !== null ? (
          <Button type="button" variant="outline" size="sm" className="ml-auto h-8 px-2" onClick={() => void onDeleteSelectedGroup()}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            Delete group
          </Button>
        ) : null}

        {selectedCount > 0 ? (
          <>
            <Button type="button" variant="outline" size="sm" className="h-8 px-2" onClick={() => setMoveDialogOpen(true)}>
              <ArrowRightLeft className="mr-1 h-3.5 w-3.5" />
              Move ({selectedCount})
            </Button>
            <Button type="button" variant="outline" size="sm" className="h-8 px-2" onClick={() => void onDeleteSelected()}>
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Delete ({selectedCount})
            </Button>
          </>
        ) : null}
      </div>

      <Separator />

      <ScrollArea className="min-h-0 flex-1 p-3">
        {!searching && subGroups.length > 0 ? (
          <div className="mb-3 space-y-2">
            <p className="text-muted-foreground text-xs font-medium">Folders</p>
            <div className="flex flex-wrap gap-2">
              {subGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => onOpenGroup(group)}
                  className="hover:bg-accent inline-flex items-center gap-1 rounded border px-2 py-1 text-sm"
                >
                  <Folder className="h-3.5 w-3.5" />
                  <span>{group.group_name}</span>
                </button>
              ))}
            </div>
            <Separator />
          </div>
        ) : null}

        {loading ? (
          <p className="text-muted-foreground text-sm">Loading prompts...</p>
        ) : null}

        {!loading && searching && groupedSearchResults ? (
          <div className="space-y-4">
            {groupedSearchResults.map((groupResult) => (
              <div key={String(groupResult.id)} className="space-y-2">
                <p className="text-muted-foreground text-xs font-semibold">{groupResult.name} ({groupResult.prompts.length})</p>
                <div className="flex flex-wrap gap-2">
                  {groupResult.prompts.map((prompt) => {
                    const selected = selectedPromptIds.has(prompt.id)
                    return (
                      <button
                        key={prompt.id}
                        type="button"
                        onClick={(event) => onTogglePrompt(prompt.id, event.ctrlKey || event.metaKey || event.shiftKey)}
                        className={`rounded border px-2 py-1 text-left text-sm ${selected ? 'bg-accent border-primary' : 'hover:bg-accent/60'}`}
                      >
                        <span>{prompt.prompt}</span>
                        <span className="text-muted-foreground ml-1 text-xs">({prompt.usage_count ?? 0})</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
            {groupedSearchResults.length === 0 ? <p className="text-muted-foreground text-sm">No matching prompts found.</p> : null}
          </div>
        ) : null}

        {!loading && !searching ? (
          prompts.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {prompts.map((prompt) => {
                const selected = selectedPromptIds.has(prompt.id)
                return (
                  <button
                    key={prompt.id}
                    type="button"
                    onClick={(event) => onTogglePrompt(prompt.id, event.ctrlKey || event.metaKey || event.shiftKey)}
                    className={`rounded border px-2 py-1 text-left text-sm ${selected ? 'bg-accent border-primary' : 'hover:bg-accent/60'}`}
                  >
                    <span>{prompt.prompt}</span>
                    <span className="text-muted-foreground ml-1 text-xs">({prompt.usage_count ?? 0})</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">No groups or prompts found.</p>
          )
        ) : null}
      </ScrollArea>

      <MovePromptsDialog
        open={moveDialogOpen}
        selectedCount={selectedCount}
        groups={groups}
        onClose={() => setMoveDialogOpen(false)}
        onConfirm={async (targetGroupId) => {
          await onMoveSelected(targetGroupId)
          setMoveDialogOpen(false)
        }}
      />
    </section>
  )
}
