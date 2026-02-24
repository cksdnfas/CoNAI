import type { PropsWithChildren } from 'react'
import { Navigate } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'

export function ProtectedRoute({ children }: PropsWithChildren) {
  const { hasCredentials, isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!hasCredentials) {
    return children
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return children
}
