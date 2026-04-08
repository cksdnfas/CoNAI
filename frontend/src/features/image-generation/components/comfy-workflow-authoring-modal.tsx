import { useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronUp, Pencil, Plus, Search, Trash2, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { SettingsField, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import {
  getAppSettings,
  createGenerationWorkflow,
  updateGenerationWorkflow,
  type CustomDropdownList,
  type GenerationWorkflowDetail,
  type WorkflowMarkedField,
} from '@/lib/api'
import { getErrorMessage } from '../image-generation-shared'

type ComfyWorkflowAuthoringModalInitialData = {
  workflow: GenerationWorkflowDetail
}

type ComfyWorkflowAuthoringModalProps = {
  open: boolean
  mode?: 'create' | 'edit'
  initialData?: ComfyWorkflowAuthoringModalInitialData | null
  dropdownLists: CustomDropdownList[]
  onClose: () => void
  onSaved?: (workflowId: number) => void
}

type EditableWorkflowInput = {
  key: string
  label: string
  value: string | number | boolean | null
  inferredType: WorkflowMarkedField['type']
}

type AuthoringNodeData = {
  label: string
  classType: string
  title: string
  editableInputs: EditableWorkflowInput[]
  markedJsonPaths: string[]
  searchMatched?: boolean
  searchCurrent?: boolean
  onAddField: (nodeId: string, classType: string, input: EditableWorkflowInput) => void
}

type AuthoringNode = Node<AuthoringNodeData, 'comfyAuthoring'>
type AuthoringEdge = Edge

type ParsedWorkflowGraph = {
  nodes: AuthoringNode[]
  edges: AuthoringEdge[]
}

const INITIAL_AUTHORING_VIEWPORT = { x: 0, y: 0, zoom: 0.7 }
const INITIAL_AUTHORING_FIT_VIEW_OPTIONS = { padding: 0.28, maxZoom: 0.72 }

type WorkflowJsonNodeRecord = {
  title?: string
  class_type?: string
  inputs?: Record<string, unknown>
  _meta?: {
    title?: string
  }
}

type WorkflowJsonRecord = Record<string, WorkflowJsonNodeRecord>

function humanizeKey(value: string) {
  return value
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase())
}

function sanitizeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_')
}

function inferFieldType(inputKey: string, value: string | number | boolean | null): WorkflowMarkedField['type'] {
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

function buildFieldFromInput(nodeId: string, classType: string, input: EditableWorkflowInput): WorkflowMarkedField {
  const id = sanitizeId(`${nodeId}_${input.key}`)
  const fieldType = input.inferredType
  const dropdownOptions = typeof input.value === 'boolean' ? ['true', 'false'] : undefined

  return {
    id,
    label: humanizeKey(input.key),
    description: `${classType} · ${input.key}`,
    jsonPath: `${nodeId}.inputs.${input.key}`,
    type: fieldType,
    default_value:
      input.value === null
        ? undefined
        : typeof input.value === 'boolean'
          ? String(input.value)
          : input.value,
    placeholder: fieldType === 'text' || fieldType === 'textarea' ? humanizeKey(input.key) : undefined,
    options: dropdownOptions,
    required: false,
  }
}

/** Prefer user-facing node title when present, then fall back to class_type or node id label. */
function resolveWorkflowNodeTitle(nodeId: string, nodeData: WorkflowJsonNodeRecord) {
  const preferredTitle = typeof nodeData.title === 'string' && nodeData.title.trim().length > 0
    ? nodeData.title.trim()
    : typeof nodeData._meta?.title === 'string' && nodeData._meta.title.trim().length > 0
      ? nodeData._meta.title.trim()
      : null

  return preferredTitle ?? nodeData.class_type ?? `Node ${nodeId}`
}

function parseWorkflowDefinition(workflowJson: string): WorkflowJsonRecord {
  const parsed = JSON.parse(workflowJson) as unknown

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('워크플로우 JSON 루트는 객체여야 해.')
  }

  return parsed as WorkflowJsonRecord
}

function layoutGraph(nodes: AuthoringNode[], edges: AuthoringEdge[]) {
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

  const columns = new Map<number, string[]>()
  for (const node of nodes) {
    const depth = depthByNode.get(node.id) ?? 0
    const column = columns.get(depth) ?? []
    column.push(node.id)
    columns.set(depth, column)
  }

  return nodes.map((node) => {
    const depth = depthByNode.get(node.id) ?? 0
    const column = columns.get(depth) ?? []
    const rowIndex = column.indexOf(node.id)
    return {
      ...node,
      position: {
        x: depth * 320,
        y: rowIndex * 220,
      },
    }
  })
}

function parseWorkflowGraph(params: {
  workflowJson: string
  markedFields: WorkflowMarkedField[]
  onAddField: (nodeId: string, classType: string, input: EditableWorkflowInput) => void
}): ParsedWorkflowGraph {
  const workflow = parseWorkflowDefinition(params.workflowJson)
  const markedPaths = new Set(params.markedFields.map((field) => field.jsonPath))

  const nodes: AuthoringNode[] = []
  const edges: AuthoringEdge[] = []

  for (const [nodeId, nodeData] of Object.entries(workflow)) {
    const inputs = nodeData.inputs ?? {}
    const editableInputs: EditableWorkflowInput[] = []

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

      if (typeof inputValue === 'string' || typeof inputValue === 'number' || typeof inputValue === 'boolean' || inputValue === null) {
        editableInputs.push({
          key: inputKey,
          label: humanizeKey(inputKey),
          value: inputValue,
          inferredType: inferFieldType(inputKey, inputValue),
        })
      }
    }

    const classType = nodeData.class_type || 'Unknown'
    const title = resolveWorkflowNodeTitle(nodeId, nodeData)

    nodes.push({
      id: nodeId,
      type: 'comfyAuthoring',
      position: { x: 0, y: 0 },
      data: {
        label: title,
        title,
        classType,
        editableInputs,
        markedJsonPaths: editableInputs.map((input) => `${nodeId}.inputs.${input.key}`).filter((path) => markedPaths.has(path)),
        onAddField: params.onAddField,
      },
    })
  }

  return {
    nodes: layoutGraph(nodes, edges),
    edges,
  }
}

function ComfyAuthoringNodeCard({ id, data }: NodeProps<AuthoringNode>) {
  return (
    <div
      className={data.searchCurrent
        ? 'min-w-[240px] rounded-sm border border-primary bg-surface-container p-3 shadow-sm ring-2 ring-primary/35'
        : data.searchMatched
          ? 'min-w-[240px] rounded-sm border border-primary/45 bg-surface-container p-3 shadow-sm'
          : 'min-w-[240px] rounded-sm border border-border bg-surface-container p-3 shadow-sm'}
    >
      <div className="space-y-1">
        <div className="text-sm font-semibold text-foreground">{data.title}</div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{data.classType}</span>
          <span>•</span>
          <span>#{id}</span>
        </div>
      </div>

      {data.editableInputs.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {data.editableInputs.map((input) => {
            const path = `${id}.inputs.${input.key}`
            const selected = data.markedJsonPaths.includes(path)
            return (
              <button
                key={path}
                type="button"
                onClick={() => data.onAddField(id, data.classType, input)}
                className={selected
                  ? 'nodrag nopan flex w-full items-center justify-between rounded-sm border border-primary/40 bg-primary/10 px-2 py-1.5 text-left text-xs text-foreground'
                  : 'nodrag nopan flex w-full items-center justify-between rounded-sm border border-border bg-surface-low px-2 py-1.5 text-left text-xs text-foreground hover:bg-surface-high'}
              >
                <span className="truncate">{input.label}</span>
                <span className="ml-2 shrink-0">{selected ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}</span>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="mt-3 text-xs text-muted-foreground">직접 입력 가능한 항목 없음</div>
      )}
    </div>
  )
}

const nodeTypes = {
  comfyAuthoring: ComfyAuthoringNodeCard,
}

function readTextFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

export function ComfyWorkflowAuthoringModal({
  open,
  mode = 'create',
  initialData,
  dropdownLists,
  onClose,
  onSaved,
}: ComfyWorkflowAuthoringModalProps) {
  const { showSnackbar } = useSnackbar()
  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })
  const [workflowName, setWorkflowName] = useState('')
  const [workflowDescription, setWorkflowDescription] = useState('')
  const [workflowJson, setWorkflowJson] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [markedFields, setMarkedFields] = useState<WorkflowMarkedField[]>([])
  const [expandedFieldIds, setExpandedFieldIds] = useState<string[]>([])
  const [workflowEditorTab, setWorkflowEditorTab] = useState<'json' | 'graph'>('json')
  const [graphSearchQuery, setGraphSearchQuery] = useState('')
  const [graphSearchIndex, setGraphSearchIndex] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const [authoringFlowInstance, setAuthoringFlowInstance] = useState<ReactFlowInstance<AuthoringNode, AuthoringEdge> | null>(null)

  useEffect(() => {
    if (!open) {
      return
    }

    if (mode === 'edit' && initialData) {
      setWorkflowName(initialData.workflow.name)
      setWorkflowDescription(initialData.workflow.description ?? '')
      setWorkflowJson(initialData.workflow.workflow_json)
      setJsonError(null)
      setMarkedFields(initialData.workflow.marked_fields ?? [])
      setExpandedFieldIds([])
      setWorkflowEditorTab('graph')
      setGraphSearchQuery('')
      setGraphSearchIndex(0)
      setIsSaving(false)
      return
    }

    setWorkflowName('')
    setWorkflowDescription('')
    setWorkflowJson('')
    setJsonError(null)
    setMarkedFields([])
    setExpandedFieldIds([])
    setWorkflowEditorTab('json')
    setGraphSearchQuery('')
    setGraphSearchIndex(0)
    setIsSaving(false)
  }, [initialData, mode, open])

  const handleWorkflowJsonChange = (nextValue: string) => {
    setWorkflowJson(nextValue)
    if (nextValue.trim().length === 0) {
      setJsonError(null)
      return
    }

    try {
      parseWorkflowDefinition(nextValue)
      setJsonError(null)
    } catch (error) {
      setJsonError(getErrorMessage(error, '유효한 workflow JSON이 아니야.'))
    }
  }

  const handleFileUpload = async (file?: File) => {
    if (!file) {
      return
    }

    try {
      const text = await readTextFile(file)
      const parsed = parseWorkflowDefinition(text)
      const normalizedJson = JSON.stringify(parsed, null, 2)
      setWorkflowJson(normalizedJson)
      setJsonError(null)
      if (workflowName.trim().length === 0) {
        setWorkflowName(file.name.replace(/\.json$/i, ''))
      }
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'JSON 파일을 읽지 못했어.'), tone: 'error' })
    }
  }

  const handleAddField = (nodeId: string, classType: string, input: EditableWorkflowInput) => {
    const field = buildFieldFromInput(nodeId, classType, input)
    setMarkedFields((current) => {
      const exists = current.some((item) => item.jsonPath === field.jsonPath)
      if (exists) {
        return current.filter((item) => item.jsonPath !== field.jsonPath)
      }
      return [...current, field]
    })
  }

  const parsedGraph = useMemo(() => {
    if (workflowJson.trim().length === 0 || jsonError) {
      return null
    }

    try {
      return parseWorkflowGraph({
        workflowJson,
        markedFields,
        onAddField: handleAddField,
      })
    } catch {
      return null
    }
  }, [jsonError, markedFields, workflowJson])

  const graphSearchMatches = useMemo(() => {
    if (!parsedGraph) {
      return []
    }

    const normalizedQuery = graphSearchQuery.trim().toLowerCase()
    if (!normalizedQuery) {
      return []
    }

    return parsedGraph.nodes
      .filter((node) => {
        const haystack = [node.data.title, node.data.classType, node.id]
          .join(' ')
          .toLowerCase()
        return haystack.includes(normalizedQuery)
      })
      .map((node) => node.id)
  }, [graphSearchQuery, parsedGraph])

  const activeGraphSearchNodeId = graphSearchMatches.length > 0
    ? graphSearchMatches[Math.min(graphSearchIndex, graphSearchMatches.length - 1)]
    : null

  const graphNodes = useMemo(() => {
    if (!parsedGraph) {
      return []
    }

    const matchedIdSet = new Set(graphSearchMatches)
    return parsedGraph.nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        searchMatched: matchedIdSet.has(node.id),
        searchCurrent: node.id === activeGraphSearchNodeId,
      },
    }))
  }, [activeGraphSearchNodeId, graphSearchMatches, parsedGraph])

  const reactFlowColorMode: 'light' | 'dark' | 'system' =
    settingsQuery.data?.appearance.themeMode ?? DEFAULT_APPEARANCE_SETTINGS.themeMode

  useEffect(() => {
    if (!open || workflowEditorTab !== 'graph' || !parsedGraph || !authoringFlowInstance) {
      return
    }

    const rafId = window.requestAnimationFrame(() => {
      void authoringFlowInstance.fitView(INITIAL_AUTHORING_FIT_VIEW_OPTIONS)
    })

    return () => {
      window.cancelAnimationFrame(rafId)
    }
  }, [authoringFlowInstance, open, parsedGraph, workflowEditorTab])

  useEffect(() => {
    setGraphSearchIndex(0)
  }, [graphSearchQuery])

  useEffect(() => {
    if (!authoringFlowInstance || !activeGraphSearchNodeId || !parsedGraph) {
      return
    }

    const targetNode = parsedGraph.nodes.find((node) => node.id === activeGraphSearchNodeId)
    if (!targetNode) {
      return
    }

    const estimatedWidth = 260
    const estimatedHeight = 180
    void authoringFlowInstance.setCenter(
      targetNode.position.x + estimatedWidth / 2,
      targetNode.position.y + estimatedHeight / 2,
      { zoom: 0.88, duration: 240 },
    )
  }, [activeGraphSearchNodeId, authoringFlowInstance, parsedGraph])

  const dropdownListNames = dropdownLists.map((list) => list.name)

  const handleFieldPatch = (fieldId: string, patch: Partial<WorkflowMarkedField>) => {
    setMarkedFields((current) => current.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)))
  }

  const handleFieldOptionsChange = (fieldId: string, rawValue: string) => {
    handleFieldPatch(fieldId, {
      options: rawValue
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    })
  }

  const toggleExpandedField = (fieldId: string) => {
    setExpandedFieldIds((current) => (
      current.includes(fieldId)
        ? current.filter((item) => item !== fieldId)
        : [...current, fieldId]
    ))
  }

  const handleSave = async () => {
    if (isSaving) {
      return
    }

    if (workflowName.trim().length === 0) {
      showSnackbar({ message: '워크플로우 이름이 필요해.', tone: 'error' })
      return
    }

    if (workflowJson.trim().length === 0 || jsonError) {
      showSnackbar({ message: '유효한 workflow JSON이 필요해.', tone: 'error' })
      return
    }

    try {
      setIsSaving(true)

      const payload = {
        name: workflowName.trim(),
        description: workflowDescription.trim() || undefined,
        workflow_json: workflowJson,
        marked_fields: markedFields,
        is_active: initialData?.workflow.is_active ?? true,
        color: initialData?.workflow.color ?? '#2196f3',
      }

      let workflowId = initialData?.workflow.id

      if (mode === 'edit' && workflowId) {
        await updateGenerationWorkflow(workflowId, payload)
      } else {
        const response = await createGenerationWorkflow(payload)
        workflowId = response.data.id
      }

      showSnackbar({ message: mode === 'edit' ? 'ComfyUI 워크플로우를 수정했어.' : 'ComfyUI 워크플로우를 저장했어.', tone: 'info' })
      onSaved?.(workflowId as number)
      onClose()
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, mode === 'edit' ? '워크플로우 수정에 실패했어.' : '워크플로우 저장에 실패했어.'), tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  const modalTitle = mode === 'edit' ? 'ComfyUI Workflow 수정' : 'ComfyUI Workflow 등록'
  const submitLabel = mode === 'edit' ? '워크플로우 저장' : '워크플로우 등록'

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={modalTitle}
      widthClassName="max-w-[1380px]"
    >
      <div className="space-y-5">
        <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-5">
            <section className="space-y-4 rounded-sm border border-border bg-surface-low p-4">
              <div className="text-sm font-semibold text-foreground">기본 정보</div>

              <div className="grid gap-4">
                <SettingsField label="이름">
                  <Input
                    variant="settings"
                    value={workflowName}
                    onChange={(event) => setWorkflowName(event.target.value)}
                    placeholder="ComfyUI Workflow"
                  />
                </SettingsField>

                <SettingsField label="설명">
                  <Textarea
                    variant="settings"
                    rows={4}
                    value={workflowDescription}
                    onChange={(event) => setWorkflowDescription(event.target.value)}
                    placeholder="선택"
                  />
                </SettingsField>
              </div>
            </section>

            <section className="space-y-4 rounded-sm border border-border bg-surface-low p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-foreground">Marked Fields</div>
                <Badge variant="outline">{markedFields.length}</Badge>
              </div>

              {markedFields.length > 0 ? (
                <div className="max-h-[620px] space-y-3 overflow-y-auto pr-1">
                  {markedFields.map((field) => {
                    const isExpanded = expandedFieldIds.includes(field.id)

                    return (
                      <div key={field.id} className="space-y-3 rounded-sm border border-border/70 bg-surface-container p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="truncate text-sm font-medium text-foreground">{field.label || field.id}</div>
                            <div className="truncate text-[11px] text-muted-foreground">{field.jsonPath}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{field.type}</Badge>
                            <Button type="button" size="icon-sm" variant="outline" onClick={() => toggleExpandedField(field.id)} title={isExpanded ? '라벨/설명 닫기' : '라벨/설명 수정'} aria-label={isExpanded ? '라벨/설명 닫기' : '라벨/설명 수정'}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button type="button" size="icon-sm" variant="outline" onClick={() => setMarkedFields((current) => current.filter((item) => item.id !== field.id))}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>

                        {isExpanded ? (
                          <div className="grid gap-3 md:grid-cols-2 rounded-sm border border-border/70 bg-background/50 p-3">
                            <SettingsField label="라벨">
                              <Input variant="settings" value={field.label} onChange={(event) => handleFieldPatch(field.id, { label: event.target.value })} />
                            </SettingsField>

                            <SettingsField label="설명" className="md:col-span-2">
                              <Input variant="settings" value={field.description ?? ''} onChange={(event) => handleFieldPatch(field.id, { description: event.target.value })} />
                            </SettingsField>
                          </div>
                        ) : null}

                        <div className="grid gap-3 md:grid-cols-2">
                          <SettingsField label="타입">
                            <Select variant="settings" value={field.type} onChange={(event) => handleFieldPatch(field.id, { type: event.target.value as WorkflowMarkedField['type'] })}>
                              <option value="text">text</option>
                              <option value="textarea">textarea</option>
                              <option value="number">number</option>
                              <option value="select">select</option>
                              <option value="image">image</option>
                            </Select>
                          </SettingsField>

                          <SettingsToggleRow className="rounded-sm border border-border/70 bg-background px-3 py-2 md:self-end">
                            <input
                              type="checkbox"
                              checked={field.required === true}
                              onChange={(event) => handleFieldPatch(field.id, { required: event.target.checked })}
                            />
                            required
                          </SettingsToggleRow>

                          <SettingsField label="Default" className="md:col-span-2">
                            {field.type === 'textarea' ? (
                              <Textarea
                                variant="settings"
                                rows={4}
                                value={field.default_value === undefined || field.default_value === null ? '' : String(field.default_value)}
                                onChange={(event) => handleFieldPatch(field.id, { default_value: event.target.value })}
                              />
                            ) : (
                              <Input
                                variant="settings"
                                type={field.type === 'number' ? 'number' : 'text'}
                                value={field.default_value === undefined || field.default_value === null ? '' : String(field.default_value)}
                                onChange={(event) => handleFieldPatch(field.id, { default_value: event.target.value })}
                              />
                            )}
                          </SettingsField>
                        </div>

                        {field.type === 'select' ? (
                          <div className="grid gap-4 md:grid-cols-2">
                            <SettingsField label="Dropdown List">
                              <Select
                                variant="settings"
                                value={field.dropdown_list_name ?? ''}
                                onChange={(event) => handleFieldPatch(field.id, { dropdown_list_name: event.target.value || undefined })}
                              >
                                <option value="">없음</option>
                                {dropdownListNames.map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                              </Select>
                            </SettingsField>

                            <SettingsField label="직접 옵션">
                              <Input
                                variant="settings"
                                value={(field.options ?? []).join(', ')}
                                onChange={(event) => handleFieldOptionsChange(field.id, event.target.value)}
                                placeholder="option1, option2"
                              />
                            </SettingsField>
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </section>
          </div>

          <div className="min-w-0">
            <section className="space-y-4 rounded-sm border border-border bg-surface-low p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="inline-flex rounded-sm border border-border bg-surface-container p-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={workflowEditorTab === 'json' ? 'default' : 'ghost'}
                    onClick={() => setWorkflowEditorTab('json')}
                  >
                    Workflow JSON
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={workflowEditorTab === 'graph' ? 'default' : 'ghost'}
                    onClick={() => setWorkflowEditorTab('graph')}
                  >
                    Graph View
                  </Button>
                </div>

                {workflowEditorTab === 'json' ? (
                  <Button type="button" size="sm" variant="outline" asChild>
                    <label className="cursor-pointer">
                      <Upload className="h-4 w-4" />
                      업로드
                      <input type="file" accept=".json,application/json" hidden onChange={(event) => void handleFileUpload(event.target.files?.[0])} />
                    </label>
                  </Button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative min-w-[240px]">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        variant="settings"
                        value={graphSearchQuery}
                        onChange={(event) => setGraphSearchQuery(event.target.value)}
                        placeholder="노드 title / class_type / id 검색"
                        className="pl-8"
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {graphSearchQuery.trim().length > 0 ? `${graphSearchMatches.length}개` : '검색 없음'}
                    </div>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      disabled={graphSearchMatches.length === 0}
                      onClick={() => setGraphSearchIndex((current) => (
                        graphSearchMatches.length === 0
                          ? 0
                          : (current - 1 + graphSearchMatches.length) % graphSearchMatches.length
                      ))}
                      title="이전 검색 결과"
                      aria-label="이전 검색 결과"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="outline"
                      disabled={graphSearchMatches.length === 0}
                      onClick={() => setGraphSearchIndex((current) => (
                        graphSearchMatches.length === 0
                          ? 0
                          : (current + 1) % graphSearchMatches.length
                      ))}
                      title="다음 검색 결과"
                      aria-label="다음 검색 결과"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              {workflowEditorTab === 'json' ? (
                <div className="space-y-3">
                  <Textarea
                    variant="settings"
                    rows={12}
                    value={workflowJson}
                    onChange={(event) => handleWorkflowJsonChange(event.target.value)}
                    placeholder="ComfyUI API workflow JSON"
                    className="min-h-[620px] font-mono text-xs"
                  />

                  {jsonError ? <div className="text-xs text-[#ffb4ab]">{jsonError}</div> : null}
                </div>
              ) : (
                <div className="h-[660px] overflow-hidden rounded-sm border border-border bg-surface-lowest">
                  {parsedGraph ? (
                    <ReactFlowProvider>
                      <ReactFlow<AuthoringNode, AuthoringEdge>
                        className="theme-graph-flow"
                        nodes={graphNodes}
                        edges={parsedGraph.edges}
                        nodeTypes={nodeTypes}
                        onInit={setAuthoringFlowInstance}
                        fitView
                        fitViewOptions={INITIAL_AUTHORING_FIT_VIEW_OPTIONS}
                        defaultViewport={INITIAL_AUTHORING_VIEWPORT}
                        colorMode={reactFlowColorMode}
                        proOptions={{ hideAttribution: true }}
                        defaultMarkerColor="var(--foreground)"
                        defaultEdgeOptions={{ animated: false }}
                        nodesDraggable
                        nodesConnectable={false}
                        elementsSelectable
                        panOnDrag
                      >
                        <MiniMap
                          pannable
                          zoomable
                          nodeColor="var(--primary)"
                          maskColor="color-mix(in srgb, var(--background) 72%, transparent)"
                          className="!bg-surface-lowest"
                        />
                        <Controls />
                        <Background color="color-mix(in srgb, var(--foreground) 10%, transparent)" />
                      </ReactFlow>
                    </ReactFlowProvider>
                  ) : (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      유효한 workflow JSON을 넣으면 그래프가 보여.
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>취소</Button>
          <Button type="button" onClick={() => void handleSave()} disabled={isSaving || workflowName.trim().length === 0 || workflowJson.trim().length === 0 || jsonError !== null}>
            {isSaving ? '저장 중…' : submitLabel}
          </Button>
        </div>
      </div>
    </SettingsModal>
  )
}
