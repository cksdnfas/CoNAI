import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, FileCode2, Folder, Search } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { SidebarItem, SidebarNav } from '@/components/ui/sidebar'
import { useI18n } from '@/i18n'
import type { GraphWorkflowFolderRecord, GraphWorkflowSummaryRecord } from '@/lib/api-module-graph'
import { hasAssignedFinalResult, resolveSavedGraphWorkflowFinalResultNodeCount, resolveSavedGraphWorkflowSummary } from '../saved-graph-list-summary'

type SavedGraphListProps = {
  graphs: GraphWorkflowSummaryRecord[]
  folders: GraphWorkflowFolderRecord[]
  selectedGraphId: number | null
  selectedFolderId: number | null
  onLoadGraph: (graph: GraphWorkflowSummaryRecord) => void
  onSelectFolder: (folderId: number | null) => void
  leftToolbar?: ReactNode
  rightToolbar?: ReactNode
}

type TreeEntry =
  | { type: 'folder'; label: string; folder: GraphWorkflowFolderRecord }
  | { type: 'workflow'; label: string; workflow: GraphWorkflowSummaryRecord }

function normalizeFolderKey(folderId: number | null | undefined) {
  return folderId ?? null
}

function compareTreeLabels(left: string, right: string, locale: string) {
  return left.localeCompare(right, locale, { numeric: true, sensitivity: 'base' })
}

function sortTreeEntries(left: TreeEntry, right: TreeEntry, locale: string) {
  if (left.type !== right.type) {
    return left.type === 'workflow' ? -1 : 1
  }

  return compareTreeLabels(left.label, right.label, locale)
}

function buildWorkflowSearchText(workflow: GraphWorkflowSummaryRecord) {
  return `${workflow.name} ${workflow.description ?? ''}`.toLowerCase()
}

function buildFolderSearchText(folder: GraphWorkflowFolderRecord) {
  return folder.name.toLowerCase()
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
}: SavedGraphListProps) {
  const { t, locale, formatNumber } = useI18n()
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<number[]>([])
  const collapsedFolderIdSet = useMemo(() => new Set(collapsedFolderIds), [collapsedFolderIds])

  const foldersByParent = useMemo(() => {
    const nextMap = new Map<number | null, GraphWorkflowFolderRecord[]>()
    for (const folder of folders) {
      const parentId = normalizeFolderKey(folder.parent_id)
      const bucket = nextMap.get(parentId) ?? []
      bucket.push(folder)
      nextMap.set(parentId, bucket)
    }

    for (const entry of nextMap.values()) {
      entry.sort((left, right) => compareTreeLabels(left.name, right.name, locale))
    }

    return nextMap
  }, [folders, locale])

  const workflowsByFolder = useMemo(() => {
    const nextMap = new Map<number | null, GraphWorkflowSummaryRecord[]>()
    for (const graph of graphs) {
      const folderId = normalizeFolderKey(graph.folder_id)
      const bucket = nextMap.get(folderId) ?? []
      bucket.push(graph)
      nextMap.set(folderId, bucket)
    }

    for (const entry of nextMap.values()) {
      entry.sort((left, right) => compareTreeLabels(left.name, right.name, locale))
    }

    return nextMap
  }, [graphs, locale])

  // WF-1: 목록 응답에 그래프 문서가 없으므로 최종 결과 노드 수는 서버 계산 값을 그대로 쓴다.
  const finalResultNodeCountByWorkflowId = useMemo(() => {
    const nextMap = new Map<number, number>()

    for (const graph of graphs) {
      nextMap.set(graph.id, resolveSavedGraphWorkflowFinalResultNodeCount(graph))
    }

    return nextMap
  }, [graphs])

  const folderSearchTextById = useMemo(() => {
    const nextMap = new Map<number, string>()

    for (const folder of folders) {
      nextMap.set(folder.id, buildFolderSearchText(folder))
    }

    return nextMap
  }, [folders])

  const workflowSearchTextById = useMemo(() => {
    const nextMap = new Map<number, string>()

    for (const graph of graphs) {
      nextMap.set(graph.id, buildWorkflowSearchText(graph))
    }

    return nextMap
  }, [graphs])

  const query = searchQuery.trim().toLowerCase()
  const visibleFolderIds = useMemo(() => {
    if (!query) {
      return null
    }

    const nextVisible = new Set<number>()
    const matchesFolder = (folder: GraphWorkflowFolderRecord) => (folderSearchTextById.get(folder.id) ?? '').includes(query)
    const matchesWorkflow = (workflow: GraphWorkflowSummaryRecord) => (workflowSearchTextById.get(workflow.id) ?? '').includes(query)

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
  }, [folderSearchTextById, foldersByParent, query, workflowSearchTextById, workflowsByFolder])

  const filteredRootWorkflows = useMemo(() => {
    const items = workflowsByFolder.get(null) ?? []
    if (!query) {
      return items
    }

    return items.filter((workflow) => (workflowSearchTextById.get(workflow.id) ?? '').includes(query))
  }, [query, workflowSearchTextById, workflowsByFolder])

  const hasAnyVisibleItem = useMemo(() => {
    if (!query) {
      return graphs.length > 0 || folders.length > 0
    }

    return filteredRootWorkflows.length > 0 || (visibleFolderIds?.size ?? 0) > 0
  }, [filteredRootWorkflows.length, folders.length, graphs.length, query, visibleFolderIds])

  const toggleFolder = (folderId: number) => {
    setCollapsedFolderIds((current) => (current.includes(folderId) ? current.filter((item) => item !== folderId) : [...current, folderId]))
  }

  const renderWorkflowRow = (graph: GraphWorkflowSummaryRecord, depth: number) => {
    const finalResultNodeCount = finalResultNodeCountByWorkflowId.get(graph.id) ?? 0
    const summary = resolveSavedGraphWorkflowSummary(graph, finalResultNodeCount)
    const summaryLine = [
      t({ ko: '노드 {count}', en: 'Nodes {count}' }, { count: formatNumber(summary.nodeCount) }),
      t({ ko: '연결 {count}', en: 'Edges {count}' }, { count: formatNumber(summary.edgeCount) }),
      t({ ko: '결과 {count}', en: 'Results {count}' }, { count: formatNumber(summary.finalResultNodeCount) }),
    ].join(' · ')
    const issueMessages = [
      !hasAssignedFinalResult(summary) ? t({ ko: '최종 결과가 아직 지정되지 않았어.', en: 'No final result has been assigned yet.' }) : null,
    ].filter((message): message is string => Boolean(message))
    const titleLines = [graph.name, graph.description?.trim() || null, summaryLine].filter((line): line is string => Boolean(line))

    return (
      <SidebarItem
        key={`workflow-${graph.id}`}
        icon={FileCode2}
        label={graph.name}
        active={selectedGraphId === graph.id}
        depth={depth}
        onClick={() => onLoadGraph(graph)}
        title={titleLines.join('\n')}
        trailing={issueMessages.length > 0 ? (
          <Badge className="h-5 min-w-5 justify-center bg-warning-soft px-1.5 text-warning-soft-foreground" title={issueMessages.join('\n')} aria-label={t({ ko: '주의', en: 'Warning' })}>
            !
          </Badge>
        ) : null}
      />
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
      return (workflowSearchTextById.get(workflow.id) ?? '').includes(query)
    })
    const isExpanded = !collapsedFolderIdSet.has(folder.id)
    const hasChildren = childFolders.length > 0 || childWorkflows.length > 0
    const childEntries: TreeEntry[] = [
      ...childFolders.map((childFolder) => ({ type: 'folder' as const, label: childFolder.name, folder: childFolder })),
      ...childWorkflows.map((workflow) => ({ type: 'workflow' as const, label: workflow.name, workflow })),
    ].sort((left, right) => sortTreeEntries(left, right, locale))

    return (
      <div key={`folder-${folder.id}`} className="flex flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-0.5">
          <SidebarItem
            icon={Folder}
            label={folder.name}
            active={selectedFolderId === folder.id}
            depth={depth}
            className="min-w-0 flex-1"
            onClick={() => onSelectFolder(folder.id)}
            title={folder.name}
          />
          {hasChildren ? (
            <IconButton
              size="icon-xs"
              variant="ghost"
              className="shrink-0"
              onClick={() => toggleFolder(folder.id)}
              label={isExpanded ? t({ ko: '폴더 접기', en: 'Collapse folder' }) : t({ ko: '폴더 펼치기', en: 'Expand folder' })}
            >
              {isExpanded ? <ChevronDown /> : <ChevronRight />}
            </IconButton>
          ) : null}
        </div>

        {isExpanded ? childEntries.map((entry) => entry.type === 'folder'
          ? renderFolderNode(entry.folder, depth + 1)
          : renderWorkflowRow(entry.workflow, depth + 1)) : null}
      </div>
    )
  }

  const rootEntries: TreeEntry[] = useMemo(
    () => [
      ...(foldersByParent.get(null) ?? []).map((folder) => ({ type: 'folder' as const, label: folder.name, folder })),
      ...filteredRootWorkflows.map((workflow) => ({ type: 'workflow' as const, label: workflow.name, workflow })),
    ].sort((left, right) => sortTreeEntries(left, right, locale)),
    [filteredRootWorkflows, foldersByParent, locale],
  )

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {leftToolbar || rightToolbar ? (
        <div className="flex flex-wrap items-center gap-0.5">
          {leftToolbar}
          {rightToolbar}
        </div>
      ) : null}

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder={t({ ko: '검색', en: 'Search' })}
          aria-label={t({ ko: '워크플로우 검색', en: 'Search workflows' })}
          className="h-8 pl-8 text-xs"
        />
      </div>

      <SidebarNav aria-label={t({ ko: '워크플로우', en: 'Workflows' })}>
        <SidebarItem
          icon={Folder}
          label="Root"
          active={selectedFolderId === null && selectedGraphId === null}
          onClick={() => onSelectFolder(null)}
        />

        {rootEntries.map((entry) => entry.type === 'folder' ? renderFolderNode(entry.folder, 0) : renderWorkflowRow(entry.workflow, 0))}
      </SidebarNav>

      {graphs.length === 0 && folders.length === 0 ? (
        <EmptyState
          size="compact"
          icon={FileCode2}
          title={t({ ko: '저장된 워크플로우가 없어', en: 'There are no saved workflows' })}
        />
      ) : null}
      {(graphs.length > 0 || folders.length > 0) && !hasAnyVisibleItem ? (
        <EmptyState
          size="compact"
          icon={Search}
          title={t({ ko: '검색 결과가 없어', en: 'No search results' })}
        />
      ) : null}
    </div>
  )
}
