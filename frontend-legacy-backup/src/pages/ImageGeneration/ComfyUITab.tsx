import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  IconButton,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Switch,
  FormControlLabel,
  Alert,
  CircularProgress,
  Divider,
  Stack
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  CheckCircle as CheckIcon,
  Error as ErrorIcon,
  AccountTree as WorkflowIcon,
  Storage as ServerIcon
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { workflowApi, type Workflow } from '../../services/api/workflowApi';
import { comfyuiServerApi, type ComfyUIServer } from '../../services/api/comfyuiServerApi';
import CustomDropdownListsSection from './CustomDropdownListsSection';

export default function ComfyUITab() {
  const { t } = useTranslation(['workflows', 'servers', 'common']);
  const navigate = useNavigate();

  // Workflows state
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [workflowsLoading, setWorkflowsLoading] = useState(true);
  const [workflowsError, setWorkflowsError] = useState<string | null>(null);

  // Servers state
  const [servers, setServers] = useState<ComfyUIServer[]>([]);
  const [serversLoading, setServersLoading] = useState(true);
  const [serversError, setServersError] = useState<string | null>(null);
  const [openDialog, setOpenDialog] = useState(false);
  const [editingServer, setEditingServer] = useState<ComfyUIServer | null>(null);
  const [testingServerId, setTestingServerId] = useState<number | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<Record<number, boolean>>({});

  const [formData, setFormData] = useState({
    name: '',
    endpoint: '',
    description: '',
    is_active: true
  });

  useEffect(() => {
    loadWorkflows();
    loadServers();
  }, []);

  // Workflows functions
  const loadWorkflows = async () => {
    try {
      setWorkflowsLoading(true);
      const response = await workflowApi.getAllWorkflows();
      setWorkflows(response.data || []);
    } catch (err: any) {
      setWorkflowsError(err.message);
    } finally {
      setWorkflowsLoading(false);
    }
  };

  const handleDeleteWorkflow = async (id: number) => {
    if (confirm(t('workflows:actions.confirmDelete'))) {
      try {
        await workflowApi.deleteWorkflow(id);
        loadWorkflows();
      } catch (err: any) {
        setWorkflowsError(err.message);
      }
    }
  };

  // Servers functions
  const loadServers = async () => {
    try {
      setServersLoading(true);
      const response = await comfyuiServerApi.getAllServers();
      setServers(response.data || []);
    } catch (err: any) {
      setServersError(err.message);
    } finally {
      setServersLoading(false);
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
      setServersError(err.message);
    }
  };

  const handleDeleteServer = async (id: number) => {
    if (confirm(t('servers:actions.confirmDelete'))) {
      try {
        await comfyuiServerApi.deleteServer(id);
        loadServers();
      } catch (err: any) {
        setServersError(err.message);
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

  const loading = workflowsLoading || serversLoading;

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Workflows Section */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <WorkflowIcon /> {t('workflows:page.listTitle')}
        </Typography>

        {workflowsError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setWorkflowsError(null)}>
            {workflowsError}
          </Alert>
        )}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, 1fr)',
              md: 'repeat(4, 1fr)',
              lg: 'repeat(5, 1fr)',
              xl: 'repeat(6, 1fr)',
            },
            gap: 1.5,
          }}
        >
          {workflows.map((workflow) => (
            <Card
              key={workflow.id}
              onClick={(e) => {
                // 아이콘 버튼 클릭 시 카드 클릭 이벤트 무시
                if ((e.target as HTMLElement).closest('button')) return;
                if (workflow.is_active) {
                  navigate(`/image-generation/${workflow.id}/generate`);
                }
              }}
              sx={{
                height: '100%',
                minHeight: 120,
                borderLeft: `3px solid ${workflow.color || '#2196f3'}`,
                transition: 'all 0.2s ease-in-out',
                cursor: workflow.is_active ? 'pointer' : 'not-allowed',
                opacity: workflow.is_active ? 1 : 0.6,
                '&:hover': {
                  boxShadow: workflow.is_active ? 3 : 1,
                  transform: workflow.is_active ? 'translateY(-2px)' : 'none',
                },
              }}
            >
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Stack spacing={1}>
                  {/* Header: Status + Actions */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Chip
                      label={workflow.is_active ? t('workflows:card.active') : t('workflows:card.inactive')}
                      color={workflow.is_active ? 'success' : 'default'}
                      size="small"
                      sx={{ height: '20px', fontSize: '0.7rem' }}
                    />
                    <Box sx={{ display: 'flex', gap: 0.25 }} onClick={(e) => e.stopPropagation()}>
                      <IconButton
                        size="small"
                        onClick={() => navigate(`/image-generation/${workflow.id}/edit`)}
                        sx={{ p: 0.5 }}
                      >
                        <EditIcon sx={{ fontSize: '1rem' }} />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteWorkflow(workflow.id)}
                        color="error"
                        sx={{ p: 0.5 }}
                      >
                        <DeleteIcon sx={{ fontSize: '1rem' }} />
                      </IconButton>
                    </Box>
                  </Box>

                  {/* Title */}
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      fontSize: '0.813rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={workflow.name}
                  >
                    {workflow.name}
                  </Typography>

                  {/* Description */}
                  {workflow.description && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        fontSize: '0.7rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {workflow.description}
                    </Typography>
                  )}

                  {/* Meta info */}
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                    {workflow.marked_fields && workflow.marked_fields.length > 0 && (
                      <Chip
                        label={t('workflows:card.fieldsCount', { count: workflow.marked_fields.length })}
                        size="small"
                        variant="outlined"
                        sx={{ height: '18px', fontSize: '0.65rem' }}
                      />
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                      {new Date(workflow.created_date).toLocaleDateString()}
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          ))}

          {/* Add Workflow Button */}
          <Box
            onClick={() => navigate('/image-generation/new')}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 120,
              border: '2px dashed',
              borderColor: 'primary.main',
              borderRadius: 2,
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out',
              bgcolor: (theme) =>
                theme.palette.mode === 'dark'
                  ? 'rgba(33, 150, 243, 0.05)'
                  : 'rgba(33, 150, 243, 0.02)',
              '&:hover': {
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark'
                    ? 'rgba(33, 150, 243, 0.15)'
                    : 'rgba(33, 150, 243, 0.08)',
                borderColor: 'primary.dark',
                transform: 'scale(1.02)',
              },
            }}
          >
            <IconButton
              color="primary"
              sx={{
                width: 56,
                height: 56,
                bgcolor: 'primary.main',
                color: 'white',
                '&:hover': {
                  bgcolor: 'primary.dark',
                  transform: 'rotate(90deg)',
                },
                transition: 'all 0.3s ease-in-out',
              }}
            >
              <AddIcon fontSize="large" />
            </IconButton>
          </Box>
        </Box>

        {workflows.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary">
              {t('workflows:page.noWorkflows')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('workflows:page.noWorkflowsDesc')}
            </Typography>
          </Box>
        )}
      </Box>

      <Divider sx={{ my: 4 }} />

      {/* Servers Section */}
      <Box>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <ServerIcon /> {t('servers:page.listTitle')}
        </Typography>

        {serversError && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setServersError(null)}>
            {serversError}
          </Alert>
        )}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, 1fr)',
              md: 'repeat(4, 1fr)',
              lg: 'repeat(5, 1fr)',
              xl: 'repeat(6, 1fr)',
            },
            gap: 1.5,
          }}
        >
          {servers.map((server) => (
            <Card
              key={server.id}
              sx={{
                height: '100%',
                minHeight: 120,
                borderLeft: '3px solid #4caf50',
                transition: 'all 0.2s ease-in-out',
                '&:hover': {
                  boxShadow: 3,
                  transform: 'translateY(-2px)',
                },
              }}
            >
              <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Stack spacing={1}>
                  {/* Header: Status + Actions */}
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Chip
                      label={server.is_active ? t('servers:card.active') : t('servers:card.inactive')}
                      color={server.is_active ? 'success' : 'default'}
                      size="small"
                      sx={{ height: '20px', fontSize: '0.7rem' }}
                    />
                    <Box sx={{ display: 'flex', gap: 0.25 }}>
                      <IconButton
                        size="small"
                        onClick={() => handleOpenDialog(server)}
                        sx={{ p: 0.5 }}
                      >
                        <EditIcon sx={{ fontSize: '1rem' }} />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteServer(server.id)}
                        color="error"
                        sx={{ p: 0.5 }}
                      >
                        <DeleteIcon sx={{ fontSize: '1rem' }} />
                      </IconButton>
                    </Box>
                  </Box>

                  {/* Title */}
                  <Typography
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      fontSize: '0.813rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={server.name}
                  >
                    {server.name}
                  </Typography>

                  {/* Endpoint */}
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      fontFamily: 'monospace',
                      fontSize: '0.7rem',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={server.endpoint}
                  >
                    {server.endpoint}
                  </Typography>

                  {/* Description */}
                  {server.description && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        fontSize: '0.7rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                      }}
                    >
                      {server.description}
                    </Typography>
                  )}

                  {/* Connection Status */}
                  {connectionStatus[server.id] !== undefined && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {connectionStatus[server.id] ? (
                        <>
                          <CheckIcon color="success" sx={{ fontSize: '0.875rem' }} />
                          <Typography variant="caption" color="success.main" sx={{ fontSize: '0.7rem' }}>
                            {t('servers:card.connectionSuccess')}
                          </Typography>
                        </>
                      ) : (
                        <>
                          <ErrorIcon color="error" sx={{ fontSize: '0.875rem' }} />
                          <Typography variant="caption" color="error.main" sx={{ fontSize: '0.7rem' }}>
                            {t('servers:card.connectionFailed')}
                          </Typography>
                        </>
                      )}
                    </Box>
                  )}

                  {/* Test Button */}
                  <Button
                    size="small"
                    onClick={() => handleTestConnection(server.id)}
                    disabled={testingServerId === server.id}
                    fullWidth
                    sx={{ mt: 'auto', fontSize: '0.7rem', py: 0.5 }}
                  >
                    {testingServerId === server.id ? (
                      <CircularProgress size={14} />
                    ) : (
                      t('servers:card.testConnection')
                    )}
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          ))}

          {/* Add Server Button */}
          <Box
            onClick={() => handleOpenDialog()}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 120,
              border: '2px dashed',
              borderColor: 'success.main',
              borderRadius: 2,
              cursor: 'pointer',
              transition: 'all 0.2s ease-in-out',
              bgcolor: (theme) =>
                theme.palette.mode === 'dark'
                  ? 'rgba(76, 175, 80, 0.05)'
                  : 'rgba(76, 175, 80, 0.02)',
              '&:hover': {
                bgcolor: (theme) =>
                  theme.palette.mode === 'dark'
                    ? 'rgba(76, 175, 80, 0.15)'
                    : 'rgba(76, 175, 80, 0.08)',
                borderColor: 'success.dark',
                transform: 'scale(1.02)',
              },
            }}
          >
            <IconButton
              sx={{
                width: 56,
                height: 56,
                bgcolor: 'success.main',
                color: 'white',
                '&:hover': {
                  bgcolor: 'success.dark',
                  transform: 'rotate(90deg)',
                },
                transition: 'all 0.3s ease-in-out',
              }}
            >
              <AddIcon fontSize="large" />
            </IconButton>
          </Box>
        </Box>

        {servers.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary">
              {t('servers:page.noServers')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t('servers:page.noServersDesc')}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Server Add/Edit Dialog */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingServer ? t('servers:dialog.editTitle') : t('servers:dialog.addTitle')}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label={t('servers:dialog.serverName')}
              fullWidth
              required
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            />
            <TextField
              label={t('servers:dialog.endpointUrl')}
              fullWidth
              required
              placeholder={t('servers:dialog.endpointPlaceholder')}
              value={formData.endpoint}
              onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })}
            />
            <TextField
              label={t('servers:dialog.description')}
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
              label={t('servers:dialog.activate')}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>{t('servers:dialog.cancel')}</Button>
          <Button onClick={handleSubmit} variant="contained" disabled={!formData.name || !formData.endpoint}>
            {editingServer ? t('servers:dialog.update') : t('servers:dialog.add')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Custom Dropdown Lists Section */}
      <Divider sx={{ my: 3 }} />
      <CustomDropdownListsSection />
    </Box>
  );
}
