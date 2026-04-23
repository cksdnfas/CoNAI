import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, RotateCcw, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { getAppSettings } from '@/lib/api'
import { createGenerationQueueJob, getCodexGenerationStatus } from '@/lib/api-image-generation-queue'
import { DEFAULT_IMAGE_SAVE_SETTINGS } from '@/lib/image-save-output'
import { cn } from '@/lib/utils'
import { FormField, getErrorMessage, type SelectedImageDraft } from '../image-generation-shared'
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { refreshGenerationQueueViews } from './generation-queue-actions'
import { NaiControllerSection, NaiPromptSection } from './nai-generation-panel-sections'
import { NaiSelectedImageCard } from './nai-selected-image-card'
import { CompactGenerationActionSurface } from './shared-generation-controller'

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

function resolveCodexSize(aspectRatio: string, resolution: string) {
  const aspect = CODEX_ASPECT_RATIO_OPTIONS.find((option) => option.value === aspectRatio)
  const longEdge = Number(resolution)
  if (!aspect || !Number.isFinite(longEdge) || longEdge <= 0) {
    return undefined
  }

  const scale = longEdge / Math.max(aspect.width, aspect.height)
  const width = roundCodexDimension(aspect.width * scale)
  const height = roundCodexDimension(aspect.height * scale)
  return `${width}x${height}`
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
  const [codexForm, setCodexForm] = useState<CodexFormDraft>(() => loadPersistedCodexFormDraft())
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [, setPortalRevision] = useState(0)

  const appSettingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })

  const codexStatusQuery = useQuery({
    queryKey: ['codex-generation-status'],
    queryFn: getCodexGenerationStatus,
    retry: false,
  })

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

    void codexStatusQuery.refetch()
  }, [codexStatusQuery, refreshNonce])

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
  const showGenerateLabel = !canGenerateWithCodex
  const useInlineActionBar = splitPaneScroll

  const generateButtonLabel = isSubmitting
    ? '큐 등록 중…'
    : codexStatusQuery.isPending
      ? '상태 확인 중…'
      : codexStatusQuery.isError
        ? '재확인 후 생성'
        : codexStatus?.available
          ? '생성'
          : codexStatus?.installed
            ? '로그인 확인 후 생성'
            : 'Codex 확인 후 생성'

  const handleFieldChange = <K extends keyof CodexFormDraft>(field: K, value: CodexFormDraft[K]) => {
    setCodexForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const handleReset = () => {
    setCodexForm(DEFAULT_CODEX_FORM)
  }

  const handleGenerate = async () => {
    if (isSubmitting) {
      return
    }

    if (codexStatusQuery.isSuccess && !codexStatus?.available) {
      const codexInstalled = codexStatus?.installed ?? false
      showSnackbar({
        message: codexInstalled ? 'Codex 로그인 상태부터 확인해줘.' : '이 서버에서 Codex를 아직 바로 쓸 수 없는 상태야.',
        tone: 'error',
      })
      return
    }

    const prompt = codexForm.prompt.trim()

    if (prompt.length === 0) {
      showSnackbar({ message: 'Codex 프롬프트를 먼저 넣어줘.', tone: 'error' })
      return
    }

    if (codexForm.maskImage && !codexForm.referenceImage) {
      showSnackbar({ message: '마스크를 쓰려면 먼저 참조 이미지를 넣어줘.', tone: 'error' })
      return
    }

    try {
      setIsSubmitting(true)
      const response = await createGenerationQueueJob({
        service_type: 'codex',
        request_summary: `Codex ${operationLabel} · ${prompt.slice(0, 48)}`,
        request_payload: {
          prompt,
          negative_prompt: codexForm.negativePrompt.trim() || undefined,
          count: queueCount,
          operation: codexForm.referenceImage ? (codexForm.maskImage ? 'infill' : 'edit') : 'generate',
          size: outputSize,
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
      showSnackbar({ message: response.message || 'Codex 큐에 생성 작업을 넣었어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, 'Codex 이미지 생성에 실패했어.'), tone: 'error' })
    } finally {
      setIsSubmitting(false)
    }
  }

  const headerToolbarContent = (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex items-center gap-2">
        <div className="truncate text-base font-semibold text-foreground">Codex</div>
      </div>
      <div className="flex items-center gap-2">
        {showStatusRecovery ? (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => void codexStatusQuery.refetch()}
            disabled={codexStatusQuery.isPending}
            aria-label="Codex 상태 재확인"
            title="Codex 상태 재확인"
          >
            <RefreshCw className={cn('h-4 w-4', codexStatusQuery.isPending && 'animate-spin')} />
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon-sm" onClick={handleReset} disabled={isSubmitting} aria-label="초기화" title="초기화">
          <RotateCcw className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )

  const generateButton = (
    <Button
      type="button"
      size={showGenerateLabel ? 'sm' : 'icon-sm'}
      onClick={() => void handleGenerate()}
      disabled={isSubmitting || codexForm.prompt.trim().length === 0 || !canGenerateWithCodex}
      aria-label={showGenerateLabel ? generateButtonLabel : (isSubmitting ? '큐 등록 중' : '큐에 추가')}
      title={showGenerateLabel ? generateButtonLabel : (isSubmitting ? '큐 등록 중' : '큐에 추가')}
    >
      <Sparkles className="h-4 w-4" />
      {showGenerateLabel ? generateButtonLabel : null}
    </Button>
  )

  const compactActionBarContent = (
    <CompactGenerationActionSurface className="max-w-full">
      <ScrubbableNumberInput
        min={CODEX_COUNT_MIN}
        max={CODEX_COUNT_MAX}
        step={1}
        scrubRatio={1}
        variant="detail"
        className="h-8 w-[58px] shrink-0 !rounded-none !border-0 !bg-transparent px-0 text-center text-xs"
        value={codexForm.count}
        onChange={(value) => handleFieldChange('count', value)}
        disabled={isSubmitting}
        aria-label="큐 등록 개수"
        inputMode="numeric"
      />

      {showStatusRecovery ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void codexStatusQuery.refetch()}
          disabled={codexStatusQuery.isPending}
          aria-label="Codex 상태 재확인"
          title="Codex 상태 재확인"
          className="rounded-none border-l border-border/70 shadow-none"
        >
          <RefreshCw className={cn('h-4 w-4', codexStatusQuery.isPending && 'animate-spin')} />
        </Button>
      ) : null}

      {showGenerateLabel ? (
        <Button
          type="button"
          size="sm"
          onClick={() => void handleGenerate()}
          disabled={isSubmitting || codexForm.prompt.trim().length === 0 || !canGenerateWithCodex}
          aria-label={generateButtonLabel}
          title={generateButtonLabel}
          className="rounded-none border-l border-border/70 shadow-none"
        >
          <Sparkles className="h-4 w-4" />
          {generateButtonLabel}
        </Button>
      ) : (
        <Button
          type="button"
          size="icon-sm"
          onClick={() => void handleGenerate()}
          disabled={isSubmitting || codexForm.prompt.trim().length === 0 || !canGenerateWithCodex}
          aria-label={isSubmitting ? '큐 등록 중' : '큐에 추가'}
          title={isSubmitting ? '큐 등록 중' : '큐에 추가'}
          className="rounded-none border-l border-border/70 shadow-none"
        >
          <Sparkles className="h-4 w-4" />
        </Button>
      )}
    </CompactGenerationActionSurface>
  )

  const actionContent = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <ScrubbableNumberInput
        min={CODEX_COUNT_MIN}
        max={CODEX_COUNT_MAX}
        step={1}
        scrubRatio={1}
        variant="detail"
        className="h-9 w-[72px]"
        value={codexForm.count}
        onChange={(value) => handleFieldChange('count', value)}
        disabled={isSubmitting}
        aria-label="큐 등록 개수"
        inputMode="numeric"
      />
      {generateButton}
    </div>
  )

  const actionSection = useInlineActionBar ? (
    <section>
      {actionContent}
    </section>
  ) : (
    <section className="space-y-3">
      <Card>
        <CardContent className="space-y-4">
          {actionContent}
        </CardContent>
      </Card>
    </section>
  )

  const inlineHeaderContent = (
    <div className="space-y-3">
      {headerToolbarContent}
      {useInlineActionBar ? actionSection : null}
    </div>
  )

  return (
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
          prompt={codexForm.prompt}
          negativePrompt={codexForm.negativePrompt}
          onPromptChange={(value) => handleFieldChange('prompt', value)}
          onNegativePromptChange={(value) => handleFieldChange('negativePrompt', value)}
        />

        <NaiControllerSection heading="Output">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <FormField label="Aspect Ratio">
              <Select
                variant="detail"
                value={codexForm.aspectRatio}
                onChange={(event) => handleFieldChange('aspectRatio', event.target.value)}
              >
                {CODEX_ASPECT_RATIO_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </FormField>

            <FormField label="Resolution" hint={outputSize}>
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
        </NaiControllerSection>

        <NaiControllerSection heading="Images">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-sm border border-border/70 bg-surface-low/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">Reference Image</div>
                  <div className="text-xs text-muted-foreground">편집용 입력 이미지</div>
                </div>
                <ImageAttachmentPickerButton
                  label={codexForm.referenceImage ? '교체' : '선택'}
                  modalTitle="Codex 참조 이미지 선택"
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
                  <NaiSelectedImageCard image={codexForm.referenceImage} alt="Codex reference image" />
                  <Button type="button" variant="ghost" size="sm" onClick={() => handleFieldChange('referenceImage', undefined)}>
                    <X className="h-4 w-4" />
                    참조 이미지 제거
                  </Button>
                </div>
              ) : null}
            </div>

            <div className="space-y-3 rounded-sm border border-border/70 bg-surface-low/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">Mask Image</div>
                  <div className="text-xs text-muted-foreground">인페인트 영역 지정</div>
                </div>
                <ImageAttachmentPickerButton
                  label={codexForm.maskImage ? '교체' : '선택'}
                  modalTitle="Codex 마스크 이미지 선택"
                  disabled={!codexForm.referenceImage}
                  onSelect={(image) => handleFieldChange('maskImage', image)}
                />
              </div>

              {codexForm.maskImage ? (
                <div className="space-y-3">
                  <NaiSelectedImageCard image={codexForm.maskImage} alt="Codex mask image" />
                  <Button type="button" variant="ghost" size="sm" onClick={() => handleFieldChange('maskImage', undefined)}>
                    <X className="h-4 w-4" />
                    마스크 제거
                  </Button>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">참조 이미지를 먼저 선택해.</div>
              )}
            </div>
          </div>
        </NaiControllerSection>

        {!useInlineActionBar ? actionSection : null}
        {useDrawerCompactChrome && compactActionBarPortalTarget ? createPortal(compactActionBarContent, compactActionBarPortalTarget) : null}
      </div>
    </div>
  )
}
