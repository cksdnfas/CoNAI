import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { ChevronDown, ChevronUp, Search, Upload } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { SettingsField, SettingsModalBody, SettingsModalFooter, SettingsSection, SettingsToggleRow } from '@/features/settings/components/settings-primitives'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { getPermissionGroupDisplayName } from '@/features/settings/components/security-ui-text'
import { DEFAULT_APPEARANCE_SETTINGS } from '@/lib/appearance'
import { useI18n } from '@/i18n'
import { useGlobalAppearanceSettingsQuery } from '@/lib/use-global-appearance-settings'
import { useIsCoarsePointer } from '@/lib/use-is-coarse-pointer'
import type { CustomDropdownList, GenerationWorkflowDetail, WorkflowMarkedField, WorkflowRoleQueueLimits } from '@/lib/api-image-generation-types'
import { createGenerationWorkflow, updateGenerationWorkflow } from '@/lib/api-image-generation-workflows'
import { listAuthPermissionGroups } from '@/lib/api-auth'
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
import {
  enrichWorkflowMarkedFieldsWithNodeSources,
  reorderWorkflowMarkedFieldGroup,
  reorderWorkflowMarkedFieldWithinGroup,
} from '../workflow-marked-field-groups'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'

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

function clampPublicQueueMaxCount(value: string) {
  const parsed = Math.trunc(Number(value))
  if (!Number.isFinite(parsed)) {
    return 32
  }

  return Math.min(32, Math.max(1, parsed))
}

const PUBLIC_QUEUE_ROLE_LIMIT_MAX = 999

/** 빈 문자열(무제한)·잘못된 값은 항목에서 제외하고, 남는 항목이 없으면 null. */
function buildPublicQueueRoleLimitsPayload(draft: Record<string, string>): WorkflowRoleQueueLimits | null {
  const limits: WorkflowRoleQueueLimits = {}
  for (const [groupKey, rawValue] of Object.entries(draft)) {
    if (rawValue.trim().length === 0) {
      continue
    }

    const parsed = Math.trunc(Number(rawValue))
    if (!Number.isFinite(parsed)) {
      continue
    }

    limits[groupKey] = Math.min(PUBLIC_QUEUE_ROLE_LIMIT_MAX, Math.max(0, parsed))
  }

  return Object.keys(limits).length > 0 ? limits : null
}

function roleLimitsToDraft(limits: WorkflowRoleQueueLimits | null | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(limits ?? {}).map(([groupKey, limit]) => [groupKey, String(limit)]))
}

function getMarkedFieldNumericDefinitionError(markedFields: WorkflowMarkedField[]) {
  for (const field of markedFields) {
    if (field.type !== 'number') {
      continue
    }

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

export function ComfyWorkflowAuthoringModal({
  open,
  mode = 'create',
  initialData,
  dropdownLists,
  onClose,
  onSaved,
}: ComfyWorkflowAuthoringModalProps) {
  const { showSnackbar } = useSnackbar()
  const { t, formatNumber, language } = useI18n()
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

  // 등급별 제한 입력 행을 그리기 위한 권한 그룹 목록. 관리자 전용 API라 403이면 기본 그룹으로 폴백한다.
  const permissionGroupsQuery = useQuery({
    queryKey: ['auth-permission-groups', 'all'],
    queryFn: listAuthPermissionGroups,
    enabled: open && isPublicPage,
    staleTime: 60_000,
    retry: false,
  })

  const roleLimitGroups = useMemo(() => {
    // 익명은 로그인 없이 대기열을 만들 수 없으므로 제외한다.
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

    // 이미 저장된 제한에만 존재하는 그룹 키도 편집할 수 있게 남긴다.
    for (const groupKey of Object.keys(publicQueueRoleLimits)) {
      if (!seenGroupKeys.has(groupKey)) {
        rows.push({ groupKey, name: null })
        seenGroupKeys.add(groupKey)
      }
    }

    return rows
  }, [permissionGroupsQuery.data, publicQueueRoleLimits])

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
      setJsonError(getErrorMessage(error, t({ ko: '유효한 workflow JSON이 아니야.', en: 'This is not a valid workflow JSON.' })))
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
    if (workflowJson.trim().length === 0 || jsonError) {
      return null
    }

    try {
      return parseWorkflowGraph({
        workflowJson,
        onAddField: handleAddField,
      })
    } catch {
      return null
    }
  }, [handleAddField, jsonError, workflowJson])

  const workflowNodeSources = useMemo(
    () => parsedGraph?.nodes.map((node) => ({ id: node.id, title: node.data.title })) ?? [],
    [parsedGraph],
  )
  const markedFieldsWithNodeSources = useMemo(
    () => enrichWorkflowMarkedFieldsWithNodeSources(markedFields, workflowNodeSources),
    [markedFields, workflowNodeSources],
  )

  const graphSearchMatches = useMemo(() => {
    if (!parsedGraph) {
      return []
    }

    return findAuthoringGraphMatches(parsedGraph.nodes, graphSearchQuery)
  }, [graphSearchQuery, parsedGraph])

  const jsonSearchMatches = useMemo(() => {
    const normalizedQuery = graphSearchQuery.trim().toLowerCase()
    if (!normalizedQuery || workflowJson.length === 0) {
      return []
    }

    const normalizedJson = workflowJson.toLowerCase()
    const matches: number[] = []
    let searchFrom = 0

    while (searchFrom < normalizedJson.length) {
      const nextIndex = normalizedJson.indexOf(normalizedQuery, searchFrom)
      if (nextIndex < 0) {
        break
      }
      matches.push(nextIndex)
      searchFrom = nextIndex + Math.max(1, normalizedQuery.length)
    }

    return matches
  }, [graphSearchQuery, workflowJson])

  const activeGraphSearchNodeId = graphSearchMatches.length > 0
    ? graphSearchMatches[Math.min(graphSearchIndex, graphSearchMatches.length - 1)]
    : null

  const graphNodes = useMemo(() => {
    if (!parsedGraph) {
      return []
    }

    const matchedIdSet = new Set(graphSearchMatches)
    const markedPathSet = new Set(markedFields.map((field) => field.jsonPath))
    return parsedGraph.nodes.map((node) => ({
      ...node,
      dragHandle: isCoarsePointer ? AUTHORING_NODE_DRAG_HANDLE_SELECTOR : undefined,
      data: {
        ...node.data,
        markedJsonPaths: node.data.editableInputs
          .map((input) => input.jsonPath ?? `${node.id}.inputs.${input.key}`)
          .filter((path) => markedPathSet.has(path)),
        searchMatched: matchedIdSet.has(node.id),
        searchCurrent: node.id === activeGraphSearchNodeId,
      },
    }))
  }, [activeGraphSearchNodeId, graphSearchMatches, isCoarsePointer, markedFields, parsedGraph])

  const reactFlowColorMode: 'light' | 'dark' | 'system' =
    appearanceQuery.data?.themeMode ?? DEFAULT_APPEARANCE_SETTINGS.themeMode
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
  }, [graphSearchQuery, workflowEditorTab])

  useEffect(() => {
    if (workflowEditorTab !== 'json' || graphSearchQuery.trim().length === 0 || jsonSearchMatches.length === 0) {
      return
    }

    const textareaElement = jsonTextareaRef.current
    if (!textareaElement) {
      return
    }

    const matchIndex = jsonSearchMatches[Math.min(graphSearchIndex, jsonSearchMatches.length - 1)]
    const selectionEnd = matchIndex + graphSearchQuery.trim().length

    textareaElement.focus({ preventScroll: true })
    textareaElement.setSelectionRange(matchIndex, selectionEnd)
  }, [graphSearchIndex, graphSearchQuery, jsonSearchMatches, workflowEditorTab])

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
  const activeSearchMatches = workflowEditorTab === 'json' ? jsonSearchMatches : graphSearchMatches
  const activeSearchCount = activeSearchMatches.length
  const searchPlaceholder = workflowEditorTab === 'json'
    ? t({ ko: 'Workflow JSON 검색', en: 'Search workflow JSON' })
    : t({ ko: '노드 title / class_type / id 검색', en: 'Search node title / class_type / id' })

  const handleFieldPatch = (fieldId: string, patch: Partial<WorkflowMarkedField>) => {
    setMarkedFields((current) => current.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)))
  }

  const handleFieldRemove = (fieldId: string) => {
    setMarkedFields((current) => current.filter((field) => field.id !== fieldId))
    setExpandedFieldIds((current) => current.filter((item) => item !== fieldId))
  }

  const handleFieldExpandToggle = (fieldId: string) => {
    setExpandedFieldIds((current) => (
      current.includes(fieldId)
        ? current.filter((item) => item !== fieldId)
        : [...current, fieldId]
    ))
  }

  const handleReorderMarkedField = (sourceFieldId: string, targetFieldId: string) => {
    setMarkedFields((current) => reorderWorkflowMarkedFieldWithinGroup(current, sourceFieldId, targetFieldId))
  }

  const handleReorderMarkedFieldGroup = (sourceGroupKey: string, targetGroupKey: string) => {
    setMarkedFields((current) => reorderWorkflowMarkedFieldGroup(current, sourceGroupKey, targetGroupKey))
  }

  const handleSave = async () => {
    if (isSaving) {
      return
    }

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

    const normalizedPublicSlug = slugifyPublicWorkflow(publicSlug)
    if (isPublicPage && normalizedPublicSlug.length === 0) {
      showSnackbar({ message: t({ ko: '공용 페이지 slug가 필요해.', en: 'Public page slug is required.' }), tone: 'error' })
      return
    }

    try {
      setIsSaving(true)

      const payload = {
        name: workflowName.trim(),
        description: workflowDescription.trim() || undefined,
        workflow_json: workflowJson,
        marked_fields: enrichWorkflowMarkedFieldsWithNodeSources(markedFields, workflowNodeSources),
        is_active: initialData?.workflow.is_active ?? true,
        is_public_page: isPublicPage,
        public_slug: isPublicPage ? normalizedPublicSlug : null,
        public_queue_max_count: isPublicPage ? clampPublicQueueMaxCount(publicQueueMaxCount) : null,
        public_queue_role_limits: isPublicPage ? buildPublicQueueRoleLimitsPayload(publicQueueRoleLimits) : null,
        result_view_mode: resultViewMode,
        artifact_directory_mode: artifactDirectoryMode,
        artifact_root_path: artifactRootPath.trim() || null,
        color: initialData?.workflow.color ?? '#2196f3',
      }

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

  const modalTitle = mode === 'edit' ? t({ ko: 'ComfyUI Workflow 수정', en: 'Edit ComfyUI Workflow' }) : t({ ko: 'ComfyUI Workflow 등록', en: 'Register ComfyUI Workflow' })
  const submitLabel = mode === 'edit' ? t({ ko: '워크플로우 저장', en: 'Save workflow' }) : t({ ko: '워크플로우 등록', en: 'Register workflow' })

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title={modalTitle}
      widthClassName="max-w-[1180px]"
    >
      <SettingsModalBody className="space-y-5">
        <SettingsSection heading={t({ ko: '기본 정보', en: 'Basic information' })}>
          <div className="grid gap-4">
            <SettingsField label={t({ ko: '이름', en: 'Name' })}>
              <Input
                variant="settings"
                value={workflowName}
                onChange={(event) => setWorkflowName(event.target.value)}
                placeholder="ComfyUI Workflow"
              />
            </SettingsField>

            <SettingsField label={t({ ko: '설명', en: 'Description' })}>
              <Textarea
                variant="settings"
                rows={4}
                value={workflowDescription}
                onChange={(event) => setWorkflowDescription(event.target.value)}
                placeholder={t({ ko: '선택', en: 'Optional' })}
              />
            </SettingsField>

            <SettingsToggleRow>
              <input
                type="checkbox"
                checked={isPublicPage}
                onChange={(event) => setIsPublicPage(event.target.checked)}
              />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">{t({ ko: '공용 페이지 사용', en: 'Use public page' })}</div>
              </div>
            </SettingsToggleRow>

            {isPublicPage ? (
              <>
                <SettingsField label={t({ ko: '공용 slug', en: 'Public slug' })}>
                  <Input
                    variant="settings"
                    value={publicSlug}
                    onChange={(event) => setPublicSlug(slugifyPublicWorkflow(event.target.value))}
                    placeholder="character-poster-generator"
                  />
                </SettingsField>

                <SettingsField label={t({ ko: '공용 1회 요청 상한', en: 'Public per-request limit' })}>
                  <NumberStepperInput
                    variant="settings"

                    min={1}
                    max={32}
                    value={publicQueueMaxCount}
                    onValueCommit={(nextValue) => setPublicQueueMaxCount(nextValue)}
                    onBlur={() => setPublicQueueMaxCount(String(clampPublicQueueMaxCount(publicQueueMaxCount)))}
                  />
                </SettingsField>

                <div className="grid gap-2.5 rounded-sm border border-border/70 px-3 py-3">
                  <div className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                    {t({ ko: '등급별 동시 대기열 제한', en: 'Per-role active queue limit' })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t({
                      ko: '각 등급의 회원 한 명이 이 워크플로우에서 동시에 유지할 수 있는 대기열 개수야. 등급 전체 합산이 아니라 회원별 제한이고, 비워두면 무제한이야. 0은 등록 금지야.',
                      en: 'How many active queue jobs a single member of each role can keep on this workflow. The limit applies per member, not to the whole role. Leave empty for unlimited; 0 blocks the role.',
                    })}
                  </div>
                  {roleLimitGroups.map((group) => (
                    <div key={group.groupKey} className="flex items-center justify-between gap-3">
                      <span className="min-w-0 truncate text-sm text-foreground">
                        {getPermissionGroupDisplayName(language, group.groupKey, group.name)}
                      </span>
                      <NumberStepperInput
                        variant="settings"
                        min={0}
                        max={999}
                        allowEmpty
                        className="w-44 shrink-0"
                        value={publicQueueRoleLimits[group.groupKey] ?? ''}
                        placeholder={t({ ko: '무제한', en: 'Unlimited' })}
                        aria-label={t(
                          { ko: '{name} 동시 대기열 제한', en: '{name} active queue limit' },
                          { name: getPermissionGroupDisplayName(language, group.groupKey, group.name) },
                        )}
                        onValueCommit={(nextValue) => setPublicQueueRoleLimits((current) => ({ ...current, [group.groupKey]: nextValue }))}
                      />
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            <SettingsField label={t({ ko: '결과 표시 방식', en: 'Result view' })}>
              <Select
                variant="settings"
                value={resultViewMode}
                onChange={(event) => setResultViewMode(event.target.value as 'history' | 'artifact_explorer')}
              >
                <option value="history">{t({ ko: '히스토리 뷰어', en: 'History viewer' })}</option>
                <option value="artifact_explorer">{t({ ko: '탐색형 뷰어', en: 'Explorer viewer' })}</option>
              </Select>
            </SettingsField>

            {resultViewMode === 'artifact_explorer' ? (
              <>
                <SettingsField label={t({ ko: '결과 저장 방식', en: 'Result storage mode' })}>
                  <Select
                    variant="settings"
                    value={artifactDirectoryMode}
                    onChange={(event) => setArtifactDirectoryMode(event.target.value as 'shared' | 'per_run')}
                  >
                    <option value="shared">{t({ ko: '공유 폴더', en: 'Shared folder' })}</option>
                    <option value="per_run">{t({ ko: '실행별 폴더', en: 'Folder per run' })}</option>
                  </Select>
                </SettingsField>

                <SettingsField label={t({ ko: '결과 저장 루트 경로', en: 'Result storage root path' })}>
                  <Input
                    variant="settings"
                    value={artifactRootPath}
                    onChange={(event) => setArtifactRootPath(event.target.value)}
                    placeholder={t({ ko: '기본값: runtime/artifacts/comfy-workflows/<workflow>', en: 'Default: runtime/artifacts/comfy-workflows/<workflow>' })}
                  />
                </SettingsField>
              </>
            ) : null}
          </div>
        </SettingsSection>

        <SettingsSection
          heading={
            <SegmentedControl
              value={workflowEditorTab}
              items={[
                { value: 'graph', label: t({ ko: '그래프 보기', en: 'Graph View' }) },
                { value: 'json', label: 'Workflow JSON' },
              ]}
              onChange={(nextTab) => setWorkflowEditorTab(nextTab as 'json' | 'graph')}
              size="sm"
            />
          }
          bodyClassName="space-y-0 px-0 py-0"
          headerClassName="flex-col items-stretch lg:flex-row lg:items-center"
          actions={
            <div className="flex w-full flex-wrap items-center justify-start gap-2 lg:w-auto lg:justify-end">
              <div className="relative min-w-0 basis-full flex-1 sm:basis-auto sm:min-w-[280px]">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  variant="settings"
                  value={graphSearchQuery}
                  onChange={(event) => setGraphSearchQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                  className="pl-8"
                />
              </div>
              <div className="text-xs text-muted-foreground">
                {graphSearchQuery.trim().length > 0 ? t({ ko: '{count}개', en: '{count}' }, { count: formatNumber(activeSearchCount) }) : t({ ko: '검색 없음', en: 'No search' })}
              </div>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                disabled={activeSearchCount === 0}
                onClick={() => setGraphSearchIndex((current) => (
                  activeSearchCount === 0
                    ? 0
                    : (current - 1 + activeSearchCount) % activeSearchCount
                ))}
                title={t({ ko: '이전 검색 결과', en: 'Previous search result' })}
                aria-label={t({ ko: '이전 검색 결과', en: 'Previous search result' })}
              >
                <ChevronUp className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                disabled={activeSearchCount === 0}
                onClick={() => setGraphSearchIndex((current) => (
                  activeSearchCount === 0
                    ? 0
                    : (current + 1) % activeSearchCount
                ))}
                title={t({ ko: '다음 검색 결과', en: 'Next search result' })}
                aria-label={t({ ko: '다음 검색 결과', en: 'Next search result' })}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
              <Button type="button" size="sm" variant="outline" asChild>
                <label className="cursor-pointer">
                  <Upload className="h-4 w-4" />
                  {t({ ko: '업로드', en: 'Upload' })}
                  <input type="file" accept=".json,application/json" hidden onChange={(event) => void handleFileUpload(event.target.files?.[0])} />
                </label>
              </Button>
            </div>
          }
        >
          {workflowEditorTab === 'json' ? (
            <div className="space-y-0">
              <Textarea
                ref={jsonTextareaRef}
                variant="settings"
                rows={12}
                value={workflowJson}
                onChange={(event) => handleWorkflowJsonChange(event.target.value)}
                placeholder="ComfyUI API workflow JSON"
                className="min-h-[520px] rounded-none border-0 bg-transparent px-4 py-4 font-mono text-xs focus:ring-0"
              />

              {jsonError ? <div className="border-t border-border/70 px-4 py-3 text-xs text-[#ffb4ab]">{jsonError}</div> : null}
            </div>
          ) : (
            <div className="px-4 py-4">
              <div className="mx-auto w-full max-w-[980px]">
                <div className="h-[620px] overflow-hidden rounded-sm border border-border/85 bg-surface-lowest">
                  {parsedGraph ? (
                    <ReactFlowProvider>
                      <ReactFlow<AuthoringNode, AuthoringEdge>
                        className={isCoarsePointer ? 'theme-graph-flow touch-scroll-safe' : 'theme-graph-flow'}
                        nodes={graphNodes}
                        edges={parsedGraph.edges}
                        nodeTypes={nodeTypes}
                        onInit={setAuthoringFlowInstance}
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
                      {t({ ko: '유효한 workflow JSON을 넣으면 그래프가 보여.', en: 'Enter a valid workflow JSON to show the graph.' })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </SettingsSection>

        <ComfyWorkflowMarkedFieldsEditor
          markedFields={markedFieldsWithNodeSources}
          expandedFieldIds={expandedFieldIds}
          dropdownListNames={dropdownListNames}
          listClassName="max-h-[520px]"
          onFieldPatch={handleFieldPatch}
          onFieldRemove={handleFieldRemove}
          onFieldExpandToggle={handleFieldExpandToggle}
          onReorderMarkedField={handleReorderMarkedField}
          onReorderMarkedFieldGroup={handleReorderMarkedFieldGroup}
        />

        <SettingsModalFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSaving}>{t({ ko: '취소', en: 'Cancel' })}</Button>
          <Button type="button" onClick={() => void handleSave()} disabled={isSaving || workflowName.trim().length === 0 || workflowJson.trim().length === 0 || jsonError !== null}>
            {isSaving ? t({ ko: '저장 중…', en: 'Saving…' }) : submitLabel}
          </Button>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
  )
}
