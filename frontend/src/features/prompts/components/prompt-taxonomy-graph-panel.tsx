import { useEffect, useMemo, useState } from 'react'
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps, type ReactFlowInstance } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { RefreshCw } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { PageSection } from '@/components/common/page-surface'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { PromptTaxonomyInferredType, PromptTaxonomyNodeItem, PromptTaxonomyPayload, PromptTypeFilter } from '@/types/prompt'

type PromptTaxonomyFilters = {
  type: PromptTypeFilter
  inferredType: PromptTaxonomyInferredType | 'all'
  minScore: number
  limit: number
}

interface PromptTaxonomyGraphPanelProps {
  data?: PromptTaxonomyPayload
  draftFilters: PromptTaxonomyFilters
  isLoading: boolean
  isFetching?: boolean
  isError: boolean
  errorMessage?: string | null
  isRebuilding?: boolean
  onDraftFiltersChange: (patch: Partial<PromptTaxonomyFilters>) => void
  onApplyFilters: () => void
  onRebuild?: () => void
}

type PromptTaxonomyCanvasNodeData = {
  prompt: string
  inferredType: PromptTaxonomyInferredType
  showLabel: boolean
  sizePx: number
  isCanonical: boolean
}

type PromptTaxonomyCanvasNode = Node<PromptTaxonomyCanvasNodeData, 'prompt-taxonomy'>
type PromptTaxonomyCanvasEdge = Edge

const PROMPT_GRAPH_TYPE_ITEMS = [
  { value: 'positive', label: 'Positive' },
  { value: 'negative', label: 'Negative' },
  { value: 'auto', label: 'Auto' },
] as const

const TAXONOMY_TYPE_OPTIONS: Array<{ value: PromptTaxonomyInferredType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'quality', label: 'Quality' },
  { value: 'subject', label: 'Subject' },
  { value: 'count_or_composition', label: 'Count' },
  { value: 'pose_or_action', label: 'Pose' },
  { value: 'body_or_expression', label: 'Body' },
  { value: 'hair_or_face', label: 'Hair' },
  { value: 'clothing_or_accessory', label: 'Clothing' },
  { value: 'background_or_setting', label: 'Background' },
  { value: 'lighting_or_mood', label: 'Lighting' },
  { value: 'style', label: 'Style' },
  { value: 'artist_or_source', label: 'Artist' },
  { value: 'meta_or_technical', label: 'Meta' },
  { value: 'unknown', label: 'Unknown' },
]

const TAXONOMY_NODE_TONE: Record<PromptTaxonomyInferredType, string> = {
  quality: 'border-amber-300/85 bg-amber-300/90',
  subject: 'border-sky-300/85 bg-sky-300/88',
  count_or_composition: 'border-indigo-300/85 bg-indigo-300/88',
  pose_or_action: 'border-emerald-300/85 bg-emerald-300/88',
  body_or_expression: 'border-rose-300/85 bg-rose-300/88',
  hair_or_face: 'border-fuchsia-300/85 bg-fuchsia-300/88',
  clothing_or_accessory: 'border-orange-300/85 bg-orange-300/88',
  background_or_setting: 'border-cyan-300/85 bg-cyan-300/88',
  lighting_or_mood: 'border-yellow-200/90 bg-yellow-200/92',
  style: 'border-violet-300/85 bg-violet-300/88',
  artist_or_source: 'border-red-300/85 bg-red-300/88',
  meta_or_technical: 'border-zinc-300/85 bg-zinc-300/88',
  unknown: 'border-white/60 bg-white/72',
}

const PROMPT_TAXONOMY_NODE_TYPES = {
  'prompt-taxonomy': PromptTaxonomyNodeDot,
}

function PromptTaxonomyNodeDot({ data, selected }: NodeProps<PromptTaxonomyCanvasNode>) {
  const centerHandleClassName = '!left-1/2 !top-1/2 !h-0 !w-0 !min-h-0 !min-w-0 !border-0 !bg-transparent -translate-x-1/2 -translate-y-1/2 opacity-0'

  return (
    <div className="relative">
      <Handle type="target" position={Position.Top} className={centerHandleClassName} />
      <div
        className={cn(
          'rounded-full border shadow-[0_0_0_1px_rgba(0,0,0,0.18)] transition-transform',
          TAXONOMY_NODE_TONE[data.inferredType],
          data.isCanonical ? 'ring-2 ring-white/35' : null,
          selected ? 'scale-125 ring-2 ring-primary/45' : null,
        )}
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

function normalizeIntegerInput(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.round(parsed)))
}

function normalizeDecimalInput(value: string, fallback: number, min: number, max: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }
  return Math.max(min, Math.min(max, Math.round(parsed * 100) / 100))
}

function layoutPromptTaxonomyCluster(nodes: PromptTaxonomyNodeItem[]) {
  const ordered = [...nodes].sort((left, right) => {
    const leftCanonical = left.canonical_prompt === left.prompt ? 1 : 0
    const rightCanonical = right.canonical_prompt === right.prompt ? 1 : 0
    return rightCanonical - leftCanonical || right.usage_count - left.usage_count || left.prompt.localeCompare(right.prompt, 'ko')
  })
  const positions = new Map<string, { x: number; y: number }>()

  if (ordered.length === 1) {
    positions.set(ordered[0].prompt, { x: 0, y: 0 })
    return { positions, width: 200, height: 160 }
  }

  const center = ordered[0]
  positions.set(center.prompt, { x: 0, y: 0 })

  let index = 1
  let ringIndex = 0
  let maxRadius = 0
  while (index < ordered.length) {
    const radius = 84 + ringIndex * 66
    const capacity = ringIndex === 0 ? 8 : 12 + ringIndex * 6
    const ringNodes = ordered.slice(index, index + capacity)
    const count = ringNodes.length

    ringNodes.forEach((node, ringNodeIndex) => {
      const angle = -Math.PI / 2 + ((Math.PI * 2) / Math.max(count, 1)) * ringNodeIndex
      positions.set(node.prompt, {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      })
    })

    maxRadius = radius
    index += capacity
    ringIndex += 1
  }

  return {
    positions,
    width: Math.max(260, maxRadius * 2 + 170),
    height: Math.max(220, maxRadius * 2 + 170),
  }
}

function buildPromptTaxonomyElements(nodes: PromptTaxonomyNodeItem[], edges: PromptTaxonomyPayload['edges'], zoom: number) {
  if (nodes.length === 0) {
    return { nodes: [] as PromptTaxonomyCanvasNode[], edges: [] as PromptTaxonomyCanvasEdge[], clusterCount: 0 }
  }

  const clusterMap = new Map<string, PromptTaxonomyNodeItem[]>()
  for (const node of nodes) {
    const key = node.cluster_id ?? `${node.inferred_type}:${node.prompt}`
    const bucket = clusterMap.get(key)
    if (bucket) {
      bucket.push(node)
    } else {
      clusterMap.set(key, [node])
    }
  }

  const clusters = [...clusterMap.entries()].sort((left, right) => {
    const leftUsage = left[1].reduce((sum, node) => sum + node.usage_count, 0)
    const rightUsage = right[1].reduce((sum, node) => sum + node.usage_count, 0)
    return right[1].length - left[1].length || rightUsage - leftUsage
  })

  const positionedNodes: PromptTaxonomyCanvasNode[] = []
  const maxRowWidth = 2200
  let cursorX = 0
  let cursorY = 0
  let rowHeight = 0

  for (const [, clusterNodes] of clusters) {
    const layout = layoutPromptTaxonomyCluster(clusterNodes)

    if (cursorX > 0 && cursorX + layout.width > maxRowWidth) {
      cursorX = 0
      cursorY += rowHeight + 110
      rowHeight = 0
    }

    const centerX = cursorX + layout.width / 2
    const centerY = cursorY + layout.height / 2
    rowHeight = Math.max(rowHeight, layout.height)

    for (const node of clusterNodes) {
      const position = layout.positions.get(node.prompt) ?? { x: 0, y: 0 }
      const isCanonical = Boolean(node.canonical_prompt && node.canonical_prompt === node.prompt)
      positionedNodes.push({
        id: `taxonomy:${node.prompt}`,
        type: 'prompt-taxonomy',
        position: {
          x: centerX + position.x,
          y: centerY + position.y,
        },
        data: {
          prompt: node.prompt,
          inferredType: node.inferred_type,
          showLabel: zoom >= 0.68,
          sizePx: isCanonical ? 18 : node.usage_count >= 40 ? 14 : node.usage_count >= 12 ? 12 : 10,
          isCanonical,
        },
        draggable: false,
      })
    }

    cursorX += layout.width + 110
  }

  const positionedEdges: PromptTaxonomyCanvasEdge[] = edges.map((edge) => ({
    id: `taxonomy-edge:${edge.source_prompt}:${edge.target_prompt}`,
    source: `taxonomy:${edge.source_prompt}`,
    target: `taxonomy:${edge.target_prompt}`,
    type: 'straight',
    animated: false,
    style: edge.relation_kind === 'string_variant'
      ? {
          strokeWidth: Math.max(1.1, Math.min(2.8, edge.score * 2.6)),
          stroke: 'rgba(196,181,253,0.9)',
          opacity: 1,
          strokeDasharray: '4 3',
        }
      : {
          strokeWidth: Math.max(1.2, Math.min(3.2, edge.score * 3.4)),
          stroke: 'rgba(125,211,252,0.92)',
          opacity: 1,
        },
  }))

  return {
    nodes: positionedNodes,
    edges: positionedEdges,
    clusterCount: clusters.length,
  }
}

export function PromptTaxonomyGraphPanel({
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
}: PromptTaxonomyGraphPanelProps) {
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance<PromptTaxonomyCanvasNode, PromptTaxonomyCanvasEdge> | null>(null)
  const [zoom, setZoom] = useState(0.42)
  const graphElements = useMemo(() => buildPromptTaxonomyElements(data?.nodes ?? [], data?.edges ?? [], zoom), [data?.nodes, data?.edges, zoom])

  useEffect(() => {
    if (!reactFlowInstance || (data?.nodes.length ?? 0) === 0) {
      return
    }

    window.requestAnimationFrame(() => {
      void reactFlowInstance.fitView({ padding: 0.14, maxZoom: 1.08, duration: 250 })
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
          {data ? <Badge variant="outline">C {(graphElements.clusterCount ?? 0).toLocaleString('ko-KR')}</Badge> : null}
          <Button type="button" variant="outline" size="sm" onClick={onApplyFilters} disabled={isLoading || isFetching}>
            Apply
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-xs"
            onClick={() => onRebuild?.()}
            disabled={!onRebuild || isRebuilding}
            aria-label="프롬프트 taxonomy 재구축"
            title="taxonomy 재구축"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isRebuilding ? 'animate-spin' : null)} />
          </Button>
        </div>
      }
      bodyClassName="space-y-4"
    >
      <div className="grid gap-2 xl:grid-cols-[auto_minmax(0,168px)_repeat(2,minmax(0,112px))]">
        <SegmentedControl
          value={draftFilters.type}
          items={PROMPT_GRAPH_TYPE_ITEMS.map((item) => ({ value: item.value, label: item.label }))}
          onChange={(value) => onDraftFiltersChange({ type: value as PromptTypeFilter })}
          size="sm"
        />

        <Select
          value={draftFilters.inferredType}
          onChange={(event) => onDraftFiltersChange({ inferredType: event.target.value as PromptTaxonomyInferredType | 'all' })}
        >
          {TAXONOMY_TYPE_OPTIONS.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </Select>

        <Input
          type="number"
          min={0}
          max={1}
          step="0.01"
          value={draftFilters.minScore}
          onChange={(event) => onDraftFiltersChange({ minScore: normalizeDecimalInput(event.target.value, draftFilters.minScore, 0, 1) })}
          placeholder="Min score"
        />
        <Input
          type="number"
          min={20}
          max={800}
          value={draftFilters.limit}
          onChange={(event) => onDraftFiltersChange({ limit: normalizeIntegerInput(event.target.value, draftFilters.limit, 20, 800) })}
          placeholder="Edge limit"
        />
      </div>

      {isError ? <div className="text-sm text-destructive">{errorMessage ?? 'taxonomy 그래프를 불러오지 못했어.'}</div> : null}
      {(isLoading || isFetching) && !data ? <div className="h-[720px] rounded-sm border border-border/70 bg-surface-low/40" /> : null}
      {!isLoading && !isFetching && !isError && (data?.nodes.length ?? 0) === 0 ? <div className="text-sm text-muted-foreground">항목 없음</div> : null}

      {(data?.nodes.length ?? 0) > 0 ? (
        <div className="h-[720px] overflow-hidden rounded-sm border border-border/70 bg-[radial-gradient(circle_at_center,hsl(var(--surface-high))_0%,hsl(var(--surface-container))_58%,hsl(var(--background))_100%)]">
          <ReactFlow<PromptTaxonomyCanvasNode, PromptTaxonomyCanvasEdge>
            nodes={graphElements.nodes}
            edges={graphElements.edges}
            nodeTypes={PROMPT_TAXONOMY_NODE_TYPES}
            onInit={(instance) => {
              setReactFlowInstance(instance)
              setZoom(instance.getZoom())
            }}
            onMoveEnd={(_event, viewport) => {
              setZoom(viewport.zoom)
            }}
            fitView
            fitViewOptions={{ padding: 0.14, maxZoom: 1.08 }}
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
