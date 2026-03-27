import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ImagePlus, RefreshCw, Sparkles, WandSparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ToggleRow } from '@/components/ui/toggle-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import {
  createGenerationComfyUIServer,
  generateComfyUIImage,
  generateNaiImage,
  getGenerationComfyUIServers,
  getGenerationHistory,
  getGenerationWorkflows,
  getNaiCostEstimate,
  getNaiUserData,
  loginNaiWithToken,
  testGenerationComfyUIServer,
  type ComfyUIServerConnectionStatus,
  type GenerationHistoryRecord,
  type GenerationServiceType,
  type WorkflowMarkedField,
} from '@/lib/api'

type HistoryFilter = 'all' | GenerationServiceType

type SelectedImageDraft = {
  fileName: string
  dataUrl: string
}

type NAIFormDraft = {
  prompt: string
  negativePrompt: string
  model: string
  action: 'generate' | 'img2img' | 'infill'
  sampler: string
  width: string
  height: string
  steps: string
  scale: string
  samples: string
  seed: string
  ucPreset: string
  varietyPlus: boolean
  strength: string
  noise: string
  addOriginalImage: boolean
  sourceImage?: SelectedImageDraft
  maskImage?: SelectedImageDraft
}

type WorkflowFieldDraftValue = string | SelectedImageDraft

type ComfyUIServerFormDraft = {
  name: string
  endpoint: string
  description: string
}

type ComfyUIServerTestState = {
  isLoading: boolean
  status?: ComfyUIServerConnectionStatus
  error?: string
}

const DEFAULT_NAI_FORM: NAIFormDraft = {
  prompt: '',
  negativePrompt: '',
  model: 'nai-diffusion-4-5-curated',
  action: 'generate',
  sampler: 'k_euler',
  width: '1024',
  height: '1024',
  steps: '28',
  scale: '6',
  samples: '1',
  seed: '',
  ucPreset: '0',
  varietyPlus: false,
  strength: '0.3',
  noise: '0',
  addOriginalImage: true,
}

const DEFAULT_COMFYUI_SERVER_FORM: ComfyUIServerFormDraft = {
  name: '',
  endpoint: 'http://127.0.0.1:8188',
  description: '',
}

/** Read a human-friendly error message from an unknown failure. */
function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

/** Format a history timestamp for the current locale. */
function formatHistoryDate(value?: string | null) {
  if (!value) {
    return '시간 정보 없음'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

/** Build the initial draft object for workflow marked fields. */
function buildWorkflowDraft(fields: WorkflowMarkedField[]) {
  return fields.reduce<Record<string, WorkflowFieldDraftValue>>((draft, field) => {
    const defaultValue = field.default_value
    draft[field.id] = defaultValue === undefined || defaultValue === null ? '' : String(defaultValue)
    return draft
  }, {})
}

/** Read a local file into a data URL for API transport. */
function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file as data URL'))
    reader.readAsDataURL(file)
  })
}

/** Check whether a workflow field draft has a usable value. */
function hasWorkflowFieldValue(value: WorkflowFieldDraftValue | undefined) {
  if (!value) {
    return false
  }

  if (typeof value === 'string') {
    return value.trim().length > 0
  }

  return value.dataUrl.trim().length > 0
}

/** Convert workflow field input strings into the payload expected by the backend. */
function buildWorkflowPromptData(fields: WorkflowMarkedField[], draft: Record<string, WorkflowFieldDraftValue>) {
  return fields.reduce<Record<string, string | number | SelectedImageDraft>>((payload, field) => {
    const value = draft[field.id]

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
}

/** Resolve the most useful image detail route for a history item. */
function getHistoryDetailHref(record: GenerationHistoryRecord) {
  const compositeHash = record.actual_composite_hash || record.composite_hash
  return compositeHash ? `/images/${compositeHash}` : null
}

/** Resolve a compact label for the history service type. */
function getHistoryServiceLabel(serviceType: GenerationServiceType) {
  return serviceType === 'novelai' ? 'NAI' : 'ComfyUI'
}

/** Resolve a compact label for the history status badge. */
function getHistoryStatusLabel(status: GenerationHistoryRecord['generation_status']) {
  if (status === 'completed') return '완료'
  if (status === 'failed') return '실패'
  if (status === 'processing') return '처리 중'
  return '대기 중'
}

/** Resolve a concise title for each history row. */
function getHistoryTitle(record: GenerationHistoryRecord) {
  if (record.service_type === 'novelai') {
    return record.nai_model || 'NovelAI 생성'
  }

  return record.workflow_name || 'ComfyUI 워크플로우'
}

function FormField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground">{label}</span>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </label>
  )
}

function SummaryChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm bg-surface-high px-3 py-2">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  )
}

/** Parse a numeric text input while keeping a safe fallback. */
function parseNumberInput(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function ImageGenerationPage() {
  const { showSnackbar } = useSnackbar()
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all')
  const [naiTokenInput, setNaiTokenInput] = useState('')
  const [isNaiLoggingIn, setIsNaiLoggingIn] = useState(false)
  const [isNaiGenerating, setIsNaiGenerating] = useState(false)
  const [isComfyGenerating, setIsComfyGenerating] = useState(false)
  const [isComfyServerCreating, setIsComfyServerCreating] = useState(false)
  const [naiForm, setNaiForm] = useState<NAIFormDraft>(DEFAULT_NAI_FORM)
  const [comfyServerForm, setComfyServerForm] = useState<ComfyUIServerFormDraft>(DEFAULT_COMFYUI_SERVER_FORM)
  const [comfyServerTests, setComfyServerTests] = useState<Record<number, ComfyUIServerTestState>>({})
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>('')
  const [selectedServerId, setSelectedServerId] = useState<string>('auto')
  const [workflowDraft, setWorkflowDraft] = useState<Record<string, WorkflowFieldDraftValue>>({})

  const workflowsQuery = useQuery({
    queryKey: ['image-generation-workflows'],
    queryFn: () => getGenerationWorkflows(true),
  })

  const serversQuery = useQuery({
    queryKey: ['image-generation-comfyui-servers'],
    queryFn: () => getGenerationComfyUIServers(true),
  })

  const historyQuery = useQuery({
    queryKey: ['image-generation-history', historyFilter],
    queryFn: () => getGenerationHistory(historyFilter === 'all' ? undefined : historyFilter),
    refetchInterval: 5000,
  })

  const naiUserQuery = useQuery({
    queryKey: ['image-generation-nai-user'],
    queryFn: getNaiUserData,
    retry: false,
  })

  const selectedWorkflow = useMemo(
    () => workflowsQuery.data?.find((workflow) => String(workflow.id) === selectedWorkflowId) ?? null,
    [selectedWorkflowId, workflowsQuery.data],
  )

  const naiCostInputs = useMemo(
    () => ({
      width: parseNumberInput(naiForm.width, 1024),
      height: parseNumberInput(naiForm.height, 1024),
      steps: parseNumberInput(naiForm.steps, 28),
      n_samples: parseNumberInput(naiForm.samples, 1),
    }),
    [naiForm.height, naiForm.samples, naiForm.steps, naiForm.width],
  )

  const naiCostQuery = useQuery({
    queryKey: ['image-generation-nai-cost', naiCostInputs, naiUserQuery.data?.subscription.tier, naiUserQuery.data?.anlasBalance],
    queryFn: () =>
      getNaiCostEstimate({
        ...naiCostInputs,
        subscriptionTier: naiUserQuery.data?.subscription.tier ?? 0,
        anlasBalance: naiUserQuery.data?.anlasBalance ?? 0,
      }),
    enabled:
      naiUserQuery.isSuccess &&
      naiCostInputs.width > 0 &&
      naiCostInputs.height > 0 &&
      naiCostInputs.steps > 0 &&
      naiCostInputs.n_samples > 0,
  })

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

  const handleNaiFieldChange = (field: keyof NAIFormDraft, value: string) => {
    setNaiForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const handleWorkflowFieldChange = (fieldId: string, value: WorkflowFieldDraftValue) => {
    setWorkflowDraft((current) => ({
      ...current,
      [fieldId]: value,
    }))
  }

  const handleNaiImageChange = async (field: 'sourceImage' | 'maskImage', file?: File) => {
    if (!file) {
      setNaiForm((current) => ({
        ...current,
        [field]: undefined,
      }))
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      setNaiForm((current) => ({
        ...current,
        [field]: {
          fileName: file.name,
          dataUrl,
        },
      }))
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '이미지 파일을 읽지 못했어.'), tone: 'error' })
    }
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

  const handleNaiLogin = async () => {
    const token = naiTokenInput.trim()
    if (token.length === 0 || isNaiLoggingIn) {
      return
    }

    try {
      setIsNaiLoggingIn(true)
      await loginNaiWithToken(token)
      await naiUserQuery.refetch()
      setNaiTokenInput('')
      showSnackbar({ message: 'NovelAI 토큰 연결 완료.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'NovelAI 토큰 로그인에 실패했어.'), tone: 'error' })
    } finally {
      setIsNaiLoggingIn(false)
    }
  }

  const handleNaiGenerate = async () => {
    if (isNaiGenerating) {
      return
    }

    if (naiForm.prompt.trim().length === 0) {
      showSnackbar({ message: 'NAI 프롬프트를 먼저 넣어줘.', tone: 'error' })
      return
    }

    if ((naiForm.action === 'img2img' || naiForm.action === 'infill') && !naiForm.sourceImage) {
      showSnackbar({ message: 'img2img / infill에는 소스 이미지가 필요해.', tone: 'error' })
      return
    }

    if (naiForm.action === 'infill' && !naiForm.maskImage) {
      showSnackbar({ message: 'infill에는 마스크 이미지도 필요해.', tone: 'error' })
      return
    }

    try {
      setIsNaiGenerating(true)
      const response = await generateNaiImage({
        prompt: naiForm.prompt.trim(),
        negative_prompt: naiForm.negativePrompt.trim() || undefined,
        model: naiForm.model,
        action: naiForm.action,
        sampler: naiForm.sampler,
        width: Number(naiForm.width),
        height: Number(naiForm.height),
        steps: Number(naiForm.steps),
        scale: Number(naiForm.scale),
        n_samples: Number(naiForm.samples),
        seed: naiForm.seed.trim().length > 0 ? Number(naiForm.seed) : undefined,
        ucPreset: Number(naiForm.ucPreset),
        variety_plus: naiForm.varietyPlus,
        image: naiForm.sourceImage?.dataUrl,
        mask: naiForm.maskImage?.dataUrl,
        strength: naiForm.action !== 'generate' ? Number(naiForm.strength) : undefined,
        noise: naiForm.action !== 'generate' ? Number(naiForm.noise) : undefined,
        add_original_image: naiForm.action === 'infill' ? naiForm.addOriginalImage : undefined,
      })

      await Promise.all([historyQuery.refetch(), naiUserQuery.refetch()])
      showSnackbar({ message: `NAI 생성 요청 완료. 히스토리 ${response.count}건 등록됐어.`, tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'NAI 이미지 생성에 실패했어.'), tone: 'error' })
    } finally {
      setIsNaiGenerating(false)
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
      const promptData = buildWorkflowPromptData(selectedWorkflow.marked_fields ?? [], workflowDraft)
      const response = await generateComfyUIImage(selectedWorkflow.id, {
        prompt_data: promptData,
        server_id: selectedServerId !== 'auto' ? Number(selectedServerId) : undefined,
      })

      await historyQuery.refetch()
      showSnackbar({ message: response.data.message || 'ComfyUI 생성 요청을 시작했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'ComfyUI 생성에 실패했어.'), tone: 'error' })
    } finally {
      setIsComfyGenerating(false)
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

  const naiConnectionDescription = naiUserQuery.isSuccess
    ? `${naiUserQuery.data.subscription.tierName} · Anlas ${naiUserQuery.data.anlasBalance}`
    : '토큰을 한 번 등록하면 이 세션에서 바로 생성 가능해.'

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Create"
        title="Image Generation"
        description="백엔드에 이미 있는 NovelAI / ComfyUI 생성 API를 바로 쓰는 첫 페이지야. 먼저 최소 동선으로 붙이고, 이후에 고급 옵션을 확장하면 돼."
        actions={
          <Button type="button" variant="outline" onClick={() => void Promise.all([historyQuery.refetch(), workflowsQuery.refetch(), serversQuery.refetch(), naiUserQuery.refetch()])}>
            <RefreshCw className="h-4 w-4" />
            새로고침
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="bg-surface-container">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-2">
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  NovelAI
                </CardTitle>
                <CardDescription>{naiConnectionDescription}</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant={naiUserQuery.isSuccess ? 'secondary' : 'outline'}>
                  {naiUserQuery.isSuccess ? '연결됨' : '미연결'}
                </Badge>
                {naiUserQuery.isSuccess ? <Badge variant="outline">{naiUserQuery.data.subscription.active ? '구독 활성' : '구독 비활성'}</Badge> : null}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-6">
            <div className="space-y-3 rounded-sm bg-surface-low p-4">
              <FormField label="Access Token" hint="현재는 토큰 로그인 우선">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={naiTokenInput}
                    onChange={(event) => setNaiTokenInput(event.target.value)}
                    placeholder="NovelAI access token"
                    autoComplete="off"
                  />
                  <Button type="button" onClick={handleNaiLogin} disabled={isNaiLoggingIn || naiTokenInput.trim().length === 0}>
                    {isNaiLoggingIn ? '연결 중…' : '토큰 연결'}
                  </Button>
                </div>
              </FormField>

              {naiUserQuery.isError ? (
                <div className="text-xs text-muted-foreground">{getErrorMessage(naiUserQuery.error, '아직 NovelAI 계정이 연결되지 않았어.')}</div>
              ) : null}

              {naiUserQuery.isSuccess ? (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <SummaryChip label="tier" value={naiUserQuery.data.subscription.tierName} />
                  <SummaryChip label="anlas" value={String(naiUserQuery.data.anlasBalance)} />
                  <SummaryChip
                    label="cost"
                    value={naiCostQuery.isSuccess ? `${naiCostQuery.data.estimatedCost} Anlas` : naiCostQuery.isPending ? '계산 중…' : '—'}
                  />
                  <SummaryChip
                    label="max samples"
                    value={naiCostQuery.isSuccess ? String(naiCostQuery.data.maxSamples) : '—'}
                  />
                </div>
              ) : null}
            </div>

            <div className="space-y-4 rounded-sm bg-surface-low p-4">
              <FormField label="Prompt">
                <Textarea value={naiForm.prompt} onChange={(event) => handleNaiFieldChange('prompt', event.target.value)} rows={5} placeholder="1girl, solo, cinematic lighting" />
              </FormField>

              <FormField label="Negative Prompt">
                <Textarea
                  value={naiForm.negativePrompt}
                  onChange={(event) => handleNaiFieldChange('negativePrompt', event.target.value)}
                  rows={4}
                  placeholder="low quality, blurry"
                />
              </FormField>

              <div className="grid gap-4 md:grid-cols-3">
                <FormField label="Model">
                  <Select value={naiForm.model} onChange={(event) => handleNaiFieldChange('model', event.target.value)}>
                    <option value="nai-diffusion-4-5-curated">NAI Diffusion 4.5 Curated</option>
                    <option value="nai-diffusion-4-5-full">NAI Diffusion 4.5 Full</option>
                    <option value="nai-diffusion-4-curated-preview">NAI Diffusion 4 Curated</option>
                    <option value="nai-diffusion-3">NAI Diffusion 3</option>
                  </Select>
                </FormField>

                <FormField label="Action">
                  <Select value={naiForm.action} onChange={(event) => handleNaiFieldChange('action', event.target.value)}>
                    <option value="generate">generate</option>
                    <option value="img2img">img2img</option>
                    <option value="infill">infill</option>
                  </Select>
                </FormField>

                <FormField label="Sampler">
                  <Select value={naiForm.sampler} onChange={(event) => handleNaiFieldChange('sampler', event.target.value)}>
                    <option value="k_euler">k_euler</option>
                    <option value="k_euler_ancestral">k_euler_ancestral</option>
                    <option value="k_dpmpp_2s_ancestral">k_dpmpp_2s_ancestral</option>
                    <option value="k_dpmpp_2m">k_dpmpp_2m</option>
                  </Select>
                </FormField>
              </div>

              {naiForm.action !== 'generate' ? (
                <div className="space-y-4 rounded-sm bg-surface-high p-4">
                  <div className="text-sm font-medium text-foreground">Source Images</div>

                  <FormField label="Source Image" hint="img2img / infill 필수">
                    <div className="space-y-3">
                      <Input type="file" accept="image/*" onChange={(event) => void handleNaiImageChange('sourceImage', event.target.files?.[0])} />
                      {naiForm.sourceImage ? (
                        <div className="space-y-2">
                          <div className="text-xs text-muted-foreground">{naiForm.sourceImage.fileName}</div>
                          <img src={naiForm.sourceImage.dataUrl} alt="NAI source" className="max-h-48 rounded-sm border border-border object-contain" />
                          <div className="flex justify-end">
                            <Button type="button" size="sm" variant="ghost" onClick={() => void handleNaiImageChange('sourceImage')}>
                              소스 제거
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </FormField>

                  {naiForm.action === 'infill' ? (
                    <FormField label="Mask Image" hint="infill 필수">
                      <div className="space-y-3">
                        <Input type="file" accept="image/*" onChange={(event) => void handleNaiImageChange('maskImage', event.target.files?.[0])} />
                        {naiForm.maskImage ? (
                          <div className="space-y-2">
                            <div className="text-xs text-muted-foreground">{naiForm.maskImage.fileName}</div>
                            <img src={naiForm.maskImage.dataUrl} alt="NAI mask" className="max-h-48 rounded-sm border border-border object-contain" />
                            <div className="flex justify-end">
                              <Button type="button" size="sm" variant="ghost" onClick={() => void handleNaiImageChange('maskImage')}>
                                마스크 제거
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </FormField>
                  ) : null}
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <FormField label="Width">
                  <Input type="number" min={64} step={64} value={naiForm.width} onChange={(event) => handleNaiFieldChange('width', event.target.value)} />
                </FormField>
                <FormField label="Height">
                  <Input type="number" min={64} step={64} value={naiForm.height} onChange={(event) => handleNaiFieldChange('height', event.target.value)} />
                </FormField>
                <FormField label="Steps">
                  <Input type="number" min={1} max={100} value={naiForm.steps} onChange={(event) => handleNaiFieldChange('steps', event.target.value)} />
                </FormField>
                <FormField label="CFG Scale">
                  <Input type="number" min={1} max={20} step={0.1} value={naiForm.scale} onChange={(event) => handleNaiFieldChange('scale', event.target.value)} />
                </FormField>
                <FormField label="Samples">
                  <Input type="number" min={1} max={8} value={naiForm.samples} onChange={(event) => handleNaiFieldChange('samples', event.target.value)} />
                </FormField>
                <FormField label="Seed" hint="비워두면 랜덤">
                  <Input type="number" value={naiForm.seed} onChange={(event) => handleNaiFieldChange('seed', event.target.value)} placeholder="random" />
                </FormField>
              </div>

              <div className="space-y-4 rounded-sm bg-surface-high p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-foreground">Advanced</div>
                    <div className="text-xs text-muted-foreground">백엔드에서 이미 지원하는 자주 쓰는 옵션만 먼저 열어뒀어.</div>
                  </div>
                  {naiCostQuery.isSuccess ? (
                    <Badge variant={naiCostQuery.data.canAfford ? 'secondary' : 'outline'}>
                      {naiCostQuery.data.isOpusFree ? 'Opus 무료 생성' : naiCostQuery.data.canAfford ? '잔액 충분' : '잔액 부족'}
                    </Badge>
                  ) : null}
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <FormField label="ucPreset">
                    <Input type="number" min={0} max={3} value={naiForm.ucPreset} onChange={(event) => handleNaiFieldChange('ucPreset', event.target.value)} />
                  </FormField>
                  <div className="space-y-2">
                    <div className="text-sm font-medium text-foreground">Variety+</div>
                    <ToggleRow variant="detail" className="justify-between">
                      <div className="min-w-0">
                        <div className="text-sm text-foreground">v4/v4.5 다양성 강화</div>
                        <div className="text-xs text-muted-foreground">NAI 4 계열에서 variety_plus 값을 같이 보낸다.</div>
                      </div>
                      <input
                        type="checkbox"
                        checked={naiForm.varietyPlus}
                        onChange={(event) => setNaiForm((current) => ({ ...current, varietyPlus: event.target.checked }))}
                      />
                    </ToggleRow>
                  </div>
                </div>

                {naiForm.action !== 'generate' ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField label="Strength">
                      <Input type="number" min={0} max={1} step={0.01} value={naiForm.strength} onChange={(event) => handleNaiFieldChange('strength', event.target.value)} />
                    </FormField>
                    <FormField label="Noise">
                      <Input type="number" min={0} max={1} step={0.01} value={naiForm.noise} onChange={(event) => handleNaiFieldChange('noise', event.target.value)} />
                    </FormField>
                  </div>
                ) : null}

                {naiForm.action === 'infill' ? (
                  <ToggleRow variant="detail" className="justify-between">
                    <div className="min-w-0">
                      <div className="text-sm text-foreground">Add original image</div>
                      <div className="text-xs text-muted-foreground">인페인트 결과에 원본 이미지 정보를 함께 전달한다.</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={naiForm.addOriginalImage}
                      onChange={(event) => setNaiForm((current) => ({ ...current, addOriginalImage: event.target.checked }))}
                    />
                  </ToggleRow>
                ) : null}

                {naiCostQuery.isError ? (
                  <div className="text-xs text-[#ffb4ab]">{getErrorMessage(naiCostQuery.error, '예상 비용 계산에 실패했어.')}</div>
                ) : null}

                {naiCostQuery.isSuccess ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <SummaryChip label="estimated" value={`${naiCostQuery.data.estimatedCost} Anlas`} />
                    <SummaryChip label="can afford" value={naiCostQuery.data.canAfford ? 'Yes' : 'No'} />
                    <SummaryChip label="opus free" value={naiCostQuery.data.isOpusFree ? 'Yes' : 'No'} />
                    <SummaryChip label="base cost" value={String(naiCostQuery.data.breakdown.baseCost)} />
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setNaiForm(DEFAULT_NAI_FORM)} disabled={isNaiGenerating}>
                  초기화
                </Button>
                <Button type="button" onClick={handleNaiGenerate} disabled={isNaiGenerating || naiForm.prompt.trim().length === 0}>
                  <ImagePlus className="h-4 w-4" />
                  {isNaiGenerating ? '생성 요청 중…' : 'NAI 생성'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-surface-container">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-2">
                <CardTitle className="flex items-center gap-2">
                  <WandSparkles className="h-4 w-4 text-primary" />
                  ComfyUI
                </CardTitle>
                <CardDescription>
                  저장된 워크플로우의 marked field를 읽어서 바로 생성 요청을 보낼 수 있어.
                </CardDescription>
              </div>
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
                <div>
                  <div className="text-sm font-medium text-foreground">ComfyUI 서버 등록</div>
                  <div className="text-xs text-muted-foreground">활성 서버가 없으면 여기서 바로 추가하면 돼.</div>
                </div>
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
                {(selectedWorkflow.marked_fields ?? []).length > 0 ? (
                  <div className="grid gap-4">
                    {selectedWorkflow.marked_fields.map((field) => {
                      const value = workflowDraft[field.id] ?? ''
                      const hint = [field.type, field.required ? 'required' : null].filter(Boolean).join(' · ')

                      if (field.type === 'textarea') {
                        return (
                          <FormField key={field.id} label={field.label} hint={hint}>
                            <Textarea
                              rows={4}
                              value={typeof value === 'string' ? value : ''}
                              placeholder={field.placeholder || ''}
                              onChange={(event) => handleWorkflowFieldChange(field.id, event.target.value)}
                            />
                            {field.description ? <div className="text-xs text-muted-foreground">{field.description}</div> : null}
                          </FormField>
                        )
                      }

                      if (field.type === 'select') {
                        return (
                          <FormField key={field.id} label={field.label} hint={hint}>
                            <Select value={typeof value === 'string' ? value : ''} onChange={(event) => handleWorkflowFieldChange(field.id, event.target.value)}>
                              <option value="">선택</option>
                              {(field.options ?? []).map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </Select>
                            {field.description ? <div className="text-xs text-muted-foreground">{field.description}</div> : null}
                          </FormField>
                        )
                      }

                      if (field.type === 'image') {
                        const imageValue = typeof value === 'string' ? null : value

                        return (
                          <FormField key={field.id} label={field.label} hint={hint}>
                            <div className="space-y-3">
                              <Input type="file" accept="image/*" onChange={(event) => void handleWorkflowImageChange(field.id, event.target.files?.[0])} />
                              {imageValue ? (
                                <div className="space-y-2 rounded-sm bg-surface-high p-3">
                                  <div className="text-xs text-muted-foreground">{imageValue.fileName}</div>
                                  <img src={imageValue.dataUrl} alt={field.label} className="max-h-40 rounded-sm border border-border object-contain" />
                                  <div className="flex justify-end">
                                    <Button type="button" size="sm" variant="ghost" onClick={() => void handleWorkflowImageChange(field.id)}>
                                      이미지 제거
                                    </Button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                            {field.description ? <div className="text-xs text-muted-foreground">{field.description}</div> : null}
                          </FormField>
                        )
                      }

                      return (
                        <FormField key={field.id} label={field.label} hint={hint}>
                          <Input
                            type={field.type === 'number' ? 'number' : 'text'}
                            min={field.type === 'number' ? field.min : undefined}
                            max={field.type === 'number' ? field.max : undefined}
                            value={typeof value === 'string' ? value : ''}
                            placeholder={field.placeholder || ''}
                            onChange={(event) => handleWorkflowFieldChange(field.id, event.target.value)}
                          />
                          {field.description ? <div className="text-xs text-muted-foreground">{field.description}</div> : null}
                        </FormField>
                      )
                    })}
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
      </div>

      <Card className="bg-surface-container">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-2">
              <CardTitle>Generation History</CardTitle>
              <CardDescription>백엔드의 통합 generation-history 테이블을 그대로 보여줘.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select className="w-40" value={historyFilter} onChange={(event) => setHistoryFilter(event.target.value as HistoryFilter)}>
                <option value="all">전체</option>
                <option value="novelai">NAI</option>
                <option value="comfyui">ComfyUI</option>
              </Select>
              <Button type="button" variant="outline" onClick={() => void historyQuery.refetch()}>
                <RefreshCw className="h-4 w-4" />
                새로고침
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {historyQuery.isError ? (
            <Alert variant="destructive">
              <AlertTitle>히스토리를 불러오지 못했어</AlertTitle>
              <AlertDescription>{getErrorMessage(historyQuery.error, '생성 히스토리 조회 실패')}</AlertDescription>
            </Alert>
          ) : null}

          {historyQuery.isPending ? <div className="text-sm text-muted-foreground">히스토리 불러오는 중…</div> : null}

          {!historyQuery.isPending && (historyQuery.data?.records.length ?? 0) === 0 ? (
            <div className="rounded-sm bg-surface-low px-4 py-6 text-sm text-muted-foreground">아직 생성 이력이 없어. 위에서 바로 하나 날려보면 돼.</div>
          ) : null}

          <div className="space-y-3">
            {historyQuery.data?.records.map((record) => {
              const detailHref = getHistoryDetailHref(record)
              const prompt = record.positive_prompt?.trim() || '프롬프트 없음'
              const metaLine = `${record.width ?? '?'} × ${record.height ?? '?'} · ${formatHistoryDate(record.created_at)}`

              return (
                <div key={record.id} className="rounded-sm bg-surface-low p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary">{getHistoryServiceLabel(record.service_type)}</Badge>
                        <Badge variant={record.generation_status === 'failed' ? 'outline' : 'secondary'}>{getHistoryStatusLabel(record.generation_status)}</Badge>
                        <span className="text-sm font-medium text-foreground">#{record.id} · {getHistoryTitle(record)}</span>
                      </div>
                      <div className="max-w-4xl text-sm text-foreground">{prompt}</div>
                      <div className="text-xs text-muted-foreground">{metaLine}</div>
                      {record.error_message ? <div className="text-xs text-[#ffb4ab]">{record.error_message}</div> : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {detailHref ? (
                        <Button asChild type="button" size="sm" variant="outline">
                          <Link to={detailHref}>이미지 보기</Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
