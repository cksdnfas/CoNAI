import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GroupWithHierarchy } from '@/types/group'

interface GroupTreeProps {
  groups: GroupWithHierarchy[]
  selectedGroupId?: number
  onSelectGroup: (groupId: number) => void
}

function buildChildrenMap(groups: GroupWithHierarchy[]) {
  const map = new Map<number | null, GroupWithHierarchy[]>()

  for (const group of groups) {
    const parentId = group.parent_id ?? null
    const siblings = map.get(parentId) ?? []
    siblings.push(group)
    map.set(parentId, siblings)
  }

  for (const siblings of map.values()) {
    siblings.sort((left, right) => left.name.localeCompare(right.name))
  }

  return map
}

function collectAncestorIds(groups: GroupWithHierarchy[], groupId?: number) {
  if (!groupId) {
    return []
  }

  const parentById = new Map(groups.map((group) => [group.id, group.parent_id ?? null]))
  const ancestors: number[] = []
  let currentParentId = parentById.get(groupId) ?? null

  while (typeof currentParentId === 'number') {
    ancestors.unshift(currentParentId)
    currentParentId = parentById.get(currentParentId) ?? null
  }

  return ancestors
}

export function GroupTree({ groups, selectedGroupId, onSelectGroup }: GroupTreeProps) {
  const childrenByParentId = useMemo(() => buildChildrenMap(groups), [groups])
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set(collectAncestorIds(groups, selectedGroupId)))

  useEffect(() => {
    const ancestorIds = collectAncestorIds(groups, selectedGroupId)
    if (ancestorIds.length === 0) {
      return
    }

    setExpandedIds((current) => {
      const next = new Set(current)
      for (const ancestorId of ancestorIds) {
        next.add(ancestorId)
      }
      return next
    })
  }, [groups, selectedGroupId])

  const toggleExpanded = (groupId: number) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(groupId)) {
        next.delete(groupId)
      } else {
        next.add(groupId)
      }
      return next
    })
  }

  const expandOnly = (groupId: number) => {
    setExpandedIds((current) => {
      if (current.has(groupId)) {
        return current
      }
      const next = new Set(current)
      next.add(groupId)
      return next
    })
  }

  const renderNodes = (parentId: number | null, depth: number): ReactNode => {
    const nodes = childrenByParentId.get(parentId) ?? []
    if (nodes.length === 0) {
      return null
    }

    return (
      <div className="space-y-1">
        {nodes.map((group) => {
          const hasChildren = (childrenByParentId.get(group.id) ?? []).length > 0
          const isExpanded = expandedIds.has(group.id)
          const isSelected = selectedGroupId === group.id
          const hasImages = group.image_count > 0
          const isDisabledLeaf = !hasChildren && !hasImages

          return (
            <div key={group.id}>
              <div className="flex items-center gap-1" style={{ paddingLeft: `${depth * 14}px` }}>
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggleExpanded(group.id)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-low hover:text-foreground"
                    aria-label={isExpanded ? `${group.name} 접기` : `${group.name} 펼치기`}
                    title={isExpanded ? '접기' : '펼치기'}
                  >
                    <ChevronRight className={cn('h-4 w-4 transition-transform', isExpanded && 'rotate-90')} />
                  </button>
                ) : (
                  <span className="inline-flex h-8 w-8 shrink-0" aria-hidden="true" />
                )}

                {isDisabledLeaf ? (
                  <div className="inline-flex max-w-full items-center gap-2 rounded-sm px-2 py-2 text-sm text-muted-foreground/45">
                    <Folder className="h-4 w-4 shrink-0" />
                    <span className="truncate">{group.name}</span>
                    <span className="shrink-0 text-xs">{group.image_count.toLocaleString('ko-KR')}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (hasChildren) {
                        expandOnly(group.id)
                      }
                      if (hasImages) {
                        onSelectGroup(group.id)
                      }
                    }}
                    className={cn(
                      'inline-flex max-w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm transition-colors',
                      isSelected ? 'bg-surface-container text-primary' : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
                    )}
                    title={group.name}
                  >
                    {hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />}
                    <span className="truncate">{group.name}</span>
                    <span className="shrink-0 text-xs">{group.image_count.toLocaleString('ko-KR')}</span>
                  </button>
                )}
              </div>

              {hasChildren && isExpanded ? renderNodes(group.id, depth + 1) : null}
            </div>
          )
        })}
      </div>
    )
  }

  return <div>{renderNodes(null, 0)}</div>
}
