import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Search, X } from 'lucide-react'
import { CreateGroupDialog } from '@/features/prompt-explorer/create-group-dialog'
import { GroupTreePanel } from '@/features/prompt-explorer/group-tree-panel'
import { PromptListPanel } from '@/features/prompt-explorer/prompt-list-panel'
import type { PromptExplorerType, PromptGroupWithChildren } from '@/features/prompt-explorer/types'
import {
  buildGroupTree,
  findGroupById,
  flattenGroupIds,
} from '@/features/prompt-explorer/utils'
import {
  promptCollectionApi,
  promptGroupApi,
  type PromptCollectionType,
  type PromptRecord,
  type PromptType,
} from '@/services/prompt-api'

interface PromptExplorerProps {
  type: PromptExplorerType
}

function toMutationType(type: PromptExplorerType): PromptType {
  if (type === 'negative') {
    return 'negative'
  }
  return 'positive'
}

function toSearchType(type: PromptExplorerType): PromptCollectionType {
  if (type === 'negative') {
    return 'negative'
  }
  if (type === 'positive') {
    return 'positive'
  }
  return 'auto'
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message
  }
  return 'Prompt request failed. Please try again.'
}

export function PromptExplorerFeature({ type }: PromptExplorerProps) {
  const [groups, setGroups] = useState<PromptGroupWithChildren[]>([])
  const [prompts, setPrompts] = useState<PromptRecord[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [selectedPromptIds, setSelectedPromptIds] = useState<Set<number>>(new Set())
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [createGroupOpen, setCreateGroupOpen] = useState(false)

  const mutationType = useMemo(() => toMutationType(type), [type])
  const searchType = useMemo(() => toSearchType(type), [type])
  const searching = searchQuery.trim().length > 0

  const selectedGroup = useMemo(() => findGroupById(groups, selectedGroupId), [groups, selectedGroupId])
  const subGroups = useMemo(() => {
    if (selectedGroupId === null) {
      return groups
    }
    return selectedGroup?.children ?? []
  }, [groups, selectedGroup, selectedGroupId])

  const loadGroups = useCallback(async () => {
    const response = await promptGroupApi.getGroups(false, mutationType)
    setGroups(buildGroupTree(response.data ?? []))
  }, [mutationType])

  const loadPrompts = useCallback(async () => {
    const response = await promptCollectionApi.searchPrompts(
      searchQuery,
      searchType,
      1,
      200,
      'usage_count',
      'DESC',
      searching ? undefined : selectedGroupId,
    )
    setPrompts(response.data ?? [])
  }, [searchQuery, searchType, searching, selectedGroupId])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await Promise.all([loadGroups(), loadPrompts()])
    } catch (loadError) {
      setError(getErrorMessage(loadError))
    } finally {
      setLoading(false)
    }
  }, [loadGroups, loadPrompts])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  const handleToggleGroup = (groupId: number) => {
    setExpandedIds((previous) => {
      const next = new Set(previous)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const handleTogglePrompt = (promptId: number, multiSelect: boolean) => {
    setSelectedPromptIds((previous) => {
      const next = new Set(multiSelect ? previous : [])
      if (next.has(promptId)) {
        next.delete(promptId)
      } else {
        next.add(promptId)
      }
      return next
    })
  }

  const handleSelectGroup = (group: PromptGroupWithChildren) => {
    setSelectedGroupId(group.id)
    setSelectedPromptIds(new Set())
    if (!expandedIds.has(group.id) && group.children.length > 0) {
      handleToggleGroup(group.id)
    }
  }

  const handleSelectAll = () => {
    setSelectedPromptIds(new Set(prompts.map((item) => item.id)))
  }

  const handleMoveSelected = async (targetGroupId: number | null) => {
    if (selectedPromptIds.size === 0) {
      return
    }

    const ids = Array.from(selectedPromptIds)
    await Promise.all(ids.map((promptId) => promptCollectionApi.assignPromptToGroup(promptId, targetGroupId, mutationType)))
    setSelectedPromptIds(new Set())
    await loadAll()
  }

  const handleDeleteSelected = async () => {
    if (selectedPromptIds.size === 0) {
      return
    }

    const confirmed = window.confirm(`Are you sure you want to delete ${selectedPromptIds.size} prompts?`)
    if (!confirmed) {
      return
    }

    const ids = Array.from(selectedPromptIds)
    await Promise.all(ids.map((promptId) => promptCollectionApi.deletePrompt(promptId, mutationType)))
    setSelectedPromptIds(new Set())
    await loadAll()
  }

  const handleCreateGroup = async (name: string, parentId: number | null) => {
    await promptGroupApi.createGroup(
      {
        group_name: name,
        parent_id: parentId,
      },
      mutationType,
    )
    await loadGroups()
  }

  const handleDeleteSelectedGroup = async () => {
    if (selectedGroupId === null) {
      return
    }

    const confirmed = window.confirm('Are you sure you want to delete this group?')
    if (!confirmed) {
      return
    }

    await promptGroupApi.deleteGroup(selectedGroupId, mutationType)
    setSelectedGroupId(null)
    setSelectedPromptIds(new Set())
    await loadAll()
  }

  return (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="text-muted-foreground absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2" />
          <Input
            aria-label="Search prompts"
            placeholder="Search prompts"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="pr-8 pl-8"
          />
          {searchQuery ? (
            <button
              type="button"
              className="text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2"
              onClick={() => setSearchQuery('')}
              aria-label="Clear prompt search"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>
        <Button type="button" variant="outline" onClick={() => void loadAll()} disabled={loading}>
          Refresh
        </Button>
      </div>

      <div className="grid min-h-[28rem] gap-3 md:grid-cols-[18rem_1fr]">
        <GroupTreePanel
          groups={groups}
          selectedId={selectedGroupId}
          expandedIds={expandedIds}
          onSelectAllPrompts={() => {
            setSelectedGroupId(null)
            setSelectedPromptIds(new Set())
          }}
          onSelectGroup={handleSelectGroup}
          onToggleGroup={handleToggleGroup}
          onExpandAll={() => setExpandedIds(new Set(flattenGroupIds(groups)))}
          onCollapseAll={() => setExpandedIds(new Set())}
          onCreateGroup={() => setCreateGroupOpen(true)}
        />

        <PromptListPanel
          type={type}
          prompts={prompts}
          groups={groups}
          subGroups={searching ? [] : subGroups}
          selectedGroupName={selectedGroup?.group_name ?? null}
          selectedGroupId={selectedGroupId}
          selectedPromptIds={selectedPromptIds}
          searching={searching}
          loading={loading}
          onTogglePrompt={handleTogglePrompt}
          onSelectAll={handleSelectAll}
          onClearSelection={() => setSelectedPromptIds(new Set())}
          onOpenGroup={handleSelectGroup}
          onDeleteSelected={handleDeleteSelected}
          onMoveSelected={handleMoveSelected}
          onDeleteSelectedGroup={handleDeleteSelectedGroup}
        />
      </div>

      <CreateGroupDialog
        open={createGroupOpen}
        groups={groups}
        onClose={() => setCreateGroupOpen(false)}
        onCreate={handleCreateGroup}
      />
    </div>
  )
}
