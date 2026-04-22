import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ImageAttachmentPickerButton } from '@/features/image-generation/components/image-attachment-picker'
import { getGenerationComfyUIServers, getGenerationWorkflowServers } from '@/lib/api-image-generation-workflows'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import type { ComfyUIServer, GraphExecutionArtifactRecord, ModulePortDefinition, ModuleUiFieldDefinition } from '@/lib/api'
import { ExecutionArtifactCard } from './execution-artifact-card'
import { NaiCharacterPromptsInput, isNaiCharacterPromptPort } from './nai-character-prompts-input'
import { NaiReusableAssetInput, isNaiCharacterReferencePort, isNaiVibePort } from './nai-reusable-assets-input'
import { TechnicalReferenceHint, getModuleGraphPortTypeLabel, hasMeaningfulValue } from './module-graph-field-shared'
import { getWorkflowInputSourcePort } from '../module-graph-workflow-inputs'
import { getModuleBaseDisplayName, getModuleNodeDisplayLabel, normalizeModulePortDescription, parseHandleId, type ModuleGraphEdge, type ModuleGraphNode } from '../module-graph-shared'

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

const NODE_INSPECTOR_INPUT_SURFACE_CLASS = 'space-y-2 rounded-sm border border-border/70 bg-background/35 p-3'
const NODE_INSPECTOR_EDGE_SURFACE_CLASS = 'space-y-3 rounded-sm border border-border/70 bg-background/35 p-4'
const NODE_INSPECTOR_NODE_SURFACE_CLASS = 'rounded-sm border border-border/70 bg-background/35 p-4'
const GRAPH_COMFY_TARGET_MODE_KEY = 'execution_target_mode'
const GRAPH_COMFY_TARGET_TAG_KEY = 'execution_target_tag'
const GRAPH_COMFY_TARGET_SERVER_ID_KEY = 'execution_target_server_id'

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parsePositiveIntegerish(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null
  }

  return null
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
      <Badge variant="outline">{getModuleGraphPortTypeLabel(port.data_type)}</Badge>
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

/** Find editable UI-only fields that are not backed by module input ports. */
function getStandaloneNodeUiFields(node: ModuleGraphNode) {
  const portKeys = new Set((node.data.module.exposed_inputs ?? []).map((port) => port.key))
  return (node.data.module.ui_schema ?? []).filter((field) => !portKeys.has(field.key))
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
    <div className="rounded-sm border border-border/70 bg-background/35 px-3 py-3">
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
  const selectedNodeWorkflowId = useMemo(() => {
    if (!selectedNode || selectedNode.data.module.engine_type !== 'comfyui') {
      return null
    }

    return parsePositiveIntegerish(
      selectedNode.data.module.source_workflow_id
      ?? selectedNode.data.module.template_defaults?.workflow_id,
    )
  }, [selectedNode])
  const isSelectedNodeComfy = selectedNode?.data.module.engine_type === 'comfyui'
  const canConfigureSelectedNodeQueueTarget = Boolean(isSelectedNodeComfy && selectedNodeWorkflowId)

  const comfyServersQuery = useQuery({
    queryKey: ['generation-comfyui-servers', 'module-graph-node-targeting'],
    queryFn: () => getGenerationComfyUIServers(true),
    enabled: canConfigureSelectedNodeQueueTarget,
    staleTime: 30_000,
  })

  const workflowServersQuery = useQuery({
    queryKey: ['generation-workflow-servers', selectedNodeWorkflowId],
    queryFn: () => getGenerationWorkflowServers(selectedNodeWorkflowId as number),
    enabled: canConfigureSelectedNodeQueueTarget && selectedNodeWorkflowId !== null,
    staleTime: 30_000,
  })

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
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <NaiCharacterPromptsInput value={rawValue} onChange={(value) => onNodeValueChange(node.id, port.key, value)} />
        </div>
      )
    }

    if (isNaiVibePort(port.key, port.data_type)) {
      return (
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <NaiReusableAssetInput kind="vibes" value={rawValue} onChange={(value) => onNodeValueChange(node.id, port.key, value)} />
        </div>
      )
    }

    if (isNaiCharacterReferencePort(port.key, port.data_type)) {
      return (
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <NaiReusableAssetInput kind="character_refs" value={rawValue} onChange={(value) => onNodeValueChange(node.id, port.key, value)} />
        </div>
      )
    }

    if (uiField?.data_type === 'select' && Array.isArray(uiField.options) && uiField.options.length > 0) {
      return (
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
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
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
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
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
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
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
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
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
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
        <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
          <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
          <div className="text-sm text-muted-foreground">
            이 포트는 연결된 업스트림 값을 그대로 받아. 직접 편집은 지원하지 않아.
          </div>
        </div>
      )
    }

    return (
      <div key={port.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS} style={cardStyle}>
        <PortHeader nodeId={node.id} port={port} hasExplicitValue={hasExplicitValue} missingRequired={missingRequired || isHighlightedPort} onClear={clearPortValue} />
        <Input
          value={typeof rawValue === 'string' ? rawValue : rawValue ? String(rawValue) : ''}
          onChange={(event) => onNodeValueChange(node.id, port.key, event.target.value)}
          placeholder={uiField?.placeholder || normalizedDescription || port.label}
        />
      </div>
    )
  }

  const renderStandaloneUiField = (node: ModuleGraphNode, field: ModuleUiFieldDefinition) => {
    const rawValue = node.data.inputValues?.[field.key]
    const normalizedDescription = normalizeModulePortDescription(field.description)
    const hasExplicitValue = hasMeaningfulValue(rawValue)
    const clearFieldValue = () => onNodeValueClear(node.id, field.key)

    if (field.data_type === 'select' && Array.isArray(field.options) && field.options.length > 0) {
      return (
        <div key={field.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <div className="text-sm font-medium text-foreground">{field.label}</div>
                <TechnicalReferenceHint title={`field ${field.key}`} label="필드 내부 키 보기" />
              </div>
              {normalizedDescription ? <div className="mt-1 text-xs text-muted-foreground">{normalizedDescription}</div> : null}
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={clearFieldValue} disabled={!hasExplicitValue}>
              값 지우기
            </Button>
          </div>
          <Select
            value={typeof rawValue === 'string' ? rawValue : rawValue == null ? '' : String(rawValue)}
            onChange={(event) => onNodeValueChange(node.id, field.key, event.target.value)}
          >
            <option value="">{hasMeaningfulValue(field.default_value) ? '기본값 사용' : '선택'}</option>
            {field.options.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </Select>
        </div>
      )
    }

    if (field.data_type === 'number') {
      return (
        <div key={field.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <div className="text-sm font-medium text-foreground">{field.label}</div>
                <TechnicalReferenceHint title={`field ${field.key}`} label="필드 내부 키 보기" />
              </div>
              {normalizedDescription ? <div className="mt-1 text-xs text-muted-foreground">{normalizedDescription}</div> : null}
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={clearFieldValue} disabled={!hasExplicitValue}>
              값 지우기
            </Button>
          </div>
          <Input
            type="number"
            min={field.min}
            max={field.max}
            value={typeof rawValue === 'number' ? String(rawValue) : typeof rawValue === 'string' ? rawValue : ''}
            onChange={(event) => onNodeValueChange(node.id, field.key, event.target.value === '' ? '' : Number(event.target.value))}
            placeholder={field.placeholder || field.label}
          />
        </div>
      )
    }

    if (field.data_type === 'boolean') {
      return (
        <div key={field.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1">
                <div className="text-sm font-medium text-foreground">{field.label}</div>
                <TechnicalReferenceHint title={`field ${field.key}`} label="필드 내부 키 보기" />
              </div>
              {normalizedDescription ? <div className="mt-1 text-xs text-muted-foreground">{normalizedDescription}</div> : null}
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={clearFieldValue} disabled={!hasExplicitValue}>
              값 지우기
            </Button>
          </div>
          <Select
            value={typeof rawValue === 'boolean' ? String(rawValue) : ''}
            onChange={(event) => onNodeValueChange(node.id, field.key, event.target.value === 'true')}
          >
            <option value="">기본값 사용</option>
            <option value="true">true</option>
            <option value="false">false</option>
          </Select>
        </div>
      )
    }

    return (
      <div key={field.key} className={NODE_INSPECTOR_INPUT_SURFACE_CLASS}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <div className="text-sm font-medium text-foreground">{field.label}</div>
              <TechnicalReferenceHint title={`field ${field.key}`} label="필드 내부 키 보기" />
            </div>
            {normalizedDescription ? <div className="mt-1 text-xs text-muted-foreground">{normalizedDescription}</div> : null}
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={clearFieldValue} disabled={!hasExplicitValue}>
            값 지우기
          </Button>
        </div>
        {field.data_type === 'json' || field.data_type === 'prompt' || field.data_type === 'text' ? (
          <Textarea
            rows={field.data_type === 'json' ? 6 : 2}
            value={typeof rawValue === 'string' ? rawValue : rawValue ? JSON.stringify(rawValue, null, 2) : ''}
            onChange={(event) => onNodeValueChange(node.id, field.key, event.target.value)}
            placeholder={field.placeholder || normalizedDescription || field.label}
          />
        ) : (
          <Input
            value={typeof rawValue === 'string' ? rawValue : rawValue ? String(rawValue) : ''}
            onChange={(event) => onNodeValueChange(node.id, field.key, event.target.value)}
            placeholder={field.placeholder || normalizedDescription || field.label}
          />
        )}
      </div>
    )
  }

  const renderComfyExecutionTargetPanel = (node: ModuleGraphNode) => {
    const workflowId = parsePositiveIntegerish(node.data.module.source_workflow_id ?? node.data.module.template_defaults?.workflow_id)
    if (!workflowId) {
      return (
        <div className="rounded-sm border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
          이 ComfyUI 노드는 원본 workflow 연결이 없어서 큐 타겟 설정을 붙일 수 없어.
        </div>
      )
    }

    const allServers = comfyServersQuery.data ?? []
    const linkedServers = workflowServersQuery.data ?? []
    const candidateServers: ComfyUIServer[] = linkedServers.length > 0 ? linkedServers : allServers
    const routingTags = Array.from(new Set(candidateServers.flatMap((server) => server.routing_tags ?? []))).sort((left, right) => left.localeCompare(right))
    const rawMode = normalizeOptionalString(node.data.inputValues?.[GRAPH_COMFY_TARGET_MODE_KEY])?.toLowerCase()
    const selectedMode = rawMode === 'tag' || rawMode === 'server' ? rawMode : 'auto'
    const selectedTag = normalizeOptionalString(node.data.inputValues?.[GRAPH_COMFY_TARGET_TAG_KEY]) ?? ''
    const selectedServerId = parsePositiveIntegerish(node.data.inputValues?.[GRAPH_COMFY_TARGET_SERVER_ID_KEY])
    const isLoadingTargets = comfyServersQuery.isLoading || workflowServersQuery.isLoading
    const hasTargetLoadError = comfyServersQuery.isError || workflowServersQuery.isError

    return (
      <div className="space-y-3 rounded-sm border border-border bg-background/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-medium text-foreground">Comfy 실행 대상</div>
          <Badge variant="outline">workflow #{workflowId}</Badge>
          <Badge variant="outline">서버 {candidateServers.length}</Badge>
          {routingTags.length > 0 ? <Badge variant="outline">태그 {routingTags.length}</Badge> : null}
        </div>

        {isLoadingTargets ? (
          <div className="rounded-sm border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
            사용 가능한 ComfyUI 서버를 불러오는 중이야…
          </div>
        ) : hasTargetLoadError ? (
          <div className="rounded-sm border border-dashed border-destructive/40 px-3 py-2 text-sm text-muted-foreground">
            서버/태그 목록을 불러오지 못했어. 저장된 값은 유지되지만 지금은 새 선택지가 비어 있을 수 있어.
          </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">모드</div>
            <Select
              value={selectedMode}
              onChange={(event) => onNodeValueChange(node.id, GRAPH_COMFY_TARGET_MODE_KEY, event.target.value)}
            >
              <option value="auto">자동 분산</option>
              <option value="tag">태그 기반</option>
              <option value="server">개별 서버</option>
            </Select>
          </div>

          {selectedMode === 'tag' ? (
            <div className="space-y-1 md:col-span-2">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">라우팅 태그</div>
              <Select
                value={selectedTag}
                onChange={(event) => onNodeValueChange(node.id, GRAPH_COMFY_TARGET_TAG_KEY, event.target.value)}
                disabled={routingTags.length === 0}
              >
                <option value="">태그 선택</option>
                {routingTags.map((tag) => (
                  <option key={tag} value={tag}>#{tag}</option>
                ))}
              </Select>
            </div>
          ) : null}

          {selectedMode === 'server' ? (
            <div className="space-y-1 md:col-span-2">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">ComfyUI 서버</div>
              <Select
                value={selectedServerId ? String(selectedServerId) : ''}
                onChange={(event) => onNodeValueChange(node.id, GRAPH_COMFY_TARGET_SERVER_ID_KEY, event.target.value)}
                disabled={candidateServers.length === 0}
              >
                <option value="">서버 선택</option>
                {candidateServers.map((server) => (
                  <option key={server.id} value={server.id}>{server.name}</option>
                ))}
              </Select>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1.5 text-xs text-muted-foreground">
          {linkedServers.length > 0 ? <Badge variant="secondary">워크플로우 연결 서버만 사용</Badge> : <Badge variant="secondary">활성 서버 전체 사용</Badge>}
          {selectedMode === 'auto' ? <Badge variant="outline">현재: 자동 분산</Badge> : null}
          {selectedMode === 'tag' && selectedTag ? <Badge variant="outline">현재 태그 #{selectedTag}</Badge> : null}
          {selectedMode === 'server' && selectedServerId ? <Badge variant="outline">현재 서버 #{selectedServerId}</Badge> : null}
        </div>
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
  const selectedNodeStandaloneUiFields = selectedNode ? getStandaloneNodeUiFields(selectedNode) : []
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
          <div className={NODE_INSPECTOR_EDGE_SURFACE_CLASS}>
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
            <div className={NODE_INSPECTOR_NODE_SURFACE_CLASS}>
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
                        placeholder={getModuleBaseDisplayName(selectedNode.data.module)}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">기본 타입</div>
                      <div className="flex h-10 items-center rounded-sm border border-border bg-background/50 px-3 text-sm text-muted-foreground">
                        {getModuleBaseDisplayName(selectedNode.data.module)}
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

            {selectedNode.data.module.engine_type === 'comfyui' ? renderComfyExecutionTargetPanel(selectedNode) : null}

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
                            {group.portType ? <Badge variant="outline">{getModuleGraphPortTypeLabel(group.portType)}</Badge> : null}
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
              selectedNodeStandaloneUiFields.length > 0 ? (
                <div className="space-y-4">{selectedNodeStandaloneUiFields.map((field) => renderStandaloneUiField(selectedNode, field))}</div>
              ) : (
                <div className="text-sm text-muted-foreground">이 노드 입력은 카드에서 바로 편집해.</div>
              )
            ) : (
              <div className="space-y-4">
                {sortedSelectedNodeInputs.map((port) => renderPortInput(selectedNode, port))}
                {selectedNodeStandaloneUiFields.map((field) => renderStandaloneUiField(selectedNode, field))}
              </div>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
