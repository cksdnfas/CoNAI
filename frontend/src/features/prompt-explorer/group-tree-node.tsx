import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import type { PromptGroupWithChildren } from '@/features/prompt-explorer/types'

interface GroupTreeNodeProps {
  node: PromptGroupWithChildren
  level: number
  selectedId: number | null
  expandedIds: Set<number>
  searchTerm?: string
  onSelect: (group: PromptGroupWithChildren) => void
  onToggle: (groupId: number) => void
}

function HighlightedLabel({ label, searchTerm }: { label: string; searchTerm?: string }) {
  if (!searchTerm || !searchTerm.trim()) {
    return <>{label}</>
  }

  const lower = label.toLowerCase()
  const keyword = searchTerm.toLowerCase()
  const index = lower.indexOf(keyword)
  if (index < 0) {
    return <>{label}</>
  }

  const head = label.slice(0, index)
  const mid = label.slice(index, index + searchTerm.length)
  const tail = label.slice(index + searchTerm.length)

  return (
    <>
      {head}
      <span className="rounded bg-amber-400/30 px-0.5">{mid}</span>
      {tail}
    </>
  )
}

export function GroupTreeNode({
  node,
  level,
  selectedId,
  expandedIds,
  searchTerm,
  onSelect,
  onToggle,
}: GroupTreeNodeProps) {
  const hasChildren = node.children.length > 0
  const isExpanded = expandedIds.has(node.id)
  const isSelected = node.id === selectedId

  return (
    <li>
      <div
        className={`flex items-center gap-1 rounded px-1 py-1 text-sm ${isSelected ? 'bg-accent font-medium' : 'hover:bg-accent/60'}`}
        style={{ paddingLeft: `${4 + level * 12}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onToggle(node.id)
            }}
            className="inline-flex h-5 w-5 items-center justify-center rounded hover:bg-accent"
            aria-label={isExpanded ? `Collapse ${node.group_name}` : `Expand ${node.group_name}`}
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
          </button>
        ) : (
          <span className="inline-block h-5 w-5" aria-hidden="true" />
        )}

        {hasChildren && isExpanded ? <FolderOpen className="h-4 w-4 text-primary" /> : <Folder className="h-4 w-4 text-primary" />}

        <button
          type="button"
          className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
          onClick={() => onSelect(node)}
        >
          <span className="truncate"><HighlightedLabel label={node.group_name} searchTerm={searchTerm} /></span>
          <span className="text-xs text-muted-foreground">{node.prompt_count ?? 0}</span>
        </button>
      </div>

      {hasChildren && isExpanded ? (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <GroupTreeNode
              key={child.id}
              node={child}
              level={level + 1}
              selectedId={selectedId}
              expandedIds={expandedIds}
              searchTerm={searchTerm}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
