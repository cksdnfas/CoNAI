import { AlertTriangle, RefreshCcw } from 'lucide-react'
import { isRouteErrorResponse, useRouteError } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

function getErrorMessage(error: unknown) {
  if (isRouteErrorResponse(error)) {
    return error.statusText || error.data || `HTTP ${error.status}`
  }

  if (error instanceof Error) {
    return error.message
  }

  return '알 수 없는 오류가 발생했어.'
}

function isChunkLoadFailure(error: unknown) {
  const message = getErrorMessage(error)
  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(message)
}

/** Render a user-friendly route-level error screen, especially for stale deploy chunk failures. */
export function RouteErrorBoundary() {
  const error = useRouteError()
  const isChunkError = isChunkLoadFailure(error)
  const message = getErrorMessage(error)

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-6 py-10">
      <div className="w-full space-y-6">
        <PageHeader
          eyebrow="System"
          title={isChunkError ? '앱 리소스를 다시 불러와야 해' : '예상치 못한 오류가 발생했어'}
        />

        <Card className="w-full">
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div className="space-y-2 text-sm text-muted-foreground">
                {isChunkError ? (
                  <>
                    <p>배포 직후나 오래 열어둔 탭에서 예전 청크 파일을 보다가 이런 오류가 날 수 있어.</p>
                    <p>보통 새로고침하면 바로 복구돼. 그래도 계속 뜨면 서버의 최신 프론트 번들과 캐시 상태를 더 확인해야 해.</p>
                  </>
                ) : (
                  <p>{message}</p>
                )}
              </div>
            </div>

            {isChunkError ? <div className="rounded-sm border border-border bg-surface-low p-3 text-xs text-muted-foreground break-all">{message}</div> : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => window.location.reload()}>
                <RefreshCcw className="h-4 w-4" />
                새로고침
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
