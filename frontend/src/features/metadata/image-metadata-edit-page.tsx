import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { ImagePermissionNotice } from '@/features/images/components/image-permission-notice'
import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronRight, Copy, Download, Save } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { PageToolbar } from '@/components/common/page-toolbar'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction } from '@/features/codex-chat/page-action-helpers'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { ImageDetailMedia } from '@/features/images/components/detail/image-detail-media'
import { useImageSourceBack } from '@/features/images/image-source-navigation'
import { getDownloadName, getImageDetailRenderUrl } from '@/features/images/components/detail/image-detail-utils'
import { useUnsavedSettingsGuard } from '@/features/settings/use-unsaved-settings-guard'
import { copyTextToClipboard } from '@/lib/clipboard'
import { downloadExistingImageWithRewrittenMetadata, getImage, saveImageMetadata } from '@/lib/api-images'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { MetadataRewriteForm } from './components/metadata-rewrite-form'
import { buildMetadataRewritePatch, createRewriteDraftFromImage, type RewriteMetadataDraft } from './use-metadata-rewrite-draft'

const SAVED_DRAFT_FIELDS = ['prompt', 'negativePrompt', 'steps', 'sampler', 'model'] as const

/** Save only writes these fields (format is download-only), so compare them trimmed against the stored values. */
function hasSavableDraftChanges(draft: RewriteMetadataDraft, baseline: RewriteMetadataDraft) {
  return SAVED_DRAFT_FIELDS.some((field) => draft[field].trim() !== baseline[field].trim())
}

export function ImageMetadataEditPage() {
  const { canViewImages, canEditMetadata } = useImagePermissions()
  const { compositeHash } = useParams<{ compositeHash: string }>()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const confirm = useConfirm()
  const [draft, setDraft] = useState<RewriteMetadataDraft | null>(null)
  const [draftImageHash, setDraftImageHash] = useState<string | null>(null)
  const isDesktopPageLayout = useDesktopPageLayout()
  const handleBack = useImageSourceBack(`/images/${compositeHash ?? ''}`)

  const imageQuery = useQuery({
    queryKey: ['image-detail', compositeHash],
    queryFn: () => getImage(compositeHash as string),
    enabled: canViewImages && Boolean(compositeHash),
  })

  useEffect(() => {
    if (!imageQuery.data || imageQuery.data.composite_hash !== compositeHash) {
      return
    }

    setDraft(createRewriteDraftFromImage(imageQuery.data))
    setDraftImageHash(compositeHash ?? null)
  }, [compositeHash, imageQuery.data])

  const baselineDraft = useMemo(() => (imageQuery.data ? createRewriteDraftFromImage(imageQuery.data) : null), [imageQuery.data])
  const hasUnsavedChanges = Boolean(draft && baselineDraft && hasSavableDraftChanges(draft, baselineDraft))
  const invalidStepsMessage = t('metadata.use.metadata.rewrite.draft.steps.must.be.a.number.greater.than')
  const draftValidationError = useMemo(() => {
    if (!draft) {
      return null
    }

    try {
      buildMetadataRewritePatch(draft, { invalidStepsMessage })
      return null
    } catch (error) {
      return error instanceof Error ? error.message : invalidStepsMessage
    }
  }, [draft, invalidStepsMessage])

  useUnsavedSettingsGuard(hasUnsavedChanges, t({ ko: '저장하지 않은 메타데이터 변경이 있어. 페이지를 떠날까?', en: 'You have unsaved metadata changes. Leave this page?' }))

  const downloadMutation = useMutation({
    mutationFn: async (nextDraft: RewriteMetadataDraft) => {
      if (!compositeHash) {
        throw new Error(t('metadata.image.metadata.edit.page.missing.image.identifier'))
      }

      return downloadExistingImageWithRewrittenMetadata(compositeHash, {
        format: nextDraft.format,
        metadataPatch: buildMetadataRewritePatch(nextDraft, { clearEmptyFields: true }),
      })
    },
    onSuccess: () => {
      showSnackbar({ message: t('metadata.image.metadata.edit.page.started.downloading.the.edited.file'), tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('metadata.image.metadata.edit.page.failed.to.download.metadata'), tone: 'error' })
    },
  })

  const saveMutation = useMutation({
    mutationFn: async (nextDraft: RewriteMetadataDraft) => {
      if (!compositeHash) {
        throw new Error(t('metadata.image.metadata.edit.page.missing.image.identifier'))
      }

      const metadataPatch = buildMetadataRewritePatch(nextDraft, {
        clearEmptyFields: true,
        invalidStepsMessage,
      })

      return saveImageMetadata(compositeHash, metadataPatch)
    },
    onSuccess: (updatedImage) => {
      if (!compositeHash) {
        return
      }

      queryClient.setQueryData(['image-detail', compositeHash], updatedImage)
      void queryClient.invalidateQueries({ queryKey: ['image-detail', compositeHash] })
      void queryClient.invalidateQueries({ queryKey: ['image-prompt-similar'] })
      setDraft(createRewriteDraftFromImage(updatedImage))
      showSnackbar({ message: t('metadata.image.metadata.edit.page.metadata.saved'), tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('metadata.image.metadata.edit.page.failed.to.save.metadata'), tone: 'error' })
    },
  })

  const image = imageQuery.data
  const renderUrl = getImageDetailRenderUrl(image)
  const downloadName = getDownloadName(image?.original_file_path, image?.composite_hash)
  const isEditableImage = image?.file_type === 'image'
  const busy = downloadMutation.isPending || saveMutation.isPending

  useChatPageRegistration(compositeHash && draftImageHash === compositeHash && image?.composite_hash === compositeHash && isEditableImage && draft && !busy && !imageQuery.isError ? {
    kind: 'metadata', title: t({ ko: '이미지 메타데이터 초안', en: 'Image metadata draft' }), resourceId: compositeHash, dirty: hasUnsavedChanges,
    fields: [
      { id: 'prompt', label: t({ ko: '프롬프트', en: 'Prompt' }), type: 'text', value: draft.prompt },
      { id: 'negativePrompt', label: t({ ko: '네거티브 프롬프트', en: 'Negative prompt' }), type: 'text', value: draft.negativePrompt },
      { id: 'steps', label: 'Steps', type: 'number', value: draft.steps, min: 1, integer: true, allowEmpty: true },
      { id: 'sampler', label: t({ ko: '샘플러', en: 'Sampler' }), type: 'text', value: draft.sampler },
      { id: 'model', label: t({ ko: '모델', en: 'Model' }), type: 'text', value: draft.model },
      { id: 'format', label: t({ ko: '다운로드 형식', en: 'Download format' }), type: 'select', value: draft.format, options: ['png', 'jpeg', 'webp'] },
    ],
    data: { selected: { prompt: draft.prompt.slice(0, 200), negativePrompt: draft.negativePrompt.slice(0, 200), steps: draft.steps, sampler: draft.sampler, model: draft.model } },
    // Saving rewrites the file, so it is a card the person applies (in place of the page's own confirm).
    actions: canEditMetadata && hasUnsavedChanges && !draftValidationError ? [pageAction('metadata.save', t({ ko: '메타데이터 저장', en: 'Save metadata' }), t({ ko: '초안의 메타데이터를 이미지 파일에 써.', en: 'Write the draft metadata into the image file.' }), undefined, 'save')] : [],
    apply: (patch) => setDraft((current) => current ? { ...current, ...patch as Partial<RewriteMetadataDraft> } : current),
    applyAction: async (id, _args, assertCurrent) => {
      assertCurrent()
      if (id !== 'metadata.save' || !draft) throw new Error('메타데이터 편집기에 없는 작업이야.')
      await saveMutation.mutateAsync(draft)
    },
  } : null)

  if (!compositeHash) {
    return null
  }

  const handleCopyHash = async () => {
    if (!image?.composite_hash) {
      return
    }

    try {
      await copyTextToClipboard(image.composite_hash)
      showSnackbar({ message: t({ ko: '복사했어.', en: 'Copied.' }), tone: 'info' })
    } catch {
      showSnackbar({ message: t({ ko: '복사하지 못했어.', en: 'Could not copy.' }), tone: 'error' })
    }
  }

  const handleDownload = () => {
    if (!draft || busy) {
      return
    }

    downloadMutation.mutate(draft)
  }

  const canSave = canEditMetadata && Boolean(draft) && !busy && isEditableImage && hasUnsavedChanges && !draftValidationError

  const handleSave = async () => {
    if (!draft || !canSave) {
      return
    }

    const confirmed = await confirm({
      title: t({ ko: '메타데이터 저장', en: 'Save metadata' }),
      description: t('metadata.image.metadata.edit.page.save.the.current.metadata.to.the.file'),
      confirmLabel: t({ ko: '저장', en: 'Save' }),
    })
    if (!confirmed) {
      return
    }

    saveMutation.mutate(draft)
  }

  // Same arrangement as the image page: a flat top row, the image on the page background, the fields in a column
  // behind one vertical hairline (below it on narrow screens).
  const gridClassName = cn('grid', isDesktopPageLayout ? 'grid-cols-[minmax(0,1fr)_minmax(420px,0.8fr)]' : 'grid-cols-1')
  const fieldColumnClassName = isDesktopPageLayout ? 'min-w-0 border-l border-line py-6 pl-6' : 'min-w-0 border-t border-line pt-6'

  if (!canViewImages) return <ImagePermissionNotice />

  return (
    <div>
      <PageToolbar
        className="border-b border-line"
        start={(
          <div className="flex min-w-0 items-center gap-2">
            <IconButton size="icon-sm" variant="ghost" onClick={handleBack} label={t({ ko: '돌아가기', en: 'Back' })}>
              <ArrowLeft className="size-4" />
            </IconButton>
            <h1 className="min-w-0 truncate text-sm font-bold text-foreground" title={downloadName}>
              {t('metadata.image.metadata.edit.page.edit.metadata')}
              <span className="ml-2 font-normal text-muted-foreground">{downloadName}</span>
            </h1>
          </div>
        )}
        actions={(
          <>
            <IconButton size="icon-sm" variant="ghost" onClick={handleDownload} disabled={!canEditMetadata || !draft || busy || !isEditableImage || Boolean(draftValidationError)} label={t({ ko: '다운로드', en: 'Download' })}>
              <Download className="size-4" />
            </IconButton>
            <Tip content={draft && isEditableImage && !hasUnsavedChanges ? t({ ko: '바뀐 게 없어', en: 'No changes to save' }) : t({ ko: '저장', en: 'Save' })}>
              {/* The span carries the tooltip: a disabled button gets no pointer events. */}
              <span className="inline-flex" tabIndex={draft && isEditableImage && !hasUnsavedChanges ? 0 : undefined}>
                <IconButton variant="default" size="icon-sm" onClick={handleSave} disabled={!canSave} tooltip={false} label={t({ ko: '저장', en: 'Save' })}>
                  <Save className="size-4" />
                </IconButton>
              </span>
            </Tip>
          </>
        )}
      />

      {imageQuery.isLoading ? (
        <div className={gridClassName}>
          <div className={cn('py-6', isDesktopPageLayout && 'pr-6')}>
            <Skeleton className="h-[max(420px,60vh)] w-full rounded-sm" />
          </div>
          <div className={cn(fieldColumnClassName, 'space-y-3')}>
            <Skeleton className="h-9 w-full rounded-sm" />
            <Skeleton className="h-28 w-full rounded-sm" />
            <Skeleton className="h-24 w-full rounded-sm" />
          </div>
        </div>
      ) : null}

      {imageQuery.isError ? (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>{t('metadata.image.metadata.edit.page.failed.to.load.the.edit.target')}</AlertTitle>
          <AlertDescription>{imageQuery.error instanceof Error ? imageQuery.error.message : t('metadata.image.metadata.edit.page.an.unknown.error.occurred')}</AlertDescription>
        </Alert>
      ) : null}

      {!imageQuery.isLoading && !imageQuery.isError && image ? (
        <div className={gridClassName}>
          <div className={cn('flex h-[max(420px,calc(100svh-var(--theme-shell-header-height)-7rem))] items-center justify-center py-6', isDesktopPageLayout && 'pr-6')}>
            <ImageDetailMedia image={image} renderUrl={renderUrl} />
          </div>

          <div className={cn(fieldColumnClassName, 'space-y-6')}>
            {!isEditableImage ? (
              <Alert variant="destructive">
                <AlertTitle>{t('metadata.image.metadata.edit.page.this.file.cannot.be.edited.in.place')}</AlertTitle>
              </Alert>
            ) : null}

            {draft ? (
              <MetadataRewriteForm
                draft={draft}
                disabled={!canEditMetadata || busy || !isEditableImage}
                formatLabel={t('metadata.image.metadata.edit.page.download.format')}
                showHeader={false}
                onDraftChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
              />
            ) : null}

            {draftValidationError ? (
              <Alert variant="destructive">
                <AlertTitle>{t({ ko: '입력값을 확인해 줘', en: 'Check the values' })}</AlertTitle>
                <AlertDescription>{draftValidationError}</AlertDescription>
              </Alert>
            ) : null}

            {image.composite_hash ? (
              <details className="group/tech border-t border-line pt-3 text-sm text-muted-foreground">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-bold text-foreground select-none [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open/tech:rotate-90" />
                  {t({ ko: '기술 정보', en: 'Technical details' })}
                </summary>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span>{t({ ko: '복합 해시', en: 'Composite hash' })}</span>
                  <IconButton
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => void handleCopyHash()}
                    label={t({ ko: '복합 해시 복사', en: 'Copy composite hash' })}
                  >
                    <Copy />
                  </IconButton>
                </div>
                <p className="mt-0.5 font-mono text-xs break-all text-foreground/88">{image.composite_hash}</p>
              </details>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
