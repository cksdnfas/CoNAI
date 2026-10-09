import { useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Copy, Download, Folder, FolderInput, FolderPlus, MoreHorizontal, PenSquare, Plus, Search, Settings2, Trash2, Upload } from 'lucide-react'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import type { GraphWorkflowFolderRecord, GraphWorkflowSummaryRecord } from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'

type WorkflowListPanelProps = {
  graphs: GraphWorkflowSummaryRecord[]
  folders: GraphWorkflowFolderRecord[]
  selectedFolderId: number | null
  /** Highlights the open workflow in the picker popover. */
  selectedGraphId?: number | null
  onSelectFolder: (folderId: number | null) => void
  onOpenGraph: (graph: GraphWorkflowSummaryRecord) => void
  onEditGraph?: (graph: GraphWorkflowSummaryRecord) => void
  onDuplicateGraph?: (graph: GraphWorkflowSummaryRecord) => void
  onExportGraph?: (graph: GraphWorkflowSummaryRecord) => void
  onMoveGraph?: (graph: GraphWorkflowSummaryRecord) => void
  onDeleteGraph?: (graph: GraphWorkflowSummaryRecord) => void
  onCreateWorkflow?: () => void
  onCreateFolder?: () => void
  onImportWorkflow?: (file: File) => void
  onFolderSettings?: (folder: GraphWorkflowFolderRecord) => void
  onDeleteFolder?: (folder: GraphWorkflowFolderRecord) => void
  /** Compact mode for the picker popover: no header, no row actions. */
  variant?: 'panel' | 'picker'
  className?: string
}

function compareLabels(left: string, right: string, locale: string) {
  return left.localeCompare(right, locale, { numeric: true, sensitivity: 'base' })
}

/**
 * The workflows tab's list: a folder tree of saved graph workflows as hairline rows. Folders are collapsible heading rows
 * that also set the scope (results on the right, folder for new workflows); the row actions stay visible.
 */
export function WorkflowListPanel({
  graphs,
  folders,
  selectedFolderId,
  selectedGraphId = null,
  onSelectFolder,
  onOpenGraph,
  onEditGraph,
  onDuplicateGraph,
  onExportGraph,
  onMoveGraph,
  onDeleteGraph,
  onCreateWorkflow,
  onCreateFolder,
  onImportWorkflow,
  onFolderSettings,
  onDeleteFolder,
  variant = 'panel',
  className,
}: WorkflowListPanelProps) {
  const { canUpdateWorkflows } = useFeaturePermissions()
  const { t, locale, formatNumber } = useI18n()
  const [query, setQuery] = useState('')
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<number>>(() => new Set())
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const isPicker = variant === 'picker'
  const normalizedQuery = query.trim().toLowerCase()

  const foldersByParent = useMemo(() => {
    const map = new Map<number | null, GraphWorkflowFolderRecord[]>()
    for (const folder of folders) {
      const bucket = map.get(folder.parent_id ?? null) ?? []
      bucket.push(folder)
      map.set(folder.parent_id ?? null, bucket)
    }
    for (const bucket of map.values()) bucket.sort((left, right) => compareLabels(left.name, right.name, locale))
    return map
  }, [folders, locale])

  const graphsByFolder = useMemo(() => {
    const map = new Map<number | null, GraphWorkflowSummaryRecord[]>()
    for (const graph of graphs) {
      const matches = !normalizedQuery || `${graph.name} ${graph.description ?? ''}`.toLowerCase().includes(normalizedQuery)
      if (!matches) continue
      const bucket = map.get(graph.folder_id ?? null) ?? []
      bucket.push(graph)
      map.set(graph.folder_id ?? null, bucket)
    }
    for (const bucket of map.values()) bucket.sort((left, right) => compareLabels(left.name, right.name, locale))
    return map
  }, [graphs, locale, normalizedQuery])

  // While searching, a folder stays visible when its name or anything below it matches.
  const visibleFolderIds = useMemo(() => {
    if (!normalizedQuery) return null
    const visible = new Set<number>()
    const visit = (parentId: number | null): boolean => {
      let any = false
      for (const folder of foldersByParent.get(parentId) ?? []) {
        const childMatch = visit(folder.id)
        const selfMatch = folder.name.toLowerCase().includes(normalizedQuery) || (graphsByFolder.get(folder.id)?.length ?? 0) > 0
        if (childMatch || selfMatch) {
          visible.add(folder.id)
          any = true
        }
      }
      return any
    }
    visit(null)
    return visible
  }, [foldersByParent, graphsByFolder, normalizedQuery])

  const folderGraphCount = useMemo(() => {
    const direct = new Map<number, number>()
    for (const graph of graphs) {
      if (graph.folder_id != null) direct.set(graph.folder_id, (direct.get(graph.folder_id) ?? 0) + 1)
    }
    const total = new Map<number, number>()
    const sum = (folderId: number): number => {
      const cached = total.get(folderId)
      if (cached !== undefined) return cached
      const value = (direct.get(folderId) ?? 0) + (foldersByParent.get(folderId) ?? []).reduce((acc, child) => acc + sum(child.id), 0)
      total.set(folderId, value)
      return value
    }
    for (const folder of folders) sum(folder.id)
    return total
  }, [folders, foldersByParent, graphs])

  const toggleFolder = (folderId: number) => {
    setCollapsedFolderIds((current) => {
      const next = new Set(current)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  const renderGraphRow = (graph: GraphWorkflowSummaryRecord, depth: number) => {
    const missingFinalResult = graph.final_result_node_count === 0
    const isSelected = selectedGraphId === graph.id
    return (
      <div
        key={`graph-${graph.id}`}
        data-active={isSelected || undefined}
        className="flex min-h-9 items-center gap-1 border-b border-line pr-1 data-[active=true]:bg-fill data-[active=true]:shadow-[inset_2px_0_0_var(--primary)]"
      >
        <Button
          type="button"
          variant="nav"
          onClick={() => onOpenGraph(graph)}
          className="h-auto min-w-0 flex-1 gap-2 self-stretch rounded-none py-2 hover:bg-transparent"
          style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
        >
          <span className="truncate text-sm font-semibold text-foreground">{graph.name}</span>
          {graph.description && !isPicker ? <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{graph.description}</span> : <span className="flex-1" />}
          {missingFinalResult ? (
            <span className="shrink-0 rounded-sm bg-warning-soft px-1.5 py-0.5 text-2xs font-semibold text-warning-soft-foreground">{t({ ko: '결과 미지정', en: 'No result' })}</span>
          ) : (
            <Tip content={t({ ko: '노드 {nodes} · 연결 {edges}', en: '{nodes} nodes · {edges} links' }, { nodes: formatNumber(graph.node_count), edges: formatNumber(graph.edge_count) })}>
              <span className="shrink-0 font-mono text-2xs text-muted-foreground">{formatNumber(graph.node_count)}</span>
            </Tip>
          )}
        </Button>
        {!isPicker ? (
          <>
            {onEditGraph ? (
              <IconButton size="icon-xs" variant="ghost" onClick={() => onEditGraph(graph)} disabled={!canUpdateWorkflows} label={t({ ko: '노드 편집', en: 'Edit nodes' })}>
                <PenSquare />
              </IconButton>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="icon-xs" variant="ghost" label={t({ ko: '더 보기', en: 'More' })}>
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onDuplicateGraph ? <DropdownMenuItem disabled={!canUpdateWorkflows} onSelect={() => onDuplicateGraph(graph)}><Copy />{t({ ko: '복제', en: 'Duplicate' })}</DropdownMenuItem> : null}
                {onExportGraph ? <DropdownMenuItem onSelect={() => onExportGraph(graph)}><Download />{t({ ko: '내보내기', en: 'Export' })}</DropdownMenuItem> : null}
                {onMoveGraph ? <DropdownMenuItem disabled={!canUpdateWorkflows} onSelect={() => onMoveGraph(graph)}><FolderInput />{t({ ko: '폴더 이동', en: 'Move to folder' })}</DropdownMenuItem> : null}
                {onDeleteGraph ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" disabled={!canUpdateWorkflows} onSelect={() => onDeleteGraph(graph)}><Trash2 />{t({ ko: '삭제', en: 'Delete' })}</DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
      </div>
    )
  }

  const renderFolder = (folder: GraphWorkflowFolderRecord, depth: number): ReactNode => {
    if (visibleFolderIds && !visibleFolderIds.has(folder.id)) return null
    // Searching opens every matching folder.
    const isExpanded = Boolean(normalizedQuery) || !collapsedFolderIds.has(folder.id)
    const isSelected = selectedFolderId === folder.id
    const childFolders = foldersByParent.get(folder.id) ?? []
    const childGraphs = graphsByFolder.get(folder.id) ?? []
    return (
      <div key={`folder-${folder.id}`}>
        <div
          data-active={isSelected || undefined}
          className="flex min-h-9 items-center gap-1 border-b border-line pr-1 data-[active=true]:bg-fill data-[active=true]:shadow-[inset_2px_0_0_var(--primary)]"
        >
          <IconButton
            size="icon-xs"
            variant="ghost"
            onClick={() => toggleFolder(folder.id)}
            aria-expanded={isExpanded}
            tooltip={false}
            label={isExpanded ? t({ ko: '폴더 접기', en: 'Collapse folder' }) : t({ ko: '폴더 펼치기', en: 'Expand folder' })}
            className="shrink-0"
            style={{ marginLeft: `${depth * 1.25}rem` }}
          >
            {isExpanded ? <ChevronDown /> : <ChevronRight />}
          </IconButton>
          <Button
            type="button"
            variant="nav"
            onClick={() => onSelectFolder(isSelected ? null : folder.id)}
            aria-pressed={isSelected}
            className="h-auto min-w-0 flex-1 gap-2 self-stretch rounded-none px-0 py-2 hover:bg-transparent"
          >
            <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate text-sm font-semibold text-muted-foreground">{folder.name}</span>
            <span className="flex-1" />
            <span className="shrink-0 font-mono text-2xs text-muted-foreground">{formatNumber(folderGraphCount.get(folder.id) ?? 0)}</span>
          </Button>
          {!isPicker && (onFolderSettings || onDeleteFolder) ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton size="icon-xs" variant="ghost" label={t({ ko: '폴더 메뉴', en: 'Folder menu' })}>
                  <MoreHorizontal />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onFolderSettings ? <DropdownMenuItem disabled={!canUpdateWorkflows} onSelect={() => onFolderSettings(folder)}><Settings2 />{t({ ko: '폴더 설정', en: 'Folder settings' })}</DropdownMenuItem> : null}
                {onDeleteFolder ? <DropdownMenuItem variant="destructive" disabled={!canUpdateWorkflows} onSelect={() => onDeleteFolder(folder)}><Trash2 />{t({ ko: '폴더 삭제', en: 'Delete folder' })}</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        {isExpanded ? (
          <>
            {childFolders.map((child) => renderFolder(child, depth + 1))}
            {childGraphs.map((graph) => renderGraphRow(graph, depth + 1))}
          </>
        ) : null}
      </div>
    )
  }

  const rootFolders = foldersByParent.get(null) ?? []
  const rootGraphs = graphsByFolder.get(null) ?? []
  const hasRows = rootGraphs.length > 0 || rootFolders.some((folder) => !visibleFolderIds || visibleFolderIds.has(folder.id))

  return (
    <div className={cn('flex min-h-0 flex-col gap-2', className)}>
      {!isPicker ? (
        <div className="flex min-h-9 shrink-0 items-center gap-1">
          <span className="text-base font-bold">{t({ ko: '워크플로', en: 'Workflows' })}</span>
          <span className="ml-1 font-mono text-xs text-muted-foreground">{formatNumber(graphs.length)}</span>
          <span className="flex-1" />
          {onCreateFolder ? (
            <IconButton size="icon-sm" variant="ghost" onClick={onCreateFolder} disabled={!canUpdateWorkflows} label={t({ ko: '폴더 만들기', en: 'New folder' })}>
              <FolderPlus />
            </IconButton>
          ) : null}
          {onImportWorkflow ? (
            <>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json,.conai-workflow.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  if (file) onImportWorkflow(file)
                }}
              />
              <IconButton size="icon-sm" variant="ghost" onClick={() => importInputRef.current?.click()} disabled={!canUpdateWorkflows} label={t({ ko: '워크플로 가져오기', en: 'Import workflow' })}>
                <Upload />
              </IconButton>
            </>
          ) : null}
          {onCreateWorkflow ? (
            <IconButton size="icon-sm" variant="secondary" onClick={onCreateWorkflow} disabled={!canUpdateWorkflows} label={t({ ko: '새 워크플로', en: 'New workflow' })}>
              <Plus />
            </IconButton>
          ) : null}
        </div>
      ) : null}

      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t({ ko: '검색', en: 'Search' })}
          aria-label={t({ ko: '워크플로 검색', en: 'Search workflows' })}
          className="h-8 pl-8 text-sm"
          autoFocus={isPicker}
        />
      </div>

      <nav aria-label={t({ ko: '워크플로', en: 'Workflows' })} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {rootFolders.map((folder) => renderFolder(folder, 0))}
        {rootGraphs.map((graph) => renderGraphRow(graph, 0))}
        {graphs.length === 0 && folders.length === 0 ? (
          <EmptyState size="compact" icon={Plus} title={t({ ko: '저장된 워크플로가 없어', en: 'No saved workflows' })} />
        ) : !hasRows ? (
          <EmptyState size="compact" icon={Search} title={t({ ko: '검색 결과가 없어', en: 'No search results' })} />
        ) : null}
      </nav>
    </div>
  )
}
