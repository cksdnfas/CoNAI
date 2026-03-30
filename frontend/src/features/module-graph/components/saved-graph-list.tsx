import { useMemo, useState, type ReactNode } from 'react'
import { PenSquare, Play, Search } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ExplorerSidebar } from '@/components/common/explorer-sidebar'
import type { GraphWorkflowRecord } from '@/lib/api'
import { cn } from '@/lib/utils'

type SavedGraphListProps = {
  graphs: GraphWorkflowRecord[]
  selectedGraphId: number | null
  executingGraphId: number | null
  onLoadGraph: (graph: GraphWorkflowRecord) => void
  onExecuteGraph: (graphId: number) => void
  onEditGraph?: (graph: GraphWorkflowRecord) => void
  showExecuteButton?: boolean
  headerActions?: ReactNode
  topToolbar?: ReactNode
}

/** Render saved workflows with quick run and edit actions. */
export function SavedGraphList({
  graphs,
  selectedGraphId,
  executingGraphId,
  onLoadGraph,
  onExecuteGraph,
  onEditGraph,
  showExecuteButton = true,
  headerActions,
  topToolbar,
}: SavedGraphListProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredGraphs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (query.length === 0) {
      return graphs
    }

    return graphs.filter((graph) => {
      const haystack = [graph.name, graph.description ?? ''].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [graphs, searchQuery])

  return (
    <ExplorerSidebar
      title="Workflows"
      badge={headerActions}
      floatingFrame
      className="sticky top-24 z-30 isolate flex max-h-[calc(100vh-var(--theme-shell-header-height)-1.5rem)] self-start flex-col"
      bodyClassName="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
      headerExtra={
        <div className="space-y-3">
          {topToolbar ? <div className="flex flex-wrap gap-2">{topToolbar}</div> : null}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="검색" className="h-8 bg-surface-container pl-9 text-sm" />
          </div>
        </div>
      }
    >
      {filteredGraphs.map((graph) => (
        <div
          key={graph.id}
          className={cn(
            'flex items-start gap-2 rounded-sm px-3 py-3 transition-colors',
            selectedGraphId === graph.id
              ? 'bg-surface-container text-primary'
              : 'text-muted-foreground hover:bg-surface-low hover:text-foreground',
          )}
        >
          <button
            type="button"
            onClick={() => onLoadGraph(graph)}
            className="min-w-0 flex-1 text-left"
            title={graph.description?.trim() || graph.name}
          >
            <div className={cn('truncate text-sm font-semibold', selectedGraphId === graph.id ? 'text-primary' : 'text-foreground')}>
              {graph.name}
            </div>
            {graph.description ? (
              <div className="mt-1 line-clamp-1 text-xs text-muted-foreground" title={graph.description}>
                {graph.description}
              </div>
            ) : null}
          </button>

          <div className="flex shrink-0 gap-1">
            {onEditGraph ? (
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => onEditGraph(graph)} title="편집" aria-label="워크플로우 편집">
                <PenSquare className="h-4 w-4" />
              </Button>
            ) : null}
            {showExecuteButton ? (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => onExecuteGraph(graph.id)}
                disabled={executingGraphId !== null}
                title={executingGraphId === graph.id ? '실행 중' : '실행'}
                aria-label={executingGraphId === graph.id ? '워크플로우 실행 중' : '워크플로우 실행'}
              >
                <Play className="h-4 w-4" />
              </Button>
            ) : null}
          </div>
        </div>
      ))}

      {graphs.length === 0 ? (
        <Alert>
          <AlertTitle>저장된 워크플로우가 없어</AlertTitle>
          <AlertDescription>새 워크플로우를 만들면 여기서 바로 불러올 수 있어.</AlertDescription>
        </Alert>
      ) : null}
      {graphs.length > 0 && filteredGraphs.length === 0 ? (
        <Alert>
          <AlertTitle>검색 결과가 없어</AlertTitle>
          <AlertDescription>다른 키워드로 찾아봐.</AlertDescription>
        </Alert>
      ) : null}
    </ExplorerSidebar>
  )
}
