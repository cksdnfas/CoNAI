import { useMemo } from 'react'
import { Check, GripVertical, Plus, TriangleAlert } from 'lucide-react'
import { Handle, Position, type Edge, type Node, type NodeProps } from '@xyflow/react'
import type { WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
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
    pos?: unknown
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
  /** Server check findings for this node ("server: message"). */
  issues?: string[]
  /** No output node reaches this node, so ComfyUI never runs it. */
  unused?: boolean
  onInputSelect: (nodeId: string, nodeTitle: string, classType: string, input: EditableWorkflowInput) => void
}

export type AuthoringNode = Node<AuthoringNodeData, 'comfyAuthoring'>
export type AuthoringEdge = Edge

export type ParsedWorkflowGraph = {
  nodes: AuthoringNode[]
  edges: AuthoringEdge[]
  /** Every node carries a ComfyUI editor position, so the ComfyUI arrangement can be shown. */
  hasComfyPositions: boolean
}

/** auto: layered layout; comfy: the positions saved from the ComfyUI editor. */
export type AuthoringGraphLayout = 'auto' | 'comfy'

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

/** A ComfyUI "Save" (UI) workflow has a root `nodes` array; the API format is a map of node id → node. */
export function isComfyUiWorkflowJson(workflowJson: string) {
  try {
    const parsed = JSON.parse(workflowJson) as unknown
    return Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed) && Array.isArray((parsed as { nodes?: unknown }).nodes)
  } catch {
    return false
  }
}

/** Resolve node coordinates from the Comfy export when present. */
function resolveWorkflowNodePosition(nodeData: WorkflowJsonNodeRecord) {
  const candidate = nodeData.pos ?? nodeData.position ?? nodeData._meta?.pos

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

/** Approximate the rendered card height: padding + header, then one 28px row (+2px gap) per input. */
function estimateAuthoringNodeHeight(node: AuthoringNode) {
  const editableInputCount = node.data.editableInputs.length
  if (editableInputCount === 0) {
    return 100
  }

  return 84 + editableInputCount * 30
}

const LAYOUT_COLUMN_SPACING = 340
const LAYOUT_ROW_GAP = 32
const LAYOUT_COMPONENT_GAP = 120
const LAYOUT_LONE_NODES_PER_ROW = 6
const LAYOUT_ORDER_SWEEPS = 6

/** Ids sort numerically where they can, so Comfy ids like 3, 10, 57:12 keep their natural order. */
function compareNodeIds(a: string, b: string) {
  const left = a.split(':').map(Number)
  const right = b.split(':').map(Number)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? -1) - (right[index] ?? -1)
    if (Number.isFinite(difference) && difference !== 0) return difference
  }
  return a.localeCompare(b)
}

/**
 * Layered left-to-right layout for API workflows, which carry no positions: each connected part gets its own block,
 * nodes sit one column before their nearest consumer, rows are ordered to cut crossings, and each node is pulled
 * level with the nodes it links to.
 */
function layoutLayeredGraph(nodes: AuthoringNode[], edges: AuthoringEdge[]) {
  const nodeIds = new Set(nodes.map((node) => node.id))
  const successors = new Map<string, string[]>(nodes.map((node) => [node.id, []]))
  const predecessors = new Map<string, string[]>(nodes.map((node) => [node.id, []]))
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target) || edge.source === edge.target) continue
    successors.get(edge.source)!.push(edge.target)
    predecessors.get(edge.target)!.push(edge.source)
  }
  const heightById = new Map(nodes.map((node) => [node.id, estimateAuthoringNodeHeight(node)]))
  const sortedIds = nodes.map((node) => node.id).sort(compareNodeIds)

  // Connected parts, in order of their smallest node id.
  const componentOf = new Map<string, number>()
  const components: string[][] = []
  for (const startId of sortedIds) {
    if (componentOf.has(startId)) continue
    const members: string[] = []
    const stack = [startId]
    componentOf.set(startId, components.length)
    while (stack.length > 0) {
      const id = stack.pop()!
      members.push(id)
      for (const next of [...successors.get(id)!, ...predecessors.get(id)!]) {
        if (!componentOf.has(next)) {
          componentOf.set(next, components.length)
          stack.push(next)
        }
      }
    }
    components.push(members.sort(compareNodeIds))
  }

  const positions = new Map<string, { x: number; y: number }>()
  let cursorY = 0
  const loneIds: string[] = []

  for (const members of components) {
    if (members.length === 1) {
      loneIds.push(members[0])
      continue
    }

    // Longest path from the sources gives each node its earliest column (Kahn order; cycle leftovers go last).
    const memberSet = new Set(members)
    const remainingInputs = new Map(members.map((id) => [id, predecessors.get(id)!.filter((source) => memberSet.has(source)).length]))
    const queue = members.filter((id) => remainingInputs.get(id) === 0)
    const topological: string[] = []
    const layer = new Map(members.map((id) => [id, 0]))
    while (queue.length > 0) {
      const id = queue.shift()!
      topological.push(id)
      for (const next of successors.get(id)!) {
        layer.set(next, Math.max(layer.get(next)!, layer.get(id)! + 1))
        remainingInputs.set(next, remainingInputs.get(next)! - 1)
        if (remainingInputs.get(next) === 0) queue.push(next)
      }
    }
    const deepest = Math.max(0, ...layer.values())
    for (const id of members) {
      if (!topological.includes(id)) {
        layer.set(id, deepest + 1)
        topological.push(id)
      }
    }
    // Then move every producer right, up to the column before its nearest consumer (loaders sit next to their users).
    for (const id of [...topological].reverse()) {
      const consumerLayers = successors.get(id)!.map((next) => layer.get(next)!).filter((value) => value > layer.get(id)!)
      if (consumerLayers.length > 0) layer.set(id, Math.min(...consumerLayers) - 1)
    }

    const layerCount = Math.max(...members.map((id) => layer.get(id)!)) + 1
    const columns: string[][] = Array.from({ length: layerCount }, () => [])
    for (const id of members) columns[layer.get(id)!].push(id)

    // Barycenter sweeps: order each column by the average row of its neighbours to cut crossings.
    const rowOf = new Map<string, number>()
    const indexColumns = () => columns.forEach((column) => column.forEach((id, index) => rowOf.set(id, index)))
    indexColumns()
    for (let sweep = 0; sweep < LAYOUT_ORDER_SWEEPS; sweep += 1) {
      const downward = sweep % 2 === 0
      const order = downward ? columns.map((_, index) => index) : columns.map((_, index) => columns.length - 1 - index)
      for (const columnIndex of order) {
        const column = columns[columnIndex]
        const key = new Map(column.map((id) => {
          const neighbours = downward ? predecessors.get(id)! : successors.get(id)!
          const rows = neighbours.filter((next) => memberSet.has(next)).map((next) => rowOf.get(next)!)
          return [id, rows.length > 0 ? rows.reduce((sum, value) => sum + value, 0) / rows.length : rowOf.get(id)!]
        }))
        column.sort((a, b) => key.get(a)! - key.get(b)! || rowOf.get(a)! - rowOf.get(b)!)
        column.forEach((id, index) => rowOf.set(id, index))
      }
    }

    // Vertical placement: keep each column's order, aim every node at the centre of its neighbours, then pack.
    const top = new Map<string, number>()
    const centerOf = (id: string) => top.get(id)! + heightById.get(id)! / 2
    const packColumn = (column: string[], desiredTop: (id: string) => number) => {
      const wanted = column.map(desiredTop)
      const placed: number[] = []
      column.forEach((_, index) => {
        const floor = index === 0 ? -Infinity : placed[index - 1] + heightById.get(column[index - 1])! + LAYOUT_ROW_GAP
        placed.push(Math.max(wanted[index], floor))
      })
      // The forward pass only pushes down; shift the column back so it sits centred on what it wanted.
      const shift = placed.reduce((sum, value, index) => sum + (wanted[index] - value), 0) / column.length
      column.forEach((id, index) => top.set(id, placed[index] + shift))
    }
    let stackY = 0
    for (const id of columns[0]) {
      top.set(id, stackY)
      stackY += heightById.get(id)! + LAYOUT_ROW_GAP
    }
    const towardNeighbours = (pick: (id: string) => string[]) => (id: string) => {
      const placedNeighbours = pick(id).filter((next) => memberSet.has(next) && top.has(next))
      if (placedNeighbours.length === 0) return top.get(id) ?? 0
      const center = placedNeighbours.reduce((sum, next) => sum + centerOf(next), 0) / placedNeighbours.length
      return center - heightById.get(id)! / 2
    }
    for (let index = 1; index < columns.length; index += 1) packColumn(columns[index], towardNeighbours((id) => predecessors.get(id)!))
    for (let index = columns.length - 2; index >= 0; index -= 1) packColumn(columns[index], towardNeighbours((id) => successors.get(id)!))
    for (let index = 1; index < columns.length; index += 1) packColumn(columns[index], towardNeighbours((id) => [...predecessors.get(id)!, ...successors.get(id)!]))

    const minTop = Math.min(...members.map((id) => top.get(id)!))
    let maxBottom = 0
    for (const id of members) {
      const y = top.get(id)! - minTop
      positions.set(id, { x: layer.get(id)! * LAYOUT_COLUMN_SPACING, y: cursorY + y })
      maxBottom = Math.max(maxBottom, y + heightById.get(id)!)
    }
    cursorY += maxBottom + LAYOUT_COMPONENT_GAP
  }

  // Unconnected nodes go in a grid under everything else.
  for (let start = 0; start < loneIds.length; start += LAYOUT_LONE_NODES_PER_ROW) {
    const row = loneIds.slice(start, start + LAYOUT_LONE_NODES_PER_ROW)
    row.forEach((id, index) => positions.set(id, { x: index * LAYOUT_COLUMN_SPACING, y: cursorY }))
    cursorY += Math.max(...row.map((id) => heightById.get(id)!)) + LAYOUT_ROW_GAP
  }

  return nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? { x: 0, y: 0 } }))
}

const COMFY_LAYOUT_GAP = 24
const COMFY_LAYOUT_MAX_SPREAD = 3

/**
 * The ComfyUI arrangement. Cards here are 260px wide and sized by their inputs, unlike ComfyUI's nodes, so the
 * coordinates are spread by the smallest factor that keeps every pair of cards apart.
 */
function layoutFromComfyPositions(nodes: AuthoringNode[], positions: Map<string, { x: number; y: number }>) {
  const boxes = nodes.map((node) => ({ node, ...positions.get(node.id)!, height: estimateAuthoringNodeHeight(node) }))
  let spread = 1
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]
      const b = boxes[j]
      const dx = Math.abs(a.x - b.x)
      const dy = Math.abs(a.y - b.y)
      const upperHeight = a.y <= b.y ? a.height : b.height
      const needX = dx > 0 ? (260 + COMFY_LAYOUT_GAP) / dx : Infinity
      const needY = dy > 0 ? (upperHeight + COMFY_LAYOUT_GAP) / dy : Infinity
      spread = Math.max(spread, Math.min(needX, needY, COMFY_LAYOUT_MAX_SPREAD))
    }
  }
  const minX = Math.min(...boxes.map((box) => box.x))
  const minY = Math.min(...boxes.map((box) => box.y))
  return boxes.map(({ node, x, y }) => ({ ...node, position: { x: (x - minX) * spread, y: (y - minY) * spread } }))
}

/** Place nodes with the layered layout, or with their ComfyUI positions when asked and every node has one. */
function layoutAuthoringGraph(
  nodes: AuthoringNode[],
  edges: AuthoringEdge[],
  explicitPositions: Map<string, { x: number; y: number } | null>,
  layout: AuthoringGraphLayout,
) {
  const positioned = new Map([...explicitPositions].filter((entry): entry is [string, { x: number; y: number }] => entry[1] !== null))
  if (layout === 'comfy' && nodes.length > 0 && positioned.size === nodes.length) {
    return layoutFromComfyPositions(nodes, positioned)
  }

  return layoutLayeredGraph(nodes, edges)
}

/** Convert the raw Comfy workflow JSON into authoring graph nodes and edges. */
export function parseWorkflowGraph(params: {
  workflowJson: string
  onInputSelect: (nodeId: string, nodeTitle: string, classType: string, input: EditableWorkflowInput) => void
  layout?: AuthoringGraphLayout
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
          data: { inputKey },
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
    nodes: layoutAuthoringGraph(nodes, edges, explicitPositions, params.layout ?? 'auto'),
    edges,
    hasComfyPositions: nodes.length > 0 && nodes.every((node) => explicitPositions.get(node.id) !== null),
  }
}

const SUGGESTED_NUMBER_INPUT_KEYS = new Set(['seed', 'noise_seed', 'steps', 'cfg'])
/** Size inputs only count on the node that makes the empty latent; upscalers and resizers have their own. */
const SUGGESTED_LATENT_SIZE_KEYS = new Set(['width', 'height', 'batch_size'])
const SUGGESTED_PROMPT_INPUT_KEY = /^(text|text_[gl]|prompt|positive|negative|(positive|negative)_prompt)$/i
const MAX_SUGGESTED_FIELDS = 20

/**
 * Fields most workflows want exposed: prompt texts, the image to load, node editors (LoRA rows, director), seed,
 * steps, CFG and the size. Linked inputs, nodes that never run and inputs already marked are skipped.
 */
export function suggestWorkflowMarkedFields(graph: ParsedWorkflowGraph, existingJsonPaths: ReadonlySet<string>) {
  const fields: WorkflowMarkedField[] = []
  // A text that feeds nothing is a display (Show Text and the like), not a prompt.
  const feedingNodeIds = new Set(graph.edges.map((edge) => edge.source))
  for (const node of graph.nodes) {
    if (node.data.unused) continue
    const makesLatent = /latent/i.test(node.data.classType)
    const showsText = /show|preview|display/i.test(node.data.classType)
    for (const input of node.data.editableInputs) {
      const path = input.jsonPath ?? `${node.id}.inputs.${input.key}`
      if (existingJsonPaths.has(path)) continue
      const wanted = input.inferredType === 'node'
        || (input.inferredType === 'image' && input.key === 'image' && typeof input.value === 'string')
        || ((input.inferredType === 'textarea' || input.inferredType === 'text') && typeof input.value === 'string' && SUGGESTED_PROMPT_INPUT_KEY.test(input.key) && feedingNodeIds.has(node.id) && !showsText)
        || (input.inferredType === 'number' && (SUGGESTED_NUMBER_INPUT_KEYS.has(input.key) || (makesLatent && SUGGESTED_LATENT_SIZE_KEYS.has(input.key))))
      if (wanted) fields.push(buildWorkflowMarkedFieldFromInput(node.id, node.data.title, node.data.classType, input))
      if (fields.length >= MAX_SUGGESTED_FIELDS) return fields
    }
  }
  return fields
}

/** Marked fields whose node or input is not in the workflow JSON (the workflow was replaced or edited). */
export function findMissingMarkedFieldIds(workflowJson: string, fields: readonly WorkflowMarkedField[]) {
  let workflow: WorkflowJsonRecord
  try {
    workflow = parseWorkflowDefinition(workflowJson)
  } catch {
    return new Set<string>()
  }
  const missing = new Set<string>()
  for (const field of fields) {
    const match = /^([^.[\]]+)\.inputs(?:\.(.+))?$/.exec(field.jsonPath)
    if (!match) continue
    const node = workflow[match[1]]
    const inputs = node && typeof node === 'object' ? node.inputs : undefined
    if (!inputs || (match[2] !== undefined && !(match[2] in inputs))) missing.add(field.id)
  }
  return missing
}

/** Seed inputs the backend rolls per run unless a value is given (mirrors backend comfyui/seedControl). */
const RANDOMIZED_SEED_INPUT_KEYS = new Set(['seed', 'noise_seed'])

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
  // No default: an empty seed field (or -1) rolls a new seed every run.
  const isRandomSeed = fieldType === 'number' && RANDOMIZED_SEED_INPUT_KEYS.has(input.key)

  return {
    id: sanitizeWorkflowFieldId(`${nodeId}_${input.key}`),
    label: !input.label || input.label === nodeTitle ? nodeTitle : `${nodeTitle}-${input.label}`,
    description: input.typeLabel ? `${classType} · ${input.typeLabel}` : `${classType} · ${input.key}`,
    jsonPath: resolvedJsonPath,
    source_node_id: nodeId,
    source_node_title: nodeTitle,
    type: fieldType,
    default_collapsed: false,
    default_value:
      input.value === null || isRandomSeed
        ? undefined
        : typeof input.value === 'boolean'
          ? String(input.value)
          : input.value as WorkflowMarkedField['default_value'],
    placeholder: fieldType === 'text' || fieldType === 'textarea' ? humanizeWorkflowInputKey(input.key) : isRandomSeed ? 'random' : undefined,
    options: dropdownOptions,
    required: false,
    step: typeof input.value === 'number' ? inferWorkflowNumberStep(input.value) : undefined,
    node_class_type: fieldType === 'node' ? classType : undefined,
    node_editor: fieldType === 'node' ? input.nodeEditor : undefined,
    node_items: fieldType === 'node' ? input.nodeItems : undefined,
  }
}

const AUTHORING_EDGE_STROKE = 'color-mix(in srgb, var(--foreground) 22%, transparent)'
const AUTHORING_EDGE_FOCUS_STROKE = 'var(--primary)'

/** Style links; the focused node's links are highlighted and named by the input they feed. */
export function styleAuthoringEdges(edges: AuthoringEdge[], focusNodeId: string | null): AuthoringEdge[] {
  return edges.map((edge) => {
    const focused = focusNodeId !== null && (edge.source === focusNodeId || edge.target === focusNodeId)
    return {
      ...edge,
      zIndex: focused ? 1 : 0,
      style: { stroke: focused ? AUTHORING_EDGE_FOCUS_STROKE : AUTHORING_EDGE_STROKE, strokeWidth: focused ? 2 : 1.5 },
      label: focused ? String(edge.data?.inputKey ?? '') : undefined,
      labelStyle: { fill: 'var(--foreground)', fontSize: 11 },
      labelBgStyle: { fill: 'var(--surface-container)' },
    }
  })
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
        'w-[260px] rounded-sm bg-surface-container p-3 shadow-elevation-1 transition-opacity',
        hasSelectedInput || data.searchCurrent ? 'ring-2 ring-primary/60' : data.searchMatched ? 'ring-1 ring-primary/40' : data.issues?.length ? 'ring-1 ring-warning/60' : undefined,
        data.unused && !hasSelectedInput && !data.searchCurrent && 'opacity-45 hover:opacity-100',
      )}
    >
      {/* Link anchors only; the canvas is read-only, so they stay hidden. */}
      <Handle type="target" position={Position.Left} isConnectable={false} className="!pointer-events-none !opacity-0" />
      <Handle type="source" position={Position.Right} isConnectable={false} className="!pointer-events-none !opacity-0" />
      <div className="flex items-start gap-2">
        <div className="comfy-authoring-drag-handle flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-sm bg-foreground/5 text-muted-foreground hover:text-foreground active:cursor-grabbing">
          <GripVertical className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start gap-1.5">
            <div className="min-w-0 flex-1 text-sm font-semibold text-foreground">{data.title}</div>
            {data.issues?.length ? (
              <Tip content={<div className="max-w-80 space-y-1 text-xs">{data.issues.map((issue) => <div key={issue}>{issue}</div>)}</div>}>
                <span role="img" aria-label={t({ ko: '서버 점검 문제', en: 'Server check issues' })} className="mt-0.5 shrink-0 text-warning">
                  <TriangleAlert className="size-3.5" />
                </span>
              </Tip>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
            <span>{data.classType}</span>
            <span>•</span>
            <span>#{id}</span>
            {data.unused ? <span>• {t({ ko: '실행 안 됨', en: 'Never runs' })}</span> : null}
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
