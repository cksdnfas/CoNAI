import { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { AlertCircle, CheckCircle2, GitBranch, Pencil, Plus, Server, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { workflowApi, type Workflow } from '@/services/workflow-api'
import { comfyuiServerApi, type ComfyUIServer } from '@/services/comfyui-server-api'
import CustomDropdownListsSection from '@/bridges/image-generation/custom-dropdown-lists-section'

export default function ComfyUITab() {
  const { t } = useTranslation(['workflows', 'servers', 'common'])
  const navigate = useNavigate()

  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [workflowsLoading, setWorkflowsLoading] = useState(true)
  const [workflowsError, setWorkflowsError] = useState<string | null>(null)

  const [servers, setServers] = useState<ComfyUIServer[]>([])
  const [serversLoading, setServersLoading] = useState(true)
  const [serversError, setServersError] = useState<string | null>(null)
  const [openDialog, setOpenDialog] = useState(false)
  const [editingServer, setEditingServer] = useState<ComfyUIServer | null>(null)
  const [testingServerId, setTestingServerId] = useState<number | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<Record<number, boolean>>({})

  const [formData, setFormData] = useState({
    name: '',
    endpoint: '',
    description: '',
    is_active: true,
  })

  const loadWorkflows = useCallback(async () => {
    try {
      setWorkflowsLoading(true)
      const response = await workflowApi.getAllWorkflows()
      setWorkflows(response.data || [])
    } catch (err: unknown) {
      const maybeError = err as { message?: string }
      setWorkflowsError(maybeError.message || 'Failed to load workflows')
    } finally {
      setWorkflowsLoading(false)
    }
  }, [])

  const handleDeleteWorkflow = async (id: number) => {
    if (!window.confirm(t('workflows:actions.confirmDelete'))) return

    try {
      await workflowApi.deleteWorkflow(id)
      await loadWorkflows()
    } catch (err: unknown) {
      const maybeError = err as { message?: string }
      setWorkflowsError(maybeError.message || 'Failed to delete workflow')
    }
  }

  const loadServers = useCallback(async () => {
    try {
      setServersLoading(true)
      const response = await comfyuiServerApi.getAllServers()
      setServers(response.data || [])
    } catch (err: unknown) {
      const maybeError = err as { message?: string }
      setServersError(maybeError.message || 'Failed to load servers')
    } finally {
      setServersLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadWorkflows()
    void loadServers()
  }, [loadServers, loadWorkflows])

  const handleOpenDialog = (server?: ComfyUIServer) => {
    if (server) {
      setEditingServer(server)
      setFormData({
        name: server.name,
        endpoint: server.endpoint,
        description: server.description || '',
        is_active: server.is_active,
      })
    } else {
      setEditingServer(null)
      setFormData({
        name: '',
        endpoint: 'http://127.0.0.1:8188',
        description: '',
        is_active: true,
      })
    }
    setOpenDialog(true)
  }

  const handleCloseDialog = () => {
    setOpenDialog(false)
    setEditingServer(null)
  }

  const handleSubmit = async () => {
    try {
      if (editingServer) {
        await comfyuiServerApi.updateServer(editingServer.id, formData)
      } else {
        await comfyuiServerApi.createServer(formData)
      }
      handleCloseDialog()
      await loadServers()
    } catch (err: unknown) {
      const maybeError = err as { message?: string }
      setServersError(maybeError.message || 'Failed to save server')
    }
  }

  const handleDeleteServer = async (id: number) => {
    if (!window.confirm(t('servers:actions.confirmDelete'))) return

    try {
      await comfyuiServerApi.deleteServer(id)
      await loadServers()
    } catch (err: unknown) {
      const maybeError = err as { message?: string }
      setServersError(maybeError.message || 'Failed to delete server')
    }
  }

  const handleTestConnection = async (id: number) => {
    setTestingServerId(id)
    try {
      const response = await comfyuiServerApi.testConnection(id)
      setConnectionStatus((previous) => ({
        ...previous,
        [id]: Boolean(response.data?.isConnected),
      }))
    } catch {
      setConnectionStatus((previous) => ({
        ...previous,
        [id]: false,
      }))
    } finally {
      setTestingServerId(null)
    }
  }

  const loading = workflowsLoading || serversLoading
  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="400px">
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <GitBranch className="h-4 w-4" /> {t('workflows:page.listTitle')}
        </Typography>

        {workflowsError ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setWorkflowsError(null)}>
            {workflowsError}
          </Alert>
        ) : null}

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
              onClick={(event) => {
                if ((event.target as HTMLElement).closest('button')) return
                if (workflow.is_active) {
                  navigate(`/image-generation/${workflow.id}/generate`)
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
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Chip
                      label={workflow.is_active ? t('workflows:card.active') : t('workflows:card.inactive')}
                      color={workflow.is_active ? 'success' : 'default'}
                      size="small"
                      sx={{ height: '20px', fontSize: '0.7rem' }}
                    />
                    <Box sx={{ display: 'flex', gap: 0.25 }} onClick={(event) => event.stopPropagation()}>
                      <IconButton size="small" onClick={() => navigate(`/image-generation/${workflow.id}/edit`)} sx={{ p: 0.5 }}>
                        <Pencil className="h-4 w-4" />
                      </IconButton>
                      <IconButton size="small" onClick={() => void handleDeleteWorkflow(workflow.id)} color="error" sx={{ p: 0.5 }}>
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </Box>
                  </Box>

                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 600, fontSize: '0.813rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={workflow.name}
                  >
                    {workflow.name}
                  </Typography>

                  {workflow.description ? (
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
                  ) : null}

                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                    {workflow.marked_fields && workflow.marked_fields.length > 0 ? (
                      <Chip
                        label={t('workflows:card.fieldsCount', { count: workflow.marked_fields.length })}
                        size="small"
                        variant="outlined"
                        sx={{ height: '18px', fontSize: '0.65rem' }}
                      />
                    ) : null}
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                      {new Date(workflow.created_date).toLocaleDateString()}
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          ))}

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
              bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(33, 150, 243, 0.05)' : 'rgba(33, 150, 243, 0.02)'),
              '&:hover': {
                bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(33, 150, 243, 0.15)' : 'rgba(33, 150, 243, 0.08)'),
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
              <Plus className="h-7 w-7" />
            </IconButton>
          </Box>
        </Box>
      </Box>

      <Divider sx={{ my: 4 }} />

      <Box>
        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Server className="h-4 w-4" /> {t('servers:page.listTitle')}
        </Typography>

        {serversError ? (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setServersError(null)}>
            {serversError}
          </Alert>
        ) : null}

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
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Chip
                      label={server.is_active ? t('servers:card.active') : t('servers:card.inactive')}
                      color={server.is_active ? 'success' : 'default'}
                      size="small"
                      sx={{ height: '20px', fontSize: '0.7rem' }}
                    />
                    <Box sx={{ display: 'flex', gap: 0.25 }}>
                      <IconButton size="small" onClick={() => handleOpenDialog(server)} sx={{ p: 0.5 }}>
                        <Pencil className="h-4 w-4" />
                      </IconButton>
                      <IconButton size="small" onClick={() => void handleDeleteServer(server.id)} color="error" sx={{ p: 0.5 }}>
                        <Trash2 className="h-4 w-4" />
                      </IconButton>
                    </Box>
                  </Box>

                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 600, fontSize: '0.813rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={server.name}
                  >
                    {server.name}
                  </Typography>

                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ fontFamily: 'monospace', fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    title={server.endpoint}
                  >
                    {server.endpoint}
                  </Typography>

                  {server.description ? (
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
                  ) : null}

                  {connectionStatus[server.id] !== undefined ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      {connectionStatus[server.id] ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                          <Typography variant="caption" color="success.main" sx={{ fontSize: '0.7rem' }}>
                            {t('servers:card.connectionSuccess')}
                          </Typography>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                          <Typography variant="caption" color="error.main" sx={{ fontSize: '0.7rem' }}>
                            {t('servers:card.connectionFailed')}
                          </Typography>
                        </>
                      )}
                    </Box>
                  ) : null}

                  <Button
                    size="small"
                    onClick={() => void handleTestConnection(server.id)}
                    disabled={testingServerId === server.id}
                    fullWidth
                    sx={{ mt: 'auto', fontSize: '0.7rem', py: 0.5 }}
                  >
                    {testingServerId === server.id ? <CircularProgress size={14} /> : t('servers:card.testConnection')}
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          ))}

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
              bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(76, 175, 80, 0.05)' : 'rgba(76, 175, 80, 0.02)'),
              '&:hover': {
                bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(76, 175, 80, 0.15)' : 'rgba(76, 175, 80, 0.08)'),
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
              <Plus className="h-7 w-7" />
            </IconButton>
          </Box>
        </Box>
      </Box>

      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editingServer ? t('servers:dialog.editTitle') : t('servers:dialog.addTitle')}</DialogTitle>
        <DialogContent>
          <Box sx={{ pt: 2, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label={t('servers:dialog.serverName')}
              fullWidth
              required
              value={formData.name}
              onChange={(event) => setFormData({ ...formData, name: event.target.value })}
            />
            <TextField
              label={t('servers:dialog.endpointUrl')}
              fullWidth
              required
              placeholder={t('servers:dialog.endpointPlaceholder')}
              value={formData.endpoint}
              onChange={(event) => setFormData({ ...formData, endpoint: event.target.value })}
            />
            <TextField
              label={t('servers:dialog.description')}
              fullWidth
              multiline
              rows={2}
              value={formData.description}
              onChange={(event) => setFormData({ ...formData, description: event.target.value })}
            />
            <FormControlLabel
              control={<Switch checked={formData.is_active} onChange={(event) => setFormData({ ...formData, is_active: event.target.checked })} />}
              label={t('servers:dialog.activate')}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>{t('servers:dialog.cancel')}</Button>
          <Button onClick={() => void handleSubmit()} variant="contained" disabled={!formData.name || !formData.endpoint}>
            {editingServer ? t('servers:dialog.update') : t('servers:dialog.add')}
          </Button>
        </DialogActions>
      </Dialog>

      <Divider sx={{ my: 3 }} />
      <CustomDropdownListsSection />
    </Box>
  )
}
