import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ReactFlowInstance } from '@xyflow/react'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { useI18n } from '@/i18n'
import { useGlobalAppearanceSettingsQuery } from '@/lib/use-global-appearance-settings'
import { useIsCoarsePointer } from '@/lib/use-is-coarse-pointer'
import type { CustomDropdownList, GenerationWorkflowDetail, WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { createGenerationWorkflow, updateGenerationWorkflow } from '@/lib/api-image-generation-workflows'
import { listAuthPermissionGroups } from '@/lib/api-auth'
import {
  buildWorkflowMarkedFieldFromInput,
  findAuthoringGraphMatches,
  parseWorkflowDefinition,
  parseWorkflowGraph,
  type AuthoringEdge,
  type AuthoringNode,
  type EditableWorkflowInput,
} from './comfy-workflow-authoring-graph'
import { getErrorMessage } from '../image-generation-shared'
import {
  enrichWorkflowMarkedFieldsWithNodeSources,
  reorderWorkflowMarkedFieldGroup,
  reorderWorkflowMarkedFieldWithinGroup,
} from '../workflow-marked-field-groups'
import {
  buildComfyWorkflowPayload,
  roleLimitsToDraft,
  slugifyPublicWorkflow,
} from './comfy-workflow-public-settings'

export type ComfyWorkflowAuthoringModalInitialData = {
  workflow: GenerationWorkflowDetail
}

export interface UseComfyWorkflowAuthoringControllerOptions {
  dropdownLists: CustomDropdownList[]
  initialData?: ComfyWorkflowAuthoringModalInitialData | null
  mode: 'create' | 'edit'
  onClose: () => void
  onSaved?: (workflowId: number) => void
  open: boolean
}

export const INITIAL_AUTHORING_VIEWPORT = { x: 0, y: 0, zoom: 0.7 }
export const INITIAL_AUTHORING_FIT_VIEW_OPTIONS = { padding: 0.28, maxZoom: 0.72 }
export const AUTHORING_NODE_DRAG_HANDLE_SELECTOR = '.comfy-authoring-drag-handle'

function readTextFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function getMarkedFieldNumericDefinitionError(markedFields: WorkflowMarkedField[]) {
  for (const field of markedFields) {
    if (field.type !== 'number') continue
    const constraints = [field.min, field.max, field.step].filter((value) => value !== undefined)
    if (constraints.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
      return `숫자 필드 제한값이 올바르지 않아: ${field.label || field.id}`
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      return `숫자 필드의 최소값은 최대값보다 클 수 없어: ${field.label || field.id}`
    }
    if (field.step !== undefined && field.step <= 0) {
      return `숫자 필드의 증감값은 0보다 커야 해: ${field.label || field.id}`
    }
  }
  return null
}

/** Own authoring state, graph/search effects, validation, and create/update orchestration. */
export function useComfyWorkflowAuthoringController({
  dropdownLists,
  initialData,
  mode,
  onClose,
  onSaved,
  open,
}: UseComfyWorkflowAuthoringControllerOptions) {
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber } = useI18n()
  const appearanceQuery = useGlobalAppearanceSettingsQuery()
  const [workflowName, setWorkflowName] = useState('')
  const [workflowDescription, setWorkflowDescription] = useState('')
  const [workflowJson, setWorkflowJson] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [isPublicPage, setIsPublicPage] = useState(false)
  const [publicSlug, setPublicSlug] = useState('')
  const [publicQueueMaxCount, setPublicQueueMaxCount] = useState('32')
  const [publicQueueRoleLimits, setPublicQueueRoleLimits] = useState<Record<string, string>>({})
  const [resultViewMode, setResultViewMode] = useState<'history' | 'artifact_explorer'>('history')
  const [artifactDirectoryMode, setArtifactDirectoryMode] = useState<'shared' | 'per_run'>('shared')
  const [artifactRootPath, setArtifactRootPath] = useState('')
  const [markedFields, setMarkedFields] = useState<WorkflowMarkedField[]>([])
  const [expandedFieldIds, setExpandedFieldIds] = useState<string[]>([])
  const [workflowEditorTab, setWorkflowEditorTab] = useState<'json' | 'graph'>('graph')
  const [graphSearchQuery, setGraphSearchQuery] = useState('')
  const [graphSearchIndex, setGraphSearchIndex] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const isCoarsePointer = useIsCoarsePointer()
  const [authoringFlowInstance, setAuthoringFlowInstance] = useState<ReactFlowInstance<AuthoringNode, AuthoringEdge> | null>(null)
  const jsonTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  const permissionGroupsQuery = useQuery({
    queryKey: ['auth-permission-groups', 'all'],
    queryFn: listAuthPermissionGroups,
    enabled: open && isPublicPage,
    staleTime: 60_000,
    retry: false,
  })
  const roleLimitGroups = useMemo(() => {
    const rows = (permissionGroupsQuery.data ?? [])
      .filter((group) => group.groupKey !== 'anonymous')
      .sort((a, b) => a.priority - b.priority || a.id - b.id)
      .map((group) => ({ groupKey: group.groupKey, name: group.name as string | null }))
    const seenGroupKeys = new Set(rows.map((row) => row.groupKey))
    for (const fallbackKey of ['guest', 'admin']) {
      if (!seenGroupKeys.has(fallbackKey)) {
        rows.push({ groupKey: fallbackKey, name: null })
        seenGroupKeys.add(fallbackKey)
      }
    }
    for (const groupKey of Object.keys(publicQueueRoleLimits)) {
      if (!seenGroupKeys.has(groupKey)) {
        rows.push({ groupKey, name: null })
        seenGroupKeys.add(groupKey)
      }
    }
    return rows
  }, [permissionGroupsQuery.data, publicQueueRoleLimits])

  useEffect(() => {
    if (!open) return
    if (mode === 'edit' && initialData) {
      setWorkflowName(initialData.workflow.name)
      setWorkflowDescription(initialData.workflow.description ?? '')
      setWorkflowJson(initialData.workflow.workflow_json)
      setJsonError(null)
      setIsPublicPage(Boolean(initialData.workflow.is_public_page))
      setPublicSlug(initialData.workflow.public_slug ?? '')
      setPublicQueueMaxCount(String(initialData.workflow.public_queue_max_count ?? 32))
      setPublicQueueRoleLimits(roleLimitsToDraft(initialData.workflow.public_queue_role_limits))
      setResultViewMode(initialData.workflow.result_view_mode ?? 'history')
      setArtifactDirectoryMode(initialData.workflow.artifact_directory_mode ?? 'shared')
      setArtifactRootPath(initialData.workflow.artifact_root_path ?? '')
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
    setPublicQueueMaxCount('32')
    setPublicQueueRoleLimits({})
    setResultViewMode('history')
    setArtifactDirectoryMode('shared')
    setArtifactRootPath('')
    setMarkedFields([])
    setExpandedFieldIds([])
    setWorkflowEditorTab('graph')
    setGraphSearchQuery('')
    setGraphSearchIndex(0)
    setIsSaving(false)
  }, [initialData, mode, open])

  useEffect(() => {
    if (!open) return
    if (!isPublicPage) {
      if (publicSlug.length > 0) setPublicSlug('')
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
      setJsonError(getErrorMessage(error, t({ ko: '유효한 workflow JSON이 아니야.', en: 'This is not a valid workflow JSON.' })))
    }
  }
  const handleFileUpload = async (file?: File) => {
    if (!file) return
    try {
      const text = await readTextFile(file)
      const parsed = parseWorkflowDefinition(text)
      setWorkflowJson(JSON.stringify(parsed, null, 2))
      setJsonError(null)
      if (workflowName.trim().length === 0) setWorkflowName(file.name.replace(/\.json$/i, ''))
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: 'JSON 파일을 읽지 못했어.', en: 'Could not read the JSON file.' })), tone: 'error' })
    }
  }
  const handleAddField = useCallback((nodeId: string, nodeTitle: string, classType: string, input: EditableWorkflowInput) => {
    const field = buildWorkflowMarkedFieldFromInput(nodeId, nodeTitle, classType, input)
    setMarkedFields((current) => {
      const exists = current.some((item) => item.jsonPath === field.jsonPath)
      if (exists) {
        setExpandedFieldIds((expanded) => expanded.filter((item) => item !== field.id))
        return current.filter((item) => item.jsonPath !== field.jsonPath)
      }
      setExpandedFieldIds((expanded) => (expanded.includes(field.id) ? expanded : [...expanded, field.id]))
      return [...current, field]
    })
  }, [])

  const parsedGraph = useMemo(() => {
    if (workflowJson.trim().length === 0 || jsonError) return null
    try {
      return parseWorkflowGraph({ workflowJson, onAddField: handleAddField })
    } catch {
      return null
    }
  }, [handleAddField, jsonError, workflowJson])
  const workflowNodeSources = useMemo(() => parsedGraph?.nodes.map((node) => ({ id: node.id, title: node.data.title })) ?? [], [parsedGraph])
  const markedFieldsWithNodeSources = useMemo(() => enrichWorkflowMarkedFieldsWithNodeSources(markedFields, workflowNodeSources), [markedFields, workflowNodeSources])
  const graphSearchMatches = useMemo(() => parsedGraph ? findAuthoringGraphMatches(parsedGraph.nodes, graphSearchQuery) : [], [graphSearchQuery, parsedGraph])
  const jsonSearchMatches = useMemo(() => {
    const normalizedQuery = graphSearchQuery.trim().toLowerCase()
    if (!normalizedQuery || workflowJson.length === 0) return []
    const normalizedJson = workflowJson.toLowerCase()
    const matches: number[] = []
    let searchFrom = 0
    while (searchFrom < normalizedJson.length) {
      const nextIndex = normalizedJson.indexOf(normalizedQuery, searchFrom)
      if (nextIndex < 0) break
      matches.push(nextIndex)
      searchFrom = nextIndex + Math.max(1, normalizedQuery.length)
    }
    return matches
  }, [graphSearchQuery, workflowJson])
  const activeGraphSearchNodeId = graphSearchMatches.length > 0 ? graphSearchMatches[Math.min(graphSearchIndex, graphSearchMatches.length - 1)] : null
  const graphNodes = useMemo(() => {
    if (!parsedGraph) return []
    const matchedIdSet = new Set(graphSearchMatches)
    const markedPathSet = new Set(markedFields.map((field) => field.jsonPath))
    return parsedGraph.nodes.map((node) => ({
      ...node,
      dragHandle: isCoarsePointer ? AUTHORING_NODE_DRAG_HANDLE_SELECTOR : undefined,
      data: {
        ...node.data,
        markedJsonPaths: node.data.editableInputs.map((input) => input.jsonPath ?? `${node.id}.inputs.${input.key}`).filter((path) => markedPathSet.has(path)),
        searchMatched: matchedIdSet.has(node.id),
        searchCurrent: node.id === activeGraphSearchNodeId,
      },
    }))
  }, [activeGraphSearchNodeId, graphSearchMatches, isCoarsePointer, markedFields, parsedGraph])

  const reactFlowColorMode: 'light' | 'dark' | 'system' = appearanceQuery.data?.themeMode ?? DEFAULT_APPEARANCE_SETTINGS.themeMode
  const authoringMiniMapNodeColor = reactFlowColorMode === 'light' ? '#d9480f' : '#f95e14'
  const authoringMiniMapMaskColor = reactFlowColorMode === 'light' ? 'rgba(255, 255, 255, 0.62)' : 'rgba(8, 10, 14, 0.58)'
  const authoringMiniMapBgColor = reactFlowColorMode === 'light' ? '#f5f6f8' : '#141414'

  useEffect(() => {
    if (!open || workflowEditorTab !== 'graph' || !parsedGraph || !authoringFlowInstance) return
    const rafId = window.requestAnimationFrame(() => { void authoringFlowInstance.fitView(INITIAL_AUTHORING_FIT_VIEW_OPTIONS) })
    return () => window.cancelAnimationFrame(rafId)
  }, [authoringFlowInstance, open, parsedGraph, workflowEditorTab])
  useEffect(() => setGraphSearchIndex(0), [graphSearchQuery, workflowEditorTab])
  useEffect(() => {
    if (workflowEditorTab !== 'json' || graphSearchQuery.trim().length === 0 || jsonSearchMatches.length === 0) return
    const textareaElement = jsonTextareaRef.current
    if (!textareaElement) return
    const matchIndex = jsonSearchMatches[Math.min(graphSearchIndex, jsonSearchMatches.length - 1)]
    textareaElement.focus({ preventScroll: true })
    textareaElement.setSelectionRange(matchIndex, matchIndex + graphSearchQuery.trim().length)
  }, [graphSearchIndex, graphSearchQuery, jsonSearchMatches, workflowEditorTab])
  useEffect(() => {
    if (!authoringFlowInstance || !activeGraphSearchNodeId || !parsedGraph) return
    const targetNode = parsedGraph.nodes.find((node) => node.id === activeGraphSearchNodeId)
    if (!targetNode) return
    void authoringFlowInstance.setCenter(targetNode.position.x + 130, targetNode.position.y + 90, { zoom: 0.88, duration: 240 })
  }, [activeGraphSearchNodeId, authoringFlowInstance, parsedGraph])

  const activeSearchMatches = workflowEditorTab === 'json' ? jsonSearchMatches : graphSearchMatches
  const activeSearchCount = activeSearchMatches.length
  const searchPlaceholder = workflowEditorTab === 'json'
    ? t({ ko: 'Workflow JSON 검색', en: 'Search workflow JSON' })
    : t({ ko: '노드 title / class_type / id 검색', en: 'Search node title / class_type / id' })
  const handleFieldPatch = (fieldId: string, patch: Partial<WorkflowMarkedField>) => setMarkedFields((current) => current.map((field) => field.id === fieldId ? { ...field, ...patch } : field))
  const handleFieldRemove = (fieldId: string) => {
    setMarkedFields((current) => current.filter((field) => field.id !== fieldId))
    setExpandedFieldIds((current) => current.filter((item) => item !== fieldId))
  }
  const handleFieldExpandToggle = (fieldId: string) => setExpandedFieldIds((current) => current.includes(fieldId) ? current.filter((item) => item !== fieldId) : [...current, fieldId])
  const handleReorderMarkedField = (sourceFieldId: string, targetFieldId: string) => setMarkedFields((current) => reorderWorkflowMarkedFieldWithinGroup(current, sourceFieldId, targetFieldId))
  const handleReorderMarkedFieldGroup = (sourceGroupKey: string, targetGroupKey: string) => setMarkedFields((current) => reorderWorkflowMarkedFieldGroup(current, sourceGroupKey, targetGroupKey))

  const handleSave = async () => {
    if (isSaving) return
    if (workflowName.trim().length === 0) {
      showSnackbar({ message: t({ ko: '워크플로우 이름이 필요해.', en: 'Workflow name is required.' }), tone: 'error' })
      return
    }
    if (workflowJson.trim().length === 0 || jsonError) {
      showSnackbar({ message: t({ ko: '유효한 workflow JSON이 필요해.', en: 'A valid workflow JSON is required.' }), tone: 'error' })
      return
    }
    const markedFieldNumericError = getMarkedFieldNumericDefinitionError(markedFields)
    if (markedFieldNumericError) {
      showSnackbar({ message: markedFieldNumericError, tone: 'error' })
      return
    }
    if (isPublicPage && slugifyPublicWorkflow(publicSlug).length === 0) {
      showSnackbar({ message: t({ ko: '공용 페이지 slug가 필요해.', en: 'Public page slug is required.' }), tone: 'error' })
      return
    }
    try {
      setIsSaving(true)
      const payload = buildComfyWorkflowPayload({
        artifactDirectoryMode,
        artifactRootPath,
        color: initialData?.workflow.color ?? '#2196f3',
        description: workflowDescription,
        isActive: initialData?.workflow.is_active ?? true,
        isPublicPage,
        markedFields: enrichWorkflowMarkedFieldsWithNodeSources(markedFields, workflowNodeSources),
        publicQueueMaxCount,
        publicQueueRoleLimits,
        publicSlug,
        resultViewMode,
        workflowJson,
        workflowName,
      })
      let workflowId = initialData?.workflow.id
      if (mode === 'edit' && workflowId) {
        await updateGenerationWorkflow(workflowId, payload)
      } else {
        const response = await createGenerationWorkflow(payload)
        workflowId = response.data.id
      }
      showSnackbar({ message: mode === 'edit' ? t({ ko: 'ComfyUI 워크플로우를 수정했어.', en: 'Updated the ComfyUI workflow.' }) : t({ ko: 'ComfyUI 워크플로우를 저장했어.', en: 'Saved the ComfyUI workflow.' }), tone: 'info' })
      onSaved?.(workflowId as number)
      onClose()
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, mode === 'edit' ? t({ ko: '워크플로우 수정에 실패했어.', en: 'Failed to update the workflow.' }) : t({ ko: '워크플로우 저장에 실패했어.', en: 'Failed to save the workflow.' })), tone: 'error' })
    } finally {
      setIsSaving(false)
    }
  }

  return {
    activeSearchCount, artifactDirectoryMode, artifactRootPath, authoringMiniMapBgColor,
    authoringMiniMapMaskColor, authoringMiniMapNodeColor, dropdownListNames: dropdownLists.map((list) => list.name),
    expandedFieldIds, formatNumber, graphNodes, graphSearchIndex, graphSearchQuery, handleFieldExpandToggle,
    handleFieldPatch, handleFieldRemove, handleFileUpload, handleReorderMarkedField, handleReorderMarkedFieldGroup,
    handleSave, handleWorkflowJsonChange, isCoarsePointer, isPublicPage, isSaving, jsonError, jsonTextareaRef,
    markedFieldsWithNodeSources, parsedGraph, publicQueueMaxCount, publicQueueRoleLimits, publicSlug,
    reactFlowColorMode, resultViewMode, roleLimitGroups, searchPlaceholder, setArtifactDirectoryMode,
    setArtifactRootPath, setAuthoringFlowInstance, setGraphSearchIndex, setGraphSearchQuery, setIsPublicPage,
    setPublicQueueMaxCount, setPublicQueueRoleLimits, setPublicSlug, setResultViewMode, setWorkflowDescription,
    setWorkflowEditorTab, setWorkflowName, workflowDescription, workflowEditorTab, workflowJson, workflowName,
  }
}
