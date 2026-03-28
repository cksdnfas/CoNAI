import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, Save } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { ImageDetailMedia } from '@/features/images/components/detail/image-detail-media'
import { getDownloadName, getImageDetailRenderUrl } from '@/features/images/components/detail/image-detail-utils'
import { downloadExistingImageWithRewrittenMetadata, getImage, saveImageMetadata } from '@/lib/api'
import { MetadataRewriteForm } from './components/metadata-rewrite-form'
import { buildMetadataRewritePatch, createRewriteDraftFromImage, type RewriteMetadataDraft } from './use-metadata-rewrite-draft'

export function ImageMetadataEditPage() {
  const { compositeHash } = useParams<{ compositeHash: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const [draft, setDraft] = useState<RewriteMetadataDraft | null>(null)

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
        throw new Error('이미지 식별자가 없어.')
      }

      return downloadExistingImageWithRewrittenMetadata(compositeHash, {
        format: nextDraft.format,
        metadataPatch: buildMetadataRewritePatch(nextDraft, { clearEmptyFields: true }),
      })
    },
    onSuccess: () => {
      showSnackbar({ message: '수정 파일 다운로드를 시작했어.', tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '메타 다운로드에 실패했어.', tone: 'error' })
    },
  })

  const saveMutation = useMutation({
    mutationFn: async (nextDraft: RewriteMetadataDraft) => {
      if (!compositeHash) {
        throw new Error('이미지 식별자가 없어.')
      }

      const metadataPatch = buildMetadataRewritePatch(nextDraft, { clearEmptyFields: true })
      if (Object.keys(metadataPatch).length === 0) {
        throw new Error('저장할 메타 변경이 없어.')
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
      showSnackbar({ message: '메타 정보를 저장했어.', tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : '메타 저장에 실패했어.', tone: 'error' })
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

    if (!window.confirm('현재 메타 정보를 실제 파일과 라이브러리 DB에 저장할까? 이전 운영 파일은 시스템 RecycleBin에 보관돼.')) {
      return
    }

    saveMutation.mutate(draft)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="메타 수정"
        description={downloadName}
        actions={
          <>
            <Button variant="secondary" onClick={handleBack}>
              <ArrowLeft className="h-4 w-4" />
              돌아가기
            </Button>
            <Button variant="outline" onClick={handleDownload} disabled={!draft || busy || !isEditableImage}>
              <Download className="h-4 w-4" />
              다운로드
            </Button>
            <Button onClick={handleSave} disabled={!draft || busy || !isEditableImage}>
              <Save className="h-4 w-4" />
              저장
            </Button>
          </>
        }
      />

      {imageQuery.isLoading ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.9fr)]">
          <Skeleton className="min-h-[420px] w-full rounded-sm" />
          <Skeleton className="min-h-[420px] w-full rounded-sm" />
        </div>
      ) : null}

      {imageQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>편집 대상을 불러오지 못했어</AlertTitle>
          <AlertDescription>{imageQuery.error instanceof Error ? imageQuery.error.message : '알 수 없는 오류가 발생했어.'}</AlertDescription>
        </Alert>
      ) : null}

      {!imageQuery.isLoading && !imageQuery.isError && image ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.9fr)] xl:items-start">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-sm bg-surface-low shadow-[0_0_40px_rgba(14,14,14,0.22)]">
              <div className="flex min-h-[420px] items-center justify-center bg-surface-lowest">
                <ImageDetailMedia image={image} renderUrl={renderUrl} />
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-sm bg-surface-high p-4 text-sm text-muted-foreground">
                <p className="text-[11px] uppercase tracking-[0.18em]">Composite hash</p>
                <p className="mt-2 break-all font-mono text-foreground">{image.composite_hash || '—'}</p>
              </div>
              <div className="rounded-sm bg-surface-high p-4 text-sm text-muted-foreground">
                <p className="text-[11px] uppercase tracking-[0.18em]">File</p>
                <p className="mt-2 break-all text-foreground">{downloadName}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {!isEditableImage ? (
              <Alert variant="destructive">
                <AlertTitle>이 파일은 아직 저장 편집 대상이 아니야</AlertTitle>
                <AlertDescription>정적 이미지 파일만 메타 저장을 지원해.</AlertDescription>
              </Alert>
            ) : null}

            {draft ? (
              <MetadataRewriteForm
                draft={draft}
                disabled={busy || !isEditableImage}
                formatLabel="다운로드 포맷"
                onDraftChange={(patch) => setDraft((current) => (current ? { ...current, ...patch } : current))}
              />
            ) : null}

            {saveMutation.isError ? (
              <Alert variant="destructive">
                <AlertTitle>저장에 실패했어</AlertTitle>
                <AlertDescription>{saveMutation.error instanceof Error ? saveMutation.error.message : '알 수 없는 오류가 발생했어.'}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
