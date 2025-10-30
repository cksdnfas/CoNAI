import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Switch,
  FormControlLabel,
  Select,
  MenuItem,
  Slider,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Chip,
  Stack,
  FormControl,
  InputLabel,
  Divider,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Refresh as RefreshIcon,
  CloudDownload as CloudDownloadIcon,
  PlayArrow as PlayArrowIcon,
  Science as ScienceIcon,
  CloudUpload as CloudUploadIcon,
  CloudOff as CloudOffIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { settingsApi, taggerBatchApi, type TaggerSettings as TaggerSettingsType, type TaggerModel, type TaggerDevice, type TaggerServerStatus } from '../../../services/settingsApi';

interface TaggerSettingsProps {
  settings: TaggerSettingsType;
  onUpdate: (settings: Partial<TaggerSettingsType>) => Promise<void>;
}

const TaggerSettings: React.FC<TaggerSettingsProps> = ({ settings, onUpdate }) => {
  const { t } = useTranslation('settings');
  const [localSettings, setLocalSettings] = useState<TaggerSettingsType>(settings);
  const [models, setModels] = useState<TaggerModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dependencyStatus, setDependencyStatus] = useState<string | null>(null);
  const [dependencyAvailable, setDependencyAvailable] = useState<boolean | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Batch operations state
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [untaggedCount, setUntaggedCount] = useState<number | null>(null);
  const [confirmDialog, setConfirmDialog] = useState(false);

  // Test state
  const [testImageId, setTestImageId] = useState('');
  const [testProcessing, setTestProcessing] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  // Model status state
  const [modelStatus, setModelStatus] = useState<TaggerServerStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  useEffect(() => {
    loadModels();
    loadUntaggedCount();
    loadModelStatus();
  }, []);

  useEffect(() => {
    // Poll model status every 5 seconds when enabled
    if (localSettings.enabled) {
      const interval = setInterval(loadModelStatus, 5000);
      return () => clearInterval(interval);
    }
  }, [localSettings.enabled]);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    const changed = JSON.stringify(localSettings) !== JSON.stringify(settings);
    setHasChanges(changed);
  }, [localSettings, settings]);

  const loadModels = async () => {
    try {
      const modelsList = await settingsApi.getModelsList();
      setModels(modelsList);
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  };

  const loadUntaggedCount = async () => {
    try {
      const count = await taggerBatchApi.getUntaggedCount();
      setUntaggedCount(count);
    } catch (error) {
      console.error('Failed to load untagged count:', error);
    }
  };

  const loadModelStatus = async () => {
    try {
      setStatusLoading(true);
      const status = await settingsApi.getTaggerStatus();
      setModelStatus(status);
    } catch (error) {
      console.error('Failed to load model status:', error);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleLoadModel = async () => {
    setLoading(true);
    try {
      await settingsApi.loadModel(localSettings.model);
      await loadModelStatus();
      alert(t('tagger.alerts.modelLoaded'));
    } catch (error) {
      alert(t('tagger.alerts.loadFailed'));
      console.error('Failed to load model:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUnloadModel = async () => {
    setLoading(true);
    try {
      await settingsApi.unloadModel();
      await loadModelStatus();
      alert(t('tagger.alerts.modelUnloaded'));
    } catch (error) {
      alert(t('tagger.alerts.unloadFailed'));
      console.error('Failed to unload model:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckDependencies = async () => {
    setChecking(true);
    setDependencyStatus(null);
    try {
      const result = await settingsApi.checkDependencies();
      setDependencyAvailable(result.available);
      setDependencyStatus(result.message);
    } catch (error) {
      setDependencyAvailable(false);
      setDependencyStatus('Failed to check dependencies');
    } finally {
      setChecking(false);
    }
  };

  const handleDownloadModel = async () => {
    setDownloading(true);
    try {
      const result = await settingsApi.downloadModel(localSettings.model);
      alert(result.message);
      await loadModels();
    } catch (error) {
      alert('Failed to download model');
      console.error('Failed to download model:', error);
    } finally {
      setDownloading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await onUpdate(localSettings);
      setHasChanges(false);
    } catch (error) {
      alert(t('tagger.alerts.saveFailed'));
      console.error('Failed to save settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setLocalSettings(settings);
    setHasChanges(false);
  };

  const handleBatchTagUnprocessed = async () => {
    setBatchProcessing(true);
    setBatchProgress(0);
    setBatchTotal(0);
    try {
      const result = await taggerBatchApi.tagUnprocessed(100);
      setBatchTotal(result.total);
      setBatchProgress(result.success_count);
      alert(t('tagger.batch.alerts.complete', { success: result.success_count, failed: result.fail_count }));
      await loadUntaggedCount();
    } catch (error) {
      alert(t('tagger.batch.alerts.failed'));
      console.error('Failed to batch tag unprocessed:', error);
    } finally {
      setBatchProcessing(false);
    }
  };

  const handleBatchTagAll = async () => {
    setConfirmDialog(false);
    setBatchProcessing(true);
    setBatchProgress(0);
    setBatchTotal(0);
    try {
      const result = await taggerBatchApi.tagAll(100, true);
      setBatchTotal(result.total);
      setBatchProgress(result.success_count);
      alert(t('tagger.batch.alerts.complete', { success: result.success_count, failed: result.fail_count }));
      await loadUntaggedCount();
    } catch (error) {
      alert(t('tagger.batch.alerts.tagAllFailed'));
      console.error('Failed to batch tag all:', error);
    } finally {
      setBatchProcessing(false);
    }
  };

  const handleTestImage = async () => {
    const imageId = parseInt(testImageId);
    if (isNaN(imageId) || imageId <= 0) {
      alert(t('tagger.test.invalidId'));
      return;
    }

    setTestProcessing(true);
    setTestResult(null);
    try {
      const result = await taggerBatchApi.testImage(String(imageId));
      setTestResult(result);
    } catch (error) {
      alert(t('tagger.test.failed'));
      console.error('Failed to test image:', error);
    } finally {
      setTestProcessing(false);
    }
  };

  const currentModel = models.find(m => m.name === localSettings.model);
  const isModelDownloaded = currentModel?.downloaded || false;

  // Format relative time
  const formatRelativeTime = (isoString: string | null): string => {
    if (!isoString) return t('tagger.modelStatus.none');
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return t('tagger.modelStatus.justNow');
    if (diffMins < 60) return t('tagger.modelStatus.minutesAgo', { minutes: diffMins });
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return t('tagger.modelStatus.hoursAgo', { hours: diffHours });
    const diffDays = Math.floor(diffHours / 24);
    return t('tagger.modelStatus.daysAgo', { days: diffDays });
  };

  return (
    <Box>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t('tagger.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            {t('tagger.description')}
          </Typography>

          <Stack spacing={3} sx={{ mt: 3 }}>
            {/* Model Status Section */}
            {localSettings.enabled && (
              <Card variant="outlined" sx={{ bgcolor: 'background.default' }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Box flex={1}>
                      <Typography variant="subtitle1" gutterBottom>
                        {t('tagger.modelStatus.title')}
                      </Typography>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                        <Chip
                          label={modelStatus?.modelLoaded ? t('tagger.modelStatus.loaded') : t('tagger.modelStatus.unloaded')}
                          color={modelStatus?.modelLoaded ? 'success' : 'default'}
                          size="small"
                          icon={modelStatus?.modelLoaded ? <CheckCircleIcon /> : undefined}
                        />
                        {modelStatus?.currentModel && (
                          <Chip
                            label={models.find(m => m.name === modelStatus.currentModel)?.label || modelStatus.currentModel}
                            size="small"
                            variant="outlined"
                          />
                        )}
                        {modelStatus?.currentDevice && (
                          <Chip
                            label={modelStatus.currentDevice}
                            size="small"
                            color={modelStatus.currentDevice.includes('cuda') ? 'success' : 'default'}
                            variant="outlined"
                          />
                        )}
                        {statusLoading && <CircularProgress size={16} />}
                      </Stack>
                      {modelStatus?.lastUsedAt && (
                        <Typography variant="caption" color="text.secondary">
                          {t('tagger.modelStatus.lastUsed')}: {formatRelativeTime(modelStatus.lastUsedAt)}
                        </Typography>
                      )}
                    </Box>
                    <Stack direction="row" spacing={1}>
                      <Button
                        onClick={handleLoadModel}
                        disabled={modelStatus?.modelLoaded || loading}
                        startIcon={<CloudUploadIcon />}
                        size="small"
                      >
                        {t('tagger.buttons.load')}
                      </Button>
                      <Button
                        onClick={handleUnloadModel}
                        disabled={!modelStatus?.modelLoaded || loading}
                        startIcon={<CloudOffIcon />}
                        color="warning"
                        size="small"
                      >
                        {t('tagger.buttons.unload')}
                      </Button>
                      <Button
                        onClick={loadModelStatus}
                        disabled={statusLoading}
                        startIcon={<RefreshIcon />}
                        size="small"
                        variant="outlined"
                      >
                        {t('tagger.buttons.refresh')}
                      </Button>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            )}

            <Divider />
            {/* Enable/Disable Toggle */}
            <FormControlLabel
              control={
                <Switch
                  checked={localSettings.enabled}
                  onChange={(e) => setLocalSettings({ ...localSettings, enabled: e.target.checked })}
                />
              }
              label={t('tagger.enabled')}
            />

            {/* Auto Tag on Upload */}
            <FormControlLabel
              control={
                <Switch
                  checked={localSettings.autoTagOnUpload}
                  onChange={(e) => setLocalSettings({ ...localSettings, autoTagOnUpload: e.target.checked })}
                  disabled={!localSettings.enabled}
                />
              }
              label={t('tagger.autoTagOnUpload')}
            />

            {/* Model Selection */}
            {models.length > 0 ? (
              <FormControl fullWidth disabled={!localSettings.enabled}>
                <InputLabel>{t('tagger.model.label')}</InputLabel>
                <Select
                  value={localSettings.model}
                  label={t('tagger.model.label')}
                  onChange={(e) => setLocalSettings({ ...localSettings, model: e.target.value as any })}
                >
                  {models.map((model) => (
                    <MenuItem key={model.name} value={model.name}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <Box>
                          <Typography variant="body1">{model.label}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {model.description}
                          </Typography>
                        </Box>
                        {model.downloaded && (
                          <Chip
                            size="small"
                            icon={<CheckCircleIcon />}
                            label={t('tagger.model.downloaded')}
                            color="success"
                            sx={{ ml: 2 }}
                          />
                        )}
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <CircularProgress size={20} />
                <Typography variant="body2" color="text.secondary">{t('tagger.model.loading')}</Typography>
              </Box>
            )}

            {/* Device Selection */}
            <FormControl fullWidth disabled={!localSettings.enabled}>
              <InputLabel>{t('tagger.device.label')}</InputLabel>
              <Select
                value={localSettings.device}
                label={t('tagger.device.label')}
                onChange={(e) => setLocalSettings({ ...localSettings, device: e.target.value as TaggerDevice })}
              >
                <MenuItem value="auto">
                  <Box>
                    <Typography variant="body1">{t('tagger.device.auto.title')}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('tagger.device.auto.description')}
                    </Typography>
                  </Box>
                </MenuItem>
                <MenuItem value="cpu">
                  <Box>
                    <Typography variant="body1">{t('tagger.device.cpu.title')}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('tagger.device.cpu.description')}
                    </Typography>
                  </Box>
                </MenuItem>
                <MenuItem value="cuda">
                  <Box>
                    <Typography variant="body1">{t('tagger.device.cuda.title')}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('tagger.device.cuda.description')}
                    </Typography>
                  </Box>
                </MenuItem>
              </Select>
            </FormControl>

            {/* Download Status and Button */}
            {localSettings.enabled && (
              <Box>
                <Alert severity={isModelDownloaded ? 'success' : 'warning'} sx={{ mb: 2 }}>
                  {isModelDownloaded ? (
                    <span dangerouslySetInnerHTML={{ __html: t('tagger.alerts.modelDownloaded', { model: currentModel?.label }) }} />
                  ) : (
                    <span dangerouslySetInnerHTML={{ __html: t('tagger.alerts.modelNotDownloaded', { model: currentModel?.label }) }} />
                  )}
                </Alert>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={downloading ? <CircularProgress size={20} /> : <CloudDownloadIcon />}
                    onClick={handleDownloadModel}
                    disabled={downloading || isModelDownloaded}
                  >
                    {downloading ? t('tagger.buttons.downloading') : t('tagger.buttons.download')}
                  </Button>
                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    onClick={loadModels}
                  >
                    {t('tagger.buttons.refreshStatus')}
                  </Button>
                </Stack>
              </Box>
            )}

            {/* General Threshold */}
            <Box>
              <Typography gutterBottom>
                {t('tagger.threshold.general.label', { value: localSettings.generalThreshold.toFixed(2) })}
              </Typography>
              <Slider
                value={localSettings.generalThreshold}
                onChange={(_, value) => setLocalSettings({ ...localSettings, generalThreshold: value as number })}
                min={0}
                max={1}
                step={0.05}
                marks={[
                  { value: 0, label: '0.0' },
                  { value: 0.5, label: '0.5' },
                  { value: 1, label: '1.0' },
                ]}
                disabled={!localSettings.enabled}
              />
              <Typography variant="caption" color="text.secondary">
                {t('tagger.threshold.general.description')}
              </Typography>
            </Box>

            {/* Character Threshold */}
            <Box>
              <Typography gutterBottom>
                {t('tagger.threshold.character.label', { value: localSettings.characterThreshold.toFixed(2) })}
              </Typography>
              <Slider
                value={localSettings.characterThreshold}
                onChange={(_, value) => setLocalSettings({ ...localSettings, characterThreshold: value as number })}
                min={0}
                max={1}
                step={0.05}
                marks={[
                  { value: 0, label: '0.0' },
                  { value: 0.5, label: '0.5' },
                  { value: 1, label: '1.0' },
                ]}
                disabled={!localSettings.enabled}
              />
              <Typography variant="caption" color="text.secondary">
                {t('tagger.threshold.character.description')}
              </Typography>
            </Box>

            {/* Python Path */}
            <TextField
              label={t('tagger.pythonPath.label')}
              value={localSettings.pythonPath}
              onChange={(e) => setLocalSettings({ ...localSettings, pythonPath: e.target.value })}
              fullWidth
              disabled={!localSettings.enabled}
              helperText={t('tagger.pythonPath.helper')}
            />

            <Divider sx={{ my: 2 }} />

            {/* Memory Management Settings */}
            {localSettings.enabled && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  {t('tagger.memoryManagement.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  {t('tagger.memoryManagement.description')}
                </Typography>

                <Stack spacing={2}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={localSettings.keepModelLoaded}
                        onChange={(e) => setLocalSettings({ ...localSettings, keepModelLoaded: e.target.checked })}
                      />
                    }
                    label={t('tagger.memoryManagement.keepModelLoaded')}
                  />

                  <Alert severity="info">
                    {localSettings.keepModelLoaded ? (
                      t('tagger.memoryManagement.keepLoadedAlert')
                    ) : (
                      t('tagger.memoryManagement.notKeepLoadedAlert')
                    )}
                  </Alert>

                  {localSettings.keepModelLoaded && (
                    <Box>
                      <Typography gutterBottom>
                        {t('tagger.memoryManagement.autoUnloadMinutes', { minutes: localSettings.autoUnloadMinutes })}
                      </Typography>
                      <Slider
                        value={localSettings.autoUnloadMinutes}
                        onChange={(_, value) => setLocalSettings({ ...localSettings, autoUnloadMinutes: value as number })}
                        min={1}
                        max={60}
                        step={1}
                        marks={[
                          { value: 1, label: '1min' },
                          { value: 15, label: '15min' },
                          { value: 30, label: '30min' },
                          { value: 60, label: '60min' },
                        ]}
                      />
                      <Typography variant="caption" color="text.secondary">
                        {t('tagger.memoryManagement.autoUnloadDescription')}
                      </Typography>
                    </Box>
                  )}
                </Stack>
              </Box>
            )}

            <Divider sx={{ my: 2 }} />

            {/* Dependency Check */}
            <Box>
              <Button
                variant="outlined"
                startIcon={checking ? <CircularProgress size={20} /> : <CheckCircleIcon />}
                onClick={handleCheckDependencies}
                disabled={checking || !localSettings.enabled}
                fullWidth
              >
                {checking ? t('tagger.buttons.checking') : t('tagger.buttons.checkDependencies')}
              </Button>

              {dependencyStatus && (
                <Alert severity={dependencyAvailable ? 'success' : 'error'} sx={{ mt: 2 }}>
                  {dependencyStatus}
                </Alert>
              )}
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Batch Operations Section */}
            {localSettings.enabled && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  {t('tagger.batch.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  {t('tagger.batch.description')}
                </Typography>

                {untaggedCount !== null && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    {t('tagger.batch.untaggedCount', { count: untaggedCount })}
                  </Alert>
                )}

                {batchProcessing && batchTotal > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" gutterBottom>
                      {t('tagger.batch.progress', { current: batchProgress, total: batchTotal })}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={(batchProgress / batchTotal) * 100}
                    />
                  </Box>
                )}

                <Stack spacing={2}>
                  <Button
                    variant="contained"
                    startIcon={batchProcessing ? <CircularProgress size={20} /> : <PlayArrowIcon />}
                    onClick={handleBatchTagUnprocessed}
                    disabled={batchProcessing}
                    fullWidth
                  >
                    {batchProcessing ? t('tagger.batch.buttons.processing') : t('tagger.batch.buttons.tagUnprocessed')}
                  </Button>

                  <Button
                    variant="outlined"
                    color="warning"
                    startIcon={batchProcessing ? <CircularProgress size={20} /> : <PlayArrowIcon />}
                    onClick={() => setConfirmDialog(true)}
                    disabled={batchProcessing}
                    fullWidth
                  >
                    {t('tagger.batch.buttons.tagAll')}
                  </Button>
                </Stack>
              </Box>
            )}

            <Divider sx={{ my: 2 }} />

            {/* Test Section */}
            {localSettings.enabled && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  {t('tagger.test.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  {t('tagger.test.description')}
                </Typography>

                <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                  <TextField
                    label={t('tagger.test.imageId')}
                    value={testImageId}
                    onChange={(e) => setTestImageId(e.target.value)}
                    type="number"
                    fullWidth
                    placeholder={t('tagger.test.placeholder')}
                  />
                  <Button
                    variant="contained"
                    startIcon={testProcessing ? <CircularProgress size={20} /> : <ScienceIcon />}
                    onClick={handleTestImage}
                    disabled={testProcessing || !testImageId}
                    sx={{ minWidth: 150 }}
                  >
                    {testProcessing ? t('tagger.test.processing') : t('tagger.test.button')}
                  </Button>
                </Stack>

                {testResult && (
                  <Alert severity="success" sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      {t('tagger.test.result')}
                    </Typography>
                    <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem' }}>
                      {JSON.stringify(testResult.auto_tags, null, 2)}
                    </Typography>
                  </Alert>
                )}
              </Box>
            )}

            {/* Save/Reset Buttons */}
            <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
              <Button
                variant="contained"
                onClick={handleSave}
                disabled={!hasChanges || loading}
                fullWidth
              >
                {loading ? <CircularProgress size={24} /> : t('tagger.buttons.save')}
              </Button>
              <Button
                variant="outlined"
                onClick={handleReset}
                disabled={!hasChanges || loading}
                fullWidth
              >
                {t('tagger.buttons.cancel')}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {/* Confirmation Dialog for Batch Tag All */}
      <Dialog open={confirmDialog} onClose={() => setConfirmDialog(false)}>
        <DialogTitle>{t('tagger.batch.confirmDialog.title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('tagger.batch.confirmDialog.message')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(false)}>{t('tagger.batch.confirmDialog.cancel')}</Button>
          <Button onClick={handleBatchTagAll} color="warning" variant="contained">
            {t('tagger.batch.confirmDialog.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TaggerSettings;
