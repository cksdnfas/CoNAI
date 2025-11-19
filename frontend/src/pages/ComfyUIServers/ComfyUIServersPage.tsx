import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('servers');
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
    if (confirm(t('actions.confirmDelete'))) {
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
          {t('page.listTitle')}
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
        >
          {t('page.addButton')}
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
                    label={server.is_active ? t('card.active') : t('card.inactive')}
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
                          {t('card.connectionSuccess')}
                        </Typography>
                      </>
                    ) : (
                      <>
                        <ErrorIcon color="error" sx={{ mr: 0.5, fontSize: 18 }} />
                        <Typography variant="caption" color="error.main">
                          {t('card.connectionFailed')}
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
                  {testingServerId === server.id ? <CircularProgress size={16} /> : t('card.testConnection')}
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
            {t('page.noServers')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('page.noServersDesc')}
          </Typography>
        </Box>
      )}

      {/* 서버 추가/수정 다이얼로그 */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingServer ? t('dialog.editTitle') : t('dialog.addTitle')}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label={t('dialog.serverName')}
              fullWidth
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
            <TextField
              label={t('dialog.endpointUrl')}
              fullWidth
              required
              placeholder={t('dialog.endpointPlaceholder')}
              value={formData.endpoint}
              onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
            />
            <TextField
              label={t('dialog.description')}
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
              label={t('dialog.activate')}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>{t('dialog.cancel')}</Button>
          <Button onClick={handleSubmit} variant="contained" disabled={!formData.name || !formData.endpoint}>
            {editingServer ? t('dialog.update') : t('dialog.add')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
