import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, FileCode2, Folder, Search } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { getNavigationItemClassName } from '@/components/common/navigation-item'
import type { GraphWorkflowFolderRecord, GraphWorkflowRecord, ModuleDefinitionRecord } from '@/lib/api'
import { cn } from '@/lib/utils'
import { isFinalResultModule } from '../module-graph-shared'

const WORKFLOW_SIDEBAR_LOCK_STORAGE_KEY = 'conai:module-graph:workflow-sidebar-locked'

type SavedGraphListProps = {
  graphs: GraphWorkflowRecord[]
  folders: GraphWorkflowFolderRecord[]
  selectedGraphId: number | null
  selectedFolderId: number | null
  moduleDefinitionById: Map<number, ModuleDefinitionRecord>
  onLoadGraph: (graph: GraphWorkflowRecord) => void
  onSelectFolder: (folderId: number | null) => void
  leftToolbar?: ReactNode
  rightToolbar?: ReactNode
}

type TreeEntry =
  | { type: 'folder'; label: string; folder: GraphWorkflowFolderRecord }
  | { type: 'workflow'; label: string; workflow: GraphWorkflowRecord }

function normalizeFolderKey(folderId: number | null | undefined) {
  return folderId ?? null
}

function compareTreeLabels(left: string, right: string) {
  return left.localeCompare(right, 'ko-KR', { numeric: true, sensitivity: 'base' })
}

function sortTreeEntries(left: TreeEntry, right: TreeEntry) {
  if (left.type !== right.type) {
    return left.type === 'workflow' ? -1 : 1
  }

  return compareTreeLabels(left.label, right.label)
}

/** Render one explorer-style tree sidebar for workflow folders and documents. */
export function SavedGraphList({
  graphs,
  folders,
  selectedGraphId,
  selectedFolderId,
  moduleDefinitionById,
  onLoadGraph,
  onSelectFolder,
  leftToolbar,
  rightToolbar,
}: SavedGraphListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<number[]>([])

  const foldersByParent = useMemo(() => {
    const nextMap = new Map<number | null, GraphWorkflowFolderRecord[]>()
    for (const folder of folders) {
      const parentId = normalizeFolderKey(folder.parent_id)
      const bucket = nextMap.get(parentId) ?? []
      bucket.push(folder)
      nextMap.set(parentId, bucket)
    }

    for (const entry of nextMap.values()) {
      entry.sort((left, right) => compareTreeLabels(left.name, right.name))
    }

    return nextMap
  }, [folders])

  const workflowsByFolder = useMemo(() => {
    const nextMap = new Map<number | null, GraphWorkflowRecord[]>()
    for (const graph of graphs) {
      const folderId = normalizeFolderKey(graph.folder_id)
      const bucket = nextMap.get(folderId) ?? []
      bucket.push(graph)
      nextMap.set(folderId, bucket)
    }

    for (const entry of nextMap.values()) {
      entry.sort((left, right) => compareTreeLabels(left.name, right.name))
    }

    return nextMap
  }, [graphs])

  const finalResultNodeCountByWorkflowId = useMemo(() => {
    const nextMap = new Map<number, number>()

    for (const graph of graphs) {
      const finalResultCount = graph.graph.nodes.reduce((count, node) => {
        const module = moduleDefinitionById.get(node.module_id)
        return count + (module && isFinalResultModule(module) ? 1 : 0)
      }, 0)

      nextMap.set(graph.id, finalResultCount)
    }

    return nextMap
  }, [graphs, moduleDefinitionById])

  const query = searchQuery.trim().toLowerCase()
  const visibleFolderIds = useMemo(() => {
    if (!query) {
      return null
    }

    const nextVisible = new Set<number>()
    const matchesFolder = (folder: GraphWorkflowFolderRecord) => folder.name.toLowerCase().includes(query)
    const matchesWorkflow = (workflow: GraphWorkflowRecord) => [workflow.name, workflow.description ?? ''].join(' ').toLowerCase().includes(query)

    const visit = (folderId: number | null): boolean => {
      let hasMatch = false

      for (const folder of foldersByParent.get(folderId) ?? []) {
        const childHasMatch = visit(folder.id)
        const folderHasMatch = matchesFolder(folder)
        const workflowHasMatch = (workflowsByFolder.get(folder.id) ?? []).some(matchesWorkflow)
        if (folderHasMatch || childHasMatch || workflowHasMatch) {
          nextVisible.add(folder.id)
          hasMatch = true
        }
      }

      const rootWorkflowMatch = folderId === null && (workflowsByFolder.get(null) ?? []).some(matchesWorkflow)
      return hasMatch || rootWorkflowMatch
    }

    visit(null)
    return nextVisible
  }, [foldersByParent, query, workflowsByFolder])

  const filteredRootWorkflows = useMemo(() => {
    const items = workflowsByFolder.get(null) ?? []
    if (!query) {
      return items
    }

    return items.filter((workflow) => [workflow.name, workflow.description ?? ''].join(' ').toLowerCase().includes(query))
  }, [query, workflowsByFolder])

  const hasAnyVisibleItem = useMemo(() => {
    if (!query) {
      return graphs.length > 0 || folders.length > 0
    }

    return filteredRootWorkflows.length > 0 || (visibleFolderIds?.size ?? 0) > 0
  }, [filteredRootWorkflows.length, folders.length, graphs.length, query, visibleFolderIds])

  const toggleFolder = (folderId: number) => {
    setCollapsedFolderIds((current) => (current.includes(folderId) ? current.filter((item) => item !== folderId) : [...current, folderId]))
  }

  const renderWorkflowRow = (graph: GraphWorkflowRecord, depth: number) => {
    const finalResultNodeCount = finalResultNodeCountByWorkflowId.get(graph.id) ?? 0
    const issueMessages = [
      finalResultNodeCount === 0 ? '최종 결과가 아직 지정되지 않았어.' : null,
    ].filter((message): message is string => Boolean(message))

    return (
      <button
        key={`workflow-${graph.id}`}
        type="button"
        onClick={() => onLoadGraph(graph)}
        className={getNavigationItemClassName({
          active: selectedGraphId === graph.id,
          className: 'block w-full px-3 py-2 text-left',
        })}
        style={{ paddingLeft: `${12 + depth * 18}px` }}
        title={graph.description?.trim() ? `${graph.name}\n${graph.description}` : graph.name}
      >
        <div className="flex min-w-0 items-center gap-2">
          <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className={cn('min-w-0 truncate text-sm font-medium', selectedGraphId === graph.id ? 'text-primary' : 'text-foreground')}>
            {graph.name}
          </div>
          {issueMessages.length > 0 ? (
            <Badge variant="outline" className="h-5 min-w-5 shrink-0 justify-center px-1.5" title={issueMessages.join('\n')} aria-label="주의">
              !
            </Badge>
          ) : null}
        </div>
      </button>
    )
  }

  const renderFolderNode = (folder: GraphWorkflowFolderRecord, depth: number): ReactNode => {
    if (query && visibleFolderIds && !visibleFolderIds.has(folder.id)) {
      return null
    }

    const childFolders = foldersByParent.get(folder.id) ?? []
    const childWorkflows = (workflowsByFolder.get(folder.id) ?? []).filter((workflow) => {
      if (!query) {
        return true
      }
      return [workflow.name, workflow.description ?? ''].join(' ').toLowerCase().includes(query)
    })
    const isExpanded = !collapsedFolderIds.includes(folder.id)
    const hasChildren = childFolders.length > 0 || childWorkflows.length > 0
    const childEntries: TreeEntry[] = [
      ...childFolders.map((childFolder) => ({ type: 'folder' as const, label: childFolder.name, folder: childFolder })),
      ...childWorkflows.map((workflow) => ({ type: 'workflow' as const, label: workflow.name, workflow })),
    ].sort(sortTreeEntries)

    return (
      <div key={`folder-${folder.id}`} className="space-y-1">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            onClick={() => toggleFolder(folder.id)}
            disabled={!hasChildren}
            aria-label={isExpanded ? '폴더 접기' : '폴더 펼치기'}
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
            ) : (
              <span className="h-4 w-4" />
            )}
          </Button>
          <button
            type="button"
            onClick={() => onSelectFolder(folder.id)}
            className={getNavigationItemClassName({
              active: selectedFolderId === folder.id,
              className: 'flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left',
            })}
            style={{ paddingLeft: `${4 + depth * 18}px` }}
            title={folder.name}
          >
            <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className={cn('min-w-0 truncate text-sm font-medium', selectedFolderId === folder.id ? 'text-primary' : 'text-foreground')}>
              {folder.name}
            </span>
          </button>
        </div>

        {isExpanded ? (
          <div className="space-y-1">
            {childEntries.map((entry) => entry.type === 'folder'
              ? renderFolderNode(entry.folder, depth + 1)
              : renderWorkflowRow(entry.workflow, depth + 1))}
          </div>
        ) : null}
      </div>
    )
  }

  const rootEntries: TreeEntry[] = useMemo(
    () => [
      ...(foldersByParent.get(null) ?? []).map((folder) => ({ type: 'folder' as const, label: folder.name, folder })),
      ...filteredRootWorkflows.map((workflow) => ({ type: 'workflow' as const, label: workflow.name, workflow })),
    ].sort(sortTreeEntries),
    [filteredRootWorkflows, foldersByParent],
  )

  return (
    <ExplorerSidebar
      title="Explorer"
      badge={<Badge variant="outline">{graphs.length}</Badge>}
      floatingFrame
      floatingLockStorageKey={WORKFLOW_SIDEBAR_LOCK_STORAGE_KEY}
      className="sticky top-24 z-30 isolate self-start max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)]"
      bodyClassName="space-y-1 overflow-y-auto pr-1"
      headerExtra={
        <div className="space-y-3 border-b border-white/5 pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">{leftToolbar}</div>
            <div className="flex items-center justify-end gap-2">
              {rightToolbar}
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="검색" className="h-8 pl-9 text-sm" />
          </div>
        </div>
      }
    >
      <button
        type="button"
        onClick={() => onSelectFolder(null)}
        className={getNavigationItemClassName({
          active: selectedFolderId === null && selectedGraphId === null,
          className: 'flex w-full items-center gap-2 px-3 py-2 text-left',
        })}
        title="Root"
      >
        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className={cn('truncate text-sm font-medium', selectedFolderId === null && selectedGraphId === null ? 'text-primary' : 'text-foreground')}>
          Root
        </span>
      </button>

      {rootEntries.map((entry) => entry.type === 'folder' ? renderFolderNode(entry.folder, 0) : renderWorkflowRow(entry.workflow, 0))}

      {graphs.length === 0 && folders.length === 0 ? (
        <Alert>
          <AlertTitle>저장된 워크플로우가 없어</AlertTitle>
          <AlertDescription>새 폴더나 새 워크플로우를 만들면 여기서 바로 탐색할 수 있어.</AlertDescription>
        </Alert>
      ) : null}
      {(graphs.length > 0 || folders.length > 0) && !hasAnyVisibleItem ? (
        <Alert>
          <AlertTitle>검색 결과가 없어</AlertTitle>
          <AlertDescription>다른 키워드로 찾아봐.</AlertDescription>
        </Alert>
      ) : null}
    </ExplorerSidebar>
  )
}
