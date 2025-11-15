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
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { authApi, type DatabaseInfoResponse } from '../../services/authApi';

export const LoginPage: React.FC = () => {
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
                  계정 복구 방법
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
          <DialogTitle>계정 복구 방법</DialogTitle>
          <DialogContent>
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ mb: 2 }}>
                비밀번호를 잊어버린 경우, 아래 방법으로 계정을 복구할 수 있습니다.
              </Typography>
              <Typography variant="body2" component="div" sx={{ mb: 1 }}>
                <strong>복구 절차:</strong>
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
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setShowRecoveryDialog(false)}>닫기</Button>
          </DialogActions>
        </Dialog>
      </Container>
    </Box>
  );
};
