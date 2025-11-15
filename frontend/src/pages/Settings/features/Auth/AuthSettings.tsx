import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Alert,
  Divider,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material';
import { Security, VpnKey, Help, ExpandMore } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { authApi, type DatabaseInfoResponse } from '../../../../services/authApi';
import { useAuth } from '../../../../contexts/AuthContext';

export const AuthSettings: React.FC = () => {
  const { t } = useTranslation('settings');
  const { hasCredentials, checkAuth } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [dbInfo, setDbInfo] = useState<DatabaseInfoResponse | null>(null);

  // Setup form state
  const [setupUsername, setSetupUsername] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('');

  // Update form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const clearMessages = () => {
    setError('');
    setSuccess('');
  };

  const clearSetupForm = () => {
    setSetupUsername('');
    setSetupPassword('');
    setSetupConfirmPassword('');
  };

  const clearUpdateForm = () => {
    setCurrentPassword('');
    setNewUsername('');
    setNewPassword('');
    setConfirmNewPassword('');
  };

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

  const handleSetup = async () => {
    clearMessages();

    if (!setupUsername || !setupPassword) {
      setError(t('auth.setup.errors.required'));
      return;
    }

    if (setupPassword !== setupConfirmPassword) {
      setError(t('auth.setup.errors.mismatch'));
      return;
    }

    setIsLoading(true);
    try {
      await authApi.setup(setupUsername, setupPassword);
      setSuccess(t('auth.setup.success'));
      clearSetupForm();
      await checkAuth(); // Refresh auth status
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message || t('auth.setup.errors.failed'));
      } else {
        setError(t('auth.setup.errors.failed'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdate = async () => {
    clearMessages();

    if (!currentPassword || !newUsername || !newPassword) {
      setError(t('auth.update.errors.required'));
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setError(t('auth.update.errors.mismatch'));
      return;
    }

    setIsLoading(true);
    try {
      await authApi.updateCredentials(currentPassword, newUsername, newPassword);
      setSuccess(t('auth.update.success'));
      clearUpdateForm();
      await checkAuth(); // Refresh auth status
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message || t('auth.update.errors.failed'));
      } else {
        setError(t('auth.update.errors.failed'));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={clearMessages}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 3 }} onClose={clearMessages}>
          {success}
        </Alert>
      )}

      {!hasCredentials ? (
        // Initial Setup Form
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Security sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">{t('auth.setup.title')}</Typography>
          </Box>

          <Alert severity="info" sx={{ mb: 3 }}>
            {t('auth.setup.description')}
          </Alert>

          <TextField
            fullWidth
            label={t('auth.setup.username')}
            value={setupUsername}
            onChange={(e) => setSetupUsername(e.target.value)}
            disabled={isLoading}
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            type="password"
            label={t('auth.setup.password')}
            value={setupPassword}
            onChange={(e) => setSetupPassword(e.target.value)}
            disabled={isLoading}
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            type="password"
            label={t('auth.setup.confirmPassword')}
            value={setupConfirmPassword}
            onChange={(e) => setSetupConfirmPassword(e.target.value)}
            disabled={isLoading}
            sx={{ mb: 3 }}
          />

          <Button
            variant="contained"
            onClick={handleSetup}
            disabled={isLoading || !setupUsername || !setupPassword || !setupConfirmPassword}
            fullWidth
          >
            {isLoading ? <CircularProgress size={24} /> : t('auth.setup.button')}
          </Button>
        </Paper>
      ) : (
        // Update Credentials Form
        <Paper sx={{ p: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <VpnKey sx={{ mr: 1, color: 'primary.main' }} />
            <Typography variant="h6">{t('auth.update.title')}</Typography>
          </Box>

          <Alert severity="warning" sx={{ mb: 3 }}>
            {t('auth.update.description')}
          </Alert>

          <TextField
            fullWidth
            type="password"
            label={t('auth.update.currentPassword')}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={isLoading}
            sx={{ mb: 2 }}
          />

          <Divider sx={{ my: 2 }} />

          <TextField
            fullWidth
            label={t('auth.update.newUsername')}
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            disabled={isLoading}
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            type="password"
            label={t('auth.update.newPassword')}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={isLoading}
            sx={{ mb: 2 }}
          />

          <TextField
            fullWidth
            type="password"
            label={t('auth.update.confirmNewPassword')}
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            disabled={isLoading}
            sx={{ mb: 3 }}
          />

          <Button
            variant="contained"
            onClick={handleUpdate}
            disabled={isLoading || !currentPassword || !newUsername || !newPassword || !confirmNewPassword}
            fullWidth
          >
            {isLoading ? <CircularProgress size={24} /> : t('auth.update.button')}
          </Button>

          {/* Account Recovery Section */}
          <Box sx={{ mt: 3 }}>
            <Accordion>
              <AccordionSummary expandIcon={<ExpandMore />}>
                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                  <Help sx={{ mr: 1, color: 'warning.main' }} />
                  <Typography>계정을 잊어버렸나요?</Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <Alert severity="info" sx={{ mb: 2 }}>
                  <Typography variant="body2" sx={{ mb: 2 }}>
                    비밀번호를 잊어버린 경우, 아래 방법으로 계정을 복구할 수 있습니다.
                  </Typography>
                  <Typography variant="body2" component="div" sx={{ mb: 1 }}>
                    <strong>복구 방법:</strong>
                  </Typography>
                  <Typography variant="body2" component="ol" sx={{ pl: 2, mb: 2 }}>
                    <li>서버를 중지합니다</li>
                    <li>아래 파일을 삭제합니다</li>
                    <li>서버를 다시 시작합니다</li>
                    <li>새로운 계정을 설정합니다</li>
                  </Typography>
                  {dbInfo && (
                    <Box sx={{ bgcolor: 'background.default', p: 2, borderRadius: 1, mt: 2 }}>
                      <Typography variant="caption" sx={{ display: 'block', mb: 1 }}>
                        <strong>삭제할 파일:</strong>
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
                      ⚠️ 주의: 이 파일을 삭제하면 모든 세션이 무효화되며, 다시 로그인해야 합니다.
                      워크플로우, 설정 등 다른 데이터는 영향을 받지 않습니다.
                    </Typography>
                  </Alert>
                </Alert>
              </AccordionDetails>
            </Accordion>
          </Box>
        </Paper>
      )}
    </Box>
  );
};
