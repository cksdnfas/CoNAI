import { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  Alert,
  Paper,
  Typography,
  CircularProgress
} from '@mui/material';
import { Login as LoginIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { naiApi } from '../../../../services/api';

interface NAILoginFormProps {
  onLoginSuccess: (token: string, expiresAt: string) => void;
}

export default function NAILoginForm({ onLoginSuccess }: NAILoginFormProps) {
  const { t } = useTranslation(['imageGeneration']);
  const [credentials, setCredentials] = useState({
    username: '',
    password: ''
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await naiApi.login(credentials.username, credentials.password);

      // Access Token 저장
      localStorage.setItem('nai_token', response.accessToken);
      localStorage.setItem('nai_token_expires', response.expiresAt);

      onLoginSuccess(response.accessToken, response.expiresAt);
    } catch (err: any) {
      setError(
        err.response?.data?.error || t('imageGeneration:nai.login.error')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <Paper sx={{ p: 4, maxWidth: 400, width: '100%' }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="h5" gutterBottom>
            {t('imageGeneration:nai.login.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('imageGeneration:nai.login.subtitle')}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <form onSubmit={handleSubmit}>
          <TextField
            fullWidth
            label={t('imageGeneration:nai.login.username')}
            type="email"
            value={credentials.username}
            onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
            required
            disabled={loading}
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            label={t('imageGeneration:nai.login.password')}
            type="password"
            value={credentials.password}
            onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
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
            startIcon={loading ? <CircularProgress size={20} /> : <LoginIcon />}
          >
            {loading ? t('imageGeneration:nai.login.loggingIn') : t('imageGeneration:nai.login.loginButton')}
          </Button>
        </form>
      </Paper>
    </Box>
  );
}
