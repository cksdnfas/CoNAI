import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, ExternalLink, RefreshCcw } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/common/page-header'
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

export function ImageDetailPage() {
  const { compositeHash } = useParams<{ compositeHash: string }>()

  const imageQuery = useQuery({
    queryKey: ['image-detail', compositeHash],
    queryFn: () => getImage(compositeHash!),
    enabled: Boolean(compositeHash),
  })

  const image = imageQuery.data
  const previewUrl = image?.image_url || image?.thumbnail_url

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Image Detail"
        title="이미지 상세 MVP"
        description="홈에서 진입한 이미지를 바로 검토할 수 있도록 최소 상세 화면을 먼저 복구했다."
        actions={(
          <>
            <Button asChild variant="outline">
              <Link to="/">
                <ArrowLeft className="h-4 w-4" />
                홈으로
              </Link>
            </Button>
            <Button variant="outline" onClick={() => imageQuery.refetch()} disabled={imageQuery.isFetching}>
              <RefreshCcw className="h-4 w-4" />
              다시 불러오기
            </Button>
            {previewUrl ? (
              <Button asChild>
                <a href={previewUrl} target="_blank" rel="noreferrer">
                  원본 열기
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            ) : null}
          </>
        )}
      />

      {imageQuery.isLoading ? (
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Skeleton className="min-h-[420px] w-full rounded-3xl" />
          <Card>
            <CardContent className="space-y-4 px-6 py-6">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
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
        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="overflow-hidden py-0">
            <div className="flex min-h-[420px] items-center justify-center bg-muted">
              {previewUrl ? (
                <img src={previewUrl} alt={image.composite_hash || String(image.id)} className="max-h-[70vh] w-full object-contain" />
              ) : (
                <div className="text-sm text-muted-foreground">표시할 이미지가 없어</div>
              )}
            </div>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-3">
                  <span className="truncate">핵심 메타데이터</span>
                  {image.is_processing ? <Badge variant="secondary">Processing</Badge> : <Badge variant="outline">Ready</Badge>}
                </CardTitle>
                <CardDescription>Phase 1 상세 화면은 실제 업무에 필요한 핵심 필드만 먼저 보여준다.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="rounded-2xl bg-muted/50 p-4">
                  <p className="text-xs uppercase tracking-wide">Composite hash</p>
                  <p className="mt-2 break-all font-mono text-foreground">{image.composite_hash || '—'}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-muted/50 p-4">
                    <p className="text-xs uppercase tracking-wide">Dimensions</p>
                    <p className="mt-2 text-foreground">{image.width && image.height ? `${image.width} × ${image.height}` : '—'}</p>
                  </div>
                  <div className="rounded-2xl bg-muted/50 p-4">
                    <p className="text-xs uppercase tracking-wide">File size</p>
                    <p className="mt-2 text-foreground">{formatBytes(image.file_size)}</p>
                  </div>
                  <div className="rounded-2xl bg-muted/50 p-4 sm:col-span-2">
                    <p className="text-xs uppercase tracking-wide">Model</p>
                    <p className="mt-2 text-foreground">{image.ai_metadata?.model_name || '모델 정보 없음'}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>파일 경로</CardTitle>
                <CardDescription>원본 경로를 바로 확인할 수 있도록 최소 표시만 제공한다.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-2xl bg-muted/50 p-4 font-mono text-xs break-all text-muted-foreground">
                  {image.original_file_path || '—'}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </div>
  )
}
