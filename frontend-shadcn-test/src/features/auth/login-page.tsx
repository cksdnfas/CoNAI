import { useEffect, useState, type FormEvent } from 'react'
import { HelpCircle, Loader2, Lock } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuth } from '@/contexts/auth-context'
import { Input } from '@/components/ui/input'
import { authApi, type DatabaseInfoResponse } from '@/services/auth-api'

export function LoginPage() {
  const navigate = useNavigate()
  const { hasCredentials, isAuthenticated, isLoading, login } = useAuth()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false)
  const [dbInfo, setDbInfo] = useState<DatabaseInfoResponse | null>(null)

  useEffect(() => {
    if (!isLoading && !hasCredentials) {
      navigate('/')
    }

    if (!isLoading && isAuthenticated) {
      navigate('/')
    }
  }, [hasCredentials, isAuthenticated, isLoading, navigate])

  useEffect(() => {
    const loadDbInfo = async () => {
      try {
        const info = await authApi.getDatabaseInfo()
        setDbInfo(info)
      } catch (loadError) {
        console.error('Failed to load database info:', loadError)
      }
    }

    void loadDbInfo()
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!username || !password) return

    try {
      setIsSubmitting(true)
      setError('')
      await login(username, password)
      navigate('/')
    } catch (submitError) {
      if (submitError instanceof Error) {
        setError(submitError.message || 'Login failed')
      } else {
        setError('Login failed')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Lock className="h-7 w-7" />
          </div>
          <CardTitle className="text-center text-2xl">ComfyUI Image Manager</CardTitle>
          <CardDescription className="text-center">Sign in to continue</CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Login failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="username">
                Username
              </label>
              <Input
                id="username"
                autoComplete="username"
                disabled={isSubmitting}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="password">
                Password
              </label>
              <Input
                id="password"
                autoComplete="current-password"
                disabled={isSubmitting}
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            <Button className="w-full" disabled={isSubmitting || !username || !password} type="submit">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Sign In
            </Button>
          </form>

          <div className="text-center">
            <Button variant="link" onClick={() => setShowRecoveryDialog(true)}>
              <HelpCircle className="h-4 w-4" />
              Account recovery guide
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showRecoveryDialog} onOpenChange={setShowRecoveryDialog}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Account recovery</DialogTitle>
            <DialogDescription>
              If you lost your account password, remove the auth database and restart the server.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            <ol className="list-decimal space-y-1 pl-4 text-muted-foreground">
              <li>Stop ComfyUI Image Manager backend.</li>
              <li>Delete the auth database file below.</li>
              <li>Restart backend and set a new account.</li>
              <li>Log in with the new credentials.</li>
            </ol>

            {dbInfo ? (
              <div className="rounded-md border bg-muted/30 p-3 font-mono text-xs break-all">
                {dbInfo.authDbPath}
              </div>
            ) : (
              <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                Unable to read auth DB path from backend.
              </div>
            )}

            <Alert>
              <AlertTitle>Warning</AlertTitle>
              <AlertDescription>
                Deleting the auth DB resets account credentials. Keep backup and proceed carefully.
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRecoveryDialog(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
