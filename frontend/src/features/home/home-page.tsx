import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ExternalLink, RefreshCcw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/common/page-header'
import { getImages } from '@/lib/api'
import type { ImageRecord } from '@/types/image'

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
    <Card className="overflow-hidden border-border/80 py-0 transition-transform hover:-translate-y-0.5 hover:shadow-md">
      <div className="aspect-[4/3] bg-muted">
        {previewUrl ? (
          <img src={previewUrl} alt={getDisplayName(image)} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">미리보기 없음</div>
        )}
      </div>

      <CardContent className="space-y-3 px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="truncate text-sm font-medium text-foreground">{getDisplayName(image)}</p>
            <p className="text-xs text-muted-foreground">{image.ai_metadata?.model_name || '모델 정보 없음'}</p>
          </div>
          {image.is_processing ? <Badge variant="secondary">Processing</Badge> : <Badge variant="outline">Ready</Badge>}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div className="rounded-xl bg-muted/60 px-3 py-2">크기: {image.width && image.height ? `${image.width}×${image.height}` : '—'}</div>
          <div className="rounded-xl bg-muted/60 px-3 py-2">용량: {formatBytes(image.file_size)}</div>
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span className="truncate">{formatDate(image.first_seen_date)}</span>
          {image.composite_hash ? (
            <Button asChild size="sm" variant="ghost">
              <Link to={`/images/${image.composite_hash}`}>
                상세
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
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
    <div className="space-y-8">
      <PageHeader
        eyebrow="Home MVP"
        title="새 프론트 첫 번째 실데이터 화면"
        description="홈은 지금 프론트가 살아 있는지 확인하는 기준 화면이야. 목록 조회, 상태 처리, 상세 이동까지 먼저 안정화한다."
        actions={(
          <>
            <Button variant="outline" onClick={() => imagesQuery.refetch()} disabled={imagesQuery.isFetching}>
              <RefreshCcw className="h-4 w-4" />
              새로고침
            </Button>
            <Button asChild>
              <a href="http://localhost:1666/health" target="_blank" rel="noreferrer">
                백엔드 체크
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </>
        )}
      />

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>현재 피드 상태</CardDescription>
            <CardTitle>{imagesQuery.isLoading ? '로딩 중' : imagesQuery.isError ? '에러' : '정상 연결'}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>표시 중인 카드</CardDescription>
            <CardTitle>{imagesQuery.isLoading ? '—' : images.length.toLocaleString('ko-KR')}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>백엔드 총 이미지 수</CardDescription>
            <CardTitle>{imagesQuery.isLoading ? '—' : total.toLocaleString('ko-KR')}</CardTitle>
          </CardHeader>
        </Card>
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
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="overflow-hidden py-0">
              <Skeleton className="aspect-[4/3] w-full rounded-none" />
              <CardContent className="space-y-3 px-4 py-4">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
                <div className="grid grid-cols-2 gap-2">
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      {!imagesQuery.isLoading && !imagesQuery.isError && images.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>표시할 이미지가 아직 없어</CardTitle>
            <CardDescription>업로드를 연결하거나 백엔드 데이터 상태를 먼저 확인하면 돼.</CardDescription>
          </CardHeader>
        </Card>
      ) : null}

      {!imagesQuery.isLoading && !imagesQuery.isError && images.length > 0 ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {images.map((image) => (
            <ImageCard key={String(image.id)} image={image} />
          ))}
        </section>
      ) : null}
    </div>
  )
}
