import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, FileCode2, Folder, Pin, PinOff, Search } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { FloatingBottomAction } from '@/components/ui/floating-bottom-action'
import { getNavigationItemClassName } from '@/components/common/navigation-item'
import type { GraphWorkflowFolderRecord, GraphWorkflowRecord } from '@/lib/api'
import { cn } from '@/lib/utils'

const WORKFLOW_SIDEBAR_LOCK_STORAGE_KEY = 'conai:module-graph:workflow-sidebar-locked'

type SavedGraphListProps = {
  graphs: GraphWorkflowRecord[]
  folders: GraphWorkflowFolderRecord[]
  selectedGraphId: number | null
  selectedFolderId: number | null
  onLoadGraph: (graph: GraphWorkflowRecord) => void
  onSelectFolder: (folderId: number | null) => void
  leftToolbar?: ReactNode
  rightToolbar?: ReactNode
  floatingActionContainerClassName?: string
}

function normalizeFolderKey(folderId: number | null | undefined) {
  return folderId ?? null
}

/** Render one explorer-style tree sidebar for workflow folders and documents. */
export function SavedGraphList({
  graphs,
  folders,
  selectedGraphId,
  selectedFolderId,
  onLoadGraph,
  onSelectFolder,
  leftToolbar,
  rightToolbar,
  floatingActionContainerClassName,
}: SavedGraphListProps) {
  const sidebarAnchorRef = useRef<HTMLDivElement | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [isSidebarFloating, setIsSidebarFloating] = useState(false)
  const [isSidebarFloatingLocked, setIsSidebarFloatingLocked] = useState(false)
  const [expandedFolderIds, setExpandedFolderIds] = useState<number[]>([])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const storedValue = window.localStorage.getItem(WORKFLOW_SIDEBAR_LOCK_STORAGE_KEY)
    setIsSidebarFloatingLocked(storedValue === 'true')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(WORKFLOW_SIDEBAR_LOCK_STORAGE_KEY, isSidebarFloatingLocked ? 'true' : 'false')
  }, [isSidebarFloatingLocked])

  useEffect(() => {
    if (folders.length === 0) {
      return
    }

    setExpandedFolderIds((current) => {
      const currentSet = new Set(current)
      let changed = false
      for (const folder of folders) {
        if (!currentSet.has(folder.id)) {
          currentSet.add(folder.id)
          changed = true
        }
      }
      return changed ? [...currentSet] : current
    })
  }, [folders])

  const foldersByParent = useMemo(() => {
    const nextMap = new Map<number | null, GraphWorkflowFolderRecord[]>()
    for (const folder of folders) {
      const parentId = normalizeFolderKey(folder.parent_id)
      const bucket = nextMap.get(parentId) ?? []
      bucket.push(folder)
      nextMap.set(parentId, bucket)
    }

    for (const entry of nextMap.values()) {
      entry.sort((left, right) => left.name.localeCompare(right.name, 'ko'))
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
      entry.sort((left, right) => left.name.localeCompare(right.name, 'ko'))
    }

    return nextMap
  }, [graphs])

  const duplicateNameCounts = useMemo(
    () =>
      graphs.reduce<Record<string, number>>((acc, graph) => {
        acc[graph.name] = (acc[graph.name] ?? 0) + 1
        return acc
      }, {}),
    [graphs],
  )

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

  const handleLockSidebar = () => {
    setIsSidebarFloatingLocked(true)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const sidebarTop = sidebarAnchorRef.current?.getBoundingClientRect().top
        if (sidebarTop === undefined || typeof window === 'undefined') {
          return
        }

        const nextOffset = sidebarTop - 96
        if (Math.abs(nextOffset) < 4) {
          return
        }

        window.scrollBy({ top: nextOffset, behavior: 'smooth' })
      })
    })
  }

  const toggleFolder = (folderId: number) => {
    setExpandedFolderIds((current) => (current.includes(folderId) ? current.filter((item) => item !== folderId) : [...current, folderId]))
  }

  const renderWorkflowRow = (graph: GraphWorkflowRecord, depth: number) => {
    const duplicateCount = duplicateNameCounts[graph.name] ?? 0

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
          {duplicateCount > 1 ? <Badge variant="outline">동명 {duplicateCount}</Badge> : null}
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
    const isExpanded = expandedFolderIds.includes(folder.id)
    const hasChildren = childFolders.length > 0 || childWorkflows.length > 0

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
            {childFolders.map((childFolder) => renderFolderNode(childFolder, depth + 1))}
            {childWorkflows.map((workflow) => renderWorkflowRow(workflow, depth + 1))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <>
      <div ref={sidebarAnchorRef}>
        <ExplorerSidebar
          title="Explorer"
          badge={<Badge variant="outline">{graphs.length}</Badge>}
          floatingFrame
          floatingLocked={isSidebarFloatingLocked}
          onFloatingChange={setIsSidebarFloating}
          className={cn(
            'isolate flex self-start flex-col',
            isSidebarFloatingLocked
              ? 'z-20'
              : 'sticky top-24 z-30 max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)]',
          )}
          bodyClassName="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1"
          headerExtra={
            <div className="space-y-3 border-b border-white/5 pb-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">{leftToolbar}</div>
                <div className="flex items-center justify-end gap-2">
                  {rightToolbar}
                  {isSidebarFloatingLocked ? (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      className="bg-surface-low"
                      onClick={() => setIsSidebarFloatingLocked(false)}
                      aria-label="사이드바 고정 해제"
                      title="사이드바 고정 해제"
                    >
                      <PinOff className="h-4 w-4" />
                    </Button>
                  ) : null}
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

          {(foldersByParent.get(null) ?? []).map((folder) => renderFolderNode(folder, 0))}
          {filteredRootWorkflows.map((graph) => renderWorkflowRow(graph, 0))}

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
      </div>

      {isSidebarFloating && !isSidebarFloatingLocked ? (
        <FloatingBottomAction type="button" onClick={handleLockSidebar} containerClassName={floatingActionContainerClassName}>
          <Pin className="h-4 w-4" />
          사이드바 고정
        </FloatingBottomAction>
      ) : null}
    </>
  )
}
