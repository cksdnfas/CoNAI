import { useState } from 'react'
import { Alert, Box, Button, CircularProgress, Paper, Tab, Tabs, TextField, Typography } from '@mui/material'
import { KeyRound, LogIn } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { naiApi } from '@/services/nai-api'

interface NAILoginFormProps {
  onLoginSuccess: (token: string, expiresAt: string) => void
}

export default function NAILoginForm({ onLoginSuccess }: NAILoginFormProps) {
  const { t } = useTranslation(['imageGeneration'])
  const [tabIndex, setTabIndex] = useState(0)
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
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <Paper sx={{ p: 4, maxWidth: 500, width: '100%' }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h5" gutterBottom>
            {t('imageGeneration:nai.login.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('imageGeneration:nai.login.subtitle')}
          </Typography>
        </Box>

        <Tabs
          value={tabIndex}
          onChange={(_event, newValue) => {
            setTabIndex(newValue)
            setError(null)
          }}
          variant="fullWidth"
          sx={{ mb: 3 }}
        >
          <Tab icon={<LogIn className="h-4 w-4" />} iconPosition="start" label={t('imageGeneration:nai.login.tabs.credentials')} />
          <Tab icon={<KeyRound className="h-4 w-4" />} iconPosition="start" label={t('imageGeneration:nai.login.tabs.token')} />
        </Tabs>

        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

        {tabIndex === 0 ? (
          <form onSubmit={handleCredentialsSubmit}>
            <TextField
              fullWidth
              label={t('imageGeneration:nai.login.username')}
              type="email"
              value={credentials.username}
              onChange={(event) => setCredentials({ ...credentials, username: event.target.value })}
              required
              disabled={loading}
              sx={{ mb: 2 }}
            />

            <TextField
              fullWidth
              label={t('imageGeneration:nai.login.password')}
              type="password"
              value={credentials.password}
              onChange={(event) => setCredentials({ ...credentials, password: event.target.value })}
              required
              disabled={loading}
              sx={{ mb: 3 }}
            />

            <Button
              fullWidth
              type="submit"
              variant="contained"
              size="large"
              disabled={loading}
              startIcon={loading ? <CircularProgress size={20} /> : <LogIn className="h-4 w-4" />}
            >
              {loading ? t('imageGeneration:nai.login.loggingIn') : t('imageGeneration:nai.login.loginButton')}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleTokenSubmit}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('imageGeneration:nai.login.tokenHint')}
            </Typography>

            <TextField
              fullWidth
              label={t('imageGeneration:nai.login.token')}
              type="password"
              multiline
              rows={3}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={t('imageGeneration:nai.login.tokenPlaceholder')}
              required
              disabled={loading}
              sx={{ mb: 3 }}
            />

            <Button
              fullWidth
              type="submit"
              variant="contained"
              size="large"
              disabled={loading}
              startIcon={loading ? <CircularProgress size={20} /> : <KeyRound className="h-4 w-4" />}
            >
              {loading ? t('imageGeneration:nai.login.loggingIn') : t('imageGeneration:nai.login.loginButton')}
            </Button>
          </form>
        )}
      </Paper>
    </Box>
  )
}
