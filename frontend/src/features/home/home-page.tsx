import { useQuery } from '@tanstack/react-query'
import { Download, ExternalLink, Heart, RefreshCcw, SlidersHorizontal, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/common/page-header'
import { getImages } from '@/lib/api'
import type { ImageRecord } from '@/types/image'

const curatedFilters = ['All Works', 'Cinematic', 'Architectural', 'Portrait', 'Abstract']

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

function formatDate(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getDisplayName(image: ImageRecord) {
  const raw = image.original_file_path || image.composite_hash || String(image.id)
  const normalized = raw.replace(/\\/g, '/')
  return normalized.split('/').at(-1) || raw
}

function ImageCard({ image }: { image: ImageRecord }) {
  const previewUrl = image.thumbnail_url || image.image_url

  return (
    <div className="group mb-6 break-inside-avoid overflow-hidden rounded-sm bg-surface-low shadow-[0_0_40px_rgba(14,14,14,0.18)]">
      <div className="relative overflow-hidden bg-surface-lowest">
        {previewUrl ? (
          <img src={previewUrl} alt={getDisplayName(image)} className="w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" loading="lazy" />
        ) : (
          <div className="flex min-h-[280px] items-center justify-center text-sm text-muted-foreground">미리보기 없음</div>
        )}

        <div className="absolute inset-0 flex flex-col justify-end bg-linear-to-t from-black/85 via-black/15 to-transparent p-5 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <p className="mb-1 text-[10px] font-bold tracking-[0.18em] text-secondary uppercase">
            {image.is_processing ? 'Processing' : 'Curated Feed'}
          </p>
          <h3 className="mb-3 text-lg font-semibold leading-tight text-foreground">{getDisplayName(image)}</h3>
          <div className="flex items-center justify-between gap-4">
            <div className="flex gap-2">
              <button className="rounded-sm bg-white/10 p-2 text-white/80 backdrop-blur-md transition-colors hover:bg-primary hover:text-primary-foreground" aria-label="Favorite">
                <Heart className="h-4 w-4" />
              </button>
              {previewUrl ? (
                <a
                  className="rounded-sm bg-white/10 p-2 text-white/80 backdrop-blur-md transition-colors hover:bg-primary hover:text-primary-foreground"
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open original"
                >
                  <Download className="h-4 w-4" />
                </a>
              ) : null}
            </div>
            <span className="text-[10px] font-medium text-white/60">{image.ai_metadata?.model_name || 'Unknown model'}</span>
          </div>
        </div>
      </div>

      <div className="space-y-3 px-4 py-4 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="truncate font-medium text-foreground">{getDisplayName(image)}</p>
            <p className="text-xs text-muted-foreground">{formatDate(image.first_seen_date)}</p>
          </div>
          {image.is_processing ? <Badge variant="secondary">Processing</Badge> : <Badge variant="outline">Ready</Badge>}
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span className="rounded-sm bg-surface-high px-2.5 py-1">{image.width && image.height ? `${image.width}×${image.height}` : 'Unknown size'}</span>
          <span className="rounded-sm bg-surface-high px-2.5 py-1">{formatBytes(image.file_size)}</span>
        </div>

        {image.composite_hash ? (
          <Button asChild size="sm" variant="ghost" className="px-0 text-secondary hover:bg-transparent hover:text-secondary/85">
            <Link to={`/images/${image.composite_hash}`}>작품 열기</Link>
          </Button>
        ) : null}
      </div>
    </div>
  )
}

export function HomePage() {
  const imagesQuery = useQuery({
    queryKey: ['home-images'],
    queryFn: () => getImages({ page: 1, limit: 12 }),
  })

  const images = imagesQuery.data?.images ?? []
  const total = imagesQuery.data?.total ?? 0

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Curated Feed"
        title="조용한 갤러리처럼, 작품이 먼저 보이는 홈 화면"
        description="이 홈은 운영 패널보다 큐레이션 피드에 가까워야 해. UI는 한 발 뒤로 물러나고, 이미지와 선택 순간만 강조한다."
        actions={(
          <>
            <Button variant="secondary" onClick={() => imagesQuery.refetch()} disabled={imagesQuery.isFetching}>
              <RefreshCcw className="h-4 w-4" />
              Refresh feed
            </Button>
            <Button asChild>
              <a href="http://localhost:1666/health" target="_blank" rel="noreferrer">
                Backend health
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </>
        )}
      />

      <section className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {curatedFilters.map((filter, index) => (
              <span
                key={filter}
                className={index === 0 ? 'cursor-default rounded-sm bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground' : 'cursor-default rounded-sm bg-surface-highest px-4 py-1.5 text-xs font-medium text-muted-foreground'}
              >
                {filter}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-6 text-sm font-medium text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-secondary" />
              총 {total.toLocaleString('ko-KR')}개의 작품이 백엔드에 있어
            </span>
            <span>현재 표시: {images.length.toLocaleString('ko-KR')}</span>
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm font-medium text-muted-foreground">
          <span className="inline-flex items-center gap-2 transition-colors hover:text-secondary">
            <SlidersHorizontal className="h-4 w-4" />
            Sort: Recent
          </span>
          <span className="inline-flex items-center gap-2 transition-colors hover:text-secondary">
            <SlidersHorizontal className="h-4 w-4" />
            Filters
          </span>
        </div>
      </section>

      {imagesQuery.isError ? (
        <Alert variant="destructive">
          <AlertTitle>홈 피드를 불러오지 못했어</AlertTitle>
          <AlertDescription>
            {imagesQuery.error instanceof Error ? imagesQuery.error.message : '알 수 없는 오류가 발생했어.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {imagesQuery.isLoading ? (
        <section className="columns-1 gap-6 sm:columns-2 xl:columns-3 2xl:columns-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="mb-6 break-inside-avoid overflow-hidden rounded-sm bg-surface-low">
              <Skeleton className="min-h-[280px] w-full rounded-none" />
              <div className="space-y-3 px-4 py-4">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <div className="flex gap-2">
                  <Skeleton className="h-7 w-20" />
                  <Skeleton className="h-7 w-20" />
                </div>
              </div>
            </div>
          ))}
        </section>
      ) : null}

      {!imagesQuery.isLoading && !imagesQuery.isError && images.length === 0 ? (
        <Card className="bg-surface-container">
          <CardHeader>
            <CardTitle>표시할 이미지가 아직 없어</CardTitle>
            <CardDescription>업로드를 연결하거나 백엔드 데이터 상태를 먼저 확인하면 돼.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {!imagesQuery.isLoading && !imagesQuery.isError && images.length > 0 ? (
        <section className="columns-1 gap-6 sm:columns-2 xl:columns-3 2xl:columns-4">
          {images.map((image) => (
            <ImageCard key={String(image.id)} image={image} />
          ))}
        </section>
      ) : null}
    </div>
  )
}
