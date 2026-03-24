import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Skeleton } from '@/components/ui/skeleton'
import { getAppSettings, getImage, getImageDuplicates, getSimilarImages, updateSimilaritySettings } from '@/lib/api'
import type { ImageRecord } from '@/types/image'
import { ImageDetailActions } from './components/detail/image-detail-actions'
import { ImageDetailMetaCard } from './components/detail/image-detail-meta-card'
import { getDownloadName, getValidImageRecords, type SimilaritySettingsDraft } from './components/detail/image-detail-utils'
import { RelatedImageGallerySection } from './components/detail/related-image-gallery-section'
import { SimilaritySettingsPanel } from './components/detail/similarity-settings-panel'

interface DetailLocationState {
  fromFeed?: boolean
  sourcePath?: string
}

export function ImageDetailPage() {
  const { compositeHash } = useParams<{ compositeHash: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const locationState = location.state as DetailLocationState | null
  const [isSimilaritySettingsOpen, setIsSimilaritySettingsOpen] = useState(false)
  const [similarityDraft, setSimilarityDraft] = useState<SimilaritySettingsDraft | null>(null)

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
  }, [compositeHash])

  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
  })

  const effectiveSimilaritySettings = settingsQuery.data?.similarity

  const imageQuery = useQuery({
    queryKey: ['image-detail', compositeHash],
    queryFn: () => getImage(compositeHash!),
    enabled: Boolean(compositeHash),
  })

  const duplicatesQuery = useQuery({
    queryKey: ['image-duplicates', compositeHash],
    queryFn: () => getImageDuplicates(compositeHash!, 5),
    enabled: Boolean(compositeHash),
  })

  const similarQuery = useQuery({
    queryKey: [
      'image-similar',
      compositeHash,
      effectiveSimilaritySettings?.detailSimilarThreshold ?? 15,
      effectiveSimilaritySettings?.detailSimilarLimit ?? 24,
      effectiveSimilaritySettings?.detailSimilarIncludeColorSimilarity ?? false,
      effectiveSimilaritySettings?.detailSimilarSortBy ?? 'similarity',
      effectiveSimilaritySettings?.detailSimilarSortOrder ?? 'DESC',
    ],
    queryFn: () =>
      getSimilarImages(compositeHash!, {
        threshold: effectiveSimilaritySettings?.detailSimilarThreshold ?? 15,
        limit: effectiveSimilaritySettings?.detailSimilarLimit ?? 24,
        includeColorSimilarity: effectiveSimilaritySettings?.detailSimilarIncludeColorSimilarity ?? false,
        sortBy: effectiveSimilaritySettings?.detailSimilarSortBy ?? 'similarity',
        sortOrder: effectiveSimilaritySettings?.detailSimilarSortOrder ?? 'DESC',
      }),
    enabled: Boolean(compositeHash) && Boolean(effectiveSimilaritySettings),
  })

  const saveSimilaritySettingsMutation = useMutation({
    mutationFn: (settings: SimilaritySettingsDraft) => updateSimilaritySettings(settings),
    onSuccess: (settings) => {
      queryClient.setQueryData(['app-settings'], settings)
      setIsSimilaritySettingsOpen(false)
    },
  })

  const image = imageQuery.data
  const previewUrl = image?.image_url || image?.thumbnail_url
  const downloadName = getDownloadName(image?.original_file_path, image?.composite_hash)

  const duplicateImages = useMemo(
    () => getValidImageRecords((duplicatesQuery.data?.similar ?? []).map((item) => item.image)),
    [duplicatesQuery.data?.similar],
  )

  const duplicateHashSet = useMemo(() => new Set(duplicateImages.map((item) => item.composite_hash as string)), [duplicateImages])

  const similarImages = useMemo(
    () =>
      getValidImageRecords((similarQuery.data?.similar ?? []).map((item) => item.image)).filter(
        (item) => !duplicateHashSet.has(item.composite_hash as string),
      ),
    [duplicateHashSet, similarQuery.data?.similar],
  )

  const handleBackToFeed = () => {
    if (locationState?.fromFeed && locationState.sourcePath === '/' && window.history.state?.idx > 0) {
      navigate(-1)
      return
    }

    navigate('/')
  }

  const handleToggleSimilaritySettings = () => {
    if (isSimilaritySettingsOpen) {
      setIsSimilaritySettingsOpen(false)
      return
    }

    const similarity = settingsQuery.data?.similarity
    if (!similarity) {
      return
    }

    setSimilarityDraft({
      detailSimilarThreshold: similarity.detailSimilarThreshold,
      detailSimilarLimit: similarity.detailSimilarLimit,
      detailSimilarIncludeColorSimilarity: similarity.detailSimilarIncludeColorSimilarity,
      detailSimilarSortBy: similarity.detailSimilarSortBy,
      detailSimilarSortOrder: similarity.detailSimilarSortOrder,
    })
    setIsSimilaritySettingsOpen(true)
  }

  const handleApplySimilaritySettings = () => {
    if (!similarityDraft || saveSimilaritySettingsMutation.isPending) {
      return
    }

    saveSimilaritySettingsMutation.mutate({
      detailSimilarThreshold: Math.max(1, Math.min(64, Math.round(similarityDraft.detailSimilarThreshold))),
      detailSimilarLimit: Math.max(1, Math.min(100, Math.round(similarityDraft.detailSimilarLimit))),
      detailSimilarIncludeColorSimilarity: similarityDraft.detailSimilarIncludeColorSimilarity,
      detailSimilarSortBy: similarityDraft.detailSimilarSortBy,
      detailSimilarSortOrder: similarityDraft.detailSimilarSortOrder,
    })
  }

  const handlePatchSimilarityDraft = (patch: Partial<SimilaritySettingsDraft>) => {
    setSimilarityDraft((current) => (current ? { ...current, ...patch } : current))
  }

  const getErrorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback)

  return (
    <div className="space-y-8">
      <ImageDetailActions
        previewUrl={previewUrl}
        downloadName={downloadName}
        isRefreshing={imageQuery.isFetching}
        onBack={handleBackToFeed}
        onRefresh={() => void imageQuery.refetch()}
      />

      {imageQuery.isLoading ? (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] xl:items-start">
          <div className="space-y-8">
            <Skeleton className="min-h-[540px] w-full rounded-sm" />
            <div className="grid gap-4 md:grid-cols-2">
              <Skeleton className="h-[220px] w-full rounded-sm" />
              <Skeleton className="h-[220px] w-full rounded-sm" />
            </div>
          </div>
          <div className="space-y-3">
            <Skeleton className="h-16 w-full rounded-sm" />
            <Skeleton className="h-16 w-full rounded-sm" />
            <Skeleton className="h-16 w-full rounded-sm" />
          </div>
        </div>
      ) : null}

      {imageQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>이미지 상세를 불러오지 못했어</AlertTitle>
          <AlertDescription>{getErrorMessage(imageQuery.error, '알 수 없는 오류가 발생했어.')}</AlertDescription>
        </Alert>
      ) : null}

      {!imageQuery.isLoading && !imageQuery.isError && image ? (
        <div className="grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] xl:items-start">
          <div className="space-y-8">
            <div className="overflow-hidden rounded-sm bg-surface-low shadow-[0_0_40px_rgba(14,14,14,0.22)]">
              <div className="flex min-h-[540px] items-center justify-center bg-surface-lowest">
                {previewUrl ? (
                  <img src={previewUrl} alt={image.composite_hash || String(image.id)} className="max-h-[80vh] w-full object-contain" />
                ) : (
                  <div className="text-sm text-muted-foreground">표시할 이미지가 없어</div>
                )}
              </div>
            </div>

            {duplicateImages.length > 0 ? (
              <RelatedImageGallerySection
                title="중복 이미지"
                items={duplicateImages}
                isLoading={false}
                errorMessage={null}
                emptyMessage="현재 중복 이미지가 없어."
              />
            ) : null}

            <RelatedImageGallerySection
              title="유사 이미지"
              items={similarImages}
              isLoading={similarQuery.isLoading || settingsQuery.isLoading}
              errorMessage={similarQuery.isError ? getErrorMessage(similarQuery.error, '알 수 없는 오류가 발생했어.') : null}
              emptyMessage="현재 설정에서는 표시할 유사 이미지가 없어."
              actions={
                <SimilaritySettingsPanel
                  isOpen={isSimilaritySettingsOpen}
                  draft={similarityDraft}
                  isSaving={saveSimilaritySettingsMutation.isPending}
                  errorMessage={
                    saveSimilaritySettingsMutation.isError
                      ? getErrorMessage(saveSimilaritySettingsMutation.error, '설정 저장 중 오류가 발생했어.')
                      : null
                  }
                  onToggle={handleToggleSimilaritySettings}
                  onPatchDraft={handlePatchSimilarityDraft}
                  onApply={handleApplySimilaritySettings}
                />
              }
            />
          </div>

          <div className="xl:self-start">
            <ImageDetailMetaCard image={image as ImageRecord} />
          </div>
        </div>
      ) : null}
    </div>
  )
}
