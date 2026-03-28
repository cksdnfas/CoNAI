import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ImagePlus, WandSparkles } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  createComfyModuleFromWorkflow,
  createGenerationComfyUIServer,
  generateComfyUIImage,
  getDefaultComfyExposedFieldIds,
  getGenerationComfyUIServers,
  getGenerationWorkflows,
  testGenerationComfyUIServer,
} from '@/lib/api'
import {
  buildWorkflowDraft,
  DEFAULT_COMFYUI_SERVER_FORM,
  FormField,
  getErrorMessage,
  hasWorkflowFieldValue,
  readFileAsDataUrl,
  toggleSelectionItem,
  type ComfyUIServerFormDraft,
  type ComfyUIServerTestState,
  type WorkflowFieldDraftValue,
} from '../image-generation-shared'
import { WorkflowFieldInput } from './workflow-field-input'

type ComfyGenerationPanelProps = {
  refreshNonce: number
  onHistoryRefresh: () => void
}

/** Render the ComfyUI server management, workflow execution, and module-authoring workflow. */
export function ComfyGenerationPanel({ refreshNonce, onHistoryRefresh }: ComfyGenerationPanelProps) {
  const { showSnackbar } = useSnackbar()
  const [isComfyGenerating, setIsComfyGenerating] = useState(false)
  const [isComfyServerCreating, setIsComfyServerCreating] = useState(false)
  const [isSavingComfyModule, setIsSavingComfyModule] = useState(false)
  const [comfyServerForm, setComfyServerForm] = useState<ComfyUIServerFormDraft>(DEFAULT_COMFYUI_SERVER_FORM)
  const [comfyServerTests, setComfyServerTests] = useState<Record<number, ComfyUIServerTestState>>({})
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('')
  const [selectedServerId, setSelectedServerId] = useState<string>('auto')
  const [workflowDraft, setWorkflowDraft] = useState<Record<string, WorkflowFieldDraftValue>>({})
  const [comfyModuleName, setComfyModuleName] = useState('')
  const [comfyModuleDescription, setComfyModuleDescription] = useState('')
  const [comfyExposedFieldIds, setComfyExposedFieldIds] = useState<string[]>([])

  const workflowsQuery = useQuery({
    queryKey: ['image-generation-workflows'],
    queryFn: () => getGenerationWorkflows(true),
  })

  const serversQuery = useQuery({
    queryKey: ['image-generation-comfyui-servers'],
    queryFn: () => getGenerationComfyUIServers(true),
  })

  const selectedWorkflow = useMemo(
    () => workflowsQuery.data?.find((workflow) => String(workflow.id) === selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflowsQuery.data],
  )

  useEffect(() => {
    if (refreshNonce === 0) {
      return
    }

    void Promise.all([workflowsQuery.refetch(), serversQuery.refetch()])
  }, [refreshNonce, serversQuery, workflowsQuery])

  useEffect(() => {
    if (!workflowsQuery.data || workflowsQuery.data.length === 0) {
      return
    }

    if (selectedWorkflowId.length > 0) {
      return
    }

    setSelectedWorkflowId(String(workflowsQuery.data[0].id))
  }, [selectedWorkflowId, workflowsQuery.data])

  useEffect(() => {
    if (!selectedWorkflow) {
      setWorkflowDraft({})
      return
    }

    setWorkflowDraft(buildWorkflowDraft(selectedWorkflow.marked_fields ?? []))
  }, [selectedWorkflow])

  useEffect(() => {
    if (!selectedWorkflow) {
      setComfyModuleName('')
      setComfyModuleDescription('')
      setComfyExposedFieldIds([])
      return
    }

    setComfyModuleName(`${selectedWorkflow.name} Module`)
    setComfyModuleDescription(selectedWorkflow.description || '')
    setComfyExposedFieldIds(getDefaultComfyExposedFieldIds(selectedWorkflow.marked_fields ?? []))
  }, [selectedWorkflow])

  const handleWorkflowFieldChange = (fieldId: string, value: WorkflowFieldDraftValue) => {
    setWorkflowDraft((current) => ({
      ...current,
      [fieldId]: value,
    }))
  }

  const handleWorkflowImageChange = async (fieldId: string, file?: File) => {
    if (!file) {
      handleWorkflowFieldChange(fieldId, '')
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      handleWorkflowFieldChange(fieldId, {
        fileName: file.name,
        dataUrl,
      })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '이미지 파일을 읽지 못했어.'), tone: 'error' })
    }
  }

  const handleComfyServerFieldChange = (field: keyof ComfyUIServerFormDraft, value: string) => {
    setComfyServerForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const handleTestComfyServer = async (serverId: number) => {
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
      showSnackbar({ message: status.is_connected ? 'ComfyUI 서버 연결 확인 완료.' : 'ComfyUI 서버 연결 실패.', tone: status.is_connected ? 'info' : 'error' })
    } catch (error) {
      const message = getErrorMessage(error, 'ComfyUI 서버 연결 테스트에 실패했어.')
      setComfyServerTests((current) => ({
        ...current,
        [serverId]: {
          isLoading: false,
          error: message,
        },
      }))
      showSnackbar({ message, tone: 'error' })
    }
  }

  const handleCreateComfyServer = async () => {
    if (isComfyServerCreating) {
      return
    }

    const name = comfyServerForm.name.trim()
    const endpoint = comfyServerForm.endpoint.trim()

    if (name.length === 0 || endpoint.length === 0) {
      showSnackbar({ message: '서버 이름과 endpoint는 꼭 필요해.', tone: 'error' })
      return
    }

    try {
      setIsComfyServerCreating(true)
      const response = await createGenerationComfyUIServer({
        name,
        endpoint,
        description: comfyServerForm.description.trim() || undefined,
      })

      await serversQuery.refetch()
      setSelectedServerId(String(response.data.id))
      setComfyServerForm(DEFAULT_COMFYUI_SERVER_FORM)
      showSnackbar({ message: 'ComfyUI 서버를 등록했어.', tone: 'info' })
      await handleTestComfyServer(response.data.id)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'ComfyUI 서버 등록에 실패했어.'), tone: 'error' })
    } finally {
      setIsComfyServerCreating(false)
    }
  }

  const handleCreateComfyModule = async () => {
    if (!selectedWorkflow) {
      showSnackbar({ message: '먼저 모듈화할 워크플로우를 골라줘.', tone: 'error' })
      return
    }

    const moduleName = comfyModuleName.trim()
    if (moduleName.length === 0 || isSavingComfyModule) {
      return
    }

    try {
      setIsSavingComfyModule(true)
      await createComfyModuleFromWorkflow(selectedWorkflow.id, {
        name: moduleName,
        description: comfyModuleDescription.trim() || undefined,
        exposed_field_ids: comfyExposedFieldIds,
      })

      showSnackbar({ message: '선택한 ComfyUI 워크플로우를 모듈로 저장했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'ComfyUI 모듈 저장에 실패했어.'), tone: 'error' })
    } finally {
      setIsSavingComfyModule(false)
    }
  }

  const handleComfyGenerate = async () => {
    if (isComfyGenerating) {
      return
    }

    if (!selectedWorkflow) {
      showSnackbar({ message: '먼저 ComfyUI 워크플로우를 선택해줘.', tone: 'error' })
      return
    }

    const missingField = selectedWorkflow.marked_fields.find((field) => field.required && !hasWorkflowFieldValue(workflowDraft[field.id]))
    if (missingField) {
      showSnackbar({ message: `필수 필드가 비어 있어: ${missingField.label}`, tone: 'error' })
      return
    }

    try {
      setIsComfyGenerating(true)
      const promptData = selectedWorkflow.marked_fields.reduce<Record<string, string | number | WorkflowFieldDraftValue>>((payload, field) => {
        const value = workflowDraft[field.id]

        if (!hasWorkflowFieldValue(value)) {
          return payload
        }

        if (typeof value !== 'string') {
          payload[field.id] = value
          return payload
        }

        if (field.type === 'number') {
          payload[field.id] = Number(value)
          return payload
        }

        payload[field.id] = value.trim()
        return payload
      }, {})

      const response = await generateComfyUIImage(selectedWorkflow.id, {
        prompt_data: promptData,
        server_id: selectedServerId !== 'auto' ? Number(selectedServerId) : undefined,
      })

      onHistoryRefresh()
      showSnackbar({ message: response.data.message || 'ComfyUI 생성 요청을 시작했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'ComfyUI 생성에 실패했어.'), tone: 'error' })
    } finally {
      setIsComfyGenerating(false)
    }
  }

  return (
    <Card className="bg-surface-container">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <WandSparkles className="h-4 w-4 text-primary" />
            ComfyUI
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">워크플로우 {workflowsQuery.data?.length ?? 0}</Badge>
            <Badge variant="outline">서버 {serversQuery.data?.length ?? 0}</Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {workflowsQuery.isError ? (
          <Alert variant="destructive">
            <AlertTitle>워크플로우를 불러오지 못했어</AlertTitle>
            <AlertDescription>{getErrorMessage(workflowsQuery.error, 'ComfyUI 워크플로우 조회 실패')}</AlertDescription>
          </Alert>
        ) : null}

        <div className="space-y-4 rounded-sm bg-surface-low p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-medium text-foreground">ComfyUI 서버 등록</div>
            <Badge variant={serversQuery.data && serversQuery.data.length > 0 ? 'secondary' : 'outline'}>
              {serversQuery.data?.length ?? 0} active
            </Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Server Name">
              <Input value={comfyServerForm.name} onChange={(event) => handleComfyServerFieldChange('name', event.target.value)} placeholder="Local ComfyUI" />
            </FormField>
            <FormField label="Endpoint">
              <Input value={comfyServerForm.endpoint} onChange={(event) => handleComfyServerFieldChange('endpoint', event.target.value)} placeholder="http://127.0.0.1:8188" />
            </FormField>
          </div>

          <FormField label="Description" hint="선택">
            <Input value={comfyServerForm.description} onChange={(event) => handleComfyServerFieldChange('description', event.target.value)} placeholder="메인 GPU 서버" />
          </FormField>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setComfyServerForm(DEFAULT_COMFYUI_SERVER_FORM)} disabled={isComfyServerCreating}>
              초기화
            </Button>
            <Button type="button" onClick={handleCreateComfyServer} disabled={isComfyServerCreating || comfyServerForm.name.trim().length === 0 || comfyServerForm.endpoint.trim().length === 0}>
              {isComfyServerCreating ? '등록 중…' : '서버 등록'}
            </Button>
          </div>

          {serversQuery.data?.length ? (
            <div className="space-y-2 rounded-sm bg-surface-high p-3">
              {serversQuery.data.map((server) => {
                const testState = comfyServerTests[server.id]
                const connectionStatus = testState?.status

                return (
                  <div key={server.id} className="rounded-sm bg-surface-container px-3 py-3 text-sm text-muted-foreground">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-foreground">{server.name}</span>
                          <Badge variant="outline">#{server.id}</Badge>
                          {connectionStatus ? (
                            <Badge variant={connectionStatus.is_connected ? 'secondary' : 'outline'}>
                              {connectionStatus.is_connected ? '연결 성공' : '연결 실패'}
                            </Badge>
                          ) : null}
                          {testState?.error ? <Badge variant="outline">테스트 오류</Badge> : null}
                        </div>
                        <div className="mt-1 break-all text-xs">{server.endpoint}</div>
                        {server.description ? <div className="mt-1 text-xs">{server.description}</div> : null}
                        {connectionStatus?.response_time !== undefined ? <div className="mt-1 text-xs">응답시간: {connectionStatus.response_time}ms</div> : null}
                        {connectionStatus?.error_message ? <div className="mt-1 text-xs text-[#ffb4ab]">{connectionStatus.error_message}</div> : null}
                        {testState?.error ? <div className="mt-1 text-xs text-[#ffb4ab]">{testState.error}</div> : null}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Button type="button" size="sm" variant="outline" onClick={() => void handleTestComfyServer(server.id)} disabled={testState?.isLoading === true}>
                          {testState?.isLoading ? '테스트 중…' : '연결 테스트'}
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <Alert>
              <AlertTitle>활성 서버 없음</AlertTitle>
              <AlertDescription>ComfyUI 생성은 서버가 최소 1개 있어야 제대로 쓸 수 있어.</AlertDescription>
            </Alert>
          )}
        </div>

        <div className="space-y-4 rounded-sm bg-surface-low p-4">
          <div className="grid gap-4 md:grid-cols-2">
            <FormField label="Workflow">
              <Select value={selectedWorkflowId} onChange={(event) => setSelectedWorkflowId(event.target.value)} disabled={!workflowsQuery.data || workflowsQuery.data.length === 0}>
                {workflowsQuery.data?.length ? (
                  workflowsQuery.data.map((workflow) => (
                    <option key={workflow.id} value={workflow.id}>
                      {workflow.name}
                    </option>
                  ))
                ) : (
                  <option value="">등록된 워크플로우 없음</option>
                )}
              </Select>
            </FormField>

            <FormField label="Server" hint="auto면 워크플로우 기본 endpoint 사용">
              <Select value={selectedServerId} onChange={(event) => setSelectedServerId(event.target.value)}>
                <option value="auto">Auto</option>
                {serversQuery.data?.map((server) => (
                  <option key={server.id} value={server.id}>
                    {server.name}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>

          {selectedWorkflow ? (
            <div className="rounded-sm bg-surface-high p-4 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">{selectedWorkflow.name}</div>
              <div className="mt-1 break-all">{selectedWorkflow.description || '설명 없음'}</div>
              <div className="mt-2 text-xs">Endpoint: {selectedWorkflow.api_endpoint}</div>
            </div>
          ) : null}
        </div>

        {selectedWorkflow ? (
          <div className="space-y-4 rounded-sm bg-surface-low p-4">
            <div className="text-sm font-medium text-foreground">Save as ComfyUI Module</div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField label="Module Name">
                <Input value={comfyModuleName} onChange={(event) => setComfyModuleName(event.target.value)} placeholder="Comfy Workflow Module" />
              </FormField>
              <FormField label="Description" hint="선택">
                <Input value={comfyModuleDescription} onChange={(event) => setComfyModuleDescription(event.target.value)} placeholder="selected workflow wrapper" />
              </FormField>
            </div>

            {(selectedWorkflow.marked_fields ?? []).length > 0 ? (
              <div className="space-y-3">
                <div className="text-sm font-medium text-foreground">Exposed Inputs</div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {selectedWorkflow.marked_fields.map((field) => {
                    const checked = comfyExposedFieldIds.includes(field.id)
                    return (
                      <label key={field.id} className="flex items-center gap-2 rounded-sm bg-surface-high px-3 py-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setComfyExposedFieldIds((current) => toggleSelectionItem(current, field.id))}
                        />
                        <span>{field.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">이 워크플로우는 marked field가 없어서 입력 없는 모듈로 저장돼.</div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={handleCreateComfyModule} disabled={isSavingComfyModule || comfyModuleName.trim().length === 0}>
                {isSavingComfyModule ? '모듈 저장 중…' : 'ComfyUI 모듈 저장'}
              </Button>
            </div>
          </div>
        ) : null}

        {selectedWorkflow ? (
          <div className="space-y-4 rounded-sm bg-surface-low p-4">
            {(selectedWorkflow.marked_fields ?? []).length > 0 ? (
              <div className="grid gap-4">
                {selectedWorkflow.marked_fields.map((field) => (
                  <WorkflowFieldInput
                    key={field.id}
                    field={field}
                    value={workflowDraft[field.id] ?? ''}
                    onChange={(value) => handleWorkflowFieldChange(field.id, value)}
                    onImageChange={(file) => handleWorkflowImageChange(field.id, file)}
                  />
                ))}
              </div>
            ) : (
              <Alert>
                <AlertTitle>Marked Field 없음</AlertTitle>
                <AlertDescription>이 워크플로우에는 페이지에서 바로 입력할 필드가 아직 없어.</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setWorkflowDraft(buildWorkflowDraft(selectedWorkflow.marked_fields ?? []))}
                disabled={isComfyGenerating}
              >
                초기화
              </Button>
              <Button
                type="button"
                onClick={handleComfyGenerate}
                disabled={isComfyGenerating || (selectedWorkflow.marked_fields ?? []).length === 0}
              >
                <ImagePlus className="h-4 w-4" />
                {isComfyGenerating ? '생성 요청 중…' : 'ComfyUI 생성'}
              </Button>
            </div>
          </div>
        ) : (
          <Alert>
            <AlertTitle>워크플로우 필요</AlertTitle>
            <AlertDescription>백엔드에는 ComfyUI 라우트가 이미 있지만, 실제 생성을 하려면 먼저 워크플로우를 등록해야 해.</AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}
