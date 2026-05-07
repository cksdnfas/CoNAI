import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, Save } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { PageInset, PageSection } from '@/components/common/page-surface'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { ImageDetailMedia } from '@/features/images/components/detail/image-detail-media'
import { getDownloadName, getImageDetailRenderUrl } from '@/features/images/components/detail/image-detail-utils'
import { downloadExistingImageWithRewrittenMetadata, getImage, saveImageMetadata } from '@/lib/api-images'
import { useDesktopPageLayout } from '@/lib/use-desktop-page-layout'
import { cn } from '@/lib/utils'
import { MetadataRewriteForm } from './components/metadata-rewrite-form'
import { buildMetadataRewritePatch, createRewriteDraftFromImage, type RewriteMetadataDraft } from './use-metadata-rewrite-draft'

export function ImageMetadataEditPage() {
  const { compositeHash } = useParams<{ compositeHash: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const [draft, setDraft] = useState<RewriteMetadataDraft | null>(null)
  const isDesktopPageLayout = useDesktopPageLayout()

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
        invalidStepsMessage: t('metadata.use.metadata.rewrite.draft.steps.must.be.a.number.greater.than'),
      })
      if (Object.keys(metadataPatch).length === 0) {
        throw new Error(t('metadata.image.metadata.edit.page.there.are.no.metadata.changes.to.save'))
      }

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

  const handleBack = () => {
    navigate(`/images/${compositeHash}`)
  }

  const handleDownload = () => {
    if (!draft || busy) {
      return
    }

    downloadMutation.mutate(draft)
  }

  const handleSave = () => {
    if (!draft || busy) {
      return
    }

    if (!window.confirm(t('metadata.image.metadata.edit.page.save.the.current.metadata.to.the.file'))) {
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
            <Button variant="outline" onClick={handleDownload} disabled={!draft || busy || !isEditableImage}>
              <Download className="h-4 w-4" />
              {t({ ko: '다운로드', en: 'Download' })}
            </Button>
            <Button onClick={handleSave} disabled={!draft || busy || !isEditableImage}>
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
          <PageSection bodyClassName="space-y-4">
            <div className="overflow-hidden rounded-sm border border-border/70 bg-surface-lowest">
              <div className="flex h-[max(420px,60vh)] items-center justify-center bg-surface-lowest">
                <ImageDetailMedia image={image} renderUrl={renderUrl} />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <PageInset className="text-sm text-muted-foreground">
                <p className="text-[11px] uppercase tracking-[0.18em]">Composite hash</p>
                <p className="mt-2 break-all font-mono text-foreground">{image.composite_hash || '—'}</p>
              </PageInset>
              <PageInset className="text-sm text-muted-foreground">
                <p className="text-[11px] uppercase tracking-[0.18em]">File</p>
                <p className="mt-2 break-all text-foreground">{downloadName}</p>
              </PageInset>
            </div>
          </PageSection>

          <PageSection title={t('metadata.image.metadata.edit.page.edit.metadata')}>
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

            {saveMutation.isError ? (
              <Alert variant="destructive">
                <AlertTitle>{t('metadata.image.metadata.edit.page.save.failed')}</AlertTitle>
                <AlertDescription>{saveMutation.error instanceof Error ? saveMutation.error.message : t('metadata.image.metadata.edit.page.an.unknown.error.occurred')}</AlertDescription>
              </Alert>
            ) : null}
          </PageSection>
        </div>
      ) : null}
    </div>
  )
}
