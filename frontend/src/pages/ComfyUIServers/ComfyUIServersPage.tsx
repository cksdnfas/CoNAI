import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CardActions,
  Typography,
  IconButton,
  Chip,
  Grid,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Settings as SettingsIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon
} from '@mui/icons-material';
import { comfyuiServerApi, type ComfyUIServer } from '../../services/api/comfyuiServerApi';

export default function ComfyUIServersPage() {
  const [servers, setServers] = useState<ComfyUIServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [editingServer, setEditingServer] = useState<ComfyUIServer | null>(null);
  const [testingServerId, setTestingServerId] = useState<number | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<Record<number, boolean>>({});

  // 폼 상태
  const [formData, setFormData] = useState({
    name: '',
    endpoint: '',
    description: '',
    is_active: true
  });

  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    try {
      setLoading(true);
      const response = await comfyuiServerApi.getAllServers();
      setServers(response.data || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (server?: ComfyUIServer) => {
    if (server) {
      setEditingServer(server);
      setFormData({
        name: server.name,
        endpoint: server.endpoint,
        description: server.description || '',
        is_active: server.is_active
      });
    } else {
      setEditingServer(null);
      setFormData({
        name: '',
        endpoint: 'http://127.0.0.1:8188',
        description: '',
        is_active: true
      });
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditingServer(null);
  };

  const handleSubmit = async () => {
    try {
      if (editingServer) {
        await comfyuiServerApi.updateServer(editingServer.id, formData);
      } else {
        await comfyuiServerApi.createServer(formData);
      }
      handleCloseDialog();
      loadServers();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDelete = async (id: number) => {
    if (confirm('정말 이 서버를 삭제하시겠습니까?')) {
      try {
        await comfyuiServerApi.deleteServer(id);
        loadServers();
      } catch (err: any) {
        setError(err.message);
      }
    }
  };

  const handleTestConnection = async (id: number) => {
    setTestingServerId(id);
    try {
      const response = await comfyuiServerApi.testConnection(id);
      setConnectionStatus({
        ...connectionStatus,
        [id]: response.data.isConnected
      });
    } catch (err: any) {
      setConnectionStatus({
        ...connectionStatus,
        [id]: false
      });
    } finally {
      setTestingServerId(null);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4">
          <SettingsIcon sx={{ mr: 1, verticalAlign: 'middle' }} />
          ComfyUI 서버 관리
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
        >
          서버 추가
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Grid container spacing={2}>
        {servers.map((server) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={server.id}>
            <Card>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                  <Typography variant="h6" component="div">
                    {server.name}
                  </Typography>
                  <Chip
                    label={server.is_active ? '활성' : '비활성'}
                    color={server.is_active ? 'success' : 'default'}
                    size="small"
                  />
                </Box>

                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {server.endpoint}
                </Typography>

                {server.description && (
                  <Typography variant="body2" sx={{ mb: 2 }}>
                    {server.description}
                  </Typography>
                )}

                {connectionStatus[server.id] !== undefined && (
                  <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                    {connectionStatus[server.id] ? (
                      <>
                        <CheckIcon color="success" sx={{ mr: 0.5, fontSize: 18 }} />
                        <Typography variant="caption" color="success.main">
                          연결 성공
                        </Typography>
                      </>
                    ) : (
                      <>
                        <ErrorIcon color="error" sx={{ mr: 0.5, fontSize: 18 }} />
                        <Typography variant="caption" color="error.main">
                          연결 실패
                        </Typography>
                      </>
                    )}
                  </Box>
                )}
              </CardContent>
              <CardActions sx={{ justifyContent: 'space-between', px: 2, pb: 2 }}>
                <Button
                  size="small"
                  onClick={() => handleTestConnection(server.id)}
                  disabled={testingServerId === server.id}
                >
                  {testingServerId === server.id ? <CircularProgress size={16} /> : '연결 테스트'}
                </Button>
                <Box>
                  <IconButton
                    size="small"
                    onClick={() => handleOpenDialog(server)}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => handleDelete(server.id)}
                    color="error"
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              </CardActions>
            </Card>
          </Grid>
        ))}
      </Grid>

      {servers.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography variant="h6" color="text.secondary">
            등록된 서버가 없습니다
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            "서버 추가" 버튼을 클릭하여 ComfyUI 서버를 추가하세요
          </Typography>
        </Box>
      )}

      {/* 서버 추가/수정 다이얼로그 */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingServer ? '서버 수정' : '서버 추가'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="서버 이름"
              fullWidth
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
            <TextField
              label="엔드포인트 URL"
              fullWidth
              required
              placeholder="http://127.0.0.1:8188"
              value={formData.endpoint}
              onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
            />
            <TextField
              label="설명"
              fullWidth
              multiline
              rows={2}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                />
              }
              label="활성화"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>취소</Button>
          <Button onClick={handleSubmit} variant="contained" disabled={!formData.name || !formData.endpoint}>
            {editingServer ? '수정' : '추가'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
