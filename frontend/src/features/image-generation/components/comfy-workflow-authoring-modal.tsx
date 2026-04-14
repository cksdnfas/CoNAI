import { useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronUp, Search, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { SettingsField, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { useIsCoarsePointer } from '@/lib/use-is-coarse-pointer'
import {
  getAppSettings,
  createGenerationWorkflow,
  updateGenerationWorkflow,
  type CustomDropdownList,
  type GenerationWorkflowDetail,
  type WorkflowMarkedField,
} from '@/lib/api'
import {
  buildWorkflowMarkedFieldFromInput,
  findAuthoringGraphMatches,
  nodeTypes,
  parseWorkflowDefinition,
  parseWorkflowGraph,
  type AuthoringEdge,
  type AuthoringNode,
  type EditableWorkflowInput,
} from './comfy-workflow-authoring-graph'
import { ComfyWorkflowMarkedFieldsEditor } from './comfy-workflow-marked-fields-editor'
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

const INITIAL_AUTHORING_VIEWPORT = { x: 0, y: 0, zoom: 0.7 }
const INITIAL_AUTHORING_FIT_VIEW_OPTIONS = { padding: 0.28, maxZoom: 0.72 }
const AUTHORING_NODE_DRAG_HANDLE_SELECTOR = '.comfy-authoring-drag-handle'

/** Read an uploaded workflow JSON file as text. */
function readTextFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function slugifyPublicWorkflow(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
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
  const [isPublicPage, setIsPublicPage] = useState(false)
  const [publicSlug, setPublicSlug] = useState('')
  const [markedFields, setMarkedFields] = useState<WorkflowMarkedField[]>([])
  const [expandedFieldIds, setExpandedFieldIds] = useState<string[]>([])
  const [workflowEditorTab, setWorkflowEditorTab] = useState<'json' | 'graph'>('json')
  const [graphSearchQuery, setGraphSearchQuery] = useState('')
  const [graphSearchIndex, setGraphSearchIndex] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const isCoarsePointer = useIsCoarsePointer()
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
      setIsPublicPage(Boolean(initialData.workflow.is_public_page))
      setPublicSlug(initialData.workflow.public_slug ?? '')
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
    setIsPublicPage(false)
    setPublicSlug('')
    setMarkedFields([])
    setExpandedFieldIds([])
    setWorkflowEditorTab('json')
    setGraphSearchQuery('')
    setGraphSearchIndex(0)
    setIsSaving(false)
  }, [initialData, mode, open])

  useEffect(() => {
    if (!open) {
      return
    }

    if (!isPublicPage) {
      if (publicSlug.length > 0) {
        setPublicSlug('')
      }
      return
    }

    setPublicSlug((current) => {
      const nextSlug = slugifyPublicWorkflow(current.length > 0 ? current : workflowName)
      return nextSlug === current ? current : nextSlug
    })
  }, [isPublicPage, open, publicSlug.length, workflowName])

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
    const field = buildWorkflowMarkedFieldFromInput(nodeId, classType, input)
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

    return findAuthoringGraphMatches(parsedGraph.nodes, graphSearchQuery)
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
      dragHandle: isCoarsePointer ? AUTHORING_NODE_DRAG_HANDLE_SELECTOR : undefined,
      data: {
        ...node.data,
        searchMatched: matchedIdSet.has(node.id),
        searchCurrent: node.id === activeGraphSearchNodeId,
      },
    }))
  }, [activeGraphSearchNodeId, graphSearchMatches, isCoarsePointer, parsedGraph])

  const reactFlowColorMode: 'light' | 'dark' | 'system' =
    settingsQuery.data?.appearance.themeMode ?? DEFAULT_APPEARANCE_SETTINGS.themeMode
  const authoringMiniMapNodeColor = reactFlowColorMode === 'light' ? '#d9480f' : '#f95e14'
  const authoringMiniMapMaskColor = reactFlowColorMode === 'light' ? 'rgba(255, 255, 255, 0.62)' : 'rgba(8, 10, 14, 0.58)'
  const authoringMiniMapBgColor = reactFlowColorMode === 'light' ? '#f5f6f8' : '#141414'

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

  const handleFieldRemove = (fieldId: string) => {
    setMarkedFields((current) => current.filter((field) => field.id !== fieldId))
  }

  const handleFieldExpandToggle = (fieldId: string) => {
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

    const normalizedPublicSlug = slugifyPublicWorkflow(publicSlug)
    if (isPublicPage && normalizedPublicSlug.length === 0) {
      showSnackbar({ message: '공용 페이지 slug가 필요해.', tone: 'error' })
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
        is_public_page: isPublicPage,
        public_slug: isPublicPage ? normalizedPublicSlug : null,
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

                <SettingsToggleRow>
                  <input
                    type="checkbox"
                    checked={isPublicPage}
                    onChange={(event) => setIsPublicPage(event.target.checked)}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-foreground">공용 페이지 사용</div>
                  </div>
                </SettingsToggleRow>

                {isPublicPage ? (
                  <SettingsField label="Public slug">
                    <Input
                      variant="settings"
                      value={publicSlug}
                      onChange={(event) => setPublicSlug(slugifyPublicWorkflow(event.target.value))}
                      placeholder="character-poster-generator"
                    />
                  </SettingsField>
                ) : null}
              </div>
            </section>

            <ComfyWorkflowMarkedFieldsEditor
              markedFields={markedFields}
              expandedFieldIds={expandedFieldIds}
              dropdownListNames={dropdownListNames}
              onFieldPatch={handleFieldPatch}
              onFieldRemove={handleFieldRemove}
              onFieldExpandToggle={handleFieldExpandToggle}
            />
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
                        className={isCoarsePointer ? 'theme-graph-flow touch-scroll-safe' : 'theme-graph-flow'}
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
                        panOnDrag={!isCoarsePointer}
                      >
                        <MiniMap
                          pannable
                          zoomable
                          nodeColor={authoringMiniMapNodeColor}
                          nodeStrokeColor={authoringMiniMapNodeColor}
                          nodeStrokeWidth={3}
                          maskColor={authoringMiniMapMaskColor}
                          bgColor={authoringMiniMapBgColor}
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
