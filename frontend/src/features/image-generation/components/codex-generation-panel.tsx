import { CodexIcon } from '@/components/common/provider-icons'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { createPortal } from 'react-dom'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, ArrowDown, LogIn, RefreshCw, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { CODEX_REFERENCE_ROLES, codexReferenceSlots, codexAttachmentUsage, codexReferencePayload, canEnableCodexStrict, shouldConfirmCodexHistoryLoad, type CodexReferenceDraft } from '../codex-reference-draft'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useCodexChatPage } from './use-codex-chat-page'
import { Text } from '@/components/ui/text'
import { Tip } from '@/components/ui/tooltip'
import { Select } from '@/components/ui/select'
import { getRuntimeImageSaveSettings } from '@/lib/api-settings'
import { createGenerationQueueJob, getCodexGenerationModels, getCodexGenerationStatus } from '@/lib/api-image-generation-queue'
import { useI18n } from '@/i18n'
import { DEFAULT_IMAGE_SAVE_SETTINGS } from '@/lib/image-save-output'
import { cn } from '@/lib/utils'
import { getErrorMessage, type SelectedImageDraft } from '../image-generation-shared'
import { consumeHistorySettingsLoad, usePendingHistorySettingsLoad } from '../history-settings-load-store'
import { confirmHistorySettingsOverwrite, getHistorySettingsLoadedMessage } from '../history-settings-mapping'
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { refreshGenerationQueueViews } from './generation-queue-actions'
import { Section } from '@/components/ui/section'
import { NaiPromptSection } from './nai-generation-panel-sections'
import { NaiSelectedImageCard } from './nai-selected-image-card'
import { normalizeTextSegmentSpreadsheetText } from './text-segment-spreadsheet-input'
import { GenerateActionBar, GenerateActionDock } from './generate-action-bar'
import { GenerationToolbarStatus, usePortalTargetById } from './generation-toolbar-status'
import { ResolutionPicker } from './resolution-picker'
import { IMAGE_GENERATION_TARGET_GROUP_KEY, useGenerationTargetGroupPath } from '@/features/groups/generation-target-group-store'
import { CodexPromptPresetButton } from './codex-prompt-preset-button'
import { CodexDeviceLoginDialog } from './codex-device-login-dialog'
import { CodexCliUpdateButton } from './codex-cli-update-button'
import { CodexModelSelect } from './codex-model-select'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { resolveAccountDraftOwner } from '@/features/auth/auth-permissions'
import { GenerationBlockLayout, StackedPluginBlocks } from '../layout/generation-block-layout'
import { useGenerationLayoutSurface } from '../layout/generation-layout-context'
import { stackedLayoutBlocks } from '../layout/generation-layout-ops'

type CodexGenerationPanelProps = {
  onHistoryRefresh: () => void
  splitPaneScroll?: boolean
  headerPortalTargetId?: string
  compactActionBarContentTargetId?: string
  /** Page toolbar slot for the Codex status; replaces the inline Codex header row. */
  statusPortalTargetId?: string
  /** Wide page: render the editor and `result` as the shared block layout instead of a single scroll column. */
  blockLayout?: { result: ReactNode }
}

type CodexEditorBlock = 'model' | 'prompt' | 'output' | 'images'

export type CodexFormDraft = {
  model: string
  prompt: string
  negativePrompt: string
  count: string
  aspectRatio: string
  resolution: string
  imageMode: 'reference' | 'edit'
  referenceImage?: SelectedImageDraft
  maskImage?: SelectedImageDraft
  references: CodexReferenceDraft[]
  strictPreservation: boolean
}

const CODEX_COUNT_MIN = 1
const CODEX_COUNT_MAX = 4
const CODEX_FORM_DRAFT_STORAGE_KEY = 'conai:image-generation:codex-form-draft:v1'

const CODEX_ASPECT_RATIO_OPTIONS = [
  { value: 'random', label: 'Random' },
  { value: '1:1', label: '1:1', width: 1, height: 1 },
  { value: '4:3', label: '4:3', width: 4, height: 3 },
  { value: '3:4', label: '3:4', width: 3, height: 4 },
  { value: '16:9', label: '16:9', width: 16, height: 9 },
  { value: '9:16', label: '9:16', width: 9, height: 16 },
] as const

const CODEX_RESOLUTION_OPTIONS = [
  { value: '1024', label: '1024px' },
  { value: '1536', label: '1536px' },
  { value: '2048', label: '2048px' },
] as const

const DEFAULT_CODEX_FORM: CodexFormDraft = {
  model: '',
  prompt: '',
  negativePrompt: '',
  count: '1',
  aspectRatio: '1:1',
  resolution: '1024',
  imageMode: 'reference',
  references: [],
  strictPreservation: false,
}

type PersistedCodexFormDraft = Pick<CodexFormDraft, 'model' | 'prompt' | 'negativePrompt' | 'count' | 'aspectRatio' | 'resolution' | 'imageMode' | 'references' | 'strictPreservation'>

function loadPersistedCodexFormDraft(owner: string): CodexFormDraft {
  if (typeof window === 'undefined') {
    return DEFAULT_CODEX_FORM
  }

  try {
    const rawValue = window.localStorage.getItem(`${CODEX_FORM_DRAFT_STORAGE_KEY}:${owner}`)
    if (!rawValue) {
      return DEFAULT_CODEX_FORM
    }

    const parsedValue = JSON.parse(rawValue) as Partial<PersistedCodexFormDraft>
    return {
      ...DEFAULT_CODEX_FORM,
      model: typeof parsedValue.model === 'string' ? parsedValue.model : '',
      prompt: typeof parsedValue.prompt === 'string' ? parsedValue.prompt : DEFAULT_CODEX_FORM.prompt,
      negativePrompt: typeof parsedValue.negativePrompt === 'string' ? parsedValue.negativePrompt : DEFAULT_CODEX_FORM.negativePrompt,
      count: typeof parsedValue.count === 'string' ? parsedValue.count : DEFAULT_CODEX_FORM.count,
      aspectRatio: typeof parsedValue.aspectRatio === 'string' ? parsedValue.aspectRatio : DEFAULT_CODEX_FORM.aspectRatio,
      resolution: typeof parsedValue.resolution === 'string' ? parsedValue.resolution : DEFAULT_CODEX_FORM.resolution,
      imageMode: parsedValue.imageMode === 'edit' ? 'edit' : 'reference',
      references: codexReferenceSlots(parsedValue.references),
      strictPreservation: parsedValue.imageMode === 'edit' && parsedValue.strictPreservation === true,
    }
  } catch {
    return DEFAULT_CODEX_FORM
  }
}

function persistCodexFormDraft(owner: string, form: CodexFormDraft) {
  if (typeof window === 'undefined') {
    return
  }

  const persistableDraft: PersistedCodexFormDraft = {
    model: form.model,
    prompt: form.prompt,
    negativePrompt: form.negativePrompt,
    count: form.count,
    aspectRatio: form.aspectRatio,
    resolution: form.resolution,
    imageMode: form.imageMode,
    references: codexReferenceSlots(form.references),
    strictPreservation: form.strictPreservation,
  }

  try {
    window.localStorage.setItem(`${CODEX_FORM_DRAFT_STORAGE_KEY}:${owner}`, JSON.stringify(persistableDraft))
  } catch {
    // Ignore quota/private-mode persistence failures.
  }
}

function clampCodexCount(value: string | number, fallback = CODEX_COUNT_MIN) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  const integerValue = Math.trunc(parsed)
  return Math.min(CODEX_COUNT_MAX, Math.max(CODEX_COUNT_MIN, integerValue))
}

function roundCodexDimension(value: number) {
  return Math.max(64, Math.round(value / 64) * 64)
}

function isSizedCodexAspectRatioOption(
  option: (typeof CODEX_ASPECT_RATIO_OPTIONS)[number],
): option is Extract<(typeof CODEX_ASPECT_RATIO_OPTIONS)[number], { width: number; height: number }> {
  return 'width' in option && 'height' in option
}

function pickCodexAspectRatio(aspectRatio: string) {
  if (aspectRatio !== 'random') {
    return aspectRatio
  }

  const candidateOptions = CODEX_ASPECT_RATIO_OPTIONS.filter(isSizedCodexAspectRatioOption)
  if (candidateOptions.length === 0) {
    return '1:1'
  }

  const randomIndex = Math.floor(Math.random() * candidateOptions.length)
  return candidateOptions[randomIndex]?.value ?? '1:1'
}

function resolveCodexSize(aspectRatio: string, resolution: string) {
  const aspect = CODEX_ASPECT_RATIO_OPTIONS
    .filter(isSizedCodexAspectRatioOption)
    .find((option) => option.value === aspectRatio)
  const longEdge = Number(resolution)
  if (!aspect || !Number.isFinite(longEdge) || longEdge <= 0) {
    return undefined
  }

  const scale = longEdge / Math.max(aspect.width, aspect.height)
  const width = roundCodexDimension(aspect.width * scale)
  const height = roundCodexDimension(aspect.height * scale)
  return `${width}x${height}`
}

/** Recover the aspect-ratio/resolution pair that produced a stored Codex `size` (e.g. "1024x768"). */
function resolveCodexAspectRatioAndResolution(size: unknown) {
  if (typeof size !== 'string') {
    return null
  }

  for (const aspectOption of CODEX_ASPECT_RATIO_OPTIONS.filter(isSizedCodexAspectRatioOption)) {
    for (const resolutionOption of CODEX_RESOLUTION_OPTIONS) {
      if (resolveCodexSize(aspectOption.value, resolutionOption.value) === size.trim()) {
        return { aspectRatio: aspectOption.value as string, resolution: resolutionOption.value as string }
      }
    }
  }

  return null
}

/** Restore text and mode; historical image inputs must be reattached rather than reusing unrelated current images. */
function buildCodexFormFromHistoryPayload(payload: Record<string, unknown>, current: CodexFormDraft) {
  const sizeSelection = resolveCodexAspectRatioAndResolution(payload.size)
  return {
    form: {
      ...current,
      model: typeof payload.model === 'string' ? payload.model : '',
      prompt: typeof payload.prompt === 'string' ? payload.prompt : '',
      negativePrompt: typeof payload.negative_prompt === 'string' ? payload.negative_prompt : '',
      imageMode: payload.operation === 'edit' || payload.operation === 'infill' ? 'edit' : 'reference',
      referenceImage: undefined,
      maskImage: undefined,
      references: codexReferenceSlots(payload.references),
      strictPreservation: payload.preserve === 'strict',
      ...(sizeSelection ?? {}),
    } satisfies CodexFormDraft,
    hasImageInputs: payload.operation === 'edit' || payload.operation === 'infill' || 'image' in payload || Boolean(codexReferenceSlots(payload.references).length),
  }
}

/** Render the Codex image-generation controller with the same controller chrome used by other generation tabs. */
export function CodexGenerationPanel({
  onHistoryRefresh,
  splitPaneScroll = false,
  headerPortalTargetId,
  compactActionBarContentTargetId,
  statusPortalTargetId,
  blockLayout,
}: CodexGenerationPanelProps) {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const authStatusQuery = useAuthStatusQuery()
  const draftStorageOwner = resolveAccountDraftOwner(authStatusQuery.data)
  const [codexForm, setCodexForm] = useState<CodexFormDraft>(() => loadPersistedCodexFormDraft(draftStorageOwner))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const modelOptionsQuery = useQuery({ queryKey: ['codex-generation-models'], queryFn: getCodexGenerationModels, staleTime: 60_000, retry: false })
  useCodexChatPage(codexForm, setCodexForm, modelOptionsQuery.data?.data.models ?? [])
  const [, setPortalRevision] = useState(0)

  const confirm = useConfirm()
  const pendingHistorySettingsLoad = usePendingHistorySettingsLoad()
  const handledHistorySettingsLoadNonceRef = useRef(0)
  useEffect(() => {
    const request = pendingHistorySettingsLoad
    if (!request || request.serviceType !== 'codex' || handledHistorySettingsLoadNonceRef.current === request.nonce) {
      return
    }

    handledHistorySettingsLoadNonceRef.current = request.nonce
    consumeHistorySettingsLoad(request.nonce)
    const { form: nextForm, hasImageInputs } = buildCodexFormFromHistoryPayload(request.payload, codexForm)
    void (async () => {
      if (shouldConfirmCodexHistoryLoad(codexForm, nextForm) && !(await confirmHistorySettingsOverwrite(confirm, t))) {
        return
      }

      setCodexForm(nextForm)
      showSnackbar({ message: getHistorySettingsLoadedMessage(t, request.historyId, hasImageInputs), tone: 'info' })
    })()
  }, [codexForm, confirm, pendingHistorySettingsLoad, showSnackbar, t])

  const appSettingsQuery = useQuery({
    queryKey: ['runtime-image-save-settings'],
    queryFn: getRuntimeImageSaveSettings,
  })

  const codexStatusQuery = useQuery({
    queryKey: ['codex-generation-status'],
    queryFn: getCodexGenerationStatus,
    retry: false,
  })
  const refetchCodexStatus = codexStatusQuery.refetch

  const generationSaveSettings = appSettingsQuery.data?.imageSave ?? DEFAULT_IMAGE_SAVE_SETTINGS

  useEffect(() => {
    if ((!headerPortalTargetId && !compactActionBarContentTargetId) || typeof document === 'undefined') {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      setPortalRevision((current) => current + 1)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [compactActionBarContentTargetId, headerPortalTargetId])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      persistCodexFormDraft(draftStorageOwner, codexForm)
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [codexForm, draftStorageOwner])

  const operationLabel = useMemo(() => {
    if (codexForm.imageMode === 'edit' && codexForm.referenceImage && codexForm.maskImage) {
      return 'Infill'
    }

    if (codexForm.imageMode === 'edit') {
      return 'Edit'
    }

    return codexForm.referenceImage ? 'Reference' : 'Generate'
  }, [codexForm.imageMode, codexForm.maskImage, codexForm.referenceImage])

  const queueCount = useMemo(() => clampCodexCount(codexForm.count), [codexForm.count])
  const attachmentUsage = codexAttachmentUsage([codexForm.referenceImage, codexForm.maskImage, ...codexForm.references.map((reference) => reference.image)])
  const attachmentLimitExceeded = attachmentUsage.count > 5 || attachmentUsage.bytes > 32 * 1024 * 1024 || attachmentUsage.oversized
  const outputSize = useMemo(() => resolveCodexSize(codexForm.aspectRatio, codexForm.resolution), [codexForm.aspectRatio, codexForm.resolution])
  const outputSizeHint = codexForm.aspectRatio === 'random' ? t({ ko: '랜덤 비율', en: 'Random ratio' }) : outputSize
  const useDrawerCompactChrome = Boolean(headerPortalTargetId)
  const useStickyActionBar = Boolean(compactActionBarContentTargetId) && !splitPaneScroll
  const statusPortalTarget = usePortalTargetById(statusPortalTargetId)
  const headerPortalTarget = headerPortalTargetId && typeof document !== 'undefined'
    ? document.getElementById(headerPortalTargetId)
    : null
  const compactActionBarPortalTarget = compactActionBarContentTargetId && typeof document !== 'undefined'
    ? document.getElementById(compactActionBarContentTargetId)
    : null
  const codexStatus = codexStatusQuery.data?.data ?? null
  const canGenerateWithCodex = codexStatusQuery.isSuccess ? Boolean(codexStatus?.available) : false
  const showStatusRecovery = codexStatusQuery.isError || (codexStatusQuery.isSuccess && !codexStatus?.available)
  // 서버 전체를 한 계정으로 로그인시키는 동작이라 관리자에게만 노출한다.
  const isAdmin = authStatusQuery.data?.isAdmin === true
  const canStartCodexLogin = isAdmin
    && codexStatusQuery.isSuccess && Boolean(codexStatus?.installed) && !codexStatus?.authenticated
  const [isCodexLoginOpen, setIsCodexLoginOpen] = useState(false)
  const useInlineActionBar = splitPaneScroll

  const generateButtonLabel = isSubmitting
    ? t({ ko: '큐 등록 중…', en: 'Adding to queue…' })
    : codexStatusQuery.isPending
      ? t({ ko: '상태 확인 중…', en: 'Checking status…' })
      : codexStatusQuery.isError
        ? t({ ko: '재확인 후 생성', en: 'Check again and generate' })
        : codexStatus?.available
          ? t({ ko: '생성', en: 'Generate' })
          : codexStatus?.installed
            ? t({ ko: '로그인 확인 후 생성', en: 'Check login and generate' })
            : t({ ko: 'Codex 확인 후 생성', en: 'Check Codex and generate' })

  const handleFieldChange = useCallback(<K extends keyof CodexFormDraft>(field: K, value: CodexFormDraft[K]) => {
    setCodexForm((current) => ({
      ...current,
      [field]: value,
    }))
  }, [])

  const handleReset = useCallback(async () => {
    const hasLosableContent = codexForm.prompt.trim().length > 0
      || codexForm.negativePrompt.trim().length > 0
      || Boolean(codexForm.referenceImage)
      || Boolean(codexForm.maskImage)
      || codexForm.references.length > 0
    if (hasLosableContent) {
      const confirmed = await confirm({
        title: t({ ko: 'Codex 설정을 초기화할까?', en: 'Reset the Codex settings?' }),
        description: t({
          ko: '프롬프트, 참조·마스크 이미지와 저장된 초안이 지워져. 되돌릴 수 없어.',
          en: 'Prompts, reference/mask images and the saved draft will be cleared. This cannot be undone.',
        }),
        confirmLabel: t({ ko: '초기화', en: 'Reset' }),
        tone: 'destructive',
      })
      if (!confirmed) {
        return
      }
    }

    setCodexForm(DEFAULT_CODEX_FORM)
  }, [codexForm.maskImage, codexForm.negativePrompt, codexForm.prompt, codexForm.referenceImage, codexForm.references, confirm, t])

  const handleRefreshStatus = useCallback(() => {
    void refetchCodexStatus()
  }, [refetchCodexStatus])

  const handleCloseCodexLogin = useCallback(() => setIsCodexLoginOpen(false), [])

  const codexLoginButton = canStartCodexLogin ? (
    <IconButton variant="ghost" size="icon-sm" onClick={() => setIsCodexLoginOpen(true)} label={t({ ko: 'Codex 로그인', en: 'Sign in to Codex' })}>
      <LogIn />
    </IconButton>
  ) : null
  const codexUpdateButton = isAdmin ? <CodexCliUpdateButton onUpdated={handleRefreshStatus} /> : null

  const { requestPath: targetGroupPath } = useGenerationTargetGroupPath(IMAGE_GENERATION_TARGET_GROUP_KEY)

  const handleGenerate = useCallback(async () => {
    if (isSubmitting) {
      return
    }

    if (codexStatusQuery.isSuccess && !codexStatus?.available) {
      const codexInstalled = codexStatus?.installed ?? false
      showSnackbar({
        message: codexInstalled ? t({ ko: 'Codex 로그인 상태부터 확인해줘.', en: 'Check the Codex login status first.' }) : t({ ko: '이 서버에서 Codex를 아직 바로 쓸 수 없는 상태야.', en: 'Codex is not ready to use directly on this server yet.' }),
        tone: 'error',
      })
      return
    }

    const prompt = normalizeTextSegmentSpreadsheetText(codexForm.prompt).trim()

    if (prompt.length === 0) {
      showSnackbar({ message: t({ ko: 'Codex 프롬프트를 먼저 넣어줘.', en: 'Enter a Codex prompt first.' }), tone: 'error' })
      return
    }

    if (codexForm.maskImage && !codexForm.referenceImage) {
      showSnackbar({ message: t({ ko: '마스크를 쓰려면 먼저 참조 이미지를 넣어줘.', en: 'Choose a reference image before using a mask.' }), tone: 'error' })
      return
    }

    if (codexForm.imageMode === 'edit' && !codexForm.referenceImage) {
      showSnackbar({ message: t({ ko: '편집할 원본 이미지를 첨부해줘.', en: 'Attach the source image to edit.' }), tone: 'error' })
      return
    }

    try {
      if (attachmentLimitExceeded) throw new Error(t({ ko: '첨부 개수와 용량 제한을 확인해줘.', en: 'Check attachment count and byte limits.' }))
      if (codexForm.strictPreservation && (codexForm.imageMode !== 'edit' || !codexForm.maskImage)) {
        throw new Error(t({ ko: '엄격 보존에는 원본과 마스크를 다시 첨부해야 해.', en: 'Strict preservation requires a source and mask to be attached.' }))
      }
      const references = codexReferencePayload(codexForm.references)
      setIsSubmitting(true)
      const response = await createGenerationQueueJob({
        service_type: 'codex',
        requested_group_path: targetGroupPath,
        request_summary: `Codex ${operationLabel} · ${prompt.slice(0, 48)}`,
        request_payload: {
          model: codexForm.model.trim() || undefined,
          prompt,
          negative_prompt: normalizeTextSegmentSpreadsheetText(codexForm.negativePrompt).trim() || undefined,
          count: queueCount,
          operation: codexForm.imageMode === 'edit' ? (codexForm.maskImage ? 'infill' : 'edit') : 'generate',
          size: resolveCodexSize(pickCodexAspectRatio(codexForm.aspectRatio), codexForm.resolution),
          image: codexForm.referenceImage?.dataUrl,
          mask: codexForm.imageMode === 'edit' ? codexForm.maskImage?.dataUrl : undefined,
          references,
          preserve: codexForm.strictPreservation ? 'strict' : undefined,
          imageSaveOptions: {
            format: generationSaveSettings.defaultFormat,
            quality: generationSaveSettings.quality,
            resizeEnabled: generationSaveSettings.resizeEnabled,
            maxWidth: generationSaveSettings.maxWidth,
            maxHeight: generationSaveSettings.maxHeight,
          },
        },
      })

      await refreshGenerationQueueViews(queryClient, onHistoryRefresh)
      showSnackbar({ message: response.message || t({ ko: 'Codex 큐에 생성 작업을 넣었어.', en: 'Added the Codex generation job to the queue.' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: 'Codex 이미지 생성에 실패했어.', en: 'Failed to generate the Codex image.' })), tone: 'error' })
    } finally {
      setIsSubmitting(false)
    }
  }, [
    codexForm,
    attachmentLimitExceeded,
    codexStatus?.available,
    codexStatus?.installed,
    codexStatusQuery.isSuccess,
    generationSaveSettings.defaultFormat,
    generationSaveSettings.maxHeight,
    generationSaveSettings.maxWidth,
    generationSaveSettings.quality,
    generationSaveSettings.resizeEnabled,
    isSubmitting,
    onHistoryRefresh,
    operationLabel,
    queryClient,
    queueCount,
    showSnackbar,
    t,
    targetGroupPath,
  ])

  const headerToolbarContent = (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex items-center gap-2">
        <CodexIcon className="size-5 text-foreground" aria-label="Codex" role="img" aria-hidden={undefined} />
      </div>
      <div className="flex items-center gap-1">
        {showStatusRecovery ? (
          <IconButton
            variant="ghost"
            size="icon-sm"
            onClick={handleRefreshStatus}
            disabled={codexStatusQuery.isPending}
            label={t({ ko: 'Codex 상태 재확인', en: 'Recheck Codex status' })}
          >
            <RefreshCw className={cn(codexStatusQuery.isPending && 'animate-spin')} />
          </IconButton>
        ) : null}
        {codexLoginButton}
        {codexUpdateButton}
        {useDrawerCompactChrome ? (
          <IconButton variant="ghost" size="icon-sm" onClick={() => void handleReset()} disabled={isSubmitting} label={t({ ko: '초기화', en: 'Reset' })}>
            <RotateCcw />
          </IconButton>
        ) : null}
      </div>
    </div>
  )

  const codexGenerateDisabled = codexForm.prompt.trim().length === 0 || !canGenerateWithCodex
    || (codexForm.imageMode === 'edit' && !codexForm.referenceImage)
    || attachmentLimitExceeded || codexForm.references.some((reference) => !reference.image)
    || (codexForm.strictPreservation && (codexForm.imageMode !== 'edit' || !codexForm.maskImage))
  const codexRepeat = {
    value: codexForm.count,
    min: CODEX_COUNT_MIN,
    max: CODEX_COUNT_MAX,
    onChange: (value: string) => handleFieldChange('count', value),
  }

  const actionSection = (
    <GenerateActionBar
      variant="inline"
      generateLabel={generateButtonLabel}
      onGenerate={() => void handleGenerate()}
      generateDisabled={codexGenerateDisabled}
      isGenerating={isSubmitting}
      repeat={codexRepeat}
      onReset={() => void handleReset()}
      targetGroupStorageKey={IMAGE_GENERATION_TARGET_GROUP_KEY}
    />
  )

  const compactActionBarContent = (
    <GenerateActionBar
      variant="sticky"
      generateLabel={generateButtonLabel}
      onGenerate={() => void handleGenerate()}
      generateDisabled={codexGenerateDisabled}
      isGenerating={isSubmitting}
      repeat={codexRepeat}
      onReset={useDrawerCompactChrome ? undefined : () => void handleReset()}
      targetGroupStorageKey={IMAGE_GENERATION_TARGET_GROUP_KEY}
    />
  )

  const statusRecheckButton = showStatusRecovery ? (
    <IconButton
      variant="ghost"
      size="icon-sm"
      onClick={handleRefreshStatus}
      disabled={codexStatusQuery.isPending}
      label={t({ ko: 'Codex 상태 재확인', en: 'Recheck Codex status' })}
    >
      <RefreshCw className={cn(codexStatusQuery.isPending && 'animate-spin')} />
    </IconButton>
  ) : null

  const toolbarStatusContent = (
    <GenerationToolbarStatus
      tone={codexStatusQuery.isPending ? 'pending' : codexStatus?.available ? 'ready' : 'warning'}
      label={codexStatusQuery.isPending
        ? t({ ko: '상태 확인 중…', en: 'Checking status…' })
        : codexStatusQuery.isError
          ? t({ ko: '확인 실패', en: 'Check failed' })
          : codexStatus?.available
            ? t({ ko: '사용 가능', en: 'Ready' })
            : codexStatus?.installed
              ? t({ ko: '로그인 필요', en: 'Sign-in needed' })
              : t({ ko: 'Codex 없음', en: 'Codex missing' })}
    >
      {statusRecheckButton}
      {codexLoginButton}
      {codexUpdateButton}
    </GenerationToolbarStatus>
  )

  const inlineHeaderContent = (
    <div className="space-y-3">
      {headerToolbarContent}
    </div>
  )

  const editorBlocks: Record<CodexEditorBlock, ReactNode> = {
    model: (
      <Tip content={t({ ko: 'Codex 실행 모델: 프롬프트를 해석하고 이미지를 만드는 에이전트 모델', en: 'Codex agent model: the agent that reads the prompt and makes the image' })}>
        <div>
          <CodexModelSelect
            value={codexForm.model}
            onChange={(value) => handleFieldChange('model', value)}
            models={modelOptionsQuery.data?.data.models}
            aria-label={t({ ko: 'Codex 실행 모델', en: 'Codex agent model' })}
          />
        </div>
      </Tip>
    ),
    prompt: (
      <div className="space-y-3">
        <NaiPromptSection
          tool="codex"
          prompt={codexForm.prompt}
          negativePrompt={codexForm.negativePrompt}
          onPromptChange={(value) => handleFieldChange('prompt', value)}
          onNegativePromptChange={(value) => handleFieldChange('negativePrompt', value)}
        />
        <div className="flex justify-end">
          <CodexPromptPresetButton prompt={codexForm.prompt} negativePrompt={codexForm.negativePrompt} />
        </div>
      </div>
    ),
    output: (
      <Section variant="settings" heading={t({ ko: '출력', en: 'Output' })} className="@container">
        <Text variant="muted">{codexForm.strictPreservation
          ? t({ ko: '엄격 보존: 출력 크기는 원본 이미지 크기로 고정돼. 다른 요청 크기는 무시해.', en: 'Strict preservation: output size is locked to the source image. Other requested sizes are overridden.' })
          : t({ ko: '요청 크기 · 실제 크기는 다를 수 있어.', en: 'Requested size · actual size may differ.' })}</Text>
        {!codexForm.strictPreservation ? <div className="grid gap-4 @sm:grid-cols-2 @3xl:grid-cols-3">
          <ResolutionPicker
            mode="ratio"
            ratio={codexForm.aspectRatio}
            ratios={CODEX_ASPECT_RATIO_OPTIONS.map((option) => ({
              value: option.value,
              label: option.value === 'random' ? t({ ko: '랜덤', en: 'Random' }) : option.label,
            }))}
            onRatioChange={(value) => handleFieldChange('aspectRatio', value)}
            tier={codexForm.resolution}
            tiers={CODEX_RESOLUTION_OPTIONS}
            tierHint={outputSizeHint}
            onTierChange={(value) => handleFieldChange('resolution', value)}
          />
        </div> : null}
      </Section>
    ),
    images: (
      <Section variant="settings" heading={t({ ko: '이미지', en: 'Images' })} className="@container">
        <Tip content={t({ ko: '이미지 사용 방식: 참조로만 쓸지, 원본을 직접 편집할지', en: 'Image usage: reference only, or edit the source directly' })}>
          <Select aria-label={t({ ko: '이미지 사용 방식', en: 'Image usage' })} value={codexForm.imageMode} onChange={(event) => setCodexForm((current) => ({ ...current, imageMode: event.target.value === 'edit' ? 'edit' : 'reference', maskImage: undefined, strictPreservation: false }))}>
            <option value="reference">{t({ ko: '새 이미지 생성 · 참조 (t2i)', en: 'New image · reference (t2i)' })}</option>
            <option value="edit">{t({ ko: '원본 이미지 편집 (i2i)', en: 'Edit source image (i2i)' })}</option>
          </Select>
        </Tip>
        <div className="grid gap-4 @2xl:grid-cols-2">
          <div className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Text variant="label">{codexForm.imageMode === 'edit' ? t({ ko: '원본', en: 'Source' }) : t({ ko: '참조', en: 'Reference' })}</Text>
              <div className="flex items-center gap-1">
                <ImageAttachmentPickerButton
                  label={codexForm.imageMode === 'edit'
                    ? (codexForm.referenceImage ? t({ ko: '원본 이미지 교체', en: 'Replace source image' }) : t({ ko: '원본 이미지 선택', en: 'Select source image' }))
                    : (codexForm.referenceImage ? t({ ko: '참조 이미지 교체', en: 'Replace reference image' }) : t({ ko: '참조 이미지 선택 (선택 사항)', en: 'Select reference image (optional)' }))}
                  modalTitle={t({ ko: 'Codex 참조 이미지 선택', en: 'Select Codex reference image' })}
                  preserveOriginal={codexForm.imageMode === 'edit'}
                  onSelect={(image) => {
                    setCodexForm((current) => ({
                      ...current,
                      referenceImage: image,
                      maskImage: undefined,
                    }))
                  }}
                />
                {codexForm.referenceImage ? (
                  <IconButton
                    variant="destructive-ghost"
                    onClick={() => setCodexForm((current) => ({ ...current, referenceImage: undefined, maskImage: undefined }))}
                    label={codexForm.imageMode === 'edit' ? t({ ko: '원본 이미지 제거', en: 'Remove source image' }) : t({ ko: '참조 이미지 제거', en: 'Remove reference image' })}
                  >
                    <X />
                  </IconButton>
                ) : null}
              </div>
            </div>

            {codexForm.referenceImage ? (
              <NaiSelectedImageCard image={codexForm.referenceImage} alt={t({ ko: 'Codex 참조 이미지', en: 'Codex reference image' })} />
            ) : null}
          </div>

          {codexForm.imageMode === 'edit' ? <div className="min-w-0 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <Text variant="label">{t({ ko: '마스크', en: 'Mask' })}</Text>
              <div className="flex items-center gap-1">
                <ImageAttachmentPickerButton
                  label={codexForm.maskImage ? t({ ko: '마스크 이미지 교체', en: 'Replace mask image' }) : t({ ko: '마스크 이미지 선택', en: 'Select mask image' })}
                  modalTitle={t({ ko: 'Codex 마스크 이미지 선택', en: 'Select Codex mask image' })}
                  preserveOriginal
                  disabled={!codexForm.referenceImage}
                  onSelect={(image) => handleFieldChange('maskImage', image)}
                />
                {codexForm.maskImage ? (
                  <IconButton
                    variant="destructive-ghost"
                    onClick={() => handleFieldChange('maskImage', undefined)}
                    label={t({ ko: '마스크 제거', en: 'Remove mask' })}
                  >
                    <X />
                  </IconButton>
                ) : null}
              </div>
            </div>

            {codexForm.maskImage ? (
              <NaiSelectedImageCard image={codexForm.maskImage} alt={t({ ko: 'Codex 마스크 이미지', en: 'Codex mask image' })} />
            ) : null}
          </div> : null}
        </div>
        {codexForm.imageMode === 'edit' ? (
          <label className="flex items-center gap-2">
            <Checkbox checked={codexForm.strictPreservation} disabled={!canEnableCodexStrict(codexForm) && !codexForm.strictPreservation} onCheckedChange={(checked) => handleFieldChange('strictPreservation', checked === true)} />
            <Text variant="label">{t({ ko: '엄격 마스크 보존 · 검정 픽셀 고정, 원본 크기 PNG만 저장', en: 'Strict mask preservation · lock black pixels, source-sized PNG only' })}</Text>
          </label>
        ) : null}
        <Text variant="muted">
          {t({ ko: '첨부 {count}/5 · {bytes} MiB/32 MiB · 파일당 10 MiB, 최대 4096px · 원본/마스크 포함', en: 'Attachments {count}/5 · {bytes} MiB/32 MiB · 10 MiB each, max 4096px · includes source/mask' }, { count: attachmentUsage.count, bytes: (attachmentUsage.bytes / 1024 / 1024).toFixed(2) })}
        </Text>
        <Text variant="muted">{t({ ko: '원본·참조: PNG/JPEG/WebP · 마스크: 원본과 같은 크기의 PNG', en: 'Source/references: PNG/JPEG/WebP · mask: source-sized PNG' })}</Text>
        {codexForm.references.map((reference, index) => (
          <div key={index} className="space-y-2 border-b border-line py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Text variant="label">{t({ ko: '참조 {index}', en: 'Reference {index}' }, { index: index + 1 })}</Text>
              <Select aria-label={t({ ko: '참조 역할', en: 'Reference role' })} value={reference.role} onChange={(event) => handleFieldChange('references', codexForm.references.map((item, position) => position === index ? { ...item, role: event.target.value as CodexReferenceDraft['role'] } : item))}>
                {CODEX_REFERENCE_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
              </Select>
              <Input aria-label={t({ ko: '참조 설명', en: 'Reference label' })} maxLength={128} value={reference.label} onChange={(event) => handleFieldChange('references', codexForm.references.map((item, position) => position === index ? { ...item, label: event.target.value } : item))} />
              <ImageAttachmentPickerButton
                label={reference.image ? t({ ko: '참조 교체', en: 'Replace reference' }) : t({ ko: '참조 다시 첨부', en: 'Attach reference' })}
                onSelect={(image) => handleFieldChange('references', codexForm.references.map((item, position) => position === index ? { ...item, image } : item))}
              />
              {([-1, 1] as const).map((direction) => (
                <IconButton key={direction} variant="ghost" label={direction < 0 ? t({ ko: '위로', en: 'Move up' }) : t({ ko: '아래로', en: 'Move down' })} disabled={index + direction < 0 || index + direction >= codexForm.references.length} onClick={() => {
                  const references = [...codexForm.references]
                  ;[references[index], references[index + direction]] = [references[index + direction], references[index]]
                  handleFieldChange('references', references)
                }}>{direction < 0 ? <ArrowUp /> : <ArrowDown />}</IconButton>
              ))}
              <IconButton variant="destructive-ghost" label={t({ ko: '참조 제거', en: 'Remove reference' })} onClick={() => handleFieldChange('references', codexForm.references.filter((_, position) => position !== index))}><X /></IconButton>
            </div>
            {reference.image ? <NaiSelectedImageCard image={reference.image} alt={reference.label || reference.role} /> : <Text variant="muted">{t({ ko: '이미지를 다시 첨부해야 해.', en: 'Image reattachment required.' })}</Text>}
          </div>
        ))}
        <Button variant="secondary" disabled={codexForm.references.length + Number(Boolean(codexForm.referenceImage)) + Number(Boolean(codexForm.maskImage)) >= 5} onClick={() => handleFieldChange('references', [...codexForm.references, { role: 'reference', label: '' }])}>
          {t({ ko: '참조 추가', en: 'Add reference' })}
        </Button>
      </Section>
    ),
  }

  // Narrow screens stack the preset's visible editor blocks in column order; the generate bar keeps its own slot.
  const { preset: layoutPreset } = useGenerationLayoutSurface('codex')
  const stackedEditorBlocks = stackedLayoutBlocks(layoutPreset)
    .filter((block): block is CodexEditorBlock => block in editorBlocks)
    .map((block) => <Fragment key={block}>{editorBlocks[block]}</Fragment>)

  if (blockLayout) {
    return (
      <>
        <div className="flex min-h-0 flex-1 flex-col">
          {statusPortalTarget ? createPortal(toolbarStatusContent, statusPortalTarget) : null}
          <GenerationBlockLayout surface="codex" blocks={{ ...editorBlocks, action: actionSection, result: blockLayout.result }} />
        </div>
        <CodexDeviceLoginDialog open={isCodexLoginOpen} onClose={handleCloseCodexLogin} onSucceeded={handleRefreshStatus} />
      </>
    )
  }

  return (
    <>
      <div className={cn(splitPaneScroll ? 'flex min-h-0 flex-1 flex-col gap-6' : 'space-y-6')}>
        {statusPortalTargetId
          ? (statusPortalTarget ? createPortal(toolbarStatusContent, statusPortalTarget) : null)
          : useDrawerCompactChrome
          ? (headerPortalTarget ? createPortal(headerToolbarContent, headerPortalTarget) : null)
          : (
            <div className="shrink-0 space-y-3">
              {inlineHeaderContent}
            </div>
          )}

        <div className={cn(
          'space-y-6',
          splitPaneScroll && 'min-h-0 flex-1 overflow-y-auto pr-2 pb-1',
          useDrawerCompactChrome ? 'px-5 pb-5' : undefined,
        )}>
        {stackedEditorBlocks}
        <StackedPluginBlocks surface="codex" />

          {!useInlineActionBar && !useStickyActionBar ? actionSection : null}
          {useStickyActionBar && compactActionBarPortalTarget ? createPortal(compactActionBarContent, compactActionBarPortalTarget) : null}
        </div>

        {/* 생성 버튼·결과 그룹은 편집 영역 아래에 고정해 스크롤 위치와 상관없이 바로 누를 수 있게 한다. */}
        {useInlineActionBar ? <GenerateActionDock>{actionSection}</GenerateActionDock> : null}
      </div>

      <CodexDeviceLoginDialog open={isCodexLoginOpen} onClose={handleCloseCodexLogin} onSucceeded={handleRefreshStatus} />
    </>
  )
}
