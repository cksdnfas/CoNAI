import { createPortal } from 'react-dom'
import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, RotateCcw, Settings2, Sparkles, X } from 'lucide-react'
import { ImageSaveOptionsModal } from '@/components/media/image-save-options-modal'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { ScrubbableNumberInput } from '@/components/ui/scrubbable-number-input'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { getAppSettings } from '@/lib/api'
import { createGenerationQueueJob } from '@/lib/api-image-generation-queue'
import { DEFAULT_IMAGE_SAVE_SETTINGS } from '@/lib/image-save-output'
import { cn } from '@/lib/utils'
import type { ImageSaveSettings } from '@/types/settings'
import { getErrorMessage, type SelectedImageDraft } from '../image-generation-shared'
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
  referenceImage?: SelectedImageDraft
  maskImage?: SelectedImageDraft
}

const CODEX_COUNT_MIN = 1
const CODEX_COUNT_MAX = 4

const DEFAULT_CODEX_FORM: CodexFormDraft = {
  prompt: '',
  negativePrompt: '',
  count: '1',
}

function clampCodexCount(value: string | number, fallback = CODEX_COUNT_MIN) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  const integerValue = Math.trunc(parsed)
  return Math.min(CODEX_COUNT_MAX, Math.max(CODEX_COUNT_MIN, integerValue))
}

/** Render the Codex image-generation controller with the same controller chrome used by other generation tabs. */
export function CodexGenerationPanel({
  refreshNonce: _refreshNonce,
  onHistoryRefresh,
  splitPaneScroll = false,
  headerPortalTargetId,
  compactActionBarContentTargetId,
}: CodexGenerationPanelProps) {
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const [codexForm, setCodexForm] = useState<CodexFormDraft>(DEFAULT_CODEX_FORM)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isGenerationSaveOptionsOpen, setIsGenerationSaveOptionsOpen] = useState(false)
  const [generationSaveOptions, setGenerationSaveOptions] = useState<ImageSaveSettings>(DEFAULT_IMAGE_SAVE_SETTINGS)
  const [, setPortalRevision] = useState(0)

  const appSettingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })

  useEffect(() => {
    if (!appSettingsQuery.data?.imageSave) {
      return
    }

    setGenerationSaveOptions((current) => current === DEFAULT_IMAGE_SAVE_SETTINGS ? appSettingsQuery.data.imageSave : current)
  }, [appSettingsQuery.data?.imageSave])

  useEffect(() => {
    if ((!headerPortalTargetId && !compactActionBarContentTargetId) || typeof document === 'undefined') {
      return
    }

    const frame = window.requestAnimationFrame(() => {
      setPortalRevision((current) => current + 1)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [compactActionBarContentTargetId, headerPortalTargetId])

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
  const useDrawerCompactChrome = Boolean(headerPortalTargetId)
  const headerPortalTarget = headerPortalTargetId && typeof document !== 'undefined'
    ? document.getElementById(headerPortalTargetId)
    : null
  const compactActionBarPortalTarget = compactActionBarContentTargetId && typeof document !== 'undefined'
    ? document.getElementById(compactActionBarContentTargetId)
    : null

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
          image: codexForm.referenceImage?.dataUrl,
          mask: codexForm.maskImage?.dataUrl,
          imageSaveOptions: {
            format: generationSaveOptions.defaultFormat,
            quality: generationSaveOptions.quality,
            resizeEnabled: generationSaveOptions.resizeEnabled,
            maxWidth: generationSaveOptions.maxWidth,
            maxHeight: generationSaveOptions.maxHeight,
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

  const desktopHeaderContent = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="truncate text-base font-semibold text-foreground">Codex</div>
          <Badge variant="outline">{operationLabel}</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="icon-sm" onClick={handleReset} disabled={isSubmitting} aria-label="초기화" title="초기화">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon-sm" asChild>
            <a href="https://platform.openai.com/docs/guides/image-generation" target="_blank" rel="noreferrer noopener" aria-label="Codex 이미지 가이드 열기" title="Codex 이미지 가이드 열기">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </div>
    </div>
  )

  const drawerHeaderContent = (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">Codex</div>
      <Badge variant="outline">{operationLabel}</Badge>
      <Button type="button" variant="ghost" size="icon-sm" onClick={handleReset} disabled={isSubmitting} aria-label="초기화" title="초기화">
        <RotateCcw className="h-4 w-4" />
      </Button>
    </div>
  )

  const compactActionBarContent = (
    <div className="flex items-center gap-2">
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

        <Button
          type="button"
          size="icon-sm"
          onClick={() => void handleGenerate()}
          disabled={isSubmitting || codexForm.prompt.trim().length === 0}
          aria-label={isSubmitting ? '큐 등록 중' : '큐에 추가'}
          title={isSubmitting ? '큐 등록 중' : '큐에 추가'}
          className="rounded-none shadow-none"
        >
          <Sparkles className="h-4 w-4" />
        </Button>

        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => setIsGenerationSaveOptionsOpen(true)}
          disabled={isSubmitting}
          aria-label="생성 결과 저장 옵션"
          title="생성 결과 저장 옵션"
          className="rounded-none border-l border-border/70 shadow-none"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </CompactGenerationActionSurface>

      <Button type="button" variant="outline" size="icon-sm" asChild>
        <a href="https://platform.openai.com/docs/guides/image-generation" target="_blank" rel="noreferrer noopener" aria-label="Codex 이미지 가이드 열기" title="Codex 이미지 가이드 열기">
          <ExternalLink className="h-4 w-4" />
        </a>
      </Button>
    </div>
  )

  const actionSection = (
    <section className="space-y-3">
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{operationLabel}</Badge>
              <Badge variant="outline">{queueCount}장</Badge>
              {codexForm.referenceImage ? <Badge variant="secondary">참조</Badge> : null}
              {codexForm.maskImage ? <Badge variant="secondary">마스크</Badge> : null}
            </div>

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
              <Button type="button" onClick={() => void handleGenerate()} disabled={isSubmitting || codexForm.prompt.trim().length === 0}>
                <Sparkles className="h-4 w-4" />
                {isSubmitting ? '큐 등록 중…' : '큐에 추가'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => setIsGenerationSaveOptionsOpen(true)}
                disabled={isSubmitting}
                aria-label="생성 결과 저장 옵션"
                title="생성 결과 저장 옵션"
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  )

  return (
    <>
      <div className={cn(splitPaneScroll ? 'flex min-h-0 flex-1 flex-col gap-6' : 'space-y-6')}>
        {useDrawerCompactChrome
          ? (headerPortalTarget ? createPortal(drawerHeaderContent, headerPortalTarget) : null)
          : (
            <div className="space-y-3 border-b border-border/70 pb-4">
              {desktopHeaderContent}
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

          {!useDrawerCompactChrome ? actionSection : null}
          {useDrawerCompactChrome && compactActionBarPortalTarget ? createPortal(compactActionBarContent, compactActionBarPortalTarget) : null}
        </div>
      </div>

      <ImageSaveOptionsModal
        open={isGenerationSaveOptionsOpen}
        title="생성 결과 저장 옵션"
        options={generationSaveOptions}
        sourceInfo={null}
        isSaving={false}
        onClose={() => setIsGenerationSaveOptionsOpen(false)}
        onOptionsChange={(patch) => setGenerationSaveOptions((current) => ({ ...current, ...patch }))}
        onConfirm={() => setIsGenerationSaveOptionsOpen(false)}
      />
    </>
  )
}
