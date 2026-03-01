import { useState } from 'react'
import { KeyRound, Loader2, LogIn } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { naiApi } from '@/services/nai-api'

interface NAILoginFormProps {
  onLoginSuccess: (token: string, expiresAt: string) => void
}

export default function NAILoginForm({ onLoginSuccess }: NAILoginFormProps) {
  const { t } = useTranslation(['imageGeneration'])
  const [activeTab, setActiveTab] = useState<'credentials' | 'token'>('credentials')
  const [credentials, setCredentials] = useState({ username: '', password: '' })
  const [token, setToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCredentialsSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const response = await naiApi.login(credentials.username, credentials.password)
      localStorage.setItem('nai_token', response.accessToken)
      localStorage.setItem('nai_token_expires', response.expiresAt)
      onLoginSuccess(response.accessToken, response.expiresAt)
    } catch (submitError: unknown) {
      const maybeError = submitError as { response?: { data?: { error?: string } } }
      setError(maybeError.response?.data?.error || t('imageGeneration:nai.login.error'))
    } finally {
      setLoading(false)
    }
  }

  const handleTokenSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const trimmedToken = token.trim()
      if (!trimmedToken) {
        setError(t('imageGeneration:nai.login.tokenError'))
        setLoading(false)
        return
      }

      const response = await naiApi.loginWithToken(trimmedToken)
      localStorage.setItem('nai_token', response.accessToken)
      localStorage.setItem('nai_token_expires', response.expiresAt)
      onLoginSuccess(response.accessToken, response.expiresAt)
    } catch (submitError: unknown) {
      const maybeError = submitError as { response?: { data?: { error?: string } } }
      setError(maybeError.response?.data?.error || t('imageGeneration:nai.login.tokenError'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Card className="w-full max-w-[500px] py-0">
        <CardContent className="space-y-6 p-6">
          <div className="space-y-1 text-center">
            <h2 className="text-2xl font-semibold">{t('imageGeneration:nai.login.title')}</h2>
            <p className="text-muted-foreground text-sm">{t('imageGeneration:nai.login.subtitle')}</p>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(value) => {
              setActiveTab(value as 'credentials' | 'token')
              setError(null)
            }}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="credentials" className="gap-2">
                <LogIn className="h-4 w-4" />
                {t('imageGeneration:nai.login.tabs.credentials')}
              </TabsTrigger>
              <TabsTrigger value="token" className="gap-2">
                <KeyRound className="h-4 w-4" />
                {t('imageGeneration:nai.login.tabs.token')}
              </TabsTrigger>
            </TabsList>

            {error ? (
              <Alert variant="destructive" className="mt-4">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <TabsContent value="credentials" className="mt-4">
              <form onSubmit={handleCredentialsSubmit} className="space-y-4">
                <div className="space-y-2">
                  <p className="text-sm">{t('imageGeneration:nai.login.username')}</p>
                  <Input
                    type="email"
                    value={credentials.username}
                    onChange={(event) => setCredentials({ ...credentials, username: event.target.value })}
                    required
                    disabled={loading}
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-sm">{t('imageGeneration:nai.login.password')}</p>
                  <Input
                    type="password"
                    value={credentials.password}
                    onChange={(event) => setCredentials({ ...credentials, password: event.target.value })}
                    required
                    disabled={loading}
                  />
                </div>

                <Button className="w-full" type="submit" size="lg" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                  {loading ? t('imageGeneration:nai.login.loggingIn') : t('imageGeneration:nai.login.loginButton')}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="token" className="mt-4">
              <form onSubmit={handleTokenSubmit} className="space-y-4">
                <p className="text-muted-foreground text-sm">{t('imageGeneration:nai.login.tokenHint')}</p>

                <div className="space-y-2">
                  <p className="text-sm">{t('imageGeneration:nai.login.token')}</p>
                  <Textarea
                    rows={3}
                    value={token}
                    onChange={(event) => setToken(event.target.value)}
                    placeholder={t('imageGeneration:nai.login.tokenPlaceholder')}
                    required
                    disabled={loading}
                  />
                </div>

                <Button className="w-full" type="submit" size="lg" disabled={loading}>
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                  {loading ? t('imageGeneration:nai.login.loggingIn') : t('imageGeneration:nai.login.loginButton')}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
