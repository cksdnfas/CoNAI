import { useEffect, useMemo, useState } from 'react'
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { RefreshCw, Share2 } from 'lucide-react'
import { PageSection } from '@/components/common/page-surface'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PromptRelatedItem, PromptTypeFilter } from '@/types/prompt'

interface ActivePromptSummary {
  prompt: string
  type: PromptTypeFilter
}

interface PromptGraphPanelProps {
  activePrompt: ActivePromptSummary | null
  items: PromptRelatedItem[]
  isLoading: boolean
  isError: boolean
  errorMessage?: string | null
  isRebuilding?: boolean
  canApplySearchPrompt?: boolean
  onApplySearchPrompt?: () => void
  onRebuild?: () => void
  onSelectPrompt: (prompt: string) => void
}

type PromptGraphNodeData = {
  prompt: string
  usageCount?: number
  sharedCount?: number
  score?: number
  isSource?: boolean
}

type PromptGraphNode = Node<PromptGraphNodeData, 'prompt'>
type PromptGraphEdge = Edge

const PROMPT_GRAPH_NODE_TYPES = {
  prompt: PromptGraphNodeCard,
}

function PromptGraphNodeCard({ data, selected }: NodeProps<PromptGraphNode>) {
  return (
    <div
      className={cn(
        'min-w-[180px] max-w-[220px] rounded-sm border px-3 py-2 shadow-sm transition-colors',
        data.isSource
          ? 'border-primary/70 bg-primary/10 text-foreground'
          : 'border-border/80 bg-surface-container/95 text-foreground',
        selected ? 'ring-2 ring-primary/50' : null,
      )}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <div className="line-clamp-3 break-all text-sm font-semibold">{data.prompt}</div>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        {typeof data.usageCount === 'number' ? <span>{data.usageCount.toLocaleString('ko-KR')}</span> : null}
        {!data.isSource && typeof data.sharedCount === 'number' ? <span>{data.sharedCount.toLocaleString('ko-KR')}</span> : null}
        {!data.isSource && typeof data.score === 'number' ? <span>{data.score.toFixed(2)}</span> : null}
        {data.isSource ? <span className="text-primary">source</span> : null}
      </div>
      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  )
}

function buildGraphNodes(activePrompt: ActivePromptSummary | null, items: PromptRelatedItem[]): { nodes: PromptGraphNode[]; edges: PromptGraphEdge[] } {
  if (!activePrompt) {
    return { nodes: [], edges: [] }
  }

  const sourceNode: PromptGraphNode = {
    id: `source:${activePrompt.type}:${activePrompt.prompt}`,
    type: 'prompt',
    position: { x: 0, y: 0 },
    data: {
      prompt: activePrompt.prompt,
      isSource: true,
    },
    draggable: false,
  }

  const total = Math.max(items.length, 1)
  const radius = items.length <= 4 ? 220 : items.length <= 8 ? 280 : 360

  const relatedNodes = items.map((item, index) => {
    const angle = (-Math.PI / 2) + ((Math.PI * 2) / total) * index
    const orbitScale = 1 + ((index % 3) - 1) * 0.08
    const x = Math.cos(angle) * radius * orbitScale
    const y = Math.sin(angle) * radius * orbitScale

    return {
      id: `related:${activePrompt.type}:${item.prompt}`,
      type: 'prompt',
      position: { x, y },
      data: {
        prompt: item.prompt,
        usageCount: item.usage_count,
        sharedCount: item.shared_count,
        score: item.score,
        isSource: false,
      },
      draggable: false,
    } satisfies PromptGraphNode
  })

  const edges = items.map((item) => ({
    id: `edge:${activePrompt.type}:${activePrompt.prompt}:${item.prompt}`,
    source: sourceNode.id,
    target: `related:${activePrompt.type}:${item.prompt}`,
    animated: item.score >= 80,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: {
      strokeWidth: Math.max(1.5, Math.min(6, item.shared_count / 24 + item.score / 40)),
      stroke: 'hsl(var(--primary))',
      opacity: 0.55,
    },
  }) satisfies PromptGraphEdge)

  return {
    nodes: [sourceNode, ...relatedNodes],
    edges,
  }
}

export function PromptGraphPanel({
  activePrompt,
  items,
  isLoading,
  isError,
  errorMessage,
  isRebuilding = false,
  canApplySearchPrompt = false,
  onApplySearchPrompt,
  onRebuild,
  onSelectPrompt,
}: PromptGraphPanelProps) {
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<PromptGraphNode, PromptGraphEdge> | null>(null)
  const { nodes, edges } = useMemo(() => buildGraphNodes(activePrompt, items), [activePrompt, items])

  useEffect(() => {
    if (!reactFlowInstance || nodes.length === 0) {
      return
    }

    window.requestAnimationFrame(() => {
      void reactFlowInstance.fitView({ padding: 0.2, maxZoom: 1.15, duration: 250 })
    })
  }, [reactFlowInstance, nodes, edges])

  return (
    <PageSection
      title="Graph"
      actions={
        <div className="flex items-center gap-2">
          {canApplySearchPrompt ? (
            <Button type="button" variant="outline" size="sm" onClick={() => onApplySearchPrompt?.()}>
              <Share2 className="h-4 w-4" />
              검색어로 보기
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            onClick={() => onRebuild?.()}
            disabled={!onRebuild || isRebuilding}
            aria-label="프롬프트 관계 재구축"
            title="관계 재구축"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isRebuilding ? 'animate-spin' : null)} />
          </Button>
        </div>
      }
    >
      {!activePrompt ? <div className="text-sm text-muted-foreground">프롬프트 선택</div> : null}
      {isError ? <div className="text-sm text-destructive">{errorMessage ?? '그래프를 불러오지 못했어.'}</div> : null}
      {isLoading ? <div className="h-[560px] rounded-sm border border-border/70 bg-surface-low/40" /> : null}
      {!isLoading && activePrompt && !isError && items.length === 0 ? <div className="text-sm text-muted-foreground">항목 없음</div> : null}

      {!isLoading && activePrompt && !isError && items.length > 0 ? (
        <div className="h-[560px] overflow-hidden rounded-sm border border-border/70 bg-[radial-gradient(circle_at_center,hsl(var(--surface-high))_0%,hsl(var(--surface-container))_58%,hsl(var(--background))_100%)]">
          <ReactFlow<PromptGraphNode, PromptGraphEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={PROMPT_GRAPH_NODE_TYPES}
            onInit={setReactFlowInstance}
            onNodeClick={(_event, node) => {
              const prompt = typeof node.data?.prompt === 'string' ? node.data.prompt : ''
              if (prompt) {
                onSelectPrompt(prompt)
              }
            }}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1.15 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            minZoom={0.15}
            maxZoom={1.5}
            colorMode="dark"
            proOptions={{ hideAttribution: true }}
          >
            <MiniMap pannable zoomable className="!bg-surface-container" />
            <Controls showInteractive={false} position="bottom-right" />
            <Background gap={18} size={1} color="rgba(255,255,255,0.08)" />
          </ReactFlow>
        </div>
      ) : null}
    </PageSection>
  )
}
