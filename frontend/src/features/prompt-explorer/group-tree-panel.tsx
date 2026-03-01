import { useMemo, useState } from 'react'
import { ChevronsDown, ChevronsUp, Plus, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { GroupTreeNode } from '@/features/prompt-explorer/group-tree-node'
import type { PromptGroupWithChildren } from '@/features/prompt-explorer/types'

interface GroupTreePanelProps {
  groups: PromptGroupWithChildren[]
  selectedId: number | null
  expandedIds: Set<number>
  onSelectAllPrompts: () => void
  onSelectGroup: (group: PromptGroupWithChildren) => void
  onToggleGroup: (groupId: number) => void
  onExpandAll: () => void
  onCollapseAll: () => void
  onCreateGroup: () => void
}

function nodeMatches(node: PromptGroupWithChildren, keyword: string): boolean {
  const term = keyword.toLowerCase()
  if (node.group_name.toLowerCase().includes(term)) {
    return true
  }
  return node.children.some((child) => nodeMatches(child, keyword))
}

function filterTree(nodes: PromptGroupWithChildren[], keyword: string): PromptGroupWithChildren[] {
  if (!keyword.trim()) {
    return nodes
  }

  return nodes
    .filter((node) => nodeMatches(node, keyword))
    .map((node) => ({
      ...node,
      children: filterTree(node.children, keyword),
    }))
}

export function GroupTreePanel({
  groups,
  selectedId,
  expandedIds,
  onSelectAllPrompts,
  onSelectGroup,
  onToggleGroup,
  onExpandAll,
  onCollapseAll,
  onCreateGroup,
}: GroupTreePanelProps) {
  const [treeSearch, setTreeSearch] = useState('')

  const filtered = useMemo(() => filterTree(groups, treeSearch), [groups, treeSearch])

  return (
    <section className="flex h-full min-h-0 flex-col rounded-md border">
      <div className="space-y-2 p-2">
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2 h-4 w-4 -translate-y-1/2" />
          <Input
            value={treeSearch}
            onChange={(event) => setTreeSearch(event.target.value)}
            placeholder="Search groups"
            className="pr-8 pl-8"
            aria-label="Search groups"
          />
          {treeSearch ? (
            <button
              type="button"
              className="text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2"
              onClick={() => setTreeSearch('')}
              aria-label="Clear group search"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="sm" onClick={onExpandAll} className="h-8 px-2">
            <ChevronsDown className="mr-1 h-3.5 w-3.5" />
            Expand
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onCollapseAll} className="h-8 px-2">
            <ChevronsUp className="mr-1 h-3.5 w-3.5" />
            Collapse
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={onCreateGroup} className="ml-auto h-8 w-8" aria-label="Create group">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <Separator />

      <button
        type="button"
        className={`mx-2 mt-2 rounded px-2 py-1 text-left text-sm ${selectedId === null ? 'bg-accent font-medium' : 'hover:bg-accent/60'}`}
        onClick={onSelectAllPrompts}
      >
        All Prompts
      </button>

      <ScrollArea className="mt-2 min-h-0 flex-1 px-2 pb-2">
        {filtered.length > 0 ? (
          <ul className="space-y-0.5">
            {filtered.map((node) => (
              <GroupTreeNode
                key={node.id}
                node={node}
                level={0}
                selectedId={selectedId}
                expandedIds={expandedIds}
                searchTerm={treeSearch}
                onSelect={onSelectGroup}
                onToggle={onToggleGroup}
              />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground px-2 py-6 text-sm">No groups found.</p>
        )}
      </ScrollArea>
    </section>
  )
}
