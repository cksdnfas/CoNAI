import { AlertTriangle, Home, RefreshCcw } from 'lucide-react'
import { useRouteError } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { getRouteErrorMessage } from '@/lib/error-message'
import { SystemMessagePanel } from '@/features/system/system-message-panel'

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
    <div className="px-4">
      <SystemMessagePanel
        icon={AlertTriangle}
        iconTone="warning"
        overline={t({ ko: '오류', en: 'Error' })}
        title={isChunkError ? t('routeErrorBoundary.appResourcesNeedToBe') : t('routeErrorBoundary.anUnexpectedErrorOccurred')}
        description={isChunkError ? (
          <>
            <p>{t('routeErrorBoundary.thisCanHappenRightAfter')}</p>
            <p>{t('routeErrorBoundary.aRefreshUsuallyFixesIt')}</p>
          </>
        ) : (
          <p>{t({ ko: '이 화면을 표시하다가 문제가 생겼어. 다시 시도하거나 홈으로 이동해 줘.', en: 'Something went wrong while showing this page. Try again, or go back to Home.' })}</p>
        )}
        actions={(
          <>
            <Button type="button" onClick={() => window.location.reload()}>
              <RefreshCcw className="h-4 w-4" />
              {isChunkError ? t({ ko: '새로고침', en: 'Refresh' }) : t({ ko: '다시 시도', en: 'Try again' })}
            </Button>
            {/* A full navigation also recovers when the router itself is in a broken state. */}
            <Button asChild variant="secondary">
              <a href="/">
                <Home className="h-4 w-4" />
                {t({ ko: '홈으로 이동', en: 'Go to Home' })}
              </a>
            </Button>
          </>
        )}
      >
        <details className="rounded-sm bg-surface-lowest px-3 py-2.5 text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none font-medium">{t({ ko: '기술 정보', en: 'Technical details' })}</summary>
          <p className="mt-2 break-all font-mono">{message}</p>
        </details>
      </SystemMessagePanel>
    </div>
  )
}
