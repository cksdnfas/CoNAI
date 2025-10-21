import { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  Alert,
  Paper,
  Typography,
  CircularProgress,
  Tabs,
  Tab
} from '@mui/material';
import { Login as LoginIcon, VpnKey as TokenIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { naiApi } from '../../../../services/api';

interface NAILoginFormProps {
  onLoginSuccess: (token: string, expiresAt: string) => void;
}

export default function NAILoginForm({ onLoginSuccess }: NAILoginFormProps) {
  const { t } = useTranslation(['imageGeneration']);
  const [tabIndex, setTabIndex] = useState(0);
  const [credentials, setCredentials] = useState({
    username: '',
    password: ''
  });
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCredentialsSubmit = async (e: React.FormEvent) => {
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

  const handleTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // 토큰 trim 처리
      const trimmedToken = token.trim();

      if (!trimmedToken) {
        setError(t('imageGeneration:nai.login.tokenError'));
        setLoading(false);
        return;
      }

      const response = await naiApi.loginWithToken(trimmedToken);

      // Access Token 저장
      localStorage.setItem('nai_token', response.accessToken);
      localStorage.setItem('nai_token_expires', response.expiresAt);

      onLoginSuccess(response.accessToken, response.expiresAt);
    } catch (err: any) {
      console.error('[NAI Login] Token login error:', err);
      setError(
        err.response?.data?.error || t('imageGeneration:nai.login.tokenError')
      );
    } finally {
      setLoading(false);
    }
  };

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

        {/* 탭 선택 */}
        <Tabs
          value={tabIndex}
          onChange={(_, newValue) => {
            setTabIndex(newValue);
            setError(null); // 탭 변경 시 에러 초기화
          }}
          variant="fullWidth"
          sx={{ mb: 3 }}
        >
          <Tab
            icon={<LoginIcon />}
            iconPosition="start"
            label={t('imageGeneration:nai.login.tabs.credentials')}
          />
          <Tab
            icon={<TokenIcon />}
            iconPosition="start"
            label={t('imageGeneration:nai.login.tabs.token')}
          />
        </Tabs>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {/* 이메일/비밀번호 로그인 폼 */}
        {tabIndex === 0 && (
          <form onSubmit={handleCredentialsSubmit}>
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
        )}

        {/* 토큰 로그인 폼 */}
        {tabIndex === 1 && (
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
              onChange={(e) => setToken(e.target.value)}
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
              startIcon={loading ? <CircularProgress size={20} /> : <TokenIcon />}
            >
              {loading ? t('imageGeneration:nai.login.loggingIn') : t('imageGeneration:nai.login.loginButton')}
            </Button>
          </form>
        )}
      </Paper>
    </Box>
  );
}
