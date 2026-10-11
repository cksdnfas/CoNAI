import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ReactFlowInstance } from '@xyflow/react'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { useI18n } from '@/i18n'
import { useGlobalAppearanceSettingsQuery } from '@/lib/use-global-appearance-settings'
import { useIsCoarsePointer } from '@/lib/use-is-coarse-pointer'
import type { CustomDropdownList, GenerationWorkflowDetail, WorkflowKind, WorkflowMarkedField } from '@/lib/api-image-generation-types'
import { checkComfyWorkflow, convertComfyUiWorkflow, createGenerationWorkflow, updateGenerationWorkflow } from '@/lib/api-image-generation-workflows'
import { useComfyAuthorChatPage } from './use-comfy-author-chat-page'
import { listAuthPermissionGroups } from '@/lib/api-auth'
import {
  buildWorkflowMarkedFieldFromInput,
  findAuthoringGraphMatches,
  findMissingMarkedFieldIds,
  isComfyUiWorkflowJson,
  parseWorkflowDefinition,
  parseWorkflowGraph,
  suggestWorkflowMarkedFields,
  type AuthoringEdge,
  type AuthoringGraphLayout,
  type AuthoringNode,
  type EditableWorkflowInput,
} from './comfy-workflow-authoring-graph'
import { getErrorMessage } from '../image-generation-shared'
import {
  enrichWorkflowMarkedFieldsWithNodeSources,
  resolveWorkflowMarkedFieldNodeSource,
  reorderWorkflowMarkedFieldGroup,
  reorderWorkflowMarkedFieldWithinGroup,
} from '../workflow-marked-field-groups'
import {
  buildComfyWorkflowPayload,
  roleLimitsToDraft,
  slugifyPublicWorkflow,
} from './comfy-workflow-public-settings'
import { applyMarkedFieldPatch } from './comfy-workflow-marked-field-utils'
import { extractComfyWorkflowFromMedia, isComfyMediaFile } from './comfy-workflow-media-import'

export type ComfyWorkflowAuthoringModalInitialData = {
  workflow: GenerationWorkflowDetail
}

export type ComfyWorkflowEditorTab = 'graph' | 'json' | 'settings'

/** Everything the editor saves; one object so open/reset, dirty tracking and the chat bridge share it. */
export type ComfyWorkflowDraft = {
  name: string
  description: string
  workflowJson: string
  kind: WorkflowKind
  isPublicPage: boolean
  publicSlug: string
  publicQueueMaxCount: string
  publicQueueRoleLimits: Record<string, string>
  resultViewMode: 'history' | 'artifact_explorer'
  artifactDirectoryMode: 'shared' | 'per_run'
  artifactRootPath: string
  markedFields: WorkflowMarkedField[]
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
export const INITIAL_AUTHORING_FIT_VIEW_OPTIONS = { padding: 0.15, maxZoom: 1 }
export const AUTHORING_NODE_DRAG_HANDLE_SELECTOR = '.comfy-authoring-drag-handle'
/** Wait this long after the last JSON edit before asking the servers about it. */
const WORKFLOW_CHECK_DEBOUNCE_MS = 800

function readTextFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.readAsText(file)
  })
}

function draftFromWorkflow(workflow: GenerationWorkflowDetail | null | undefined): ComfyWorkflowDraft {
  return {
    name: workflow?.name ?? '',
    description: workflow?.description ?? '',
    workflowJson: workflow?.workflow_json ?? '',
    kind: workflow?.kind ?? 'image',
    isPublicPage: Boolean(workflow?.is_public_page),
    publicSlug: workflow?.public_slug ?? '',
    publicQueueMaxCount: String(workflow?.public_queue_max_count ?? 32),
    publicQueueRoleLimits: roleLimitsToDraft(workflow?.public_queue_role_limits),
    resultViewMode: workflow?.result_view_mode ?? 'history',
    artifactDirectoryMode: workflow?.artifact_directory_mode ?? 'shared',
    artifactRootPath: workflow?.artifact_root_path ?? '',
    markedFields: workflow?.marked_fields ?? [],
  }
}

function getJsonError(workflowJson: string, fallback: string) {
  if (workflowJson.trim().length === 0) return null
  try {
    parseWorkflowDefinition(workflowJson)
    return null
  } catch (error) {
    return getErrorMessage(error, fallback)
  }
}

/** Find every occurrence of the query in the JSON text, for the JSON tab's previous/next search. */
function findJsonMatches(workflowJson: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
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
  const { t } = useI18n()
  const appearanceQuery = useGlobalAppearanceSettingsQuery()
  const invalidJsonMessage = t({ ko: '유효한 workflow JSON이 아니야.', en: 'This is not a valid workflow JSON.' })
  const [draft, setDraft] = useState<ComfyWorkflowDraft>(() => draftFromWorkflow(null))
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(draftFromWorkflow(null)))
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [editorTab, setEditorTabState] = useState<ComfyWorkflowEditorTab>('graph')
  const [searchQuery, setSearchQueryState] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  const [selectedFieldPath, setSelectedFieldPath] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  // A pasted or loaded ComfyUI "Save" workflow is converted to the API format once; a failure keeps its reason.
  const [uiConversion, setUiConversion] = useState<{ json: string; status: 'converting' | 'failed'; message: string } | null>(null)
  const uiConversionAttemptRef = useRef<string | null>(null)
  // A workflow just loaded (file, drop, paste into an empty editor, conversion): once the graph and server check are
  // in, an empty field list gets suggested fields and existing fields that lost their input are reported.
  const pendingLoadedJsonRef = useRef<string | null>(null)
  const [graphLayout, setGraphLayout] = useState<AuthoringGraphLayout>('auto')
  const [checkedJson, setCheckedJson] = useState('')
  const checkIssueCursorRef = useRef(0)
  const isCoarsePointer = useIsCoarsePointer()
  const [authoringFlowInstance, setAuthoringFlowInstance] = useState<ReactFlowInstance<AuthoringNode, AuthoringEdge> | null>(null)
  const jsonTextareaRef = useRef<HTMLTextAreaElement | null>(null)

  const permissionGroupsQuery = useQuery({
    queryKey: ['auth-permission-groups', 'all'],
    queryFn: listAuthPermissionGroups,
    enabled: open && draft.isPublicPage,
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
    for (const groupKey of Object.keys(draft.publicQueueRoleLimits)) {
      if (!seenGroupKeys.has(groupKey)) {
        rows.push({ groupKey, name: null })
        seenGroupKeys.add(groupKey)
      }
    }
    return rows
  }, [permissionGroupsQuery.data, draft.publicQueueRoleLimits])

  // Reset everything each time the editor opens, from the workflow being edited or an empty draft.
  useEffect(() => {
    if (!open) return
    const nextDraft = draftFromWorkflow(mode === 'edit' ? initialData?.workflow : null)
    setDraft(nextDraft)
    setSavedSnapshot(JSON.stringify(nextDraft))
    setJsonError(null)
    setSelectedFieldPath(null)
    setEditorTabState('graph')
    setSearchQueryState('')
    setSearchIndex(0)
    setIsSaving(false)
    setUiConversion(null)
    uiConversionAttemptRef.current = null
    pendingLoadedJsonRef.current = null
    setGraphLayout('auto')
    setCheckedJson('')
  }, [initialData, mode, open])

  const patchDraft = useCallback((patch: Partial<ComfyWorkflowDraft>) => setDraft((current) => ({ ...current, ...patch })), [])

  // The public slug follows the name until it is set, and is cleared when the public page is off.
  useEffect(() => {
    if (!open) return
    setDraft((current) => {
      const nextSlug = current.isPublicPage ? slugifyPublicWorkflow(current.publicSlug.length > 0 ? current.publicSlug : current.name) : ''
      return nextSlug === current.publicSlug ? current : { ...current, publicSlug: nextSlug }
    })
  }, [draft.isPublicPage, draft.name, draft.publicSlug, open])

  const isDirty = useMemo(() => JSON.stringify(draft) !== savedSnapshot, [draft, savedSnapshot])

  const handleWorkflowJsonChange = (nextValue: string) => {
    // A paste into an empty editor counts as loading a workflow; typing does not.
    if (draft.workflowJson.trim().length === 0 && nextValue.trim().length > 0) pendingLoadedJsonRef.current = nextValue
    patchDraft({ workflowJson: nextValue })
    setJsonError(getJsonError(nextValue, invalidJsonMessage))
  }
  const loadWorkflowJson = (workflowJson: string, fileName: string) => {
    pendingLoadedJsonRef.current = workflowJson
    setDraft((current) => ({
      ...current,
      workflowJson,
      name: current.name.trim().length === 0 ? fileName.replace(/\.[^.]+$/, '') : current.name,
    }))
    setJsonError(null)
  }
  /** A workflow JSON, or a ComfyUI image/video that carries its workflow. */
  const handleFileUpload = async (file?: File) => {
    if (!file) return
    try {
      if (isComfyMediaFile(file)) {
        const extracted = await extractComfyWorkflowFromMedia(file)
        if (!extracted) {
          showSnackbar({ message: t({ ko: '이 파일에는 ComfyUI 워크플로가 들어 있지 않아.', en: 'This file carries no ComfyUI workflow.' }), tone: 'error' })
          return
        }
        loadWorkflowJson(extracted.workflowJson, file.name)
        return
      }
      const text = await readTextFile(file)
      loadWorkflowJson(JSON.stringify(parseWorkflowDefinition(text), null, 2), file.name)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '파일을 읽지 못했어.', en: 'Could not read the file.' })), tone: 'error' })
    }
  }

  // An unmarked input becomes a field; a marked one is selected for editing. Removing goes through the field panel.
  // Selection is keyed by JSON path, which stays unique per field and is known here without reading the draft.
  const handleInputSelect = useCallback((nodeId: string, nodeTitle: string, classType: string, input: EditableWorkflowInput) => {
    const field = buildWorkflowMarkedFieldFromInput(nodeId, nodeTitle, classType, input)
    setDraft((current) => (
      current.markedFields.some((item) => item.jsonPath === field.jsonPath)
        ? current
        : { ...current, markedFields: [...current.markedFields, field] }
    ))
    setSelectedFieldPath(field.jsonPath)
  }, [])

  const isUiWorkflow = useMemo(() => isComfyUiWorkflowJson(draft.workflowJson), [draft.workflowJson])
  useEffect(() => {
    if (!open || !isUiWorkflow || uiConversionAttemptRef.current === draft.workflowJson) return
    const sourceJson = draft.workflowJson
    uiConversionAttemptRef.current = sourceJson
    setUiConversion({ json: sourceJson, status: 'converting', message: '' })
    convertComfyUiWorkflow(sourceJson)
      .then((result) => {
        setUiConversion((current) => current?.json === sourceJson ? null : current)
        if (pendingLoadedJsonRef.current === sourceJson) pendingLoadedJsonRef.current = result.workflow_json
        setDraft((current) => current.workflowJson === sourceJson ? { ...current, workflowJson: result.workflow_json } : current)
        const converted = t({ ko: '일반 워크플로를 API 형식으로 바꿨어.', en: 'Converted the workflow to the API format.' })
        showSnackbar({ message: result.warnings.length > 0 ? `${converted} ${result.warnings.join(' · ').slice(0, 240)}` : converted, tone: 'info' })
      })
      .catch((error) => {
        const message = getErrorMessage(error, t({ ko: '일반 워크플로를 API 형식으로 바꾸지 못했어. ComfyUI에서 Workflow → Export (API)로 내보낸 JSON을 넣어줘.', en: 'Could not convert this workflow. Use Workflow → Export (API) in ComfyUI and load that JSON.' }))
        setUiConversion((current) => current?.json === sourceJson ? { json: sourceJson, status: 'failed', message } : current)
      })
  }, [draft.workflowJson, isUiWorkflow, open, showSnackbar, t])
  const activeUiConversion = isUiWorkflow && uiConversion?.json === draft.workflowJson ? uiConversion : null
  const isConvertingUiWorkflow = isUiWorkflow && activeUiConversion?.status !== 'failed'
  const uiConversionError = activeUiConversion?.status === 'failed' ? activeUiConversion.message : null

  const parsedGraph = useMemo(() => {
    if (draft.workflowJson.trim().length === 0 || jsonError || isUiWorkflow) return null
    try {
      return parseWorkflowGraph({ workflowJson: draft.workflowJson, onInputSelect: handleInputSelect, layout: graphLayout })
    } catch {
      return null
    }
  }, [graphLayout, handleInputSelect, isUiWorkflow, jsonError, draft.workflowJson])
  const toggleGraphLayout = () => setGraphLayout((current) => current === 'auto' ? 'comfy' : 'auto')

  // Server check: missing nodes and models, out-of-range numbers, and which nodes never run.
  const hasParsedGraph = parsedGraph !== null
  useEffect(() => {
    if (!open || !hasParsedGraph) return
    const timer = window.setTimeout(() => setCheckedJson(draft.workflowJson), WORKFLOW_CHECK_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [draft.workflowJson, hasParsedGraph, open])
  const checkWorkflowId = mode === 'edit' ? initialData?.workflow.id ?? null : null
  const workflowCheckQuery = useQuery({
    queryKey: ['comfy-workflow-check', checkWorkflowId, checkedJson],
    queryFn: () => checkComfyWorkflow(checkedJson, checkWorkflowId),
    enabled: open && hasParsedGraph && checkedJson.length > 0 && checkedJson === draft.workflowJson,
    staleTime: 5 * 60_000,
    retry: false,
  })
  const workflowCheck = checkedJson === draft.workflowJson ? workflowCheckQuery.data ?? null : null
  const workflowCheckSettled = checkedJson === draft.workflowJson && !workflowCheckQuery.isFetching && (workflowCheckQuery.isSuccess || workflowCheckQuery.isError)
  const checkIssuesByNode = useMemo(() => {
    const byNode = new Map<string, string[]>()
    for (const server of workflowCheck?.servers ?? []) {
      for (const issue of server.issues) byNode.set(issue.node_id, [...(byNode.get(issue.node_id) ?? []), `${server.server_name}: ${issue.message}`])
    }
    return byNode
  }, [workflowCheck])
  const unusedNodeIds = useMemo(() => new Set(workflowCheck?.unused_node_ids ?? []), [workflowCheck])
  /** One line per server for the editor bar: none = nothing to show. */
  const serverCheckSummary = useMemo(() => {
    const servers = workflowCheck?.servers ?? []
    if (servers.length === 0) return null
    const issueCount = servers.reduce((sum, server) => sum + server.issues.length, 0)
    const reachable = servers.filter((server) => server.status !== 'unreachable')
    const status: 'ok' | 'issues' | 'unreachable' = issueCount > 0 ? 'issues' : reachable.length === 0 ? 'unreachable' : 'ok'
    const lines = servers.map((server) => server.status === 'unreachable'
      ? t({ ko: '{name}: 연결 안 됨', en: '{name}: unreachable' }, { name: server.server_name })
      : server.issues.length > 0
        ? t({ ko: '{name}: 문제 {count}개', en: '{name}: {count} issues' }, { name: server.server_name, count: server.issues.length })
        : t({ ko: '{name}: 문제 없음', en: '{name}: no issues' }, { name: server.server_name }))
    return { status, lines, issueNodeIds: [...checkIssuesByNode.keys()] }
  }, [checkIssuesByNode, t, workflowCheck])
  const missingFieldIds = useMemo(
    () => (parsedGraph ? findMissingMarkedFieldIds(draft.workflowJson, draft.markedFields) : new Set<string>()),
    [draft.markedFields, draft.workflowJson, parsedGraph],
  )
  const workflowNodeSources = useMemo(() => parsedGraph?.nodes.map((node) => ({ id: node.id, title: node.data.title })) ?? [], [parsedGraph])
  const markedFieldsWithNodeSources = useMemo(() => enrichWorkflowMarkedFieldsWithNodeSources(draft.markedFields, workflowNodeSources), [draft.markedFields, workflowNodeSources])
  const selectedField = useMemo(() => markedFieldsWithNodeSources.find((field) => field.jsonPath === selectedFieldPath) ?? null, [markedFieldsWithNodeSources, selectedFieldPath])
  const selectedFieldNodeId = selectedField ? resolveWorkflowMarkedFieldNodeSource(selectedField).nodeId : null

  const graphSearchMatches = useMemo(() => parsedGraph ? findAuthoringGraphMatches(parsedGraph.nodes, searchQuery) : [], [searchQuery, parsedGraph])
  const jsonSearchMatches = useMemo(() => findJsonMatches(draft.workflowJson, searchQuery), [searchQuery, draft.workflowJson])
  const activeGraphSearchNodeId = graphSearchMatches.length > 0 ? graphSearchMatches[Math.min(searchIndex, graphSearchMatches.length - 1)] : null
  const graphNodes = useMemo(() => {
    if (!parsedGraph) return []
    const matchedIdSet = new Set(graphSearchMatches)
    const markedPathSet = new Set(draft.markedFields.map((field) => field.jsonPath))
    return parsedGraph.nodes.map((node) => ({
      ...node,
      dragHandle: isCoarsePointer ? AUTHORING_NODE_DRAG_HANDLE_SELECTOR : undefined,
      data: {
        ...node.data,
        markedJsonPaths: node.data.editableInputs.map((input) => input.jsonPath ?? `${node.id}.inputs.${input.key}`).filter((path) => markedPathSet.has(path)),
        selectedJsonPath: selectedField && selectedFieldNodeId === node.id ? selectedField.jsonPath : null,
        searchQuery,
        searchMatched: matchedIdSet.has(node.id),
        searchCurrent: node.id === activeGraphSearchNodeId,
        issues: checkIssuesByNode.get(node.id),
        unused: unusedNodeIds.has(node.id),
      },
    }))
  }, [activeGraphSearchNodeId, checkIssuesByNode, graphSearchMatches, isCoarsePointer, draft.markedFields, parsedGraph, searchQuery, selectedField, selectedFieldNodeId, unusedNodeIds])

  /** Add the commonly exposed inputs that are not fields yet; returns how many were added. */
  const addSuggestedFields = useCallback(() => {
    if (!parsedGraph) return 0
    const graph = { ...parsedGraph, nodes: parsedGraph.nodes.map((node) => ({ ...node, data: { ...node.data, unused: unusedNodeIds.has(node.id) } })) }
    const suggested = suggestWorkflowMarkedFields(graph, new Set(draft.markedFields.map((field) => field.jsonPath)))
    if (suggested.length > 0) setDraft((current) => ({ ...current, markedFields: [...current.markedFields, ...suggested.filter((field) => !current.markedFields.some((item) => item.jsonPath === field.jsonPath))] }))
    return suggested.length
  }, [draft.markedFields, parsedGraph, unusedNodeIds])
  const handleSuggestFields = () => {
    const added = addSuggestedFields()
    showSnackbar({
      message: added > 0
        ? t({ ko: '자주 쓰는 필드 {count}개를 추가했어.', en: 'Added {count} common fields.' }, { count: added })
        : t({ ko: '더 추가할 만한 필드가 없어.', en: 'No more common fields to add.' }),
      tone: 'info',
    })
  }

  // After a load settles: suggest fields for an empty list, or report fields the new workflow no longer has.
  useEffect(() => {
    const pending = pendingLoadedJsonRef.current
    if (!pending || pending !== draft.workflowJson || !parsedGraph || !workflowCheckSettled) return
    pendingLoadedJsonRef.current = null
    if (draft.markedFields.length === 0) {
      const added = addSuggestedFields()
      if (added > 0) showSnackbar({ message: t({ ko: '자주 쓰는 필드 {count}개를 넣었어.', en: 'Added {count} common fields.' }, { count: added }), tone: 'info' })
    } else if (missingFieldIds.size > 0) {
      showSnackbar({ message: t({ ko: '필드 {count}개가 새 워크플로에 없어.', en: '{count} fields are not in the new workflow.' }, { count: missingFieldIds.size }), tone: 'error' })
    }
  }, [addSuggestedFields, draft.markedFields.length, draft.workflowJson, missingFieldIds, parsedGraph, showSnackbar, t, workflowCheckSettled])

  const reactFlowColorMode: 'light' | 'dark' | 'system' = appearanceQuery.data?.themeMode ?? DEFAULT_APPEARANCE_SETTINGS.themeMode
  const authoringMiniMapNodeColor = reactFlowColorMode === 'light' ? '#d9480f' : '#f95e14'
  const authoringMiniMapMaskColor = reactFlowColorMode === 'light' ? 'rgba(255, 255, 255, 0.62)' : 'rgba(8, 10, 14, 0.58)'
  const authoringMiniMapBgColor = reactFlowColorMode === 'light' ? '#f5f6f8' : '#141414'

  const centerGraphOnNode = useCallback((nodeId: string, zoom = 0.88) => {
    const targetNode = parsedGraph?.nodes.find((node) => node.id === nodeId)
    if (!authoringFlowInstance || !targetNode) return
    void authoringFlowInstance.setCenter(targetNode.position.x + 130, targetNode.position.y + 90, { zoom, duration: 240 })
  }, [authoringFlowInstance, parsedGraph])

  useEffect(() => {
    if (!open || editorTab !== 'graph' || !parsedGraph || !authoringFlowInstance) return
    const rafId = window.requestAnimationFrame(() => { void authoringFlowInstance.fitView(INITIAL_AUTHORING_FIT_VIEW_OPTIONS) })
    return () => window.cancelAnimationFrame(rafId)
  }, [authoringFlowInstance, open, parsedGraph, editorTab])
  useEffect(() => {
    if (editorTab !== 'json' || searchQuery.trim().length === 0 || jsonSearchMatches.length === 0) return
    const textareaElement = jsonTextareaRef.current
    if (!textareaElement) return
    const matchIndex = jsonSearchMatches[Math.min(searchIndex, jsonSearchMatches.length - 1)]
    textareaElement.focus({ preventScroll: true })
    textareaElement.setSelectionRange(matchIndex, matchIndex + searchQuery.trim().length)
  }, [searchIndex, searchQuery, jsonSearchMatches, editorTab])
  useEffect(() => {
    if (activeGraphSearchNodeId) centerGraphOnNode(activeGraphSearchNodeId)
  }, [activeGraphSearchNodeId, centerGraphOnNode])
  /** Step through the nodes the server check flagged. */
  const focusNextCheckIssue = () => {
    const ids = serverCheckSummary?.issueNodeIds ?? []
    if (ids.length === 0) return
    const nodeId = ids[checkIssueCursorRef.current % ids.length]
    checkIssueCursorRef.current += 1
    if (editorTab !== 'graph') setEditorTabState('graph')
    centerGraphOnNode(nodeId)
  }

  const activeSearchCount = editorTab === 'json' ? jsonSearchMatches.length : graphSearchMatches.length
  const setSearchQuery = (value: string) => {
    setSearchQueryState(value)
    setSearchIndex(0)
  }
  const setEditorTab = (tab: ComfyWorkflowEditorTab) => {
    setEditorTabState(tab)
    setSearchIndex(0)
  }
  const stepSearch = (direction: 1 | -1) => setSearchIndex((current) => (
    activeSearchCount === 0 ? 0 : (current + direction + activeSearchCount) % activeSearchCount
  ))

  const handleFieldSelect = (fieldId: string) => {
    const field = draft.markedFields.find((item) => item.id === fieldId)
    if (field) setSelectedFieldPath(field.jsonPath)
  }
  const handleFieldLocate = (fieldId: string) => {
    const field = markedFieldsWithNodeSources.find((item) => item.id === fieldId)
    const nodeId = field ? resolveWorkflowMarkedFieldNodeSource(field).nodeId : null
    if (nodeId) centerGraphOnNode(nodeId)
  }
  const handleFieldPatch = (fieldId: string, patch: Partial<WorkflowMarkedField>) => setDraft((current) => ({
    ...current,
    markedFields: current.markedFields.map((field) => field.id === fieldId ? applyMarkedFieldPatch(field, patch) : field),
  }))
  const handleFieldRemove = (fieldId: string) => {
    const removedPath = draft.markedFields.find((field) => field.id === fieldId)?.jsonPath
    setDraft((current) => ({ ...current, markedFields: current.markedFields.filter((field) => field.id !== fieldId) }))
    setSelectedFieldPath((current) => current === removedPath ? null : current)
  }
  const handleReorderMarkedField = (sourceFieldId: string, targetFieldId: string) => setDraft((current) => ({
    ...current,
    markedFields: reorderWorkflowMarkedFieldWithinGroup(current.markedFields, sourceFieldId, targetFieldId),
  }))
  const handleReorderMarkedFieldGroup = (sourceGroupKey: string, targetGroupKey: string) => setDraft((current) => ({
    ...current,
    markedFields: reorderWorkflowMarkedFieldGroup(current.markedFields, sourceGroupKey, targetGroupKey),
  }))

  const getSaveError = () => {
    if (draft.name.trim().length === 0) return t({ ko: '워크플로우 이름이 필요해.', en: 'Workflow name is required.' })
    if (draft.workflowJson.trim().length === 0 || jsonError) return t({ ko: '유효한 workflow JSON이 필요해.', en: 'A valid workflow JSON is required.' })
    if (uiConversionError) return uiConversionError
    if (isUiWorkflow) return t({ ko: '일반 워크플로를 API 형식으로 바꾸는 중이야.', en: 'Still converting the workflow to the API format.' })
    for (const field of draft.markedFields) {
      if (field.type !== 'number') continue
      const label = field.label || field.id
      if ([field.min, field.max, field.step].some((value) => value !== undefined && (typeof value !== 'number' || !Number.isFinite(value)))) {
        return t({ ko: '숫자 필드 제한값이 올바르지 않아: {label}', en: 'Invalid number limits: {label}' }, { label })
      }
      if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
        return t({ ko: '숫자 필드의 최소값은 최대값보다 클 수 없어: {label}', en: 'Minimum is above maximum: {label}' }, { label })
      }
      if (field.step !== undefined && field.step <= 0) {
        return t({ ko: '숫자 필드의 단계는 0보다 커야 해: {label}', en: 'Step must be above 0: {label}' }, { label })
      }
    }
    if (draft.isPublicPage && slugifyPublicWorkflow(draft.publicSlug).length === 0) return t({ ko: '공용 페이지 주소가 필요해.', en: 'Public page address is required.' })
    return null
  }

  const handleSave = async (revision?: string, propagate = false) => {
    if (isSaving) { if (propagate) throw new Error('워크플로를 저장하고 있어.'); return }
    const saveError = getSaveError()
    if (saveError) {
      if (propagate) throw new Error(saveError)
      showSnackbar({ message: saveError, tone: 'error' })
      return
    }
    try {
      setIsSaving(true)
      const payload = buildComfyWorkflowPayload({
        artifactDirectoryMode: draft.artifactDirectoryMode,
        artifactRootPath: draft.artifactRootPath,
        color: initialData?.workflow.color ?? '#2196f3',
        kind: draft.kind,
        description: draft.description,
        isActive: initialData?.workflow.is_active ?? true,
        isPublicPage: draft.isPublicPage,
        markedFields: markedFieldsWithNodeSources,
        publicQueueMaxCount: draft.publicQueueMaxCount,
        publicQueueRoleLimits: draft.publicQueueRoleLimits,
        publicSlug: draft.publicSlug,
        resultViewMode: draft.resultViewMode,
        workflowJson: draft.workflowJson,
        workflowName: draft.name,
      })
      let workflowId = initialData?.workflow.id
      if (mode === 'edit' && workflowId) {
        await updateGenerationWorkflow(workflowId, payload, revision)
      } else {
        const response = await createGenerationWorkflow(payload)
        workflowId = response.data.id
      }
      setSavedSnapshot(JSON.stringify(draft))
      showSnackbar({ message: mode === 'edit' ? t({ ko: 'ComfyUI 워크플로우를 수정했어.', en: 'Updated the ComfyUI workflow.' }) : t({ ko: 'ComfyUI 워크플로우를 저장했어.', en: 'Saved the ComfyUI workflow.' }), tone: 'info' })
      onSaved?.(workflowId as number)
      onClose()
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, mode === 'edit' ? t({ ko: '워크플로우 수정에 실패했어.', en: 'Failed to update the workflow.' }) : t({ ko: '워크플로우 저장에 실패했어.', en: 'Failed to save the workflow.' })), tone: 'error' })
      if (propagate) throw error
    } finally {
      setIsSaving(false)
    }
  }

  useComfyAuthorChatPage({
    enabled: open && !isSaving, dirty: isDirty, graph: parsedGraph, saved: mode === 'edit' ? initialData?.workflow ?? null : null,
    draft: { name: draft.name, description: draft.description, workflowJson: draft.workflowJson, markedFields: draft.markedFields, isPublicPage: draft.isPublicPage, publicSlug: draft.publicSlug, publicQueueMaxCount: draft.publicQueueMaxCount },
    setDraft: (next) => {
      setDraft((current) => ({ ...current, name: next.name, description: next.description, workflowJson: next.workflowJson, markedFields: next.markedFields, isPublicPage: next.isPublicPage, publicSlug: next.publicSlug, publicQueueMaxCount: next.publicQueueMaxCount }))
      setJsonError(getJsonError(next.workflowJson, invalidJsonMessage))
    },
    save: (revision) => handleSave(revision, true),
  })

  return {
    activeSearchCount, authoringMiniMapBgColor, authoringMiniMapMaskColor, authoringMiniMapNodeColor,
    dropdownListNames: dropdownLists.map((list) => list.name), draft, editorTab, graphNodes, handleFieldLocate,
    handleFieldPatch, handleFieldRemove, handleFieldSelect, handleFileUpload, handleReorderMarkedField,
    handleReorderMarkedFieldGroup, handleSave, handleWorkflowJsonChange, isCoarsePointer, isConvertingUiWorkflow, isDirty, isSaving,
    jsonError: jsonError ?? uiConversionError, focusNextCheckIssue, graphLayout, handleSuggestFields, missingFieldIds,
    serverCheckSummary, toggleGraphLayout,
    jsonTextareaRef, markedFieldsWithNodeSources, parsedGraph, patchDraft, reactFlowColorMode, roleLimitGroups,
    searchIndex, searchQuery, selectedField, setAuthoringFlowInstance, setEditorTab, setSearchQuery, stepSearch,
  }
}
