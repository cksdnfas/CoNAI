import type { ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
      <div className="w-full max-w-md space-y-3 rounded-sm bg-surface-low px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="rounded-sm bg-destructive-soft p-2 text-destructive-soft-foreground">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="text-sm font-semibold text-foreground">{t('requireAuthPermission.statusUnavailable')}</div>
            <div className="text-sm text-muted-foreground">{t('requireAuthPermission.statusUnavailableHint')}</div>
            {error instanceof Error && error.message ? (
              <div className="break-words text-xs text-muted-foreground/80">{error.message}</div>
            ) : null}
          </div>
        </div>
        <div className="flex justify-end">
          <Button type="button" size="sm" variant="secondary" onClick={onRetry} disabled={isRetrying}>
            <RotateCw className={isRetrying ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {isRetrying ? t('requireAuthPermission.retrying') : t('requireAuthPermission.retry')}
          </Button>
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
    return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
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

  return <div className="min-h-[40vh] rounded-sm bg-surface-low animate-pulse" />
}
