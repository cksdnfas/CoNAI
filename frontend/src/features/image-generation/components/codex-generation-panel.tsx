import { useConfirm } from '@/components/ui/confirm-dialog'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { getAppSettings } from '@/lib/api-settings-general'
import { createGenerationQueueJob, getCodexGenerationStatus } from '@/lib/api-image-generation-queue'
import { useI18n } from '@/i18n'
import { DEFAULT_IMAGE_SAVE_SETTINGS } from '@/lib/image-save-output'
import { cn } from '@/lib/utils'
import { FormField, getErrorMessage, type SelectedImageDraft } from '../image-generation-shared'
import { consumeHistorySettingsLoad, usePendingHistorySettingsLoad } from '../history-settings-load-store'
import { confirmHistorySettingsOverwrite, getHistorySettingsLoadedMessage } from '../history-settings-mapping'
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { refreshGenerationQueueViews } from './generation-queue-actions'
import { Section } from '@/components/ui/section'
import { NaiPromptSection } from './nai-generation-panel-sections'
import { NaiSelectedImageCard } from './nai-selected-image-card'
import { normalizeTextSegmentSpreadsheetText } from './text-segment-spreadsheet-input'
import { GenerateActionBar } from './generate-action-bar'
import { IMAGE_GENERATION_TARGET_GROUP_KEY, useGenerationTargetGroupPath } from '@/features/groups/generation-target-group-store'

type CodexGenerationPanelProps = {
  refreshNonce: number
  onHistoryRefresh: () => void
  splitPaneScroll?: boolean
  headerPortalTargetId?: string
  compactActionBarContentTargetId?: string
}

type CodexFormDraft = {
  prompt: string
  negativePrompt: string
  count: string
  aspectRatio: string
  resolution: string
  referenceImage?: SelectedImageDraft
  maskImage?: SelectedImageDraft
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
  prompt: '',
  negativePrompt: '',
  count: '1',
  aspectRatio: '1:1',
  resolution: '1024',
}

type PersistedCodexFormDraft = Pick<CodexFormDraft, 'prompt' | 'negativePrompt' | 'count' | 'aspectRatio' | 'resolution'>

function loadPersistedCodexFormDraft(): CodexFormDraft {
  if (typeof window === 'undefined') {
    return DEFAULT_CODEX_FORM
  }

  try {
    const rawValue = window.localStorage.getItem(CODEX_FORM_DRAFT_STORAGE_KEY)
    if (!rawValue) {
      return DEFAULT_CODEX_FORM
    }

    const parsedValue = JSON.parse(rawValue) as Partial<PersistedCodexFormDraft>
    return {
      ...DEFAULT_CODEX_FORM,
      prompt: typeof parsedValue.prompt === 'string' ? parsedValue.prompt : DEFAULT_CODEX_FORM.prompt,
      negativePrompt: typeof parsedValue.negativePrompt === 'string' ? parsedValue.negativePrompt : DEFAULT_CODEX_FORM.negativePrompt,
      count: typeof parsedValue.count === 'string' ? parsedValue.count : DEFAULT_CODEX_FORM.count,
      aspectRatio: typeof parsedValue.aspectRatio === 'string' ? parsedValue.aspectRatio : DEFAULT_CODEX_FORM.aspectRatio,
      resolution: typeof parsedValue.resolution === 'string' ? parsedValue.resolution : DEFAULT_CODEX_FORM.resolution,
    }
  } catch {
    return DEFAULT_CODEX_FORM
  }
}

function persistCodexFormDraft(form: CodexFormDraft) {
  if (typeof window === 'undefined') {
    return
  }

  const persistableDraft: PersistedCodexFormDraft = {
    prompt: form.prompt,
    negativePrompt: form.negativePrompt,
    count: form.count,
    aspectRatio: form.aspectRatio,
    resolution: form.resolution,
  }

  try {
    window.localStorage.setItem(CODEX_FORM_DRAFT_STORAGE_KEY, JSON.stringify(persistableDraft))
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

/** Map a stored Codex queue payload onto the form; reference/mask images and the queue count are kept as they are. */
function buildCodexFormFromHistoryPayload(payload: Record<string, unknown>, current: CodexFormDraft) {
  const sizeSelection = resolveCodexAspectRatioAndResolution(payload.size)
  return {
    form: {
      ...current,
      prompt: typeof payload.prompt === 'string' ? payload.prompt : '',
      negativePrompt: typeof payload.negative_prompt === 'string' ? payload.negative_prompt : '',
      ...(sizeSelection ?? {}),
    } satisfies CodexFormDraft,
    hasImageInputs: payload.operation === 'edit' || payload.operation === 'infill',
  }
}

/** Render the Codex image-generation controller with the same controller chrome used by other generation tabs. */
export function CodexGenerationPanel({
  refreshNonce,
  onHistoryRefresh,
  splitPaneScroll = false,
  headerPortalTargetId,
  compactActionBarContentTargetId,
}: CodexGenerationPanelProps) {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const [codexForm, setCodexForm] = useState<CodexFormDraft>(() => loadPersistedCodexFormDraft())
  const [isSubmitting, setIsSubmitting] = useState(false)
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
    const hasPromptContent = codexForm.prompt.trim().length > 0 || codexForm.negativePrompt.trim().length > 0
    const changesPrompt = codexForm.prompt !== nextForm.prompt || codexForm.negativePrompt !== nextForm.negativePrompt
    void (async () => {
      if (hasPromptContent && changesPrompt && !(await confirmHistorySettingsOverwrite(confirm, t))) {
        return
      }

      setCodexForm(nextForm)
      showSnackbar({ message: getHistorySettingsLoadedMessage(t, request.historyId, hasImageInputs), tone: 'info' })
    })()
  }, [codexForm, confirm, pendingHistorySettingsLoad, showSnackbar, t])

  const appSettingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
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
    if (refreshNonce === 0) {
      return
    }

    void refetchCodexStatus()
  }, [refetchCodexStatus, refreshNonce])

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      persistCodexFormDraft(codexForm)
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [codexForm])

  const operationLabel = useMemo(() => {
    if (codexForm.referenceImage && codexForm.maskImage) {
      return 'Infill'
    }

    if (codexForm.referenceImage) {
      return 'Edit'
    }

    return 'Generate'
  }, [codexForm.maskImage, codexForm.referenceImage])

  const queueCount = useMemo(() => clampCodexCount(codexForm.count), [codexForm.count])
  const outputSize = useMemo(() => resolveCodexSize(codexForm.aspectRatio, codexForm.resolution), [codexForm.aspectRatio, codexForm.resolution])
  const outputSizeHint = codexForm.aspectRatio === 'random' ? t({ ko: '랜덤 비율', en: 'Random ratio' }) : outputSize
  const useDrawerCompactChrome = Boolean(headerPortalTargetId)
  const headerPortalTarget = headerPortalTargetId && typeof document !== 'undefined'
    ? document.getElementById(headerPortalTargetId)
    : null
  const compactActionBarPortalTarget = compactActionBarContentTargetId && typeof document !== 'undefined'
    ? document.getElementById(compactActionBarContentTargetId)
    : null
  const codexStatus = codexStatusQuery.data?.data ?? null
  const canGenerateWithCodex = codexStatusQuery.isSuccess ? Boolean(codexStatus?.available) : false
  const showStatusRecovery = codexStatusQuery.isError || (codexStatusQuery.isSuccess && !codexStatus?.available)
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

  const handleReset = useCallback(() => {
    setCodexForm(DEFAULT_CODEX_FORM)
  }, [])

  const handleRefreshStatus = useCallback(() => {
    void refetchCodexStatus()
  }, [refetchCodexStatus])

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

    try {
      setIsSubmitting(true)
      const response = await createGenerationQueueJob({
        service_type: 'codex',
        requested_group_path: targetGroupPath,
        request_summary: `Codex ${operationLabel} · ${prompt.slice(0, 48)}`,
        request_payload: {
          prompt,
          negative_prompt: normalizeTextSegmentSpreadsheetText(codexForm.negativePrompt).trim() || undefined,
          count: queueCount,
          operation: codexForm.referenceImage ? (codexForm.maskImage ? 'infill' : 'edit') : 'generate',
          size: resolveCodexSize(pickCodexAspectRatio(codexForm.aspectRatio), codexForm.resolution),
          image: codexForm.referenceImage?.dataUrl,
          mask: codexForm.maskImage?.dataUrl,
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
        <div className="truncate text-base font-semibold text-foreground">Codex</div>
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
        {useDrawerCompactChrome ? (
          <IconButton variant="ghost" size="icon-sm" onClick={handleReset} disabled={isSubmitting} label={t({ ko: '초기화', en: 'Reset' })}>
            <RotateCcw />
          </IconButton>
        ) : null}
      </div>
    </div>
  )

  const codexGenerateDisabled = codexForm.prompt.trim().length === 0 || !canGenerateWithCodex
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
      onReset={handleReset}
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
      targetGroupStorageKey={IMAGE_GENERATION_TARGET_GROUP_KEY}
    />
  )

  const inlineHeaderContent = (
    <div className="space-y-3">
      {headerToolbarContent}
      {useInlineActionBar ? actionSection : null}
    </div>
  )

  return (
    <>
      <div className={cn(splitPaneScroll ? 'flex min-h-0 flex-1 flex-col gap-6' : 'space-y-6')}>
        {useDrawerCompactChrome
          ? (headerPortalTarget ? createPortal(headerToolbarContent, headerPortalTarget) : null)
          : (
            <div className="shrink-0 space-y-3 border-b border-border/70 pb-4">
              {inlineHeaderContent}
            </div>
          )}

        <div className={cn(
          'space-y-6',
          splitPaneScroll && 'min-h-0 flex-1 overflow-y-auto pr-2 pb-1',
          useDrawerCompactChrome ? 'px-5 pb-5' : undefined,
        )}>
        <NaiPromptSection
          tool="codex"
          prompt={codexForm.prompt}
          negativePrompt={codexForm.negativePrompt}
          onPromptChange={(value) => handleFieldChange('prompt', value)}
          onNegativePromptChange={(value) => handleFieldChange('negativePrompt', value)}
        />

        <Section variant="controller" heading={t({ ko: '출력', en: 'Output' })}>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <FormField label={t({ ko: '비율', en: 'Aspect Ratio' })}>
              <Select
                variant="detail"
                value={codexForm.aspectRatio}
                onChange={(event) => handleFieldChange('aspectRatio', event.target.value)}
              >
                {CODEX_ASPECT_RATIO_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.value === 'random' ? t({ ko: '랜덤', en: 'Random' }) : option.label}</option>
                ))}
              </Select>
            </FormField>

            <FormField label={t({ ko: '해상도', en: 'Resolution' })} hint={outputSizeHint}>
              <Select
                variant="detail"
                value={codexForm.resolution}
                onChange={(event) => handleFieldChange('resolution', event.target.value)}
              >
                {CODEX_RESOLUTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </FormField>
          </div>
        </Section>

        <Section variant="controller" heading={t({ ko: '이미지', en: 'Images' })}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-sm border border-border/70 bg-surface-low/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{t({ ko: '참조 이미지', en: 'Reference Image' })}</div>
                  <div className="text-xs text-muted-foreground">{t({ ko: '편집용 입력 이미지', en: 'Input image for editing' })}</div>
                </div>
                <ImageAttachmentPickerButton
                  label={codexForm.referenceImage ? t({ ko: '교체', en: 'Replace' }) : t({ ko: '선택', en: 'Select' })}
                  modalTitle={t({ ko: 'Codex 참조 이미지 선택', en: 'Select Codex reference image' })}
                  onSelect={(image) => {
                    setCodexForm((current) => ({
                      ...current,
                      referenceImage: image,
                      maskImage: image ? current.maskImage : undefined,
                    }))
                  }}
                />
              </div>

              {codexForm.referenceImage ? (
                <div className="space-y-3">
                  <NaiSelectedImageCard image={codexForm.referenceImage} alt={t({ ko: 'Codex 참조 이미지', en: 'Codex reference image' })} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => handleFieldChange('referenceImage', undefined)}>
                    <X className="h-4 w-4" />
                    {t({ ko: '참조 이미지 제거', en: 'Remove reference image' })}
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="space-y-3 rounded-sm border border-border/70 bg-surface-low/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">{t({ ko: '마스크 이미지', en: 'Mask Image' })}</div>
                  <div className="text-xs text-muted-foreground">{t({ ko: '인페인트 영역 지정', en: 'Inpaint area mask' })}</div>
                </div>
                <ImageAttachmentPickerButton
                  label={codexForm.maskImage ? t({ ko: '교체', en: 'Replace' }) : t({ ko: '선택', en: 'Select' })}
                  modalTitle={t({ ko: 'Codex 마스크 이미지 선택', en: 'Select Codex mask image' })}
                  disabled={!codexForm.referenceImage}
                  onSelect={(image) => handleFieldChange('maskImage', image)}
                />
              </div>

              {codexForm.maskImage ? (
                <div className="space-y-3">
                  <NaiSelectedImageCard image={codexForm.maskImage} alt={t({ ko: 'Codex 마스크 이미지', en: 'Codex mask image' })} />
                  <Button type="button" variant="ghost" size="sm" onClick={() => handleFieldChange('maskImage', undefined)}>
                    <X className="h-4 w-4" />
                    {t({ ko: '마스크 제거', en: 'Remove mask' })}
                  </Button>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">{t({ ko: '참조 이미지를 먼저 선택해.', en: 'Choose a reference image first.' })}</div>
              )}
            </div>
          </div>
        </Section>

          {!useInlineActionBar && !useDrawerCompactChrome ? actionSection : null}
          {useDrawerCompactChrome && compactActionBarPortalTarget ? createPortal(compactActionBarContent, compactActionBarPortalTarget) : null}
        </div>
      </div>

    </>
  )
}
