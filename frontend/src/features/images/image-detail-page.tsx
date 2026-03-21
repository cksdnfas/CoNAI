import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Download, RefreshCcw } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getImage } from '@/lib/api'

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

interface DetailLocationState {
  fromFeed?: boolean
}

export function ImageDetailPage() {
  const { compositeHash } = useParams<{ compositeHash: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as DetailLocationState | null

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior })
  }, [compositeHash])

  const imageQuery = useQuery({
    queryKey: ['image-detail', compositeHash],
    queryFn: () => getImage(compositeHash!),
    enabled: Boolean(compositeHash),
  })

  const image = imageQuery.data
  const previewUrl = image?.image_url || image?.thumbnail_url
  const downloadName = getDownloadName(image?.original_file_path, image?.composite_hash)

  const handleBackToFeed = () => {
    if (locationState?.fromFeed && window.history.state?.idx > 0) {
      navigate(-1)
      return
    }

    navigate('/')
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
      ) : null}
    </div>
  )
}
