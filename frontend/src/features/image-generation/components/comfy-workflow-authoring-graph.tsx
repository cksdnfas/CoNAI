import { useMemo } from 'react'
import { Check, GripVertical, Plus } from 'lucide-react'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { buildPowerLoraNodeItemsFromInputs } from './power-lora-loader-input'
import {
  MINIMAX_H3_DIRECTOR_CLASS_TYPE,
  MINIMAX_H3_DIRECTOR_NODE_EDITOR,
  MINIMAX_H3_DIRECTOR_NODE_INPUT_KEY,
} from './minimax-h3-director-dasiwa-utils'

type WorkflowJsonNodeRecord = {
  title?: string
  class_type?: string
  inputs?: Record<string, unknown>
  pos?: unknown
  position?: unknown
  _meta?: {
    title?: string
  }
}

type WorkflowJsonRecord = Record<string, WorkflowJsonNodeRecord>

type WorkflowNodeItem = NonNullable<WorkflowMarkedField['node_items']>[number]

export type EditableWorkflowInput = {
  key: string
  label: string
  value: unknown
  inferredType: WorkflowMarkedField['type']
  jsonPath?: string
  typeLabel?: string
  nodeEditor?: WorkflowMarkedField['node_editor']
  nodeItems?: WorkflowNodeItem[]
}

export type AuthoringNodeData = {
  title: string
  classType: string
  editableInputs: EditableWorkflowInput[]
  markedJsonPaths: string[]
  /** JSON path of the field selected in the field panel, when it belongs to this node. */
  selectedJsonPath?: string | null
  /** Current search text, so matching inputs are marked too. */
  searchQuery?: string
  searchMatched?: boolean
  searchCurrent?: boolean
  onInputSelect: (nodeId: string, nodeTitle: string, classType: string, input: EditableWorkflowInput) => void
}

export type AuthoringNode = Node<AuthoringNodeData, 'comfyAuthoring'>
export type AuthoringEdge = Edge

export type ParsedWorkflowGraph = {
  nodes: AuthoringNode[]
  edges: AuthoringEdge[]
}

/** Build a readable label from a workflow input key. */
function humanizeWorkflowInputKey(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase())
}

/** Keep generated marked-field ids stable and React-safe. */
function sanitizeWorkflowFieldId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

const POWER_LORA_LOADER_CLASS_TYPE = 'Power Lora Loader (rgthree)'
const POWER_LORA_NODE_INPUT_KEY = '__power_lora_loader_node__'

function inferWorkflowNumberStep(value: number) {
  if (!Number.isFinite(value)) {
    return undefined
  }

  const normalized = `${value}`
  const decimalPart = normalized.includes('.') ? normalized.split('.')[1] ?? '' : ''
  if (decimalPart.length === 0) {
    return 1
  }

  return Number(`0.${'0'.repeat(Math.max(decimalPart.length - 1, 0))}1`)
}

/** Infer the most useful authoring field type from the raw workflow value. */
function inferWorkflowFieldType(inputKey: string, value: string | number | boolean | null): WorkflowMarkedField['type'] {
  if (typeof value === 'number') {
    return 'number'
  }

  if (typeof value === 'boolean') {
    return 'select'
  }

  const normalizedKey = inputKey.toLowerCase()
  if (normalizedKey.includes('image') || normalizedKey.includes('mask') || normalizedKey.includes('pixels')) {
    return 'image'
  }

  if (typeof value === 'string') {
    if (value.includes('\n') || value.length > 80 || normalizedKey.includes('prompt') || normalizedKey.includes('text')) {
      return 'textarea'
    }
  }

  return 'text'
}

/** Prefer the user-facing node title, then fall back to class type or node id. */
function resolveWorkflowNodeTitle(nodeId: string, nodeData: WorkflowJsonNodeRecord) {
  const preferredTitle = typeof nodeData.title === 'string' && nodeData.title.trim().length > 0
    ? nodeData.title.trim()
    : typeof nodeData._meta?.title === 'string' && nodeData._meta.title.trim().length > 0
      ? nodeData._meta.title.trim()
      : null

  return preferredTitle ?? nodeData.class_type ?? `Node ${nodeId}`
}

/** Parse and validate the raw Comfy workflow JSON payload. */
export function parseWorkflowDefinition(workflowJson: string): WorkflowJsonRecord {
  const parsed = JSON.parse(workflowJson) as unknown

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Workflow JSON root must be an object.')
  }

  return parsed as WorkflowJsonRecord
}

/** Resolve node coordinates from the Comfy export when present. */
function resolveWorkflowNodePosition(nodeData: WorkflowJsonNodeRecord) {
  const candidate = nodeData.pos ?? nodeData.position

  if (Array.isArray(candidate) && candidate.length >= 2) {
    const [x, y] = candidate
    if (typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)) {
      return { x, y }
    }
  }

  if (candidate && typeof candidate === 'object') {
    const record = candidate as Record<string, unknown>
    const x = typeof record.x === 'number' && Number.isFinite(record.x)
      ? record.x
      : typeof record['0'] === 'number' && Number.isFinite(record['0'])
        ? record['0']
        : null
    const y = typeof record.y === 'number' && Number.isFinite(record.y)
      ? record.y
      : typeof record['1'] === 'number' && Number.isFinite(record['1'])
        ? record['1']
        : null

    if (x !== null && y !== null) {
      return { x, y }
    }
  }

  return null
}

/** Approximate node height so auto-layout columns stay readable. */
function estimateAuthoringNodeHeight(node: AuthoringNode) {
  const editableInputCount = node.data.editableInputs.length
  if (editableInputCount === 0) {
    return 120
  }

  return 108 + editableInputCount * 42
}

/** Place nodes using explicit Comfy positions first, then a simple fallback DAG layout. */
function layoutAuthoringGraph(
  nodes: AuthoringNode[],
  edges: AuthoringEdge[],
  explicitPositions: Map<string, { x: number; y: number } | null>,
) {
  const hasExplicitPositions = nodes.some((node) => explicitPositions.get(node.id) !== null)
  if (hasExplicitPositions) {
    const explicitNodes = nodes.filter((node) => explicitPositions.get(node.id) !== null)
    const maxExplicitX = explicitNodes.reduce((acc, node) => Math.max(acc, explicitPositions.get(node.id)?.x ?? 0), 0)
    const maxExplicitY = explicitNodes.reduce(
      (acc, node) => Math.max(acc, (explicitPositions.get(node.id)?.y ?? 0) + estimateAuthoringNodeHeight(node)),
      0,
    )
    let missingCursorY = maxExplicitY + 80

    return nodes.map((node) => {
      const explicitPosition = explicitPositions.get(node.id)
      if (explicitPosition) {
        return {
          ...node,
          position: explicitPosition,
        }
      }

      const nextNode = {
        ...node,
        position: {
          x: maxExplicitX + 360,
          y: missingCursorY,
        },
      }
      missingCursorY += estimateAuthoringNodeHeight(node) + 48
      return nextNode
    })
  }

  const inDegree = new Map<string, number>()
  const adjacency = new Map<string, string[]>()
  const depthByNode = new Map<string, number>()

  for (const node of nodes) {
    inDegree.set(node.id, 0)
    adjacency.set(node.id, [])
    depthByNode.set(node.id, 0)
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target)
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1)
  }

  const queue = nodes.filter((node) => (inDegree.get(node.id) ?? 0) === 0).map((node) => node.id)
  const visited = new Set<string>()

  while (queue.length > 0) {
    const nodeId = queue.shift() as string
    visited.add(nodeId)
    const currentDepth = depthByNode.get(nodeId) ?? 0

    for (const nextNodeId of adjacency.get(nodeId) ?? []) {
      depthByNode.set(nextNodeId, Math.max(depthByNode.get(nextNodeId) ?? 0, currentDepth + 1))
      inDegree.set(nextNodeId, (inDegree.get(nextNodeId) ?? 1) - 1)
      if ((inDegree.get(nextNodeId) ?? 0) === 0) {
        queue.push(nextNodeId)
      }
    }
  }

  for (const node of nodes) {
    if (!visited.has(node.id)) {
      depthByNode.set(node.id, Math.max(...depthByNode.values(), 0) + 1)
    }
  }

  const columnYOffsets = new Map<number, number>()
  return nodes.map((node) => {
    const depth = depthByNode.get(node.id) ?? 0
    const currentY = columnYOffsets.get(depth) ?? 0
    const estimatedHeight = estimateAuthoringNodeHeight(node)
    columnYOffsets.set(depth, currentY + estimatedHeight + 48)

    return {
      ...node,
      position: {
        x: depth * 360,
        y: currentY,
      },
    }
  })
}

/** Convert the raw Comfy workflow JSON into authoring graph nodes and edges. */
export function parseWorkflowGraph(params: {
  workflowJson: string
  onInputSelect: (nodeId: string, nodeTitle: string, classType: string, input: EditableWorkflowInput) => void
}): ParsedWorkflowGraph {
  const workflow = parseWorkflowDefinition(params.workflowJson)

  const nodes: AuthoringNode[] = []
  const edges: AuthoringEdge[] = []
  const explicitPositions = new Map<string, { x: number; y: number } | null>()

  for (const [nodeId, nodeData] of Object.entries(workflow)) {
    const inputs = nodeData.inputs ?? {}
    const editableInputs: EditableWorkflowInput[] = []
    const classType = nodeData.class_type || 'Unknown'

    if (classType === POWER_LORA_LOADER_CLASS_TYPE) {
      const powerLoraNodeItems = buildPowerLoraNodeItemsFromInputs(inputs)
      if (powerLoraNodeItems.length > 0) {
        editableInputs.push({
          key: POWER_LORA_NODE_INPUT_KEY,
          label: 'Add Lora',
          value: inputs,
          inferredType: 'node',
          jsonPath: `${nodeId}.inputs`,
          typeLabel: 'Node',
          nodeEditor: 'power_lora_loader_rgthree',
          nodeItems: powerLoraNodeItems,
        })
      }
    }

    if (classType === MINIMAX_H3_DIRECTOR_CLASS_TYPE) {
      editableInputs.push({
        key: MINIMAX_H3_DIRECTOR_NODE_INPUT_KEY,
        label: 'MiniMax H3 Director',
        value: inputs,
        inferredType: 'node',
        jsonPath: `${nodeId}.inputs`,
        typeLabel: 'Director',
        nodeEditor: MINIMAX_H3_DIRECTOR_NODE_EDITOR,
      })
    }

    for (const [inputKey, inputValue] of Object.entries(inputs)) {
      if (Array.isArray(inputValue) && inputValue.length >= 2) {
        edges.push({
          id: `${inputValue[0]}-${nodeId}-${inputKey}`,
          source: String(inputValue[0]),
          target: nodeId,
          label: inputKey,
        })
        continue
      }

      if (classType === POWER_LORA_LOADER_CLASS_TYPE && inputKey === '➕ Add Lora') {
        continue
      }

      if (classType === MINIMAX_H3_DIRECTOR_CLASS_TYPE) {
        continue
      }

      if (typeof inputValue === 'string' || typeof inputValue === 'number' || typeof inputValue === 'boolean' || inputValue === null) {
        editableInputs.push({
          key: inputKey,
          label: humanizeWorkflowInputKey(inputKey),
          value: inputValue,
          inferredType: inferWorkflowFieldType(inputKey, inputValue),
        })
      }
    }

    const title = resolveWorkflowNodeTitle(nodeId, nodeData)

    explicitPositions.set(nodeId, resolveWorkflowNodePosition(nodeData))

    nodes.push({
      id: nodeId,
      type: 'comfyAuthoring',
      position: { x: 0, y: 0 },
      data: {
        title,
        classType,
        editableInputs,
        markedJsonPaths: [],
        onInputSelect: params.onInputSelect,
      },
    })
  }

  return {
    nodes: layoutAuthoringGraph(nodes, edges, explicitPositions),
    edges,
  }
}

/** Build a marked-field draft from a clicked graph input. */
export function buildWorkflowMarkedFieldFromInput(
  nodeId: string,
  nodeTitle: string,
  classType: string,
  input: EditableWorkflowInput,
): WorkflowMarkedField {
  const fieldType = input.inferredType
  const dropdownOptions = typeof input.value === 'boolean' ? ['true', 'false'] : undefined
  const resolvedJsonPath = input.jsonPath ?? `${nodeId}.inputs.${input.key}`

  return {
    id: sanitizeWorkflowFieldId(`${nodeId}_${input.key}`),
    label: `${nodeTitle}-${input.label}`,
    description: input.typeLabel ? `${classType} · ${input.typeLabel}` : `${classType} · ${input.key}`,
    jsonPath: resolvedJsonPath,
    source_node_id: nodeId,
    source_node_title: nodeTitle,
    type: fieldType,
    default_collapsed: false,
    default_value:
      input.value === null
        ? undefined
        : typeof input.value === 'boolean'
          ? String(input.value)
          : input.value as WorkflowMarkedField['default_value'],
    placeholder: fieldType === 'text' || fieldType === 'textarea' ? humanizeWorkflowInputKey(input.key) : undefined,
    options: dropdownOptions,
    required: false,
    step: typeof input.value === 'number' ? inferWorkflowNumberStep(input.value) : undefined,
    node_class_type: fieldType === 'node' ? classType : undefined,
    node_editor: fieldType === 'node' ? input.nodeEditor : undefined,
    node_items: fieldType === 'node' ? input.nodeItems : undefined,
  }
}

/** Whether one node input matches the search text (input key or its readable label). */
export function authoringInputMatchesQuery(input: EditableWorkflowInput, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return false
  }

  return `${input.key} ${input.label}`.toLowerCase().includes(normalizedQuery)
}

/** Find graph nodes matching the current search query by title, class type, id or one of their inputs. */
export function findAuthoringGraphMatches(nodes: AuthoringNode[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return []
  }

  return nodes
    .filter((node) => {
      const haystack = [node.data.title, node.data.classType, node.id]
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedQuery) || node.data.editableInputs.some((input) => authoringInputMatchesQuery(input, normalizedQuery))
    })
    .map((node) => node.id)
}

/** Render one clickable workflow node card inside the authoring graph. */
function ComfyAuthoringNodeCard({ id, data }: NodeProps<AuthoringNode>) {
  const { t } = useI18n()
  const markedJsonPathSet = useMemo(() => new Set(data.markedJsonPaths), [data.markedJsonPaths])
  const hasSelectedInput = Boolean(data.selectedJsonPath)

  return (
    <div
      // Floating card on the graph canvas: tone + elevation; the selected field's node and search hits get a primary ring.
      className={cn(
        'w-[260px] rounded-sm bg-surface-container p-3 shadow-elevation-1',
        hasSelectedInput || data.searchCurrent ? 'ring-2 ring-primary/60' : data.searchMatched ? 'ring-1 ring-primary/40' : undefined,
      )}
    >
      <div className="flex items-start gap-2">
        <div className="comfy-authoring-drag-handle flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm bg-foreground/5 text-muted-foreground hover:text-foreground active:cursor-grabbing">
          <GripVertical className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-sm font-semibold text-foreground">{data.title}</div>
          <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
            <span>{data.classType}</span>
            <span>•</span>
            <span>#{id}</span>
          </div>
        </div>
      </div>

      {data.editableInputs.length > 0 ? (
        <div className="mt-3 space-y-0.5">
          {data.editableInputs.map((input) => {
            const path = input.jsonPath ?? `${id}.inputs.${input.key}`
            const marked = markedJsonPathSet.has(path)
            const current = data.selectedJsonPath === path
            const searchHit = data.searchQuery ? authoringInputMatchesQuery(input, data.searchQuery) : false
            return (
              <Button
                key={path}
                type="button"
                variant="nav"
                size="xs"
                data-active={marked || undefined}
                aria-pressed={marked}
                aria-current={current || undefined}
                onClick={() => data.onInputSelect(id, data.title, data.classType, input)}
                className={cn(
                  'nodrag nopan h-7 justify-between',
                  current && 'bg-primary/15 text-secondary-text hover:bg-primary/20 data-[active=true]:bg-primary/15 data-[active=true]:text-secondary-text',
                  !current && searchHit && 'ring-1 ring-inset ring-primary/45',
                )}
              >
                <span className="truncate">{input.label}</span>
                {marked ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
              </Button>
            )
          })}
        </div>
      ) : (
        <div className="mt-3 text-xs text-muted-foreground">{t('image-generation.components.comfy.workflow.authoring.graph.no.direct.inputs')}</div>
      )}
    </div>
  )
}

export const nodeTypes = {
  comfyAuthoring: ComfyAuthoringNodeCard,
}
