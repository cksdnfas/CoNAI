import { useEffect, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { authApi } from '@/services/auth-api'
import { useAuth } from '@/contexts/auth-context'

export function AuthSettingsFeature() {
  const { hasCredentials, checkAuth } = useAuth()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [authDbPath, setAuthDbPath] = useState<string | null>(null)

  const [setupUsername, setSetupUsername] = useState('')
  const [setupPassword, setSetupPassword] = useState('')
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('')

  const [currentPassword, setCurrentPassword] = useState('')
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')

  useEffect(() => {
    const loadDbInfo = async () => {
      try {
        const info = await authApi.getDatabaseInfo()
        setAuthDbPath(info.authDbPath)
      } catch {
        setAuthDbPath(null)
      }
    }

    void loadDbInfo()
  }, [])

  const clearMessages = () => {
    setError(null)
    setSuccess(null)
  }

  const handleSetup = async () => {
    clearMessages()

    if (!setupUsername || !setupPassword || !setupConfirmPassword) {
      setError('Please fill all setup fields.')
      return
    }

    if (setupPassword !== setupConfirmPassword) {
      setError('Setup passwords do not match.')
      return
    }

    setIsLoading(true)
    try {
      await authApi.setup(setupUsername, setupPassword)
      await checkAuth()
      setSuccess('Account credentials initialized successfully.')
      setSetupUsername('')
      setSetupPassword('')
      setSetupConfirmPassword('')
    } catch (setupError) {
      if (setupError instanceof Error) {
        setError(setupError.message || 'Failed to initialize account credentials.')
      } else {
        setError('Failed to initialize account credentials.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdate = async () => {
    clearMessages()

    if (!currentPassword || !newUsername || !newPassword || !confirmNewPassword) {
      setError('Please fill all update fields.')
      return
    }

    if (newPassword !== confirmNewPassword) {
      setError('New passwords do not match.')
      return
    }

    setIsLoading(true)
    try {
      await authApi.updateCredentials(currentPassword, newUsername, newPassword)
      await checkAuth()
      setSuccess('Account credentials updated successfully.')
      setCurrentPassword('')
      setNewUsername('')
      setNewPassword('')
      setConfirmNewPassword('')
    } catch (updateError) {
      if (updateError instanceof Error) {
        setError(updateError.message || 'Failed to update account credentials.')
      } else {
        setError('Failed to update account credentials.')
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <section className="space-y-4">
      <h3 className="text-lg font-semibold">Account settings</h3>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {success ? (
        <Alert>
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      ) : null}

      {!hasCredentials ? (
        <div className="space-y-3 rounded-md border p-3">
          <h4 className="font-medium">Initial setup</h4>
          <Input
            placeholder="Username"
            value={setupUsername}
            onChange={(event) => setSetupUsername(event.target.value)}
            disabled={isLoading}
          />
          <Input
            type="password"
            placeholder="Password"
            value={setupPassword}
            onChange={(event) => setSetupPassword(event.target.value)}
            disabled={isLoading}
          />
          <Input
            type="password"
            placeholder="Confirm password"
            value={setupConfirmPassword}
            onChange={(event) => setSetupConfirmPassword(event.target.value)}
            disabled={isLoading}
          />
          <Button type="button" onClick={() => void handleSetup()} disabled={isLoading}>
            Initialize account credentials
          </Button>
        </div>
      ) : (
        <div className="space-y-3 rounded-md border p-3">
          <h4 className="font-medium">Update credentials</h4>
          <Input
            type="password"
            placeholder="Current password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            disabled={isLoading}
          />
          <Input
            placeholder="New username"
            value={newUsername}
            onChange={(event) => setNewUsername(event.target.value)}
            disabled={isLoading}
          />
          <Input
            type="password"
            placeholder="New password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            disabled={isLoading}
          />
          <Input
            type="password"
            placeholder="Confirm new password"
            value={confirmNewPassword}
            onChange={(event) => setConfirmNewPassword(event.target.value)}
            disabled={isLoading}
          />
          <Button type="button" onClick={() => void handleUpdate()} disabled={isLoading}>
            Save updated credentials
          </Button>
          {authDbPath ? <p className="text-xs text-muted-foreground">Recovery DB path: {authDbPath}</p> : null}
        </div>
      )}
    </section>
  )
}
