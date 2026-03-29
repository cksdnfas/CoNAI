import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { ModulePortDefinition } from '@/lib/api'
import { parseHandleId, type ModuleGraphEdge, type ModuleGraphNode } from '../module-graph-shared'

type NodeInspectorPanelProps = {
  nodes: ModuleGraphNode[]
  selectedNode: ModuleGraphNode | null
  selectedEdge: ModuleGraphEdge | null
  onNodeValueChange: (nodeId: string, portKey: string, value: unknown) => void
  onNodeValueClear: (nodeId: string, portKey: string) => void
  onNodeImageChange: (nodeId: string, portKey: string, file?: File) => Promise<void>
  showHeader?: boolean
}

type ResolvedEdgeEndpoint = {
  node: ModuleGraphNode | null
  port: ModulePortDefinition | null
  portKey: string | null
}

/** Render compact badges for one module port so graph and inspector use the same nouns. */
function PortBadges({ port }: { port: ModulePortDefinition }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <Badge variant="outline">{port.data_type}</Badge>
      <Badge variant="secondary">{port.key}</Badge>
      {port.required ? <Badge variant="outline">required</Badge> : null}
      {port.multiple ? <Badge variant="outline">multi</Badge> : null}
    </div>
  )
}

/** Render the shared heading block for an editable node port. */
function PortHeader({
  nodeId,
  port,
  hasExplicitValue,
  onClear,
}: {
  nodeId: string
  port: ModulePortDefinition
  hasExplicitValue: boolean
  onClear: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-foreground">{port.label}</div>
        <div className="mt-1 text-[11px] text-muted-foreground">{nodeId}.{port.key}</div>
        <PortBadges port={port} />
        {port.description ? <div className="mt-1 text-xs text-muted-foreground">{port.description}</div> : null}
      </div>
      <Button type="button" size="sm" variant="ghost" onClick={onClear} disabled={!hasExplicitValue}>
        값 지우기
      </Button>
    </div>
  )
}

/** Resolve a selected edge endpoint back into its node and module port metadata. */
function resolveEdgeEndpoint(nodes: ModuleGraphNode[], nodeId: string, handleId: string | null | undefined, direction: 'in' | 'out'): ResolvedEdgeEndpoint {
  const node = nodes.find((item) => item.id === nodeId) ?? null
  const parsedHandle = parseHandleId(handleId)
  const portKey = parsedHandle?.portKey ?? null

  if (!node || !portKey) {
    return { node, port: null, portKey }
  }

  const portList = direction === 'out' ? node.data.module.output_ports : node.data.module.exposed_inputs
  const port = portList.find((item) => item.key === portKey) ?? null

  return {
    node,
    port,
    portKey,
  }
}

/** Render an edge endpoint summary so selected connections are understandable without raw handle ids. */
function EdgeEndpointCard({
  heading,
  endpoint,
  role,
}: {
  heading: string
  endpoint: ResolvedEdgeEndpoint
  role: '입력' | '출력'
}) {
  return (
    <div className="rounded-sm border border-border bg-surface-container px-3 py-3">
      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{heading}</div>
      <div className="mt-2 text-sm font-medium text-foreground">{endpoint.node?.data.module.name ?? endpoint.node?.id ?? '알 수 없는 노드'}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">node · {endpoint.node?.id ?? 'unknown'}</div>
      <div className="mt-3 text-xs font-medium text-foreground">{role} 포트</div>
      {endpoint.port ? (
        <>
          <div className="mt-1 text-sm text-foreground">{endpoint.port.label}</div>
          <PortBadges port={endpoint.port} />
          {endpoint.port.description ? <div className="mt-1 text-xs text-muted-foreground">{endpoint.port.description}</div> : null}
        </>
      ) : (
        <div className="mt-1 text-xs text-muted-foreground">{endpoint.portKey ? `port key · ${endpoint.portKey}` : '포트 정보를 찾지 못했어.'}</div>
      )}
    </div>
  )
}

/** Render editable node input overrides and selected edge details. */
export function NodeInspectorPanel({
  nodes,
  selectedNode,
  selectedEdge,
  onNodeValueChange,
  onNodeValueClear,
  onNodeImageChange,
  showHeader = true,
}: NodeInspectorPanelProps) {
  const renderPortInput = (node: ModuleGraphNode, port: ModulePortDefinition) => {
    const rawValue = node.data.inputValues?.[port.key]
    const hasExplicitValue = rawValue !== undefined && rawValue !== null && rawValue !== ''
    const clearPortValue = () => onNodeValueClear(node.id, port.key)

    if (port.data_type === 'prompt' || port.data_type === 'json') {
      return (
        <div key={port.key} className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} onClear={clearPortValue} />
          <Textarea
            rows={port.data_type === 'json' ? 6 : 4}
            value={typeof rawValue === 'string' ? rawValue : rawValue ? JSON.stringify(rawValue, null, 2) : ''}
            onChange={(event) => onNodeValueChange(node.id, port.key, event.target.value)}
            placeholder={port.description || port.label}
          />
        </div>
      )
    }

    if (port.data_type === 'number') {
      return (
        <div key={port.key} className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} onClear={clearPortValue} />
          <Input
            type="number"
            value={typeof rawValue === 'number' ? String(rawValue) : typeof rawValue === 'string' ? rawValue : ''}
            onChange={(event) => onNodeValueChange(node.id, port.key, event.target.value === '' ? '' : Number(event.target.value))}
            placeholder={port.label}
          />
        </div>
      )
    }

    if (port.data_type === 'boolean') {
      return (
        <div key={port.key} className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} onClear={clearPortValue} />
          <Select
            value={typeof rawValue === 'boolean' ? String(rawValue) : ''}
            onChange={(event) => onNodeValueChange(node.id, port.key, event.target.value === 'true')}
          >
            <option value="">기본값 사용</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </Select>
        </div>
      )
    }

    if (port.data_type === 'image' || port.data_type === 'mask') {
      return (
        <div key={port.key} className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} onClear={clearPortValue} />
          <Input type="file" accept="image/*" onChange={(event) => void onNodeImageChange(node.id, port.key, event.target.files?.[0])} />
          {typeof rawValue === 'string' && rawValue.startsWith('data:image/') ? (
            <img src={rawValue} alt={port.label} className="max-h-40 rounded-sm border border-border object-contain" />
          ) : null}
        </div>
      )
    }

    return (
      <div key={port.key} className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
        <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} onClear={clearPortValue} />
        <Input
          value={typeof rawValue === 'string' ? rawValue : rawValue ? String(rawValue) : ''}
          onChange={(event) => onNodeValueChange(node.id, port.key, event.target.value)}
          placeholder={port.description || port.label}
        />
      </div>
    )
  }

  const sourceEndpoint = selectedEdge
    ? resolveEdgeEndpoint(nodes, selectedEdge.source, selectedEdge.sourceHandle, 'out')
    : null
  const targetEndpoint = selectedEdge
    ? resolveEdgeEndpoint(nodes, selectedEdge.target, selectedEdge.targetHandle, 'in')
    : null
  const selectedEdgeType = sourceEndpoint?.port?.data_type ?? targetEndpoint?.port?.data_type ?? null

  return (
    <Card className="bg-surface-container">
      <CardContent className="space-y-4">
        {showHeader ? (
          <SectionHeading
            variant="inside"
            heading="Node Inspector"
            description="선택한 노드나 엣지의 포트 정보와 입력 오버라이드를 다듬어."
          />
        ) : null}
        {!selectedNode && !selectedEdge ? (
          <div className="rounded-sm bg-surface-low px-4 py-6 text-sm text-muted-foreground">캔버스에서 노드나 엣지를 하나 선택해봐.</div>
        ) : null}

        {!selectedNode && selectedEdge && sourceEndpoint && targetEndpoint ? (
          <div className="space-y-3 rounded-sm bg-surface-low p-4">
            <div className="flex items-center gap-2">
              <div className="font-medium text-foreground">Selected Edge</div>
              {selectedEdgeType ? <Badge variant="outline">{selectedEdgeType}</Badge> : null}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <EdgeEndpointCard heading="Source" endpoint={sourceEndpoint} role="출력" />
              <EdgeEndpointCard heading="Target" endpoint={targetEndpoint} role="입력" />
            </div>
            <div className="text-[11px] text-muted-foreground">{selectedEdge.id}</div>
          </div>
        ) : null}

        {selectedNode ? (
          <>
            <div className="rounded-sm bg-surface-low p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{selectedNode.data.module.name}</span>
                <Badge variant="outline">{selectedNode.data.module.engine_type}</Badge>
                <Badge variant="secondary">node {selectedNode.id}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                <Badge variant="outline">입력 {(selectedNode.data.module.exposed_inputs ?? []).length}</Badge>
                <Badge variant="outline">출력 {(selectedNode.data.module.output_ports ?? []).length}</Badge>
              </div>
            </div>

            {(selectedNode.data.module.exposed_inputs ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">이 노드는 편집 가능한 입력 포트가 없어.</div>
            ) : (
              <div className="space-y-4">{selectedNode.data.module.exposed_inputs.map((port) => renderPortInput(selectedNode, port))}</div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
