import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, FileCode2, Folder, Search } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import { useI18n } from '@/i18n'
import type { GraphWorkflowFolderRecord, GraphWorkflowSummaryRecord } from '@/lib/api-module-graph'
import { hasAssignedFinalResult, resolveSavedGraphWorkflowFinalResultNodeCount, resolveSavedGraphWorkflowSummary } from '../saved-graph-list-summary'

const WORKFLOW_SIDEBAR_LOCK_STORAGE_KEY = 'conai:module-graph:workflow-sidebar-locked'

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
      <Button
        key={`workflow-${graph.id}`}
        type="button"
        variant="nav"
        data-active={selectedGraphId === graph.id}
        onClick={() => onLoadGraph(graph)}
        className="h-auto flex-col items-stretch gap-1 px-3 py-2"
        style={{ paddingLeft: `${12 + depth * 18}px` }}
        title={titleLines.join('\n')}
      >
        <span className="flex min-w-0 items-center gap-2">
          <FileCode2 className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate">{graph.name}</span>
          {issueMessages.length > 0 ? (
            <Badge className="ml-auto h-5 min-w-5 shrink-0 justify-center bg-warning-soft px-1.5 text-warning-soft-foreground" title={issueMessages.join('\n')} aria-label={t({ ko: '주의', en: 'Warning' })}>
              !
            </Badge>
          ) : null}
        </span>
        <Text as="span" variant="caption" className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-6 text-2xs leading-tight">
          <span>{t({ ko: '노드 {count}', en: 'Nodes {count}' }, { count: formatNumber(summary.nodeCount) })}</span>
          <span>{t({ ko: '연결 {count}', en: 'Edges {count}' }, { count: formatNumber(summary.edgeCount) })}</span>
          <span>{t({ ko: '결과 {count}', en: 'Results {count}' }, { count: formatNumber(summary.finalResultNodeCount) })}</span>
        </Text>
      </Button>
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
      <div key={`folder-${folder.id}`} className="space-y-1">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="h-7 w-7 shrink-0"
            onClick={() => toggleFolder(folder.id)}
            disabled={!hasChildren}
            aria-label={isExpanded ? t({ ko: '폴더 접기', en: 'Collapse folder' }) : t({ ko: '폴더 펼치기', en: 'Expand folder' })}
          >
            {hasChildren ? (
              isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
            ) : (
              <span className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="nav"
            data-active={selectedFolderId === folder.id}
            onClick={() => onSelectFolder(folder.id)}
            className="min-w-0 flex-1 px-2"
            style={{ paddingLeft: `${4 + depth * 18}px` }}
            title={folder.name}
          >
            <Folder className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{folder.name}</span>
          </Button>
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
    ].sort((left, right) => sortTreeEntries(left, right, locale)),
    [filteredRootWorkflows, foldersByParent, locale],
  )

  return (
    <ExplorerSidebar
      title={t({ ko: '탐색기', en: 'Explorer' })}
      badge={<Badge variant="outline">{graphs.length}</Badge>}
      floatingFrame
      floatingLockStorageKey={WORKFLOW_SIDEBAR_LOCK_STORAGE_KEY}
      className="sticky top-24 z-30 isolate self-start max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)]"
      bodyClassName="space-y-1 overflow-y-auto pr-1"
      headerExtra={
        <div className="space-y-3 pb-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">{leftToolbar}</div>
            <div className="flex items-center justify-end gap-2">
              {rightToolbar}
            </div>
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t({ ko: '검색', en: 'Search' })} className="h-8 pl-9 text-sm" />
          </div>
        </div>
      }
    >
      <Button
        type="button"
        variant="nav"
        data-active={selectedFolderId === null && selectedGraphId === null}
        onClick={() => onSelectFolder(null)}
        className="px-3"
        title="Root"
      >
        <Folder className="h-4 w-4 shrink-0" />
        <span className="truncate">Root</span>
      </Button>

      {rootEntries.map((entry) => entry.type === 'folder' ? renderFolderNode(entry.folder, 0) : renderWorkflowRow(entry.workflow, 0))}

      {graphs.length === 0 && folders.length === 0 ? (
        <EmptyState
          size="compact"
          icon={FileCode2}
          title={t({ ko: '저장된 워크플로우가 없어', en: 'There are no saved workflows' })}
          description={t({ ko: '새 폴더나 새 워크플로우를 만들면 여기서 바로 탐색할 수 있어.', en: 'Create a new folder or workflow to browse it here.' })}
        />
      ) : null}
      {(graphs.length > 0 || folders.length > 0) && !hasAnyVisibleItem ? (
        <EmptyState
          size="compact"
          icon={Search}
          title={t({ ko: '검색 결과가 없어', en: 'No search results' })}
          description={t({ ko: '다른 키워드로 찾아봐.', en: 'Try a different keyword.' })}
        />
      ) : null}
    </ExplorerSidebar>
  )
}
