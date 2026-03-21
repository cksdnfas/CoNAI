import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getImages } from '@/lib/api'
import type { ImageRecord } from '@/types/image'

const curatedFilters = ['All Works', 'Cinematic', 'Architectural', 'Portrait', 'Abstract']

function getDisplayName(image: ImageRecord) {
  const raw = image.original_file_path || image.composite_hash || String(image.id)
  const normalized = raw.replace(/\\/g, '/')
  return normalized.split('/').at(-1) || raw
}

function ImageCard({ image }: { image: ImageRecord }) {
  const previewUrl = image.thumbnail_url || image.image_url
  const imageElement = previewUrl ? (
    <img
      src={previewUrl}
      alt={getDisplayName(image)}
      className="w-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
      loading="lazy"
    />
  ) : (
    <div className="flex min-h-[280px] items-center justify-center text-sm text-muted-foreground">미리보기 없음</div>
  )

  if (!image.composite_hash) {
    return (
      <div className="group mb-6 break-inside-avoid overflow-hidden rounded-sm bg-surface-low shadow-[0_0_40px_rgba(14,14,14,0.18)]">
        <div className="bg-surface-lowest">{imageElement}</div>
      </div>
    )
  }

  return (
    <Link
      to={`/images/${image.composite_hash}`}
      className="group mb-6 block break-inside-avoid overflow-hidden rounded-sm bg-surface-low shadow-[0_0_40px_rgba(14,14,14,0.18)]"
      aria-label={`${getDisplayName(image)} 상세 보기`}
    >
      <div className="bg-surface-lowest">{imageElement}</div>
    </Link>
  )
}

export function HomePage() {
  const imagesQuery = useQuery({
    queryKey: ['home-images'],
    queryFn: () => getImages({ page: 1, limit: 12 }),
  })

  const images = imagesQuery.data?.images ?? []

  return (
    <div className="space-y-8">
      <section className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
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
