import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  createComfyModuleFromWorkflow,
  createGenerationComfyUIServer,
  createGenerationWorkflow,
  deleteGenerationComfyUIServer,
  deleteGenerationWorkflow,
  generateComfyUIImage,
  getGenerationComfyUIServers,
  getGenerationCustomDropdownLists,
  getGenerationWorkflow,
  getGenerationWorkflows,
  testGenerationComfyUIServer,
  updateGenerationComfyUIServer,
  type GenerationWorkflowDetail,
} from '@/lib/api'
import {
  buildWorkflowDraft,
  buildWorkflowPromptData,
  DEFAULT_COMFYUI_SERVER_FORM,
  getErrorMessage,
  hasWorkflowFieldValue,
  type ComfyUIServerFormDraft,
  type ComfyUIServerTestState,
  type ModuleFieldOption,
  type SelectedImageDraft,
  type WorkflowFieldDraftValue,
} from '../image-generation-shared'
import { ComfyDropdownListsSection, ComfyServerListSection, ComfyWorkflowListSection } from './comfy-home-sections'
import { ComfyModuleSaveModal } from './comfy-module-save-modal'
import { ComfyServerRegistrationModal } from './comfy-server-registration-modal'
import { ComfyWorkflowAuthoringModal } from './comfy-workflow-authoring-modal'
import { ComfyWorkflowControllerPanel } from './comfy-workflow-controller-panel'

type ComfyGenerationPanelProps = {
  refreshNonce: number
  onHistoryRefresh: () => void
  selectedWorkflowId: number | null
  onSelectedWorkflowChange: (workflowId: number | null) => void
  headerPortalTargetId?: string
}

type ComfyWorkflowEditorState = {
  workflow: GenerationWorkflowDetail
}

/** Render the ComfyUI home/workflow views and coordinate server-targeted generation. */
export function ComfyGenerationPanel({
  refreshNonce,
  onHistoryRefresh,
  selectedWorkflowId,
  onSelectedWorkflowChange,
  headerPortalTargetId,
}: ComfyGenerationPanelProps) {
  const { showSnackbar } = useSnackbar()
  const [isComfyGenerating, setIsComfyGenerating] = useState(false)
  const [isComfyServerSubmitting, setIsComfyServerSubmitting] = useState(false)
  const [comfyServerForm, setComfyServerForm] = useState<ComfyUIServerFormDraft>(DEFAULT_COMFYUI_SERVER_FORM)
  const [editingServerId, setEditingServerId] = useState<number | null>(null)
  const [comfyServerTests, setComfyServerTests] = useState<Record<number, ComfyUIServerTestState>>({})
  const [selectedServerId, setSelectedServerId] = useState<string>('')
  const [workflowDraft, setWorkflowDraft] = useState<Record<string, WorkflowFieldDraftValue>>({})
  const [isAuthoringModalOpen, setIsAuthoringModalOpen] = useState(false)
  const [workflowEditorState, setWorkflowEditorState] = useState<ComfyWorkflowEditorState | null>(null)
  const [isServerModalOpen, setIsServerModalOpen] = useState(false)
  const [isModuleSaveModalOpen, setIsModuleSaveModalOpen] = useState(false)
  const [isSavingComfyModule, setIsSavingComfyModule] = useState(false)
  const [comfyModuleName, setComfyModuleName] = useState('')
  const [comfyModuleDescription, setComfyModuleDescription] = useState('')
  const [comfyExposedFieldIds, setComfyExposedFieldIds] = useState<string[]>([])
  const activeWorkflowId = selectedWorkflowId !== null ? String(selectedWorkflowId) : ''

  const workflowsQuery = useQuery({
    queryKey: ['image-generation-workflows'],
    queryFn: () => getGenerationWorkflows(true),
  })

  const serversQuery = useQuery({
    queryKey: ['image-generation-comfyui-servers'],
    queryFn: () => getGenerationComfyUIServers(true),
  })

  const dropdownListsQuery = useQuery({
    queryKey: ['image-generation-custom-dropdown-lists'],
    queryFn: () => getGenerationCustomDropdownLists(),
  })

  const selectedWorkflow = useMemo(
    () => workflowsQuery.data?.find((workflow) => workflow.id === selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflowsQuery.data],
  )

  const dropdownListMap = useMemo(
    () => new Map((dropdownListsQuery.data ?? []).map((list) => [list.name, list])),
    [dropdownListsQuery.data],
  )

  const selectedWorkflowFields = useMemo(() => {
    if (!selectedWorkflow) {
      return []
    }

    return (selectedWorkflow.marked_fields ?? []).map((field) => {
      if (field.dropdown_list_name) {
        const dropdownList = dropdownListMap.get(field.dropdown_list_name)
        if (dropdownList) {
          return {
            ...field,
            type: 'select' as const,
            options: dropdownList.items,
          }
        }
      }

      return field
    })
  }, [dropdownListMap, selectedWorkflow])

  const activeServers = useMemo(() => serversQuery.data ?? [], [serversQuery.data])
  const connectedServers = activeServers.filter((server) => comfyServerTests[server.id]?.status?.is_connected === true)
  const comfyModuleFieldOptions = useMemo<ModuleFieldOption[]>(() => (
    selectedWorkflowFields.map((field) => ({
      key: field.id,
      label: field.label,
      dataType: field.type === 'number' ? 'number' : field.type === 'image' ? 'image' : 'text',
      options: field.options,
    }))
  ), [selectedWorkflowFields])

  useEffect(() => {
    if (refreshNonce === 0) {
      return
    }

    void Promise.all([workflowsQuery.refetch(), serversQuery.refetch(), dropdownListsQuery.refetch()])
  }, [dropdownListsQuery, refreshNonce, serversQuery, workflowsQuery])

  useEffect(() => {
    if (!selectedWorkflow) {
      setWorkflowDraft({})
      setComfyModuleName('')
      setComfyModuleDescription('')
      setComfyExposedFieldIds([])
      setIsModuleSaveModalOpen(false)
      return
    }

    setWorkflowDraft(buildWorkflowDraft(selectedWorkflowFields))
    setComfyModuleName(`${selectedWorkflow.name} 모듈`)
    setComfyModuleDescription(selectedWorkflow.description ?? '')
    setComfyExposedFieldIds(selectedWorkflowFields.map((field) => field.id))
  }, [selectedWorkflow, selectedWorkflowFields])

  useEffect(() => {
    if (activeServers.length === 0) {
      if (selectedServerId.length > 0) {
        setSelectedServerId('')
      }
      return
    }

    const stillExists = activeServers.some((server) => String(server.id) === selectedServerId)
    if (!stillExists) {
      setSelectedServerId(String(activeServers[0].id))
    }
  }, [activeServers, selectedServerId])

  useEffect(() => {
    if (selectedWorkflowId === null) {
      return
    }

    if (workflowsQuery.isSuccess && selectedWorkflow === null) {
      onSelectedWorkflowChange(null)
    }
  }, [onSelectedWorkflowChange, selectedWorkflow, selectedWorkflowId, workflowsQuery.isSuccess])

  /** Test a single ComfyUI server and cache its reachability state. */
  const handleTestComfyServer = useCallback(async (serverId: number, options?: { silent?: boolean }) => {
    setComfyServerTests((current) => ({
      ...current,
      [serverId]: {
        ...current[serverId],
        isLoading: true,
        error: undefined,
      },
    }))

    try {
      const status = await testGenerationComfyUIServer(serverId)
      setComfyServerTests((current) => ({
        ...current,
        [serverId]: {
          isLoading: false,
          status,
        },
      }))

      if (!options?.silent) {
        showSnackbar({ message: status.is_connected ? 'ComfyUI 서버 연결 확인 완료.' : 'ComfyUI 서버 연결 실패.', tone: status.is_connected ? 'info' : 'error' })
      }
    } catch (error) {
      const message = getErrorMessage(error, 'ComfyUI 서버 연결 테스트에 실패했어.')
      setComfyServerTests((current) => ({
        ...current,
        [serverId]: {
          isLoading: false,
          error: message,
        },
      }))

      if (!options?.silent) {
        showSnackbar({ message, tone: 'error' })
      }
    }
  }, [showSnackbar])

  useEffect(() => {
    if (selectedWorkflowId === null || activeServers.length === 0) {
      return
    }

    const untestedServers = activeServers.filter((server) => !comfyServerTests[server.id])
    if (untestedServers.length === 0) {
      return
    }

    for (const server of untestedServers) {
      void handleTestComfyServer(server.id, { silent: true })
    }
  }, [activeServers, comfyServerTests, handleTestComfyServer, selectedWorkflowId])

  const handleWorkflowFieldChange = (fieldId: string, value: WorkflowFieldDraftValue) => {
    setWorkflowDraft((current) => ({
      ...current,
      [fieldId]: value,
    }))
  }

  const handleWorkflowImageChange = async (fieldId: string, image?: SelectedImageDraft) => {
    handleWorkflowFieldChange(fieldId, image ?? '')
  }

  const handleComfyServerFieldChange = (field: keyof ComfyUIServerFormDraft, value: string) => {
    setComfyServerForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const resetComfyServerEditor = () => {
    setEditingServerId(null)
    setComfyServerForm(DEFAULT_COMFYUI_SERVER_FORM)
  }

  const handleOpenCreateWorkflow = () => {
    setWorkflowEditorState(null)
    setIsAuthoringModalOpen(true)
  }

  const handleOpenCreateServer = () => {
    resetComfyServerEditor()
    setIsServerModalOpen(true)
  }

  const handleOpenWorkflow = (workflowId: number) => {
    onSelectedWorkflowChange(workflowId)
  }

  const handleSubmitComfyServer = async () => {
    if (isComfyServerSubmitting) {
      return
    }

    const name = comfyServerForm.name.trim()
    const endpoint = comfyServerForm.endpoint.trim()

    if (name.length === 0 || endpoint.length === 0) {
      showSnackbar({ message: '서버 이름과 endpoint는 꼭 필요해.', tone: 'error' })
      return
    }

    try {
      setIsComfyServerSubmitting(true)

      if (editingServerId !== null) {
        await updateGenerationComfyUIServer(editingServerId, {
          name,
          endpoint,
          description: comfyServerForm.description.trim() || undefined,
          is_active: true,
        })

        await serversQuery.refetch()
        setSelectedServerId(String(editingServerId))
        setIsServerModalOpen(false)
        resetComfyServerEditor()
        showSnackbar({ message: 'ComfyUI 서버를 수정했어.', tone: 'info' })
        await handleTestComfyServer(editingServerId)
      } else {
        const response = await createGenerationComfyUIServer({
          name,
          endpoint,
          description: comfyServerForm.description.trim() || undefined,
        })

        await serversQuery.refetch()
        setSelectedServerId(String(response.data.id))
        setIsServerModalOpen(false)
        resetComfyServerEditor()
        showSnackbar({ message: 'ComfyUI 서버를 등록했어.', tone: 'info' })
        await handleTestComfyServer(response.data.id)
      }
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, editingServerId !== null ? 'ComfyUI 서버 수정에 실패했어.' : 'ComfyUI 서버 등록에 실패했어.'), tone: 'error' })
    } finally {
      setIsComfyServerSubmitting(false)
    }
  }

  const handleAuthoringSaved = async (workflowId: number) => {
    await Promise.all([workflowsQuery.refetch(), dropdownListsQuery.refetch()])
    setWorkflowEditorState(null)
    onSelectedWorkflowChange(workflowId)
  }

  const handleEditWorkflow = async (workflowId: number) => {
    try {
      const workflow = await getGenerationWorkflow(workflowId)

      setWorkflowEditorState({
        workflow,
      })
      setIsAuthoringModalOpen(true)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '워크플로우 정보를 불러오지 못했어.'), tone: 'error' })
    }
  }

  const handleCopyWorkflow = async (workflowId: number) => {
    try {
      const workflow = await getGenerationWorkflow(workflowId)

      const currentNames = new Set((workflowsQuery.data ?? []).map((item) => item.name))
      const baseName = `${workflow.name} 복사본`
      let nextName = baseName
      let suffix = 2
      while (currentNames.has(nextName)) {
        nextName = `${baseName} ${suffix}`
        suffix += 1
      }

      await createGenerationWorkflow({
        name: nextName,
        description: workflow.description,
        workflow_json: workflow.workflow_json,
        marked_fields: workflow.marked_fields,
        is_active: workflow.is_active,
        color: workflow.color,
      })

      await workflowsQuery.refetch()
      showSnackbar({ message: 'ComfyUI 워크플로우를 복사했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '워크플로우 복사에 실패했어.'), tone: 'error' })
    }
  }

  const handleDeleteWorkflow = async (workflowId: number) => {
    const workflow = workflowsQuery.data?.find((item) => item.id === workflowId)
    if (!workflow) {
      return
    }

    const confirmed = window.confirm(`정말 ${workflow.name} 워크플로우를 삭제할까?`)
    if (!confirmed) {
      return
    }

    try {
      await deleteGenerationWorkflow(workflowId)
      await workflowsQuery.refetch()
      if (selectedWorkflowId === workflowId) {
        onSelectedWorkflowChange(null)
      }
      showSnackbar({ message: 'ComfyUI 워크플로우를 삭제했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '워크플로우 삭제에 실패했어.'), tone: 'error' })
    }
  }

  const handleEditServer = (serverId: number) => {
    const server = activeServers.find((item) => item.id === serverId)
    if (!server) {
      return
    }

    setEditingServerId(server.id)
    setComfyServerForm({
      name: server.name,
      endpoint: server.endpoint,
      description: server.description ?? '',
    })
    setIsServerModalOpen(true)
  }

  const handleDeleteServer = async (serverId: number) => {
    const server = activeServers.find((item) => item.id === serverId)
    if (!server) {
      return
    }

    const confirmed = window.confirm(`정말 ${server.name} 서버를 삭제할까?`)
    if (!confirmed) {
      return
    }

    try {
      await deleteGenerationComfyUIServer(serverId)
      await serversQuery.refetch()
      setComfyServerTests((current) => {
        const next = { ...current }
        delete next[serverId]
        return next
      })
      if (selectedServerId === String(serverId)) {
        setSelectedServerId('')
      }
      showSnackbar({ message: 'ComfyUI 서버를 삭제했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'ComfyUI 서버 삭제에 실패했어.'), tone: 'error' })
    }
  }

  const handleCreateComfyModule = async () => {
    if (!selectedWorkflow) {
      return
    }

    const moduleName = comfyModuleName.trim()
    if (moduleName.length === 0 || isSavingComfyModule) {
      return
    }

    if (comfyModuleFieldOptions.length > 0 && comfyExposedFieldIds.length === 0) {
      showSnackbar({ message: '최소 1개는 입력 가능 필드로 열어줘.', tone: 'error' })
      return
    }

    try {
      setIsSavingComfyModule(true)
      await createComfyModuleFromWorkflow(selectedWorkflow.id, {
        name: moduleName,
        description: comfyModuleDescription.trim() || undefined,
        exposed_field_ids: comfyExposedFieldIds,
      })
      setIsModuleSaveModalOpen(false)
      showSnackbar({ message: '현재 ComfyUI 워크플로우를 모듈로 저장했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'ComfyUI 모듈 저장에 실패했어.'), tone: 'error' })
    } finally {
      setIsSavingComfyModule(false)
    }
  }

  /** Validate the selected workflow fields before sending a generation request. */
  const validateComfyGeneration = () => {
    if (!selectedWorkflow) {
      showSnackbar({ message: '먼저 ComfyUI 워크플로우를 선택해줘.', tone: 'error' })
      return false
    }

    const missingField = selectedWorkflowFields.find((field) => field.required && !hasWorkflowFieldValue(workflowDraft[field.id]))
    if (missingField) {
      showSnackbar({ message: `필수 필드가 비어 있어: ${missingField.label}`, tone: 'error' })
      return false
    }

    return true
  }

  /** Send one generation request to a specific server. */
  const handleGenerateOnServer = async (serverId: number) => {
    if (!selectedWorkflow) {
      return
    }

    const promptData = buildWorkflowPromptData(selectedWorkflowFields, workflowDraft)
    return generateComfyUIImage(selectedWorkflow.id, {
      prompt_data: promptData,
      server_id: serverId,
    })
  }

  /** Generate once on the currently selected server. */
  const handleGenerateSelected = async () => {
    if (isComfyGenerating || !validateComfyGeneration()) {
      return
    }

    const serverId = Number(selectedServerId)
    if (!Number.isFinite(serverId)) {
      showSnackbar({ message: '생성할 서버를 먼저 골라줘.', tone: 'error' })
      return
    }

    const server = activeServers.find((item) => item.id === serverId)
    if (!server) {
      showSnackbar({ message: '선택한 서버를 찾지 못했어.', tone: 'error' })
      return
    }

    if (comfyServerTests[serverId]?.status?.is_connected !== true) {
      showSnackbar({ message: '선택한 서버가 아직 연결 확인되지 않았어.', tone: 'error' })
      return
    }

    try {
      setIsComfyGenerating(true)
      const response = await handleGenerateOnServer(serverId)
      onHistoryRefresh()
      showSnackbar({ message: response?.data.message || `${server.name}에 생성 요청을 시작했어.`, tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'ComfyUI 생성에 실패했어.'), tone: 'error' })
    } finally {
      setIsComfyGenerating(false)
    }
  }

  /** Generate once on every connected server in parallel. */
  const handleGenerateAllServers = async () => {
    if (isComfyGenerating || !validateComfyGeneration()) {
      return
    }

    if (connectedServers.length === 0) {
      showSnackbar({ message: '연결된 ComfyUI 서버가 없어.', tone: 'error' })
      return
    }

    try {
      setIsComfyGenerating(true)
      const results = await Promise.allSettled(connectedServers.map((server) => handleGenerateOnServer(server.id)))
      const successCount = results.filter((result) => result.status === 'fulfilled').length
      const failedCount = results.length - successCount

      if (successCount > 0) {
        onHistoryRefresh()
      }

      if (failedCount === 0) {
        showSnackbar({ message: `${successCount}개 서버에 생성 요청을 보냈어.`, tone: 'info' })
      } else if (successCount === 0) {
        showSnackbar({ message: '모든 서버 생성 요청이 실패했어.', tone: 'error' })
      } else {
        showSnackbar({ message: `${successCount}개 서버 성공, ${failedCount}개 서버 실패.`, tone: 'error' })
      }
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '전체 서버 생성 요청에 실패했어.'), tone: 'error' })
    } finally {
      setIsComfyGenerating(false)
    }
  }

  return (
    <>
      <div className="space-y-5">
        {workflowsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>워크플로우를 불러오지 못했어</AlertTitle>
            <AlertDescription>{getErrorMessage(workflowsQuery.error, 'ComfyUI 워크플로우 조회 실패')}</AlertDescription>
          </Alert>
        ) : null}

        {serversQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>서버를 불러오지 못했어</AlertTitle>
            <AlertDescription>{getErrorMessage(serversQuery.error, 'ComfyUI 서버 조회 실패')}</AlertDescription>
          </Alert>
        ) : null}

        {dropdownListsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>드롭다운 목록을 불러오지 못했어</AlertTitle>
            <AlertDescription>{getErrorMessage(dropdownListsQuery.error, '커스텀 드롭다운 조회 실패')}</AlertDescription>
          </Alert>
        ) : null}

        {selectedWorkflowId === null ? (
          <div className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <ComfyWorkflowListSection
                workflows={workflowsQuery.data ?? []}
                selectedWorkflowId={activeWorkflowId}
                onSelectWorkflow={handleOpenWorkflow}
                onCreateWorkflow={handleOpenCreateWorkflow}
                onEditWorkflow={(workflowId) => void handleEditWorkflow(workflowId)}
                onCopyWorkflow={(workflowId) => void handleCopyWorkflow(workflowId)}
                onDeleteWorkflow={(workflowId) => void handleDeleteWorkflow(workflowId)}
              />

              <ComfyDropdownListsSection dropdownLists={dropdownListsQuery.data ?? []} />
            </div>

            <ComfyServerListSection
              servers={activeServers}
              serverTests={comfyServerTests}
              onOpenCreateServer={handleOpenCreateServer}
              onEditServer={handleEditServer}
              onDeleteServer={(serverId) => void handleDeleteServer(serverId)}
              onTestServer={(serverId) => void handleTestComfyServer(serverId)}
            />
          </div>
        ) : selectedWorkflow ? (
          <ComfyWorkflowControllerPanel
            workflowName={selectedWorkflow.name}
            workflowDescription={selectedWorkflow.description}
            workflowFields={selectedWorkflowFields}
            servers={activeServers}
            serverTests={comfyServerTests}
            selectedServerId={selectedServerId}
            workflowDraft={workflowDraft}
            isGenerating={isComfyGenerating}
            headerPortalTargetId={headerPortalTargetId}
            onBack={() => onSelectedWorkflowChange(null)}
            onSelectServer={setSelectedServerId}
            onFieldChange={handleWorkflowFieldChange}
            onImageChange={handleWorkflowImageChange}
            onResetDraft={() => setWorkflowDraft(buildWorkflowDraft(selectedWorkflowFields))}
            onOpenModuleSave={() => setIsModuleSaveModalOpen(true)}
            onGenerateSelected={() => void handleGenerateSelected()}
            onGenerateAll={() => void handleGenerateAllServers()}
          />
        ) : null}
      </div>

      <ComfyWorkflowAuthoringModal
        open={isAuthoringModalOpen}
        mode={workflowEditorState ? 'edit' : 'create'}
        initialData={workflowEditorState}
        dropdownLists={dropdownListsQuery.data ?? []}
        onClose={() => {
          setIsAuthoringModalOpen(false)
          setWorkflowEditorState(null)
        }}
        onSaved={(workflowId) => void handleAuthoringSaved(workflowId)}
      />

      <ComfyServerRegistrationModal
        open={isServerModalOpen}
        mode={editingServerId !== null ? 'edit' : 'create'}
        form={comfyServerForm}
        isSubmitting={isComfyServerSubmitting}
        onClose={() => {
          setIsServerModalOpen(false)
          resetComfyServerEditor()
        }}
        onReset={resetComfyServerEditor}
        onFieldChange={handleComfyServerFieldChange}
        onSubmit={() => void handleSubmitComfyServer()}
      />

      <ComfyModuleSaveModal
        open={isModuleSaveModalOpen}
        moduleName={comfyModuleName}
        moduleDescription={comfyModuleDescription}
        fieldOptions={comfyModuleFieldOptions}
        exposedFieldIds={comfyExposedFieldIds}
        isSaving={isSavingComfyModule}
        onClose={() => setIsModuleSaveModalOpen(false)}
        onModuleNameChange={setComfyModuleName}
        onModuleDescriptionChange={setComfyModuleDescription}
        onExposedFieldIdsChange={setComfyExposedFieldIds}
        onSave={() => void handleCreateComfyModule()}
      />
    </>
  )
}
