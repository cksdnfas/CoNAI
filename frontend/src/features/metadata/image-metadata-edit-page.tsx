import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Copy, Download, Save } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { Inset } from '@/components/ui/inset'
import { Section } from '@/components/ui/section'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Text } from '@/components/ui/text'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
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
  const { compositeHash } = useParams<{ compositeHash: string }>()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const confirm = useConfirm()
  const [draft, setDraft] = useState<RewriteMetadataDraft | null>(null)
  const isDesktopPageLayout = useDesktopPageLayout()
  const handleBack = useImageSourceBack(`/images/${compositeHash ?? ''}`)

  const imageQuery = useQuery({
    queryKey: ['image-detail', compositeHash],
    queryFn: () => getImage(compositeHash as string),
    enabled: Boolean(compositeHash),
  })

  useEffect(() => {
    if (!imageQuery.data) {
      return
    }

    setDraft(createRewriteDraftFromImage(imageQuery.data))
  }, [imageQuery.data])

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

  useUnsavedSettingsGuard(hasUnsavedChanges, t({ ko: '저장하지 않은 메타데이터 변경 사항이 있습니다. 페이지를 떠날까요?', en: 'You have unsaved metadata changes. Leave this page?' }))

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

  if (!compositeHash) {
    return null
  }

  const image = imageQuery.data
  const renderUrl = getImageDetailRenderUrl(image)
  const downloadName = getDownloadName(image?.original_file_path, image?.composite_hash)
  const isEditableImage = image?.file_type === 'image'
  const busy = downloadMutation.isPending || saveMutation.isPending

  const handleCopyHash = async () => {
    if (!image?.composite_hash) {
      return
    }

    try {
      await copyTextToClipboard(image.composite_hash)
      showSnackbar({ message: t({ ko: '복사했습니다.', en: 'Copied.' }), tone: 'info' })
    } catch {
      showSnackbar({ message: t({ ko: '복사하지 못했습니다.', en: 'Could not copy.' }), tone: 'error' })
    }
  }

  const handleDownload = () => {
    if (!draft || busy) {
      return
    }

    downloadMutation.mutate(draft)
  }

  const canSave = Boolean(draft) && !busy && isEditableImage && hasUnsavedChanges && !draftValidationError

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

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('metadata.image.metadata.edit.page.edit.metadata')}
        description={downloadName}
        actions={
          <>
            <Button variant="secondary" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4" />
              {t({ ko: '돌아가기', en: 'Back' })}
            </Button>
            <Button variant="secondary" onClick={handleDownload} disabled={!draft || busy || !isEditableImage || Boolean(draftValidationError)}>
              <Download className="h-4 w-4" />
              {t({ ko: '다운로드', en: 'Download' })}
            </Button>
            <Button
              onClick={handleSave}
              disabled={!canSave}
              title={draft && isEditableImage && !hasUnsavedChanges ? t({ ko: '바뀐 게 없어', en: 'No changes to save' }) : undefined}
            >
              <Save className="h-4 w-4" />
              {t({ ko: '저장', en: 'Save' })}
            </Button>
          </>
        }
      />

      {imageQuery.isLoading ? (
        <div className={cn('grid gap-6', isDesktopPageLayout ? 'grid-cols-[minmax(0,1fr)_minmax(380px,0.9fr)]' : 'grid-cols-1')}>
          <Skeleton className="min-h-[420px] w-full rounded-sm" />
          <Skeleton className="min-h-[420px] w-full rounded-sm" />
        </div>
      ) : null}

      {imageQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>{t('metadata.image.metadata.edit.page.failed.to.load.the.edit.target')}</AlertTitle>
          <AlertDescription>{imageQuery.error instanceof Error ? imageQuery.error.message : t('metadata.image.metadata.edit.page.an.unknown.error.occurred')}</AlertDescription>
        </Alert>
      ) : null}

      {!imageQuery.isLoading && !imageQuery.isError && image ? (
        <div className={cn('grid gap-6', isDesktopPageLayout ? 'grid-cols-[minmax(0,1fr)_minmax(380px,0.9fr)] items-start' : 'grid-cols-1')}>
          <Section bodyClassName="space-y-4">
            <div className="overflow-hidden rounded-sm bg-surface-lowest">
              <div className="flex h-[max(420px,60vh)] items-center justify-center bg-surface-lowest">
                <ImageDetailMedia image={image} renderUrl={renderUrl} />
              </div>
            </div>

            <Inset className="text-sm text-muted-foreground">
              <Text variant="overline">{t({ ko: '파일', en: 'File' })}</Text>
              <p className="mt-2 break-all text-foreground">{downloadName}</p>
            </Inset>

            {image.composite_hash ? (
              <Inset className="text-sm text-muted-foreground">
                <details>
                  <summary className="cursor-pointer select-none text-2xs uppercase tracking-overline">{t({ ko: '기술 정보', en: 'Technical details' })}</summary>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <Text variant="overline">{t({ ko: '복합 해시', en: 'Composite hash' })}</Text>
                    <IconButton
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => void handleCopyHash()}
                      label={t({ ko: '복합 해시 복사', en: 'Copy composite hash' })}
                    >
                      <Copy className="h-4 w-4" />
                    </IconButton>
                  </div>
                  <p className="mt-1 break-all font-mono text-xs text-foreground/88">{image.composite_hash}</p>
                </details>
              </Inset>
            ) : null}
          </Section>

          <Section heading={t({ ko: '메타 필드', en: 'Metadata fields' })}>
            {!isEditableImage ? (
              <Alert variant="destructive">
                <AlertTitle>{t('metadata.image.metadata.edit.page.this.file.cannot.be.edited.in.place')}</AlertTitle>
                <AlertDescription>{t('metadata.image.metadata.edit.page.only.static.image.files.support.metadata.saving')}</AlertDescription>
              </Alert>
            ) : null}

            {draft ? (
              <MetadataRewriteForm
                draft={draft}
                disabled={busy || !isEditableImage}
                formatLabel={t('metadata.image.metadata.edit.page.download.format')}
                onDraftChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
              />
            ) : null}

            {draftValidationError ? (
              <Alert variant="destructive">
                <AlertTitle>{t({ ko: '입력값을 확인해 줘', en: 'Check the values' })}</AlertTitle>
                <AlertDescription>{draftValidationError}</AlertDescription>
              </Alert>
            ) : null}
          </Section>
        </div>
      ) : null}
    </div>
  )
}
