import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Divider,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Switch,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import {
  ExpandMore,
  Visibility,
  VisibilityOff,
  Delete,
  Check,
  Add,
  VpnKey,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import {
  externalApiApi,
  type ExternalApiProvider,
  type CreateExternalApiProviderInput,
  type UpdateExternalApiProviderInput,
} from '../../../../services/externalApiApi';

export const ExternalApiSettings: React.FC = () => {
  const { t } = useTranslation('settings');
  const { enqueueSnackbar } = useSnackbar();
  const [providers, setProviders] = useState<ExternalApiProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedProvider, setExpandedProvider] = useState<string | false>(false);

  // Form states for each provider
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [testingConnection, setTestingConnection] = useState<Record<string, boolean>>({});

  // New provider dialog
  const [showNewProviderDialog, setShowNewProviderDialog] = useState(false);
  const [newProviderName, setNewProviderName] = useState('');
  const [newProviderDisplayName, setNewProviderDisplayName] = useState('');

  // Delete confirmation dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [providerToDelete, setProviderToDelete] = useState<string | null>(null);

  const loadProviders = async () => {
    try {
      setIsLoading(true);
      const data = await externalApiApi.getProviders();
      setProviders(data);

      // Initialize form data with empty strings for new API keys
      const initialFormData: Record<string, any> = {};
      data.forEach((provider) => {
        initialFormData[provider.provider_name] = {
          api_key: '',
          api_secret: '',
          base_url: provider.base_url || '',
        };
      });
      setFormData(initialFormData);
    } catch (err) {
      console.error('Failed to load providers:', err);
      enqueueSnackbar(t('externalApi.errors.loadFailed'), { variant: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProviders();
  }, []);

  const handleAccordionChange = (providerName: string) => (
    event: React.SyntheticEvent,
    isExpanded: boolean
  ) => {
    setExpandedProvider(isExpanded ? providerName : false);
  };

  const handleFormChange = (providerName: string, field: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [providerName]: {
        ...prev[providerName],
        [field]: value,
      },
    }));
  };

  const handleToggleEnabled = async (providerName: string, currentState: boolean) => {
    try {
      await externalApiApi.toggleProvider(providerName, !currentState);
      await loadProviders();
      enqueueSnackbar(
        t('externalApi.success.toggled', {
          state: !currentState ? t('common.enabled') : t('common.disabled'),
        }),
        { variant: 'success' }
      );
    } catch (err: any) {
      enqueueSnackbar(err.message || t('externalApi.errors.toggleFailed'), { variant: 'error' });
    }
  };

  const handleSaveProvider = async (providerName: string) => {
    try {
      const data = formData[providerName];

      const updateInput: UpdateExternalApiProviderInput = {};

      // Only include API key if user entered something
      if (data.api_key && data.api_key.trim() !== '') {
        updateInput.api_key = data.api_key.trim();
      }

      if (data.api_secret && data.api_secret.trim() !== '') {
        updateInput.api_secret = data.api_secret.trim();
      }

      if (data.base_url !== undefined) {
        updateInput.base_url = data.base_url.trim() || null;
      }

      await externalApiApi.updateProvider(providerName, updateInput);
      await loadProviders();

      // Clear the API key field after successful save
      setFormData((prev) => ({
        ...prev,
        [providerName]: {
          ...prev[providerName],
          api_key: '',
          api_secret: '',
        },
      }));

      enqueueSnackbar(t('externalApi.success.saved'), { variant: 'success' });
    } catch (err: any) {
      enqueueSnackbar(err.message || t('externalApi.errors.saveFailed'), { variant: 'error' });
    }
  };

  const handleTestConnection = async (providerName: string) => {
    try {
      setTestingConnection((prev) => ({ ...prev, [providerName]: true }));

      const result = await externalApiApi.testConnection(providerName);

      if (result.success) {
        enqueueSnackbar(t('externalApi.success.connectionTest'), { variant: 'success' });
      } else {
        enqueueSnackbar(result.message || t('externalApi.errors.connectionTestFailed'), { variant: 'error' });
      }
    } catch (err: any) {
      enqueueSnackbar(err.message || t('externalApi.errors.connectionTestFailed'), { variant: 'error' });
    } finally {
      setTestingConnection((prev) => ({ ...prev, [providerName]: false }));
    }
  };

  const handleDeleteProvider = async () => {
    if (!providerToDelete) return;

    try {
      await externalApiApi.deleteProvider(providerToDelete);
      await loadProviders();
      enqueueSnackbar(t('externalApi.success.deleted'), { variant: 'success' });
      setDeleteDialogOpen(false);
      setProviderToDelete(null);
    } catch (err: any) {
      enqueueSnackbar(err.message || t('externalApi.errors.deleteFailed'), { variant: 'error' });
    }
  };

  const handleCreateProvider = async () => {
    try {
      if (!newProviderName || !newProviderDisplayName) {
        enqueueSnackbar(t('externalApi.errors.nameRequired'), { variant: 'error' });
        return;
      }

      const input: CreateExternalApiProviderInput = {
        provider_name: newProviderName.toLowerCase().replace(/\s+/g, '_'),
        display_name: newProviderDisplayName,
        provider_type: 'general',
      };

      await externalApiApi.createProvider(input);
      await loadProviders();
      enqueueSnackbar(t('externalApi.success.created'), { variant: 'success' });
      setShowNewProviderDialog(false);
      setNewProviderName('');
      setNewProviderDisplayName('');
    } catch (err: any) {
      enqueueSnackbar(err.message || t('externalApi.errors.createFailed'), { variant: 'error' });
    }
  };


  const toggleShowApiKey = (providerName: string) => {
    setShowApiKey((prev) => ({
      ...prev,
      [providerName]: !prev[providerName],
    }));
  };

  const openDeleteDialog = (providerName: string) => {
    setProviderToDelete(providerName);
    setDeleteDialogOpen(true);
  };

  // All providers are now general type (Civitai)
  const generalProviders = providers;

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  const renderProviderAccordion = (provider: ExternalApiProvider) => {
    const providerFormData = formData[provider.provider_name] || {};

    return (
      <Accordion
        key={provider.provider_name}
        expanded={expandedProvider === provider.provider_name}
        onChange={handleAccordionChange(provider.provider_name)}
        sx={{ mb: 1 }}
      >
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Box display="flex" alignItems="center" gap={2} width="100%">
            <VpnKey color="primary" />
            <Typography variant="subtitle1">{provider.display_name}</Typography>
            <Box flex={1} />
            <FormControlLabel
              control={
                <Switch
                  checked={provider.is_enabled}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    handleToggleEnabled(provider.provider_name, provider.is_enabled);
                  }}
                />
              }
              label={provider.is_enabled ? t('common.enabled') : t('common.disabled')}
              onClick={(e) => e.stopPropagation()}
            />
          </Box>
        </AccordionSummary>

        <AccordionDetails>
          <Box>
            {/* Current API Key (masked) */}
            <TextField
              fullWidth
              label={t('externalApi.currentApiKey')}
              value={provider.api_key_masked}
              disabled
              margin="normal"
              size="small"
              helperText={t('externalApi.currentApiKeyHelper')}
            />

            {/* New API Key Input */}
            <TextField
              fullWidth
              label={t('externalApi.newApiKey')}
              type={showApiKey[provider.provider_name] ? 'text' : 'password'}
              value={providerFormData.api_key || ''}
              onChange={(e) =>
                handleFormChange(provider.provider_name, 'api_key', e.target.value)
              }
              margin="normal"
              size="small"
              placeholder={t('externalApi.newApiKeyPlaceholder')}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => toggleShowApiKey(provider.provider_name)}
                      edge="end"
                    >
                      {showApiKey[provider.provider_name] ? (
                        <VisibilityOff />
                      ) : (
                        <Visibility />
                      )}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />

            {/* Base URL */}
            <TextField
              fullWidth
              label={t('externalApi.baseUrl')}
              value={providerFormData.base_url || ''}
              onChange={(e) =>
                handleFormChange(provider.provider_name, 'base_url', e.target.value)
              }
              margin="normal"
              size="small"
              helperText={t('externalApi.baseUrlHelper')}
            />


            {/* Action Buttons */}
            <Box display="flex" gap={1} mt={2}>
              <Button
                variant="contained"
                startIcon={<Check />}
                onClick={() => handleSaveProvider(provider.provider_name)}
              >
                {t('common.save')}
              </Button>

              <Button
                variant="outlined"
                onClick={() => handleTestConnection(provider.provider_name)}
                disabled={testingConnection[provider.provider_name]}
              >
                {testingConnection[provider.provider_name] ? (
                  <CircularProgress size={20} />
                ) : (
                  t('externalApi.testConnection')
                )}
              </Button>

              {provider.provider_name !== 'civitai' && (
                <Button
                  variant="outlined"
                  color="error"
                  startIcon={<Delete />}
                  onClick={() => openDeleteDialog(provider.provider_name)}
                >
                  {t('common.delete')}
                </Button>
              )}
            </Box>
          </Box>
        </AccordionDetails>
      </Accordion>
    );
  };

  return (
    <Box>
      {/* General Providers Section */}
      <Paper sx={{ p: 3, mb: 2 }}>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <VpnKey color="primary" />
          <Typography variant="h6">{t('externalApi.title')}</Typography>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* General Provider Accordions */}
        {generalProviders.map(renderProviderAccordion)}

        {/* Add New Provider Button */}
        <Button
          variant="outlined"
          startIcon={<Add />}
          onClick={() => setShowNewProviderDialog(true)}
          sx={{ mt: 2 }}
        >
          {t('externalApi.addProvider')}
        </Button>
      </Paper>


      {/* New General Provider Dialog */}
      <Dialog open={showNewProviderDialog} onClose={() => setShowNewProviderDialog(false)}>
        <DialogTitle>{t('externalApi.addProvider')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <DialogContentText>{t('externalApi.addProviderDescription')}</DialogContentText>

          <TextField
            fullWidth
            label={t('externalApi.providerName')}
            value={newProviderName}
            onChange={(e) => setNewProviderName(e.target.value)}
            helperText={t('externalApi.providerNameHelper')}
          />

          <TextField
            fullWidth
            label={t('externalApi.providerDisplayName')}
            value={newProviderDisplayName}
            onChange={(e) => setNewProviderDisplayName(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowNewProviderDialog(false)}>{t('common.cancel')}</Button>
          <Button
            onClick={handleCreateProvider}
            variant="contained"
            disabled={!newProviderName || !newProviderDisplayName}
          >
            {t('common.create')}
          </Button>
        </DialogActions>
      </Dialog>


      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>{t('externalApi.deleteConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('externalApi.deleteConfirmMessage', { provider: providerToDelete })}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button onClick={handleDeleteProvider} color="error" variant="contained">
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
