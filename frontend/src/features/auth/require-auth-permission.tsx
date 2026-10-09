import type { ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import { hasAuthPermission } from './auth-permissions'
import { useAuthPermissionRedirect } from './use-auth-permission-redirect'
import { useAuthStatusQuery } from './use-auth-status-query'

interface RequireAuthPermissionProps {
  permissionKey: string
  children: ReactNode
}

/** Show a retryable state when auth status failed to load, so a network/server error is not mistaken for "forbidden". */
export function AuthStatusErrorState({ error, isRetrying, onRetry }: { error: unknown; isRetrying: boolean; onRetry: () => void }) {
  const { t } = useI18n()

  return (
    <div role="alert" className="flex min-h-[40vh] items-center justify-center">
      <div className="w-full max-w-md space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-semibold text-foreground">{t('requireAuthPermission.statusUnavailable')}</div>
            {error instanceof Error && error.message ? (
              <div className="break-words text-xs text-muted-foreground/80">{error.message}</div>
            ) : null}
          </div>
        </div>
        <div className="flex justify-end">
          <IconButton size="icon-sm" variant="secondary" onClick={onRetry} disabled={isRetrying} label={isRetrying ? t('requireAuthPermission.retrying') : t('requireAuthPermission.retry')}>
            <RotateCw className={isRetrying ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </IconButton>
        </div>
      </div>
    </div>
  )
}

/** Redirect authenticated users away from routes they are not allowed to view. */
export function RequireAuthPermission({ permissionKey, children }: RequireAuthPermissionProps) {
  const authStatusQuery = useAuthStatusQuery()
  const canViewPage = hasAuthPermission(authStatusQuery.data?.permissionKeys, permissionKey)
  // A failed status fetch says nothing about permissions; only redirect on a successfully loaded "no".
  const isAuthStatusUnavailable = authStatusQuery.isError && !canViewPage

  useAuthPermissionRedirect({
    enabled: !authStatusQuery.isLoading && !isAuthStatusUnavailable && !canViewPage,
    permissionKey,
  })

  if (authStatusQuery.isLoading) {
    return <div className="min-h-[40vh] rounded-sm bg-fill animate-pulse" />
  }

  if (canViewPage) {
    return <>{children}</>
  }

  if (isAuthStatusUnavailable) {
    return (
      <AuthStatusErrorState
        error={authStatusQuery.error}
        isRetrying={authStatusQuery.isFetching}
        onRetry={() => void authStatusQuery.refetch()}
      />
    )
  }

  return <div className="min-h-[40vh] rounded-sm bg-fill animate-pulse" />
}
