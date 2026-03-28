import { useMemo, useState } from 'react'
import { PenSquare, Play, Search } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { GraphWorkflowRecord } from '@/lib/api'

type SavedGraphListProps = {
  graphs: GraphWorkflowRecord[]
  selectedGraphId: number | null
  executingGraphId: number | null
  onLoadGraph: (graph: GraphWorkflowRecord) => void
  onExecuteGraph: (graphId: number) => void
  onEditGraph?: (graph: GraphWorkflowRecord) => void
  showExecuteButton?: boolean
  showHeader?: boolean
}

function formatUpdatedDate(value?: string | null) {
  if (!value) {
    return '시간 없음'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date)
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
  showHeader = true,
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
    <Card className="bg-surface-container">
      <CardContent className="space-y-2.5">
        {showHeader ? (
          <SectionHeading
            variant="inside"
            heading="Saved Workflows"
            description="저장된 워크플로우를 선택하고 실행 흐름으로 이어가."
          />
        ) : null}

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="검색" className="h-8 pl-9 text-sm" />
        </div>

        <div className="space-y-2">
          {filteredGraphs.map((graph) => {
            const exposedInputCount = graph.graph.metadata?.exposed_inputs?.length ?? 0
            return (
              <div key={graph.id} className="rounded-sm bg-surface-low px-2.5 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onLoadGraph(graph)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{graph.name}</span>
                      {selectedGraphId === graph.id ? <Badge variant="secondary">선택</Badge> : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                      <span>v{graph.version}</span>
                      <span>·</span>
                      <span>N {graph.graph.nodes.length}</span>
                      <span>·</span>
                      <span>E {graph.graph.edges.length}</span>
                      <span>·</span>
                      <span>I {exposedInputCount}</span>
                    </div>
                    {graph.description ? <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{graph.description}</div> : null}
                    <div className="mt-1 text-[10px] text-muted-foreground">{formatUpdatedDate(graph.updated_date)}</div>
                  </button>

                  <div className="flex shrink-0 gap-1">
                    {onEditGraph ? (
                      <Button type="button" size="icon-sm" variant="outline" onClick={() => onEditGraph(graph)} title="편집" aria-label="워크플로우 편집">
                        <PenSquare className="h-4 w-4" />
                      </Button>
                    ) : null}
                    {showExecuteButton ? (
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="outline"
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
              </div>
            )
          })}
        </div>

        {graphs.length === 0 ? <div className="text-sm text-muted-foreground">저장된 워크플로우가 아직 없어.</div> : null}
        {graphs.length > 0 && filteredGraphs.length === 0 ? <div className="text-sm text-muted-foreground">검색 결과가 없어.</div> : null}
      </CardContent>
    </Card>
  )
}
