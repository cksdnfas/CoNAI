import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, RotateCcw, Save, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { getAppSettings, getModuleDefinitions } from '@/lib/api'
import { createGenerationQueueJob, getCodexGenerationStatus } from '@/lib/api-image-generation-queue'
import { createCodexModuleFromSnapshot } from '@/lib/api-module-graph'
import { useI18n } from '@/i18n'
import { DEFAULT_IMAGE_SAVE_SETTINGS } from '@/lib/image-save-output'
import { cn } from '@/lib/utils'
import { buildModuleExposedFields, buildModuleUiSchema, FormField, getErrorMessage, type ModuleFieldOption, type SelectedImageDraft } from '../image-generation-shared'
import { ImageAttachmentPickerButton } from './image-attachment-picker'
import { CodexModuleSaveModal } from './codex-module-save-modal'
import { refreshGenerationQueueViews } from './generation-queue-actions'
import { NaiControllerSection, NaiPromptSection } from './nai-generation-panel-sections'
import { NaiSelectedImageCard } from './nai-selected-image-card'
import { normalizeTextSegmentSpreadsheetText } from './text-segment-spreadsheet-input'
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

const DEFAULT_CODEX_MODULE_FIELD_KEYS = ['prompt', 'negative_prompt', 'aspect_ratio', 'resolution']

type PersistedCodexFormDraft = Pick<CodexFormDraft, 'prompt' | 'negativePrompt' | 'count' | 'aspectRatio' | 'resolution'>

function buildCodexModuleSnapshot(form: CodexFormDraft) {
  return {
    prompt: normalizeTextSegmentSpreadsheetText(form.prompt).trim(),
    negative_prompt: normalizeTextSegmentSpreadsheetText(form.negativePrompt).trim(),
    aspect_ratio: form.aspectRatio,
    resolution: form.resolution,
    image: form.referenceImage?.dataUrl || null,
    mask: form.maskImage?.dataUrl || null,
  }
}

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
  const [isModuleSaveModalOpen, setIsModuleSaveModalOpen] = useState(false)
  const [codexModuleName, setCodexModuleName] = useState(() => t({ ko: 'Codex 모듈', en: 'Codex module' }))
  const [codexModuleDescription, setCodexModuleDescription] = useState('')
  const [codexExposedFieldKeys, setCodexExposedFieldKeys] = useState<string[]>(DEFAULT_CODEX_MODULE_FIELD_KEYS)
  const [codexOverwriteModuleId, setCodexOverwriteModuleId] = useState<number | null>(null)
  const [isSavingCodexModule, setIsSavingCodexModule] = useState(false)
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

  const moduleDefinitionsQuery = useQuery({
    queryKey: ['module-definitions', 'codex-overwrite-candidates'],
    queryFn: () => getModuleDefinitions(false),
  })

  const codexOverwriteCandidates = useMemo(
    () => (moduleDefinitionsQuery.data ?? []).filter((module) => module.engine_type === 'codex' && module.authoring_source === 'codex_form_snapshot'),
    [moduleDefinitionsQuery.data],
  )

  const codexModuleFieldOptions = useMemo<ModuleFieldOption[]>(() => [
    { key: 'prompt', label: t({ ko: '프롬프트', en: 'Prompt' }), dataType: 'prompt' },
    { key: 'negative_prompt', label: t({ ko: '네거티브 프롬프트', en: 'Negative prompt' }), dataType: 'prompt' },
    { key: 'aspect_ratio', label: t({ ko: '비율', en: 'Aspect ratio' }), dataType: 'text', options: CODEX_ASPECT_RATIO_OPTIONS.map((option) => option.value) },
    { key: 'resolution', label: t({ ko: '해상도', en: 'Resolution' }), dataType: 'text', options: CODEX_RESOLUTION_OPTIONS.map((option) => option.value) },
    { key: 'image', label: t({ ko: '참조 이미지', en: 'Reference image' }), dataType: 'image' },
    { key: 'mask', label: t({ ko: '마스크 이미지', en: 'Mask image' }), dataType: 'mask' },
  ], [t])

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
  const showGenerateLabel = !canGenerateWithCodex
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

  const handleFieldChange = <K extends keyof CodexFormDraft>(field: K, value: CodexFormDraft[K]) => {
    setCodexForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const handleReset = () => {
    setCodexForm(DEFAULT_CODEX_FORM)
  }

  const handleOpenModuleSave = () => {
    setCodexModuleName((current) => current.trim().length > 0 ? current : t({ ko: 'Codex 모듈', en: 'Codex module' }))
    setIsModuleSaveModalOpen(true)
  }

  const handleCreateCodexModule = async () => {
    const moduleName = codexModuleName.trim()

    if (moduleName.length === 0 || isSavingCodexModule) {
      return
    }

    if (codexExposedFieldKeys.length === 0) {
      showSnackbar({ message: t({ ko: '최소 1개는 입력 가능 필드로 열어줘.', en: 'Expose at least one editable field.' }), tone: 'error' })
      return
    }

    try {
      setIsSavingCodexModule(true)
      const snapshot = buildCodexModuleSnapshot(codexForm)
      const exposedFields = buildModuleExposedFields(codexModuleFieldOptions, codexExposedFieldKeys)
      const uiSchema = buildModuleUiSchema(codexModuleFieldOptions, snapshot, codexExposedFieldKeys)

      await createCodexModuleFromSnapshot({
        name: moduleName,
        description: codexModuleDescription.trim() || undefined,
        snapshot,
        exposed_fields: exposedFields,
        ui_schema: uiSchema,
        target_module_id: codexOverwriteModuleId ?? undefined,
      })

      setIsModuleSaveModalOpen(false)
      setCodexOverwriteModuleId(null)
      void moduleDefinitionsQuery.refetch()
      showSnackbar({ message: codexOverwriteModuleId ? t({ ko: '현재 Codex 설정으로 기존 모듈을 덮어썼어.', en: 'Overwrote the existing module with the current Codex settings.' }) : t({ ko: '현재 Codex 설정을 모듈로 저장했어.', en: 'Saved the current Codex settings as a module.' }), tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: 'Codex 모듈 저장에 실패했어.', en: 'Failed to save the Codex module.' })), tone: 'error' })
    } finally {
      setIsSavingCodexModule(false)
    }
  }

  const handleGenerate = async () => {
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
  }

  const headerToolbarContent = (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex items-center gap-2">
        <div className="truncate text-base font-semibold text-foreground">Codex</div>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          onClick={handleOpenModuleSave}
          disabled={isSubmitting || isSavingCodexModule}
          aria-label={t({ ko: '모듈 저장', en: 'Save module' })}
          title={t({ ko: '모듈 저장', en: 'Save module' })}
        >
          <Save className="h-4 w-4" />
        </Button>
        {showStatusRecovery ? (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={() => void codexStatusQuery.refetch()}
            disabled={codexStatusQuery.isPending}
            aria-label={t({ ko: 'Codex 상태 재확인', en: 'Recheck Codex status' })}
            title={t({ ko: 'Codex 상태 재확인', en: 'Recheck Codex status' })}
          >
            <RefreshCw className={cn('h-4 w-4', codexStatusQuery.isPending && 'animate-spin')} />
          </Button>
        ) : null}
        <Button type="button" variant="ghost" size="icon-sm" onClick={handleReset} disabled={isSubmitting} aria-label={t({ ko: '초기화', en: 'Reset' })} title={t({ ko: '초기화', en: 'Reset' })}>
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
      aria-label={showGenerateLabel ? generateButtonLabel : (isSubmitting ? t({ ko: '큐 등록 중', en: 'Adding to queue' }) : t({ ko: '큐에 추가', en: 'Add to queue' }))}
      title={showGenerateLabel ? generateButtonLabel : (isSubmitting ? t({ ko: '큐 등록 중', en: 'Adding to queue' }) : t({ ko: '큐에 추가', en: 'Add to queue' }))}
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
        aria-label={t({ ko: '큐 등록 개수', en: 'Queue count' })}
        inputMode="numeric"
      />

      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={handleOpenModuleSave}
        disabled={isSubmitting || isSavingCodexModule}
        aria-label={t({ ko: '모듈 저장', en: 'Save module' })}
        title={t({ ko: '모듈 저장', en: 'Save module' })}
        className="rounded-none border-r border-border/70 shadow-none"
      >
        <Save className="h-4 w-4" />
      </Button>

      {showStatusRecovery ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void codexStatusQuery.refetch()}
          disabled={codexStatusQuery.isPending}
          aria-label={t({ ko: 'Codex 상태 재확인', en: 'Recheck Codex status' })}
          title={t({ ko: 'Codex 상태 재확인', en: 'Recheck Codex status' })}
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
          aria-label={isSubmitting ? t({ ko: '큐 등록 중', en: 'Adding to queue' }) : t({ ko: '큐에 추가', en: 'Add to queue' })}
          title={isSubmitting ? t({ ko: '큐 등록 중', en: 'Adding to queue' }) : t({ ko: '큐에 추가', en: 'Add to queue' })}
          className="rounded-none border-l border-border/70 shadow-none"
        >
          <Sparkles className="h-4 w-4" />
        </Button>
      )}
    </CompactGenerationActionSurface>
  )

  const actionContent = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        onClick={handleOpenModuleSave}
        disabled={isSubmitting || isSavingCodexModule}
        aria-label={t({ ko: '모듈 저장', en: 'Save module' })}
        title={t({ ko: '모듈 저장', en: 'Save module' })}
      >
        <Save className="h-4 w-4" />
      </Button>
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
        aria-label={t({ ko: '큐 등록 개수', en: 'Queue count' })}
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

        <NaiControllerSection heading={t({ ko: '출력', en: 'Output' })}>
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
        </NaiControllerSection>

        <NaiControllerSection heading={t({ ko: '이미지', en: 'Images' })}>
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
        </NaiControllerSection>

          {!useInlineActionBar ? actionSection : null}
          {useDrawerCompactChrome && compactActionBarPortalTarget ? createPortal(compactActionBarContent, compactActionBarPortalTarget) : null}
        </div>
      </div>

      <CodexModuleSaveModal
        open={isModuleSaveModalOpen}
        moduleName={codexModuleName}
        moduleDescription={codexModuleDescription}
        fieldOptions={codexModuleFieldOptions}
        exposedFieldKeys={codexExposedFieldKeys}
        isSaving={isSavingCodexModule}
        overwriteCandidates={codexOverwriteCandidates}
        overwriteModuleId={codexOverwriteModuleId}
        onClose={() => {
          setIsModuleSaveModalOpen(false)
          setCodexOverwriteModuleId(null)
        }}
        onModuleNameChange={setCodexModuleName}
        onModuleDescriptionChange={setCodexModuleDescription}
        onExposedFieldKeysChange={setCodexExposedFieldKeys}
        onOverwriteModuleIdChange={(moduleId) => {
          setCodexOverwriteModuleId(moduleId)
          const module = codexOverwriteCandidates.find((item) => item.id === moduleId)
          if (module) {
            setCodexModuleName(module.name)
            setCodexModuleDescription(module.description ?? '')
          }
        }}
        onSave={() => void handleCreateCodexModule()}
      />
    </>
  )
}
