import { AlertTriangle, Home, RefreshCcw } from 'lucide-react'
import { useRouteError } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useI18n } from '@/i18n'
import { getRouteErrorMessage } from '@/lib/error-message'

function isChunkLoadFailure(error: unknown, fallbackMessage: string) {
  const message = getRouteErrorMessage(error, fallbackMessage)
  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk/i.test(message)
}

/** Render a user-friendly route-level error screen, especially for stale deploy chunk failures. */
export function RouteErrorBoundary() {
  const { t } = useI18n()
  const error = useRouteError()
  const fallbackMessage = t('routeErrorBoundary.anUnknownErrorOccurred')
  const isChunkError = isChunkLoadFailure(error, fallbackMessage)
  const message = getRouteErrorMessage(error, fallbackMessage)

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-6 py-10">
      <div className="w-full space-y-6">
        <PageHeader
          eyebrow={t({ ko: '오류', en: 'Error' })}
          title={isChunkError ? t('routeErrorBoundary.appResourcesNeedToBe') : t('routeErrorBoundary.anUnexpectedErrorOccurred')}
        />

        <Card className="w-full">
          <CardContent className="space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div className="space-y-2 text-sm text-muted-foreground">
                {isChunkError ? (
                  <>
                    <p>{t('routeErrorBoundary.thisCanHappenRightAfter')}</p>
                    <p>{t('routeErrorBoundary.aRefreshUsuallyFixesIt')}</p>
                  </>
                ) : (
                  <p>{t({ ko: '이 화면을 표시하다가 문제가 생겼어. 다시 시도하거나 홈으로 이동해 줘.', en: 'Something went wrong while showing this page. Try again, or go back to Home.' })}</p>
                )}
              </div>
            </div>

            <details className="rounded-sm border border-border bg-surface-low p-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none font-medium">{t({ ko: '기술 정보', en: 'Technical details' })}</summary>
              <p className="mt-2 break-all font-mono">{message}</p>
            </details>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => window.location.reload()}>
                <RefreshCcw className="h-4 w-4" />
                {isChunkError ? t({ ko: '새로고침', en: 'Refresh' }) : t({ ko: '다시 시도', en: 'Try again' })}
              </Button>
              {/* A full navigation also recovers when the router itself is in a broken state. */}
              <Button asChild variant="outline">
                <a href="/">
                  <Home className="h-4 w-4" />
                  {t({ ko: '홈으로 이동', en: 'Go to Home' })}
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
