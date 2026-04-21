import { useEffect, useMemo, useState } from 'react'
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { RefreshCw } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { PageSection } from '@/components/common/page-surface'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { PromptGraphEdgeItem, PromptGraphNodeItem, PromptGraphPayload, PromptTypeFilter } from '@/types/prompt'

type PromptGraphFilters = {
  type: PromptTypeFilter
  minScore: number
  minSharedCount: number
  minUsageCount: number
  limit: number
}

interface PromptGraphPanelProps {
  data?: PromptGraphPayload
  draftFilters: PromptGraphFilters
  isLoading: boolean
  isFetching?: boolean
  isError: boolean
  errorMessage?: string | null
  isRebuilding?: boolean
  onDraftFiltersChange: (patch: Partial<PromptGraphFilters>) => void
  onApplyFilters: () => void
  onRebuild?: () => void
}

type PromptGraphCanvasNodeData = {
  prompt: string
  usageCount: number
  degree: number
  showLabel: boolean
  sizePx: number
}

type PromptGraphCanvasNode = Node<PromptGraphCanvasNodeData, 'prompt'>
type PromptGraphCanvasEdge = Edge

const PROMPT_GRAPH_TYPE_ITEMS = [
  { value: 'positive', label: 'Positive' },
  { value: 'negative', label: 'Negative' },
  { value: 'auto', label: 'Auto' },
] as const

const PROMPT_GRAPH_NODE_TYPES = {
  prompt: PromptGraphNodeCard,
}

function PromptGraphNodeCard({ data, selected }: NodeProps<PromptGraphCanvasNode>) {
  const fillTone = data.degree >= 8
    ? 'border-primary/80 bg-primary'
    : data.degree >= 4
      ? 'border-primary/60 bg-primary/70'
      : 'border-white/45 bg-white/65'
  const centerHandleClassName = '!left-1/2 !top-1/2 !h-0 !w-0 !min-h-0 !min-w-0 !border-0 !bg-transparent -translate-x-1/2 -translate-y-1/2 opacity-0'

  return (
    <div className="relative">
      <Handle type="target" position={Position.Top} className={centerHandleClassName} />
      <div
        className={cn('rounded-full border shadow-[0_0_0_1px_rgba(0,0,0,0.18)] transition-transform', fillTone, selected ? 'scale-125 ring-2 ring-primary/45' : null)}
        style={{ width: data.sizePx, height: data.sizePx }}
        title={data.prompt}
      />
      {data.showLabel ? (
        <div className="pointer-events-none absolute left-1/2 bottom-full z-20 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-xs bg-background/92 px-1.5 py-0.5 text-[10px] leading-none font-medium text-foreground shadow-sm">
          {data.prompt}
        </div>
      ) : null}
      <Handle type="source" position={Position.Top} className={centerHandleClassName} />
    </div>
  )
}

function getConnectedComponents(nodes: PromptGraphNodeItem[], edges: PromptGraphEdgeItem[]) {
  const nodeMap = new Map(nodes.map((node) => [node.prompt, node]))
  const adjacency = new Map<string, Set<string>>()

  for (const node of nodes) {
    adjacency.set(node.prompt, new Set())
  }

  for (const edge of edges) {
    adjacency.get(edge.source_prompt)?.add(edge.target_prompt)
    adjacency.get(edge.target_prompt)?.add(edge.source_prompt)
  }

  const visited = new Set<string>()
  const components: PromptGraphNodeItem[][] = []

  for (const node of nodes) {
    if (visited.has(node.prompt)) {
      continue
    }

    const stack = [node.prompt]
    const component: PromptGraphNodeItem[] = []
    visited.add(node.prompt)

    while (stack.length > 0) {
      const current = stack.pop()
      if (!current) {
        continue
      }

      const currentNode = nodeMap.get(current)
      if (currentNode) {
        component.push(currentNode)
      }

      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor)) {
          continue
        }
        visited.add(neighbor)
        stack.push(neighbor)
      }
    }

    components.push(component)
  }

  return components.sort((left, right) => right.length - left.length || right.reduce((sum, node) => sum + node.degree, 0) - left.reduce((sum, node) => sum + node.degree, 0))
}

function layoutPromptComponent(component: PromptGraphNodeItem[]) {
  const ordered = [...component].sort((left, right) => right.degree - left.degree || right.usage_count - left.usage_count || left.prompt.localeCompare(right.prompt, 'ko'))
  const positions = new Map<string, { x: number; y: number }>()

  if (ordered.length === 1) {
    positions.set(ordered[0].prompt, { x: 0, y: 0 })
    return { positions, width: 220, height: 160 }
  }

  if (ordered.length === 2) {
    positions.set(ordered[0].prompt, { x: -95, y: 0 })
    positions.set(ordered[1].prompt, { x: 95, y: 0 })
    return { positions, width: 360, height: 180 }
  }

  positions.set(ordered[0].prompt, { x: 0, y: 0 })

  let startIndex = 1
  let ringIndex = 0
  let maxRadius = 0
  while (startIndex < ordered.length) {
    const radius = 120 + ringIndex * 92
    const capacity = ringIndex === 0 ? 10 : 16 + ringIndex * 8
    const ringNodes = ordered.slice(startIndex, startIndex + capacity)
    const ringCount = ringNodes.length

    ringNodes.forEach((node, index) => {
      const angle = -Math.PI / 2 + ((Math.PI * 2) / Math.max(ringCount, 1)) * index
      positions.set(node.prompt, {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      })
    })

    maxRadius = radius
    startIndex += capacity
    ringIndex += 1
  }

  const width = Math.max(320, maxRadius * 2 + 220)
  const height = Math.max(260, maxRadius * 2 + 220)
  return { positions, width, height }
}

function buildPromptGraphElements(nodes: PromptGraphNodeItem[], edges: PromptGraphEdgeItem[], zoom: number) {
  if (nodes.length === 0) {
    return { nodes: [] as PromptGraphCanvasNode[], edges: [] as PromptGraphCanvasEdge[] }
  }

  const positionedNodes: PromptGraphCanvasNode[] = []
  const maxRowWidth = 2000
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0

  for (const component of getConnectedComponents(nodes, edges)) {
    const layout = layoutPromptComponent(component)

    if (cursorX > 0 && cursorX + layout.width > maxRowWidth) {
      cursorX = 0
      cursorY += rowHeight + 120
      rowHeight = 0
    }

    const centerX = cursorX + layout.width / 2
    const centerY = cursorY + layout.height / 2
    rowHeight = Math.max(rowHeight, layout.height)

    for (const node of component) {
      const position = layout.positions.get(node.prompt) ?? { x: 0, y: 0 }
      positionedNodes.push({
        id: `prompt:${node.prompt}`,
        type: 'prompt',
        position: {
          x: centerX + position.x,
          y: centerY + position.y,
        },
        data: {
          prompt: node.prompt,
          usageCount: node.usage_count,
          degree: node.degree,
          showLabel: zoom >= 0.72,
          sizePx: node.degree >= 10 ? 18 : node.degree >= 6 ? 14 : 10,
        },
        draggable: false,
      })
    }

    cursorX += layout.width + 120
  }

  const positionedEdges: PromptGraphCanvasEdge[] = edges.map((edge) => ({
    id: `edge:${edge.source_prompt}:${edge.target_prompt}`,
    source: `prompt:${edge.source_prompt}`,
    target: `prompt:${edge.target_prompt}`,
    type: 'straight',
    animated: false,
    style: {
      strokeWidth: Math.max(1.2, Math.min(3.2, edge.shared_count / 34 + edge.score / 100)),
      stroke: 'rgba(255,255,255,0.68)',
      opacity: 1,
    },
  }))

  return {
    nodes: positionedNodes,
    edges: positionedEdges,
  }
}

function normalizeNumberInput(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

export function PromptGraphPanel({
  data,
  draftFilters,
  isLoading,
  isFetching = false,
  isError,
  errorMessage,
  isRebuilding = false,
  onDraftFiltersChange,
  onApplyFilters,
  onRebuild,
}: PromptGraphPanelProps) {
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<PromptGraphCanvasNode, PromptGraphCanvasEdge> | null>(null)
  const [zoom, setZoom] = useState(0.42)
  const graphElements = useMemo(() => buildPromptGraphElements(data?.nodes ?? [], data?.edges ?? [], zoom), [data?.nodes, data?.edges, zoom])

  useEffect(() => {
    if (!reactFlowInstance || (data?.nodes.length ?? 0) === 0) {
      return
    }

    window.requestAnimationFrame(() => {
      void reactFlowInstance.fitView({ padding: 0.15, maxZoom: 1.1, duration: 250 })
      setZoom(reactFlowInstance.getZoom())
    })
  }, [data?.edges.length, data?.nodes.length, reactFlowInstance])

  return (
    <PageSection
      title="Graph"
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {data ? <Badge variant="outline">N {data.nodes.length.toLocaleString('ko-KR')}</Badge> : null}
          {data ? <Badge variant="outline">E {data.edges.length.toLocaleString('ko-KR')}</Badge> : null}
          <Button type="button" variant="outline" size="sm" onClick={onApplyFilters} disabled={isLoading || isFetching}>
            Apply
          </Button>
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
      bodyClassName="space-y-4"
    >
      <div className="grid gap-2 xl:grid-cols-[auto_repeat(4,minmax(0,112px))]">
        <SegmentedControl
          value={draftFilters.type}
          items={PROMPT_GRAPH_TYPE_ITEMS.map((item) => ({ value: item.value, label: item.label }))}
          onChange={(value) => onDraftFiltersChange({ type: value as PromptTypeFilter })}
          size="sm"
        />

        <Input
          type="number"
          min={0}
          max={1000}
          value={draftFilters.minScore}
          onChange={(event) => onDraftFiltersChange({ minScore: normalizeNumberInput(event.target.value, draftFilters.minScore, 0, 1000) })}
          placeholder="Min score"
        />
        <Input
          type="number"
          min={1}
          max={9999}
          value={draftFilters.minSharedCount}
          onChange={(event) => onDraftFiltersChange({ minSharedCount: normalizeNumberInput(event.target.value, draftFilters.minSharedCount, 1, 9999) })}
          placeholder="Min shared"
        />
        <Input
          type="number"
          min={1}
          max={999999}
          value={draftFilters.minUsageCount}
          onChange={(event) => onDraftFiltersChange({ minUsageCount: normalizeNumberInput(event.target.value, draftFilters.minUsageCount, 1, 999999) })}
          placeholder="Min usage"
        />
        <Input
          type="number"
          min={20}
          max={800}
          value={draftFilters.limit}
          onChange={(event) => onDraftFiltersChange({ limit: normalizeNumberInput(event.target.value, draftFilters.limit, 20, 800) })}
          placeholder="Edge limit"
        />
      </div>

      {isError ? <div className="text-sm text-destructive">{errorMessage ?? '그래프를 불러오지 못했어.'}</div> : null}
      {(isLoading || isFetching) && !data ? <div className="h-[720px] rounded-sm border border-border/70 bg-surface-low/40" /> : null}
      {!isLoading && !isFetching && !isError && (data?.nodes.length ?? 0) === 0 ? <div className="text-sm text-muted-foreground">항목 없음</div> : null}

      {(data?.nodes.length ?? 0) > 0 ? (
        <div className="h-[720px] overflow-hidden rounded-sm border border-border/70 bg-[radial-gradient(circle_at_center,hsl(var(--surface-high))_0%,hsl(var(--surface-container))_58%,hsl(var(--background))_100%)]">
          <ReactFlow<PromptGraphCanvasNode, PromptGraphCanvasEdge>
            nodes={graphElements.nodes}
            edges={graphElements.edges}
            nodeTypes={PROMPT_GRAPH_NODE_TYPES}
            onInit={(instance) => {
              setReactFlowInstance(instance)
              setZoom(instance.getZoom())
            }}
            onMoveEnd={(_event, viewport) => {
              setZoom(viewport.zoom)
            }}
            fitView
            fitViewOptions={{ padding: 0.15, maxZoom: 1.1 }}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            minZoom={0.08}
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
