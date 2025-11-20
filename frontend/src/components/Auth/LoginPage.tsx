import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  Typography,
  Alert,
  CircularProgress,
  Container,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Link
} from '@mui/material';
import { LockOutlined, Help } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { authApi, type DatabaseInfoResponse } from '../../services/authApi';

export const LoginPage: React.FC = () => {
  const { t } = useTranslation(['auth', 'common']);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showRecoveryDialog, setShowRecoveryDialog] = useState(false);
  const [dbInfo, setDbInfo] = useState<DatabaseInfoResponse | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();

  // Load database info on mount
  useEffect(() => {
    const loadDbInfo = async () => {
      try {
        const info = await authApi.getDatabaseInfo();
        setDbInfo(info);
      } catch (err) {
        console.error('Failed to load database info:', err);
      }
    };
    loadDbInfo();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await login(username, password);
      navigate('/');
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message || 'Login failed');
      } else {
        setError('Login failed');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default'
      }}
    >
      <Container maxWidth="sm">
        <Card elevation={3}>
          <CardContent sx={{ p: 4 }}>
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                mb: 3
              }}
            >
              <Box
                sx={{
                  width: 56,
                  height: 56,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 2
                }}
              >
                <LockOutlined sx={{ fontSize: 32, color: 'white' }} />
              </Box>
              <Typography variant="h5" component="h1" fontWeight="bold">
                ComfyUI Image Manager
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Sign in to continue
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
                label="Username"
                variant="outlined"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                autoComplete="username"
                autoFocus
                sx={{ mb: 2 }}
              />

              <TextField
                fullWidth
                label="Password"
                type="password"
                variant="outlined"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                autoComplete="current-password"
                sx={{ mb: 3 }}
              />

              <Button
                fullWidth
                type="submit"
                variant="contained"
                size="large"
                disabled={isLoading || !username || !password}
                sx={{ py: 1.5 }}
              >
                {isLoading ? <CircularProgress size={24} /> : 'Sign In'}
              </Button>

              {/* Account Recovery Link */}
              <Box sx={{ mt: 2, textAlign: 'center' }}>
                <Link
                  component="button"
                  type="button"
                  variant="body2"
                  onClick={() => setShowRecoveryDialog(true)}
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.5,
                    cursor: 'pointer',
                    textDecoration: 'none',
                    '&:hover': {
                      textDecoration: 'underline'
                    }
                  }}
                >
                  <Help fontSize="small" />
                  {t('auth:recovery.link')}
                </Link>
              </Box>
            </form>
          </CardContent>
        </Card>

        {/* Recovery Dialog */}
        <Dialog
          open={showRecoveryDialog}
          onClose={() => setShowRecoveryDialog(false)}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>{t('auth:recovery.title')}</DialogTitle>
          <DialogContent>
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ mb: 2 }}>
                {t('auth:recovery.description')}
              </Typography>
              <Typography variant="body2" component="div" sx={{ mb: 1 }}>
                <strong>{t('auth:recovery.procedureTitle')}</strong>
              </Typography>
              <Typography variant="body2" component="ol" sx={{ pl: 2, mb: 2 }}>
                <li>{t('auth:recovery.step1')}</li>
                <li>{t('auth:recovery.step2')}</li>
                <li>{t('auth:recovery.step3')}</li>
                <li>{t('auth:recovery.step4')}</li>
              </Typography>
              {dbInfo && (
                <Box sx={{ bgcolor: 'background.default', p: 2, borderRadius: 1, mt: 2 }}>
                  <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
                    <strong>{t('auth:recovery.fileLabel')}</strong>
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: 'monospace',
                      fontSize: '0.85rem',
                      wordBreak: 'break-all',
                      bgcolor: 'grey.900',
                      color: 'success.light',
                      p: 1,
                      borderRadius: 1
                    }}
                  >
                    {dbInfo.authDbPath}
                  </Typography>
                </Box>
              )}
              <Alert severity="warning" sx={{ mt: 2 }}>
                <Typography variant="caption">
                  {t('auth:recovery.warning')} {t('auth:recovery.warningNote')}
                </Typography>
              </Alert>
            </Alert>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowRecoveryDialog(false)}>{t('common:buttons.close')}</Button>
          </DialogActions>
        </Dialog>
      </Container>
    </Box>
  );
};
