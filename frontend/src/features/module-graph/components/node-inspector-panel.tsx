import type { CSSProperties } from 'react'
import { CircleHelp } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { ModulePortDefinition } from '@/lib/api'
import { NaiCharacterPromptsInput, isNaiCharacterPromptPort } from './nai-character-prompts-input'
import { NaiReusableAssetInput, isNaiCharacterReferencePort, isNaiVibePort } from './nai-reusable-assets-input'
import { parseHandleId, type ModuleGraphEdge, type ModuleGraphNode } from '../module-graph-shared'

type NodeInspectorPanelProps = {
  nodes: ModuleGraphNode[]
  selectedNode: ModuleGraphNode | null
  selectedEdge: ModuleGraphEdge | null
  onNodeValueChange: (nodeId: string, portKey: string, value: unknown) => void
  onNodeValueClear: (nodeId: string, portKey: string) => void
  onNodeImageChange: (nodeId: string, portKey: string, file?: File) => Promise<void>
  highlightedPortKey?: string | null
  showHeader?: boolean
}

type ResolvedEdgeEndpoint = {
  node: ModuleGraphNode | null
  port: ModulePortDefinition | null
  portKey: string | null
}

/** Check whether a node input has any explicit or default value. */
function hasMeaningfulValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}

/** Render a compact tooltip icon for internal node, edge, and port references. */
function TechnicalReferenceHint({ title, label }: { title: string; label: string }) {
  return (
    <span className="inline-flex cursor-help text-muted-foreground" title={title} aria-label={label}>
      <CircleHelp className="h-3.5 w-3.5" />
    </span>
  )
}

/** Resolve whether one node input is already satisfied by a connection or value. */
function isNodeInputSatisfied(node: ModuleGraphNode, port: ModulePortDefinition) {
  const connectedInputKeys = new Set(node.data.connectedInputKeys ?? [])
  return connectedInputKeys.has(port.key) || hasMeaningfulValue(node.data.inputValues?.[port.key]) || hasMeaningfulValue(port.default_value)
}

/** Find optional UI-schema metadata for one node input port. */
function findNodeUiField(node: ModuleGraphNode, portKey: string) {
  return node.data.module.ui_schema?.find((field) => field.key === portKey)
}

/** Render compact badges for one module port so graph and inspector use the same nouns. */
function PortBadges({ port, missingRequired = false }: { port: ModulePortDefinition; missingRequired?: boolean }) {
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      <Badge variant="outline">{port.data_type}</Badge>
      <Badge variant="secondary">{port.key}</Badge>
      {port.required ? <Badge variant="outline">required</Badge> : null}
      {missingRequired ? <Badge variant="secondary">needs input</Badge> : null}
      {port.multiple ? <Badge variant="outline">multi</Badge> : null}
    </div>
  )
}

/** Render the shared heading block for an editable node port. */
function PortHeader({
  nodeId,
  port,
  hasExplicitValue,
  missingRequired,
  onClear,
}: {
  nodeId: string
  port: ModulePortDefinition
  hasExplicitValue: boolean
  missingRequired: boolean
  onClear: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <div className="text-sm font-medium text-foreground">{port.label}</div>
          <TechnicalReferenceHint title={`node ${nodeId}\nport ${port.key}`} label="포트 내부 키 보기" />
        </div>
        <PortBadges port={port} missingRequired={missingRequired} />
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
    <div className="rounded-sm border border-border bg-surface-low px-3 py-3">
      <div className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{heading}</div>
      <div className="mt-2 flex items-center gap-1">
        <div className="text-sm font-medium text-foreground">{endpoint.node?.data.module.name ?? endpoint.node?.id ?? '알 수 없는 노드'}</div>
        {endpoint.node?.id ? <TechnicalReferenceHint title={`node ${endpoint.node.id}`} label="노드 내부 식별자 보기" /> : null}
      </div>
      <div className="mt-3 text-xs font-medium text-foreground">{role} 포트</div>
      {endpoint.port ? (
        <>
          <div className="mt-1 flex items-center gap-1">
            <div className="text-sm text-foreground">{endpoint.port.label}</div>
            <TechnicalReferenceHint title={`port ${endpoint.port.key}`} label="포트 내부 키 보기" />
          </div>
          <PortBadges port={endpoint.port} />
          {endpoint.port.description ? <div className="mt-1 text-xs text-muted-foreground">{endpoint.port.description}</div> : null}
        </>
      ) : (
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <span>{endpoint.portKey ? '포트 세부 정보' : '포트 정보를 찾지 못했어.'}</span>
          {endpoint.portKey ? <TechnicalReferenceHint title={`port ${endpoint.portKey}`} label="포트 내부 키 보기" /> : null}
        </div>
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
  highlightedPortKey = null,
  showHeader = true,
}: NodeInspectorPanelProps) {
  const renderPortInput = (node: ModuleGraphNode, port: ModulePortDefinition) => {
    const rawValue = node.data.inputValues?.[port.key]
    const uiField = findNodeUiField(node, port.key)
    const hasExplicitValue = hasMeaningfulValue(rawValue)
    const missingRequired = Boolean(port.required && !isNodeInputSatisfied(node, port))
    const isHighlightedPort = highlightedPortKey === port.key
    const clearPortValue = () => onNodeValueClear(node.id, port.key)
    const cardStyle = isHighlightedPort
      ? ({ borderColor: '#60a5fa', backgroundColor: 'rgba(96, 165, 250, 0.10)', boxShadow: '0 0 0 1px rgba(96, 165, 250, 0.35)' } as CSSProperties)
      : missingRequired
        ? ({ borderColor: '#f59e0b99', backgroundColor: 'rgba(245, 158, 11, 0.08)' } as CSSProperties)
        : undefined

    if (isNaiCharacterPromptPort(port.key, port.data_type)) {
      return (
        <div key={port.key} className="space-y-2 rounded-sm border border-border bg-surface-low p-3" style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <NaiCharacterPromptsInput value={rawValue} onChange={(value) => onNodeValueChange(node.id, port.key, value)} />
        </div>
      )
    }

    if (isNaiVibePort(port.key, port.data_type)) {
      return (
        <div key={port.key} className="space-y-2 rounded-sm border border-border bg-surface-low p-3" style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <NaiReusableAssetInput kind="vibes" value={rawValue} onChange={(value) => onNodeValueChange(node.id, port.key, value)} />
        </div>
      )
    }

    if (isNaiCharacterReferencePort(port.key, port.data_type)) {
      return (
        <div key={port.key} className="space-y-2 rounded-sm border border-border bg-surface-low p-3" style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <NaiReusableAssetInput kind="character_refs" value={rawValue} onChange={(value) => onNodeValueChange(node.id, port.key, value)} />
        </div>
      )
    }

    if (uiField?.data_type === 'select' && Array.isArray(uiField.options) && uiField.options.length > 0) {
      return (
        <div key={port.key} className="space-y-2 rounded-sm border border-border bg-surface-low p-3" style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <Select
            value={typeof rawValue === 'string' ? rawValue : rawValue == null ? '' : String(rawValue)}
            onChange={(event) => onNodeValueChange(node.id, port.key, event.target.value)}
          >
            <option value="">{hasMeaningfulValue(port.default_value) || hasMeaningfulValue(uiField.default_value) ? '기본값 사용' : '선택'}</option>
            {uiField.options.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>
        </div>
      )
    }

    if (port.data_type === 'prompt' || port.data_type === 'json') {
      return (
        <div key={port.key} className="space-y-2 rounded-sm border border-border bg-surface-low p-3" style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
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
        <div key={port.key} className="space-y-2 rounded-sm border border-border bg-surface-low p-3" style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <Input
            type="number"
            min={uiField?.min}
            max={uiField?.max}
            value={typeof rawValue === 'number' ? String(rawValue) : typeof rawValue === 'string' ? rawValue : ''}
            onChange={(event) => onNodeValueChange(node.id, port.key, event.target.value === '' ? '' : Number(event.target.value))}
            placeholder={uiField?.placeholder || port.label}
          />
        </div>
      )
    }

    if (port.data_type === 'boolean') {
      return (
        <div key={port.key} className="space-y-2 rounded-sm border border-border bg-surface-low p-3" style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
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
        <div key={port.key} className="space-y-2 rounded-sm border border-border bg-surface-low p-3" style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <Input type="file" accept="image/*" onChange={(event) => void onNodeImageChange(node.id, port.key, event.target.files?.[0])} />
          {typeof rawValue === 'string' && rawValue.startsWith('data:image/') ? (
            <img src={rawValue} alt={port.label} className="max-h-40 rounded-sm border border-border object-contain" />
          ) : null}
        </div>
      )
    }

    return (
      <div key={port.key} className="space-y-2 rounded-sm border border-border bg-surface-low p-3" style={cardStyle}>
        <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
        <Input
          value={typeof rawValue === 'string' ? rawValue : rawValue ? String(rawValue) : ''}
          onChange={(event) => onNodeValueChange(node.id, port.key, event.target.value)}
          placeholder={uiField?.placeholder || port.description || port.label}
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
  const missingRequiredInputs = selectedNode
    ? (selectedNode.data.module.exposed_inputs ?? []).filter((port) => port.required && !isNodeInputSatisfied(selectedNode, port))
    : []
  const sortedSelectedNodeInputs = selectedNode
    ? [...(selectedNode.data.module.exposed_inputs ?? [])].sort((left, right) => {
        const leftHighlighted = left.key === highlightedPortKey ? 1 : 0
        const rightHighlighted = right.key === highlightedPortKey ? 1 : 0
        if (leftHighlighted !== rightHighlighted) {
          return rightHighlighted - leftHighlighted
        }

        const leftMissing = left.required && !isNodeInputSatisfied(selectedNode, left) ? 1 : 0
        const rightMissing = right.required && !isNodeInputSatisfied(selectedNode, right) ? 1 : 0
        if (leftMissing !== rightMissing) {
          return rightMissing - leftMissing
        }
        if (Boolean(left.required) !== Boolean(right.required)) {
          return Number(Boolean(right.required)) - Number(Boolean(left.required))
        }
        return left.label.localeCompare(right.label)
      })
    : []

  return (
    <Card>
      <CardContent className="space-y-4">
        {showHeader ? (
          <SectionHeading
            variant="inside"
            heading="Node Inspector"
          />
        ) : null}
        {!selectedNode && !selectedEdge ? (
          <div className="rounded-sm bg-surface-low px-4 py-6 text-sm text-muted-foreground">노드나 엣지를 선택해.</div>
        ) : null}

        {!selectedNode && selectedEdge && sourceEndpoint && targetEndpoint ? (
          <div className="space-y-3 rounded-sm bg-surface-low p-4">
            <div className="flex items-center gap-2">
              <div className="font-medium text-foreground">Selected Edge</div>
              {selectedEdgeType ? <Badge variant="outline">{selectedEdgeType}</Badge> : null}
              <TechnicalReferenceHint title={`edge ${selectedEdge.id}`} label="엣지 내부 식별자 보기" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <EdgeEndpointCard heading="Source" endpoint={sourceEndpoint} role="출력" />
              <EdgeEndpointCard heading="Target" endpoint={targetEndpoint} role="입력" />
            </div>
          </div>
        ) : null}

        {selectedNode ? (
          <>
            <div className="rounded-sm bg-surface-low p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-foreground">{selectedNode.data.module.name}</span>
                <Badge variant="outline">{selectedNode.data.module.engine_type}</Badge>
                <TechnicalReferenceHint title={`node ${selectedNode.id}`} label="노드 내부 식별자 보기" />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                <Badge variant="outline">입력 {(selectedNode.data.module.exposed_inputs ?? []).length}</Badge>
                <Badge variant="outline">출력 {(selectedNode.data.module.output_ports ?? []).length}</Badge>
                {missingRequiredInputs.length > 0 ? <Badge variant="outline">필수 부족 {missingRequiredInputs.length}</Badge> : <Badge variant="secondary">필수 입력 충족</Badge>}
                {highlightedPortKey ? <Badge variant="secondary">선택 포트 강조</Badge> : null}
                {highlightedPortKey ? <TechnicalReferenceHint title={`focus port ${highlightedPortKey}`} label="강조 중인 포트 내부 키 보기" /> : null}
              </div>
            </div>

            {missingRequiredInputs.length > 0 ? (
              <div className="rounded-sm border px-4 py-3" style={{ borderColor: '#f59e0b99', backgroundColor: 'rgba(245, 158, 11, 0.08)' } as CSSProperties}>
                <div className="text-sm font-medium text-foreground">아직 채워야 하는 필수 입력</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {missingRequiredInputs.map((port) => (
                    <Badge key={port.key} variant="secondary">{port.label}</Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {(selectedNode.data.module.exposed_inputs ?? []).length === 0 ? (
              <div className="text-sm text-muted-foreground">이 노드는 편집 가능한 입력 포트가 없어.</div>
            ) : (
              <div className="space-y-4">{sortedSelectedNodeInputs.map((port) => renderPortInput(selectedNode, port))}</div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
