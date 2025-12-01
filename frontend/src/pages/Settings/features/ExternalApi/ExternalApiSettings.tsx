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
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Slider,
  Tooltip,
  Autocomplete,
  Collapse,
} from '@mui/material';
import { useSnackbar } from 'notistack';
import {
  ExpandMore,
  Visibility,
  VisibilityOff,
  Delete,
  Check,
  Close,
  Add,
  VpnKey,
  Psychology,
  Refresh,
  Computer,
  Send,
  Chat,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import {
  externalApiApi,
  type ExternalApiProvider,
  type CreateExternalApiProviderInput,
  type UpdateExternalApiProviderInput,
  type LLMProviderPreset,
  type LLMModelInfo,
  type LLMConfig,
  type ProviderType,
} from '../../../../services/externalApiApi';

export const ExternalApiSettings: React.FC = () => {
  const { t } = useTranslation('settings');
  const { enqueueSnackbar } = useSnackbar();
  const [providers, setProviders] = useState<ExternalApiProvider[]>([]);
  const [llmPresets, setLlmPresets] = useState<LLMProviderPreset[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedProvider, setExpandedProvider] = useState<string | false>(false);

  // Form states for each provider
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [testingConnection, setTestingConnection] = useState<Record<string, boolean>>({});

  // LLM-specific states
  const [availableModels, setAvailableModels] = useState<Record<string, LLMModelInfo[]>>({});
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});

  // New provider dialog
  const [showNewProviderDialog, setShowNewProviderDialog] = useState(false);
  const [newProviderName, setNewProviderName] = useState('');
  const [newProviderDisplayName, setNewProviderDisplayName] = useState('');
  const [newProviderType, setNewProviderType] = useState<ProviderType>('general');

  // LLM provider dialog
  const [showLLMProviderDialog, setShowLLMProviderDialog] = useState(false);
  const [selectedLLMPreset, setSelectedLLMPreset] = useState<string>('');

  // Delete confirmation dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [providerToDelete, setProviderToDelete] = useState<string | null>(null);

  // Test chat states
  const [showTestChat, setShowTestChat] = useState<Record<string, boolean>>({});
  const [testChatMessage, setTestChatMessage] = useState<Record<string, string>>({});
  const [testChatResponse, setTestChatResponse] = useState<Record<string, string>>({});
  const [testChatLoading, setTestChatLoading] = useState<Record<string, boolean>>({});

  const loadProviders = async () => {
    try {
      setIsLoading(true);
      const data = await externalApiApi.getProviders();
      setProviders(data);

      // Initialize form data with empty strings for new API keys
      const initialFormData: Record<string, any> = {};
      data.forEach((provider) => {
        const config = provider.additional_config as LLMConfig | null;
        initialFormData[provider.provider_name] = {
          api_key: '',
          api_secret: '',
          base_url: provider.base_url || '',
          model: config?.model || '',
          temperature: config?.temperature ?? 1,
          max_tokens: config?.max_tokens || 4096,
          default_system_prompt: config?.default_system_prompt || '',
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

  const loadLLMPresets = async () => {
    try {
      const presets = await externalApiApi.getLLMPresets();
      setLlmPresets(presets);
    } catch (err) {
      console.error('Failed to load LLM presets:', err);
    }
  };

  useEffect(() => {
    loadProviders();
    loadLLMPresets();
  }, []);

  const handleAccordionChange = (providerName: string) => (
    event: React.SyntheticEvent,
    isExpanded: boolean
  ) => {
    setExpandedProvider(isExpanded ? providerName : false);

    // Load models for LLM providers when expanded
    const provider = providers.find(p => p.provider_name === providerName);
    if (isExpanded && provider?.provider_type === 'llm' && !availableModels[providerName]) {
      loadModelsForProvider(providerName);
    }
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
      const provider = providers.find(p => p.provider_name === providerName);

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

      // Handle LLM-specific config
      if (provider?.provider_type === 'llm') {
        const llmConfig: LLMConfig = {
          model: data.model || '',
          temperature: data.temperature,
          max_tokens: data.max_tokens,
          default_system_prompt: data.default_system_prompt || undefined,
        };
        updateInput.additional_config = llmConfig;
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
        provider_type: newProviderType,
      };

      await externalApiApi.createProvider(input);
      await loadProviders();
      enqueueSnackbar(t('externalApi.success.created'), { variant: 'success' });
      setShowNewProviderDialog(false);
      setNewProviderName('');
      setNewProviderDisplayName('');
      setNewProviderType('general');
    } catch (err: any) {
      enqueueSnackbar(err.message || t('externalApi.errors.createFailed'), { variant: 'error' });
    }
  };

  const handleCreateLLMProvider = async () => {
    try {
      if (!selectedLLMPreset) {
        return;
      }

      const preset = llmPresets.find(p => p.provider_name === selectedLLMPreset);
      if (!preset) return;

      // Check if provider already exists
      const existingProvider = providers.find(p => p.provider_name === preset.provider_name);
      if (existingProvider) {
        enqueueSnackbar(`${preset.display_name} is already configured`, { variant: 'error' });
        return;
      }

      const input: CreateExternalApiProviderInput = {
        provider_name: preset.provider_name,
        display_name: preset.display_name,
        provider_type: 'llm',
        base_url: preset.default_base_url,
        additional_config: {
          model: preset.default_models[0] || '',
          temperature: 1,
          max_tokens: 4096,
        } as LLMConfig,
      };

      await externalApiApi.createProvider(input);
      await loadProviders();
      enqueueSnackbar(t('externalApi.success.created'), { variant: 'success' });
      setShowLLMProviderDialog(false);
      setSelectedLLMPreset('');
    } catch (err: any) {
      enqueueSnackbar(err.message || t('externalApi.errors.createFailed'), { variant: 'error' });
    }
  };

  const loadModelsForProvider = async (providerName: string) => {
    try {
      setLoadingModels((prev) => ({ ...prev, [providerName]: true }));
      const models = await externalApiApi.getLLMModels(providerName);
      setAvailableModels((prev) => ({ ...prev, [providerName]: models }));
    } catch (err) {
      console.error(`Failed to load models for ${providerName}:`, err);
      // Use preset default models as fallback
      const preset = llmPresets.find(p => p.provider_name === providerName);
      if (preset) {
        setAvailableModels((prev) => ({
          ...prev,
          [providerName]: preset.default_models.map(id => ({ id, name: id })),
        }));
      }
    } finally {
      setLoadingModels((prev) => ({ ...prev, [providerName]: false }));
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

  const toggleTestChat = (providerName: string) => {
    setShowTestChat((prev) => ({
      ...prev,
      [providerName]: !prev[providerName],
    }));
  };

  const handleTestChat = async (providerName: string) => {
    const message = testChatMessage[providerName]?.trim();
    if (!message) return;

    const model = formData[providerName]?.model;
    if (!model) {
      enqueueSnackbar(t('externalApi.llm.testChatNoModel'), { variant: 'error' });
      return;
    }

    try {
      setTestChatLoading((prev) => ({ ...prev, [providerName]: true }));
      setTestChatResponse((prev) => ({ ...prev, [providerName]: '' }));

      const response = await externalApiApi.llmChat(providerName, {
        messages: [{ role: 'user', content: message }],
      });

      if (response.success && response.content) {
        setTestChatResponse((prev) => ({ ...prev, [providerName]: response.content || '' }));
        enqueueSnackbar(t('externalApi.llm.testChatSuccess'), { variant: 'success' });
      } else {
        enqueueSnackbar(response.error || t('externalApi.llm.testChatError'), { variant: 'error' });
      }
    } catch (err: any) {
      enqueueSnackbar(err.message || t('externalApi.llm.testChatError'), { variant: 'error' });
    } finally {
      setTestChatLoading((prev) => ({ ...prev, [providerName]: false }));
    }
  };

  const getPresetForProvider = (providerName: string): LLMProviderPreset | undefined => {
    return llmPresets.find(p => p.provider_name === providerName);
  };

  const isLocalServer = (providerName: string): boolean => {
    const preset = getPresetForProvider(providerName);
    return preset ? !preset.requires_api_key : false;
  };

  // Separate general and LLM providers
  const generalProviders = providers.filter(p => p.provider_type !== 'llm');
  const llmProviders = providers.filter(p => p.provider_type === 'llm');

  // Available LLM presets (not yet configured)
  const availableLLMPresets = llmPresets.filter(
    preset => !providers.some(p => p.provider_name === preset.provider_name)
  );

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="200px">
        <CircularProgress />
      </Box>
    );
  }

  const renderProviderAccordion = (provider: ExternalApiProvider) => {
    const providerFormData = formData[provider.provider_name] || {};
    const isLLM = provider.provider_type === 'llm';
    const preset = getPresetForProvider(provider.provider_name);
    const isLocal = isLocalServer(provider.provider_name);
    const models = availableModels[provider.provider_name] || preset?.default_models.map(id => ({ id, name: id })) || [];

    return (
      <Accordion
        key={provider.provider_name}
        expanded={expandedProvider === provider.provider_name}
        onChange={handleAccordionChange(provider.provider_name)}
        sx={{ mb: 1 }}
      >
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Box display="flex" alignItems="center" gap={2} width="100%">
            {isLLM ? <Psychology color="secondary" /> : <VpnKey color="primary" />}
            <Typography variant="subtitle1">{provider.display_name}</Typography>
            {isLLM && (
              <Chip
                label="LLM"
                size="small"
                color="secondary"
                variant="outlined"
              />
            )}
            {isLocal && (
              <Chip
                label={t('externalApi.llm.localServer')}
                size="small"
                icon={<Computer />}
                variant="outlined"
              />
            )}
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
            {/* API Key Section - only show if requires API key */}
            {!isLocal && (
              <>
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
              </>
            )}

            {/* Local server notice */}
            {isLocal && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('externalApi.llm.localServerHelper')}
              </Alert>
            )}

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
              placeholder={preset?.default_base_url || ''}
              helperText={t('externalApi.baseUrlHelper')}
            />

            {/* LLM-specific settings */}
            {isLLM && (
              <>
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle2" gutterBottom>
                  {t('externalApi.llm.title')}
                </Typography>

                {/* Model Selection with Custom Input */}
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                  <Autocomplete
                    freeSolo
                    fullWidth
                    size="small"
                    options={models}
                    getOptionLabel={(option) => {
                      if (typeof option === 'string') return option;
                      return option.id;
                    }}
                    value={providerFormData.model || ''}
                    onChange={(_, newValue) => {
                      if (typeof newValue === 'string') {
                        handleFormChange(provider.provider_name, 'model', newValue);
                      } else if (newValue) {
                        handleFormChange(provider.provider_name, 'model', newValue.id);
                      } else {
                        handleFormChange(provider.provider_name, 'model', '');
                      }
                    }}
                    onInputChange={(_, newInputValue, reason) => {
                      if (reason === 'input') {
                        handleFormChange(provider.provider_name, 'model', newInputValue);
                      }
                    }}
                    renderOption={(props, option) => (
                      <li {...props} key={option.id}>
                        <Box>
                          <Typography>{option.name}</Typography>
                          {option.description && (
                            <Typography variant="caption" color="textSecondary">
                              {option.description}
                            </Typography>
                          )}
                        </Box>
                      </li>
                    )}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label={t('externalApi.llm.model')}
                        placeholder={t('externalApi.llm.modelPlaceholder')}
                        margin="normal"
                        helperText={t('externalApi.llm.modelCustomHelper')}
                      />
                    )}
                    loading={loadingModels[provider.provider_name]}
                    noOptionsText={t('externalApi.llm.noModels')}
                  />
                  <Tooltip title={t('externalApi.llm.refreshModels')}>
                    <IconButton
                      size="small"
                      onClick={() => loadModelsForProvider(provider.provider_name)}
                      disabled={loadingModels[provider.provider_name]}
                      sx={{ mt: 2.5 }}
                    >
                      {loadingModels[provider.provider_name] ? (
                        <CircularProgress size={20} />
                      ) : (
                        <Refresh />
                      )}
                    </IconButton>
                  </Tooltip>
                </Box>

                {/* Temperature */}
                <Box sx={{ mt: 2 }}>
                  <Typography gutterBottom>
                    {t('externalApi.llm.temperature')}: {providerFormData.temperature ?? 1}
                  </Typography>
                  <Slider
                    value={providerFormData.temperature ?? 1}
                    onChange={(_, value) =>
                      handleFormChange(provider.provider_name, 'temperature', value)
                    }
                    min={0}
                    max={2}
                    step={0.1}
                    marks={[
                      { value: 0, label: '0' },
                      { value: 1, label: '1' },
                      { value: 2, label: '2' },
                    ]}
                  />
                  <Typography variant="caption" color="textSecondary">
                    {t('externalApi.llm.temperatureHelper')}
                  </Typography>
                </Box>

                {/* Max Tokens */}
                <TextField
                  fullWidth
                  label={t('externalApi.llm.maxTokens')}
                  type="number"
                  value={providerFormData.max_tokens || 4096}
                  onChange={(e) =>
                    handleFormChange(provider.provider_name, 'max_tokens', parseInt(e.target.value) || 4096)
                  }
                  margin="normal"
                  size="small"
                  helperText={t('externalApi.llm.maxTokensHelper')}
                />

                {/* System Prompt */}
                <TextField
                  fullWidth
                  label={t('externalApi.llm.systemPrompt')}
                  value={providerFormData.default_system_prompt || ''}
                  onChange={(e) =>
                    handleFormChange(provider.provider_name, 'default_system_prompt', e.target.value)
                  }
                  margin="normal"
                  size="small"
                  multiline
                  rows={3}
                  placeholder={t('externalApi.llm.systemPromptPlaceholder')}
                />

                {/* Test Chat Section */}
                <Box sx={{ mt: 2 }}>
                  <Button
                    variant="outlined"
                    color="secondary"
                    startIcon={<Chat />}
                    onClick={() => toggleTestChat(provider.provider_name)}
                    size="small"
                  >
                    {t('externalApi.llm.testChat')}
                  </Button>

                  <Collapse in={showTestChat[provider.provider_name]}>
                    <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
                      <Typography variant="subtitle2" gutterBottom>
                        {t('externalApi.llm.testChatTitle')}
                      </Typography>

                      <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
                        <TextField
                          fullWidth
                          size="small"
                          placeholder={t('externalApi.llm.testChatPlaceholder')}
                          value={testChatMessage[provider.provider_name] || ''}
                          onChange={(e) => setTestChatMessage((prev) => ({
                            ...prev,
                            [provider.provider_name]: e.target.value,
                          }))}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleTestChat(provider.provider_name);
                            }
                          }}
                          disabled={testChatLoading[provider.provider_name]}
                        />
                        <Button
                          variant="contained"
                          color="secondary"
                          onClick={() => handleTestChat(provider.provider_name)}
                          disabled={testChatLoading[provider.provider_name] || !testChatMessage[provider.provider_name]?.trim()}
                        >
                          {testChatLoading[provider.provider_name] ? (
                            <CircularProgress size={20} />
                          ) : (
                            <Send />
                          )}
                        </Button>
                      </Box>

                      {testChatResponse[provider.provider_name] && (
                        <Box sx={{
                          p: 2,
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          maxHeight: 200,
                          overflow: 'auto',
                        }}>
                          <Typography variant="caption" color="textSecondary" gutterBottom display="block">
                            {t('externalApi.llm.testChatResponse')}:
                          </Typography>
                          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                            {testChatResponse[provider.provider_name]}
                          </Typography>
                        </Box>
                      )}
                    </Paper>
                  </Collapse>
                </Box>
              </>
            )}

            {/* Action Buttons */}
            <Box display="flex" gap={1} mt={2}>
              <Button
                variant="contained"
                startIcon={<Check />}
                onClick={() => handleSaveProvider(provider.provider_name)}
                disabled={!isLocal && !providerFormData.api_key && !isLLM}
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

      {/* LLM Providers Section */}
      <Paper sx={{ p: 3, mb: 2 }}>
        <Box display="flex" alignItems="center" gap={1} mb={2}>
          <Psychology color="secondary" />
          <Typography variant="h6">{t('externalApi.llm.title')}</Typography>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* LLM Provider Accordions */}
        {llmProviders.map(renderProviderAccordion)}

        {/* Add LLM Provider Button */}
        {availableLLMPresets.length > 0 && (
          <Button
            variant="outlined"
            color="secondary"
            startIcon={<Add />}
            onClick={() => setShowLLMProviderDialog(true)}
            sx={{ mt: 2 }}
          >
            {t('externalApi.llm.addLLMProvider')}
          </Button>
        )}
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

      {/* LLM Provider Dialog */}
      <Dialog open={showLLMProviderDialog} onClose={() => setShowLLMProviderDialog(false)}>
        <DialogTitle>{t('externalApi.llm.addLLMProvider')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2, minWidth: 400 }}>
          <FormControl fullWidth>
            <InputLabel>{t('externalApi.llm.selectPreset')}</InputLabel>
            <Select
              value={selectedLLMPreset}
              label={t('externalApi.llm.selectPreset')}
              onChange={(e) => setSelectedLLMPreset(e.target.value)}
            >
              {availableLLMPresets.map((preset) => (
                <MenuItem key={preset.provider_name} value={preset.provider_name}>
                  <Box>
                    <Typography>{preset.display_name}</Typography>
                    <Typography variant="caption" color="textSecondary">
                      {preset.requires_api_key ? 'API Key required' : 'Local server (no API key)'}
                    </Typography>
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowLLMProviderDialog(false)}>{t('common.cancel')}</Button>
          <Button
            onClick={handleCreateLLMProvider}
            variant="contained"
            color="secondary"
            disabled={!selectedLLMPreset}
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
