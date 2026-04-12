import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ChevronDown, ChevronRight, CircleHelp } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ImageAttachmentPickerButton } from '@/features/image-generation/components/image-attachment-picker'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import type { GraphExecutionArtifactRecord, ModulePortDefinition } from '@/lib/api'
import { ExecutionArtifactCard } from './execution-artifact-card'
import { NaiCharacterPromptsInput, isNaiCharacterPromptPort } from './nai-character-prompts-input'
import { NaiReusableAssetInput, isNaiCharacterReferencePort, isNaiVibePort } from './nai-reusable-assets-input'
import { getWorkflowInputSourcePort } from '../module-graph-workflow-inputs'
import { getModuleNodeDisplayLabel, normalizeModulePortDescription, parseHandleId, type ModuleGraphEdge, type ModuleGraphNode } from '../module-graph-shared'

type NodeInspectorPanelProps = {
  nodes: ModuleGraphNode[]
  selectedNode: ModuleGraphNode | null
  selectedEdge: ModuleGraphEdge | null
  selectedExecutionId?: number | null
  selectedExecutionArtifacts?: GraphExecutionArtifactRecord[]
  onNodeLabelChange: (nodeId: string, label: string) => void
  onNodeValueChange: (nodeId: string, portKey: string, value: unknown) => void
  onNodeValueClear: (nodeId: string, portKey: string) => void
  onNodeImageChange: (nodeId: string, portKey: string, image?: SelectedImageDraft) => Promise<void> | void
  onExecuteSelectedNode?: () => void
  onForceExecuteSelectedNode?: () => void
  executeSelectedNodeDisabled?: boolean
  executeSelectedNodeLabel?: string
  forceExecuteSelectedNodeLabel?: string
  highlightedPortKey?: string | null
  showHeader?: boolean
}

type ResolvedEdgeEndpoint = {
  node: ModuleGraphNode | null
  port: ModulePortDefinition | null
  portKey: string | null
}

type NodeOutputArtifactGroup = {
  portKey: string
  portLabel: string
  portType: ModulePortDefinition['data_type'] | null
  artifacts: GraphExecutionArtifactRecord[]
}

const PORT_TYPE_LABELS: Record<ModulePortDefinition['data_type'], string> = {
  image: '이미지',
  mask: '마스크',
  prompt: '프롬프트',
  text: '텍스트',
  number: '숫자',
  boolean: '불리언',
  json: 'JSON',
  any: '임의',
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
      <Badge variant="outline">{PORT_TYPE_LABELS[port.data_type]}</Badge>
      <Badge variant="secondary">{port.key}</Badge>
      {port.required ? <Badge variant="outline">필수</Badge> : null}
      {missingRequired ? <Badge variant="secondary">입력 필요</Badge> : null}
      {port.multiple ? <Badge variant="outline">다중</Badge> : null}
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
        {normalizeModulePortDescription(port.description) ? <div className="mt-1 text-xs text-muted-foreground">{normalizeModulePortDescription(port.description)}</div> : null}
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
        <div className="text-sm font-medium text-foreground">{endpoint.node ? getModuleNodeDisplayLabel(endpoint.node) : '알 수 없는 노드'}</div>
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
          {normalizeModulePortDescription(endpoint.port.description) ? <div className="mt-1 text-xs text-muted-foreground">{normalizeModulePortDescription(endpoint.port.description)}</div> : null}
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

/** Group one selected node's execution artifacts by output port for inspector display. */
function groupNodeOutputArtifacts(node: ModuleGraphNode, artifacts: GraphExecutionArtifactRecord[]) {
  const outputPortMap = new Map(node.data.module.output_ports.map((port, index) => [port.key, { port, index }]))
  const groupedArtifacts = artifacts.reduce<Map<string, GraphExecutionArtifactRecord[]>>((acc, artifact) => {
    const current = acc.get(artifact.port_key) ?? []
    current.push(artifact)
    acc.set(artifact.port_key, current)
    return acc
  }, new Map())

  return Array.from(groupedArtifacts.entries())
    .map(([portKey, portArtifacts]) => {
      const outputPort = outputPortMap.get(portKey)?.port ?? null
      return {
        portKey,
        portLabel: outputPort?.label ?? portKey,
        portType: outputPort?.data_type ?? (portArtifacts[0]?.artifact_type === 'file' ? null : portArtifacts[0]?.artifact_type ?? null),
        artifacts: [...portArtifacts].sort((left, right) => new Date(right.created_date).getTime() - new Date(left.created_date).getTime()),
      } satisfies NodeOutputArtifactGroup
    })
    .sort((left, right) => {
      const leftOrder = outputPortMap.get(left.portKey)?.index ?? Number.MAX_SAFE_INTEGER
      const rightOrder = outputPortMap.get(right.portKey)?.index ?? Number.MAX_SAFE_INTEGER
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder
      }

      return left.portLabel.localeCompare(right.portLabel, 'ko')
    })
}

/** Render editable node input overrides and selected edge details. */
export function NodeInspectorPanel({
  nodes,
  selectedNode,
  selectedEdge,
  selectedExecutionId = null,
  selectedExecutionArtifacts,
  onNodeLabelChange,
  onNodeValueChange,
  onNodeValueClear,
  onNodeImageChange,
  onExecuteSelectedNode,
  onForceExecuteSelectedNode,
  executeSelectedNodeDisabled = false,
  executeSelectedNodeLabel = '선택 노드 실행',
  forceExecuteSelectedNodeLabel = '강제 재실행',
  highlightedPortKey = null,
  showHeader = true,
}: NodeInspectorPanelProps) {
  const [collapsedOutputGroupKeys, setCollapsedOutputGroupKeys] = useState<string[]>([])

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setCollapsedOutputGroupKeys([])
    })

    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [selectedNode?.id, selectedExecutionId])

  const renderPortInput = (node: ModuleGraphNode, port: ModulePortDefinition) => {
    const rawValue = node.data.inputValues?.[port.key]
    const uiField = findNodeUiField(node, port.key)
    const normalizedDescription = normalizeModulePortDescription(port.description)
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
            placeholder={normalizedDescription || port.label}
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
          <ImageAttachmentPickerButton label={hasExplicitValue ? '이미지 변경' : '이미지 선택'} modalTitle={port.label} allowSaveDialog={false} onSelect={(image) => void onNodeImageChange(node.id, port.key, image)} />
          {typeof rawValue === 'string' && rawValue.startsWith('data:') ? (
            <InlineMediaPreview src={rawValue} alt={port.label} frameClassName="p-3" />
          ) : null}
        </div>
      )
    }

    if (port.data_type === 'any') {
      return (
        <div key={port.key} className="space-y-2 rounded-sm border border-border bg-surface-low p-3" style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <div className="text-sm text-muted-foreground">
            이 포트는 연결된 업스트림 값을 그대로 받아. 직접 편집은 지원하지 않아.
          </div>
        </div>
      )
    }

    return (
      <div key={port.key} className="space-y-2 rounded-sm border border-border bg-surface-low p-3" style={cardStyle}>
        <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
        <Input
          value={typeof rawValue === 'string' ? rawValue : rawValue ? String(rawValue) : ''}
          onChange={(event) => onNodeValueChange(node.id, port.key, event.target.value)}
          placeholder={uiField?.placeholder || normalizedDescription || port.label}
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
  const selectedNodeWorkflowInputPort = selectedNode ? getWorkflowInputSourcePort(selectedNode) : null
  const sortedSelectedNodeInputs = selectedNode && !selectedNodeWorkflowInputPort
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
  const selectedNodeOutputGroups = useMemo(
    () => selectedNode && selectedExecutionArtifacts
      ? groupNodeOutputArtifacts(
          selectedNode,
          selectedExecutionArtifacts.filter((artifact) => artifact.node_id === selectedNode.id),
        )
      : [],
    [selectedExecutionArtifacts, selectedNode],
  )

  const toggleOutputGroup = (portKey: string) => {
    setCollapsedOutputGroupKeys((current) => (
      current.includes(portKey)
        ? current.filter((key) => key !== portKey)
        : [...current, portKey]
    ))
  }

  return (
    <Card>
      <CardContent className="space-y-4">
        {showHeader ? (
          <SectionHeading
            variant="inside"
            heading="노드 인스펙터"
          />
        ) : null}
        {!selectedNode && !selectedEdge ? (
          <div className="rounded-sm bg-surface-low px-4 py-6 text-sm text-muted-foreground">노드나 엣지를 선택해.</div>
        ) : null}

        {!selectedNode && selectedEdge && sourceEndpoint && targetEndpoint ? (
          <div className="space-y-3 rounded-sm bg-surface-low p-4">
            <div className="flex items-center gap-2">
              <div className="font-medium text-foreground">선택한 엣지</div>
              {selectedEdgeType ? <Badge variant="outline">{selectedEdgeType}</Badge> : null}
              <TechnicalReferenceHint title={`edge ${selectedEdge.id}`} label="엣지 내부 식별자 보기" />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <EdgeEndpointCard heading="출발" endpoint={sourceEndpoint} role="출력" />
              <EdgeEndpointCard heading="도착" endpoint={targetEndpoint} role="입력" />
            </div>
          </div>
        ) : null}

        {selectedNode ? (
          <>
            <div className="rounded-sm bg-surface-low p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{getModuleNodeDisplayLabel(selectedNode)}</span>
                    <Badge variant="outline">{selectedNode.data.module.engine_type}</Badge>
                    <TechnicalReferenceHint title={`node ${selectedNode.id}`} label="노드 내부 식별자 보기" />
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">노드 이름</div>
                      <Input
                        value={selectedNode.data.label ?? ''}
                        onChange={(event) => onNodeLabelChange(selectedNode.id, event.target.value)}
                        placeholder={selectedNode.data.module.name}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">기본 타입</div>
                      <div className="flex h-10 items-center rounded-sm border border-border bg-background/50 px-3 text-sm text-muted-foreground">
                        {selectedNode.data.module.name}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                    <Badge variant="outline">입력 {(selectedNode.data.module.exposed_inputs ?? []).length}</Badge>
                    <Badge variant="outline">출력 {(selectedNode.data.module.output_ports ?? []).length}</Badge>
                    {missingRequiredInputs.length > 0 ? <Badge variant="outline">필수 부족 {missingRequiredInputs.length}</Badge> : <Badge variant="secondary">필수 입력 충족</Badge>}
                    {highlightedPortKey ? <Badge variant="secondary">선택 포트 강조</Badge> : null}
                    {highlightedPortKey ? <TechnicalReferenceHint title={`focus port ${highlightedPortKey}`} label="강조 중인 포트 내부 키 보기" /> : null}
                  </div>
                </div>
                {onExecuteSelectedNode ? (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={onExecuteSelectedNode} disabled={executeSelectedNodeDisabled}>
                      {executeSelectedNodeLabel}
                    </Button>
                    {onForceExecuteSelectedNode ? (
                      <Button type="button" size="sm" variant="outline" onClick={onForceExecuteSelectedNode} disabled={executeSelectedNodeDisabled}>
                        {forceExecuteSelectedNodeLabel}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
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

            <div className="space-y-3 rounded-sm border border-border bg-background/40 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-foreground">노드 출력</div>
                {selectedExecutionId ? <Badge variant="outline">실행 #{selectedExecutionId}</Badge> : <Badge variant="outline">실행 선택 필요</Badge>}
                {selectedNodeOutputGroups.length > 0 ? <Badge variant="outline">포트 {selectedNodeOutputGroups.length}</Badge> : null}
              </div>

              {!selectedExecutionArtifacts ? (
                <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                  실행 결과를 선택하면 이 노드의 출력 값을 포트별로 여기서 바로 확인할 수 있어.
                </div>
              ) : selectedNodeOutputGroups.length === 0 ? (
                <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
                  선택한 실행에서 이 노드가 남긴 출력이 없어.
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedNodeOutputGroups.map((group) => {
                    const isCollapsed = collapsedOutputGroupKeys.includes(group.portKey)

                    return (
                      <div key={group.portKey} className="rounded-sm border border-border bg-surface-low/70">
                        <button
                          type="button"
                          onClick={() => toggleOutputGroup(group.portKey)}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                            <span className="truncate text-sm font-medium text-foreground">{group.portLabel}</span>
                            <Badge variant="secondary">{group.portKey}</Badge>
                            {group.portType ? <Badge variant="outline">{PORT_TYPE_LABELS[group.portType]}</Badge> : null}
                          </div>
                          <Badge variant="outline">{group.artifacts.length}</Badge>
                        </button>

                        {!isCollapsed ? (
                          <div className="space-y-3 border-t border-border px-3 py-3">
                            {group.artifacts.map((artifact) => (
                              <ExecutionArtifactCard key={artifact.id} artifact={artifact} />
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {(selectedNode.data.module.exposed_inputs ?? []).length === 0 || selectedNodeWorkflowInputPort ? (
              <div className="text-sm text-muted-foreground">이 노드 입력은 카드에서 바로 편집해.</div>
            ) : (
              <div className="space-y-4">{sortedSelectedNodeInputs.map((port) => renderPortInput(selectedNode, port))}</div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
