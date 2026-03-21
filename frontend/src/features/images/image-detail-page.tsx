import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Download, RefreshCcw, Settings2 } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ImageList } from '@/features/images/components/image-list/image-list'
import {
  getAppSettings,
  getImage,
  getImageDuplicates,
  getSimilarImages,
  updateSimilaritySettings,
} from '@/lib/api'
import type { ImageRecord } from '@/types/image'
import type { SimilaritySettings } from '@/types/settings'

function formatBytes(value?: number | null) {
  if (!value) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function getDownloadName(path?: string | null, compositeHash?: string | null) {
  if (path) {
    const normalized = path.replace(/\\/g, '/')
    const name = normalized.split('/').at(-1)
    if (name) return name
  }

  return compositeHash ? `${compositeHash}.png` : 'image'
}

function getValidImageRecords(images: ImageRecord[]) {
  return images.filter((image) => typeof image.composite_hash === 'string' && image.composite_hash.length > 0)
}

interface DetailLocationState {
  fromFeed?: boolean
  sourcePath?: string
}

interface SimilaritySettingsDraft {
  detailSimilarThreshold: number
  detailSimilarLimit: number
  detailSimilarIncludeColorSimilarity: boolean
  detailSimilarSortBy: SimilaritySettings['detailSimilarSortBy']
  detailSimilarSortOrder: SimilaritySettings['detailSimilarSortOrder']
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

  const duplicateHashSet = useMemo(
    () => new Set(duplicateImages.map((item) => item.composite_hash as string)),
    [duplicateImages],
  )

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

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={handleBackToFeed}>
          <ArrowLeft className="h-4 w-4" />
          피드로 돌아가기
        </Button>
        <Button variant="outline" onClick={() => imageQuery.refetch()} disabled={imageQuery.isFetching}>
          <RefreshCcw className="h-4 w-4" />
          새로고침
        </Button>
        {previewUrl ? (
          <Button asChild>
            <a href={previewUrl} download={downloadName}>
              <Download className="h-4 w-4" />
              다운로드
            </a>
          </Button>
        ) : null}
      </div>

      {imageQuery.isLoading ? (
        <div className="grid gap-8 xl:grid-cols-[1.2fr_0.8fr]">
          <Skeleton className="min-h-[540px] w-full rounded-sm" />
          <div className="space-y-6">
            <Card className="bg-surface-container">
              <CardContent className="space-y-4 px-6 py-6">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}

      {imageQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>이미지 상세를 불러오지 못했어</AlertTitle>
          <AlertDescription>
            {imageQuery.error instanceof Error ? imageQuery.error.message : '알 수 없는 오류가 발생했어.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {!imageQuery.isLoading && !imageQuery.isError && image ? (
        <>
          <div className="grid gap-8 xl:grid-cols-[1.25fr_0.75fr]">
            <div className="overflow-hidden rounded-sm bg-surface-low shadow-[0_0_40px_rgba(14,14,14,0.22)]">
              <div className="flex min-h-[540px] items-center justify-center bg-surface-lowest">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={image.composite_hash || String(image.id)}
                    className="max-h-[80vh] w-full object-contain"
                  />
                ) : (
                  <div className="text-sm text-muted-foreground">표시할 이미지가 없어</div>
                )}
              </div>
            </div>

            <Card className="bg-surface-container">
              <CardContent className="space-y-3 p-6 text-sm text-muted-foreground">
                {image.is_processing ? (
                  <div className="flex items-center justify-end">
                    <Badge variant="secondary">Processing</Badge>
                  </div>
                ) : null}

                <div className="rounded-sm bg-surface-high p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em]">Composite hash</p>
                  <p className="mt-2 break-all font-mono text-foreground">{image.composite_hash || '—'}</p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-sm bg-surface-high p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em]">Dimensions</p>
                    <p className="mt-2 text-foreground">
                      {image.width && image.height ? `${image.width} × ${image.height}` : '—'}
                    </p>
                  </div>
                  <div className="rounded-sm bg-surface-high p-4">
                    <p className="text-[11px] uppercase tracking-[0.18em]">File size</p>
                    <p className="mt-2 text-foreground">{formatBytes(image.file_size)}</p>
                  </div>
                  {image.ai_metadata?.model_name ? (
                    <div className="rounded-sm bg-surface-high p-4 sm:col-span-2">
                      <p className="text-[11px] uppercase tracking-[0.18em]">Model</p>
                      <p className="mt-2 text-foreground">{image.ai_metadata.model_name}</p>
                    </div>
                  ) : null}
                  {image.original_file_path ? (
                    <div className="rounded-sm bg-surface-high p-4 sm:col-span-2">
                      <p className="text-[11px] uppercase tracking-[0.18em]">Path</p>
                      <p className="mt-2 break-all font-mono text-xs text-foreground/88">{image.original_file_path}</p>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          </div>

          {duplicateImages.length > 0 ? (
            <section className="space-y-4">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">중복 이미지</h2>

              <ImageList
                items={duplicateImages}
                layout="grid"
                getItemHref={(relatedImage) =>
                  relatedImage.composite_hash ? `/images/${relatedImage.composite_hash}` : undefined
                }
                minColumnWidth={220}
                columnGap={16}
                rowGap={16}
                gridItemHeight={220}
              />
            </section>
          ) : null}

          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">유사 이미지</h2>

              <div className="relative">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleToggleSimilaritySettings}
                >
                  <Settings2 className="h-4 w-4" />
                  유사도 설정
                </Button>

                {isSimilaritySettingsOpen && similarityDraft ? (
                  <div className="absolute right-0 top-12 z-30 w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface-container p-4 shadow-[0_0_32px_rgba(14,14,14,0.28)]">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                          Threshold
                        </label>
                        <div className="flex items-center gap-3">
                          <input
                            type="range"
                            min={1}
                            max={64}
                            step={1}
                            value={similarityDraft.detailSimilarThreshold}
                            onChange={(event) =>
                              setSimilarityDraft((current) =>
                                current
                                  ? { ...current, detailSimilarThreshold: Number(event.target.value) }
                                  : current,
                              )
                            }
                            className="w-full"
                          />
                          <span className="w-10 text-right text-sm text-foreground">
                            {similarityDraft.detailSimilarThreshold}
                          </span>
                        </div>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                            Limit
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={similarityDraft.detailSimilarLimit}
                            onChange={(event) =>
                              setSimilarityDraft((current) =>
                                current
                                  ? { ...current, detailSimilarLimit: Number(event.target.value) }
                                  : current,
                              )
                            }
                            className="h-10 w-full rounded-sm border border-border bg-surface-high px-3 text-sm text-foreground outline-none focus:border-primary"
                          />
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                            Sort By
                          </label>
                          <select
                            value={similarityDraft.detailSimilarSortBy}
                            onChange={(event) =>
                              setSimilarityDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      detailSimilarSortBy: event.target.value as SimilaritySettings['detailSimilarSortBy'],
                                    }
                                  : current,
                              )
                            }
                            className="h-10 w-full rounded-sm border border-border bg-surface-high px-3 text-sm text-foreground outline-none focus:border-primary"
                          >
                            <option value="similarity">Similarity</option>
                            <option value="upload_date">Upload date</option>
                          </select>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">
                            Sort Order
                          </label>
                          <select
                            value={similarityDraft.detailSimilarSortOrder}
                            onChange={(event) =>
                              setSimilarityDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      detailSimilarSortOrder: event.target.value as SimilaritySettings['detailSimilarSortOrder'],
                                    }
                                  : current,
                              )
                            }
                            className="h-10 w-full rounded-sm border border-border bg-surface-high px-3 text-sm text-foreground outline-none focus:border-primary"
                          >
                            <option value="DESC">DESC</option>
                            <option value="ASC">ASC</option>
                          </select>
                        </div>

                        <label className="flex items-center gap-3 rounded-sm border border-border bg-surface-high px-3 py-2.5 text-sm text-foreground">
                          <input
                            type="checkbox"
                            checked={similarityDraft.detailSimilarIncludeColorSimilarity}
                            onChange={(event) =>
                              setSimilarityDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      detailSimilarIncludeColorSimilarity: event.target.checked,
                                    }
                                  : current,
                              )
                            }
                            className="h-4 w-4"
                          />
                          색상 유사도 포함
                        </label>
                      </div>

                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={handleToggleSimilaritySettings}
                        >
                          닫기
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleApplySimilaritySettings}
                          disabled={saveSimilaritySettingsMutation.isPending}
                        >
                          {saveSimilaritySettingsMutation.isPending ? '저장 중…' : '적용'}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {saveSimilaritySettingsMutation.isError ? (
              <Alert variant="destructive">
                <AlertTitle>유사 이미지 설정을 저장하지 못했어</AlertTitle>
                <AlertDescription>
                  {saveSimilaritySettingsMutation.error instanceof Error
                    ? saveSimilaritySettingsMutation.error.message
                    : '설정 저장 중 오류가 발생했어.'}
                </AlertDescription>
              </Alert>
            ) : null}

            {similarQuery.isLoading || settingsQuery.isLoading ? (
              <div className="grid gap-4 md:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Skeleton key={index} className="h-[220px] w-full rounded-sm" />
                ))}
              </div>
            ) : null}

            {similarQuery.isError ? (
              <Alert variant="destructive">
                <AlertTitle>유사 이미지를 불러오지 못했어</AlertTitle>
                <AlertDescription>
                  {similarQuery.error instanceof Error ? similarQuery.error.message : '알 수 없는 오류가 발생했어.'}
                </AlertDescription>
              </Alert>
            ) : null}

            {!similarQuery.isLoading && !similarQuery.isError && similarImages.length > 0 ? (
              <ImageList
                items={similarImages}
                layout="grid"
                getItemHref={(relatedImage) =>
                  relatedImage.composite_hash ? `/images/${relatedImage.composite_hash}` : undefined
                }
                minColumnWidth={220}
                columnGap={16}
                rowGap={16}
                gridItemHeight={220}
              />
            ) : null}

            {!similarQuery.isLoading && !similarQuery.isError && similarImages.length === 0 ? (
              <Card className="bg-surface-container">
                <CardContent className="p-6 text-sm text-muted-foreground">
                  현재 설정에서는 표시할 유사 이미지가 없어.
                </CardContent>
              </Card>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  )
}
