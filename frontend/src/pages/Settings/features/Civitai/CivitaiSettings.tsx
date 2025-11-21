import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  Switch,
  FormControlLabel,
  Slider,
  Button,
  Alert,
  CircularProgress,
  Divider,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Chip,
  LinearProgress,
} from '@mui/material';
import {
  Refresh,
  Delete,
  CheckCircle,
  Error as ErrorIcon,
  CloudSync,
  Search,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { civitaiApi, type CivitaiSettings as CivitaiSettingsType, type CivitaiStats, type ModelInfo } from '../../../../services/civitaiApi';

export const CivitaiSettings: React.FC = () => {
  const { t } = useTranslation('settings');
  const [settings, setSettings] = useState<CivitaiSettingsType | null>(null);
  const [stats, setStats] = useState<CivitaiStats | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [clearCacheDialog, setClearCacheDialog] = useState(false);
  const [resetStatsDialog, setResetStatsDialog] = useState(false);
  const [rescanProgress, setRescanProgress] = useState<{
    isRunning: boolean;
    total: number;
    processed: number;
    added: number;
    percentage: number;
  } | null>(null);
  const [isRescanStarting, setIsRescanStarting] = useState(false);

  const loadData = async () => {
    try {
      setIsLoading(true);
      setError('');
      const [settingsData, statsData, modelsData] = await Promise.all([
        civitaiApi.getSettings(),
        civitaiApi.getStats(),
        civitaiApi.getModels(20, 0)
      ]);
      setSettings(settingsData);
      setStats(statsData);
      setModels(modelsData);
    } catch (err) {
      setError('Failed to load Civitai settings');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleToggleEnabled = async (enabled: boolean) => {
    try {
      const updated = await civitaiApi.updateSettings({ enabled });
      setSettings(updated);
      setSuccess(enabled ? 'Civitai integration enabled' : 'Civitai integration disabled');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to update settings');
    }
  };

  const handleIntervalChange = async (_: Event, value: number | number[]) => {
    const interval = value as number;
    try {
      const updated = await civitaiApi.updateSettings({ apiCallInterval: interval });
      setSettings(updated);
    } catch (err) {
      setError('Failed to update interval');
    }
  };

  const handleResetFailed = async () => {
    try {
      const message = await civitaiApi.resetFailed();
      setSuccess(message);
      setTimeout(() => setSuccess(''), 3000);
      loadData();
    } catch (err) {
      setError('Failed to reset failed lookups');
    }
  };

  const handleClearCache = async () => {
    try {
      const message = await civitaiApi.clearModelCache();
      setSuccess(message);
      setClearCacheDialog(false);
      setTimeout(() => setSuccess(''), 3000);
      loadData();
    } catch (err) {
      setError('Failed to clear cache');
    }
  };

  const handleResetStats = async () => {
    try {
      await civitaiApi.resetStats();
      setSuccess('Statistics reset');
      setResetStatsDialog(false);
      setTimeout(() => setSuccess(''), 3000);
      loadData();
    } catch (err) {
      setError('Failed to reset statistics');
    }
  };

  // 재스캔 시작
  const handleStartRescan = async () => {
    try {
      setIsRescanStarting(true);
      setError('');
      const result = await civitaiApi.startRescan();
      setSuccess(`Rescan started: ${result.total} images to process`);
      setTimeout(() => setSuccess(''), 3000);
      // 진행률 폴링 시작
      pollRescanProgress();
    } catch (err: any) {
      if (err.message?.includes('disabled')) {
        setError('Civitai integration is disabled. Please enable it first.');
      } else if (err.message?.includes('in progress')) {
        setError('Rescan is already in progress');
      } else {
        setError(err.message || 'Failed to start rescan');
      }
    } finally {
      setIsRescanStarting(false);
    }
  };

  // 재스캔 진행률 폴링
  const pollRescanProgress = async () => {
    try {
      const progress = await civitaiApi.getRescanProgress();
      setRescanProgress(progress);

      if (progress.isRunning) {
        // 1초 후 다시 폴링
        setTimeout(pollRescanProgress, 1000);
      } else if (progress.total > 0) {
        // 완료
        setSuccess(`Rescan completed: ${progress.added} model references added`);
        setTimeout(() => {
          setSuccess('');
          setRescanProgress(null);
        }, 5000);
        loadData(); // 데이터 새로고침
      }
    } catch (err) {
      console.error('Failed to get rescan progress:', err);
    }
  };

  // 컴포넌트 마운트 시 재스캔 진행 중인지 확인
  useEffect(() => {
    const checkRescanStatus = async () => {
      try {
        const progress = await civitaiApi.getRescanProgress();
        if (progress.isRunning) {
          setRescanProgress(progress);
          pollRescanProgress();
        }
      } catch (err) {
        // 무시
      }
    };
    checkRescanStatus();
  }, []);

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" p={4}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        <CloudSync sx={{ mr: 1, verticalAlign: 'middle' }} />
        {t('civitai.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {t('civitai.description')}
      </Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}

      {/* Main Settings */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>{t('civitai.settings.title')}</Typography>

        <FormControlLabel
          control={
            <Switch
              checked={settings?.enabled ?? false}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
            />
          }
          label={t('civitai.settings.enableIntegration')}
        />
        <Typography variant="body2" color="text.secondary" sx={{ ml: 4, mb: 2 }}>
          {t('civitai.settings.enableDescription')}
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Typography gutterBottom>{t('civitai.settings.apiInterval', { interval: settings?.apiCallInterval ?? 2 })}</Typography>
        <Slider
          value={settings?.apiCallInterval ?? 2}
          onChange={handleIntervalChange}
          min={1}
          max={10}
          step={1}
          marks
          valueLabelDisplay="auto"
          disabled={!settings?.enabled}
          sx={{ maxWidth: 400 }}
        />
        <Typography variant="body2" color="text.secondary">
          {t('civitai.settings.apiIntervalDescription')}
        </Typography>
      </Paper>

      {/* Statistics */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h6">{t('civitai.statistics.title')}</Typography>
          <Button
            size="small"
            startIcon={<Refresh />}
            onClick={loadData}
          >
            {t('civitai.statistics.refresh')}
          </Button>
        </Box>

        {stats && (
          <>
            <Box display="flex" gap={3} mb={2}>
              <Box>
                <Typography variant="h4">{stats.totalLookups}</Typography>
                <Typography variant="body2" color="text.secondary">{t('civitai.statistics.totalLookups')}</Typography>
              </Box>
              <Box>
                <Typography variant="h4" color="success.main">{stats.successfulLookups}</Typography>
                <Typography variant="body2" color="text.secondary">{t('civitai.statistics.successful')}</Typography>
              </Box>
              <Box>
                <Typography variant="h4" color="error.main">{stats.failedLookups}</Typography>
                <Typography variant="body2" color="text.secondary">{t('civitai.statistics.failed')}</Typography>
              </Box>
              <Box>
                <Typography variant="h4">{stats.successRate}%</Typography>
                <Typography variant="body2" color="text.secondary">{t('civitai.statistics.successRate')}</Typography>
              </Box>
            </Box>

            {stats.totalLookups > 0 && (
              <LinearProgress
                variant="determinate"
                value={stats.successRate}
                color={stats.successRate > 80 ? 'success' : stats.successRate > 50 ? 'warning' : 'error'}
                sx={{ height: 8, borderRadius: 4, mb: 2 }}
              />
            )}

            <Typography variant="body2" color="text.secondary">
              {t('civitai.statistics.lastApiCall')}: {stats.lastApiCall ? new Date(stats.lastApiCall).toLocaleString() : t('civitai.statistics.never')}
            </Typography>
          </>
        )}

        <Box display="flex" gap={2} mt={2}>
          <Button
            variant="outlined"
            size="small"
            onClick={handleResetFailed}
          >
            {t('civitai.statistics.recheckFailed')}
          </Button>
          <Button
            variant="outlined"
            color="warning"
            size="small"
            onClick={() => setResetStatsDialog(true)}
          >
            {t('civitai.statistics.resetStats')}
          </Button>
        </Box>
      </Paper>

      {/* Rescan Existing Images */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          <Search sx={{ mr: 1, verticalAlign: 'middle' }} />
          {t('civitai.rescan.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('civitai.rescan.description')}
        </Typography>

        {rescanProgress?.isRunning ? (
          <Box>
            <Box display="flex" justifyContent="space-between" mb={1}>
              <Typography variant="body2">
                {t('civitai.rescan.processing', { processed: rescanProgress.processed, total: rescanProgress.total })}
              </Typography>
              <Typography variant="body2">
                {rescanProgress.percentage}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={rescanProgress.percentage}
              sx={{ height: 8, borderRadius: 4, mb: 1 }}
            />
            <Typography variant="body2" color="text.secondary">
              {t('civitai.rescan.added', { count: rescanProgress.added })}
            </Typography>
          </Box>
        ) : (
          <Button
            variant="contained"
            startIcon={isRescanStarting ? <CircularProgress size={20} color="inherit" /> : <Search />}
            onClick={handleStartRescan}
            disabled={isRescanStarting || !settings?.enabled}
          >
            {isRescanStarting ? t('civitai.rescan.starting') : t('civitai.rescan.startButton')}
          </Button>
        )}

        {!settings?.enabled && (
          <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
            {t('civitai.rescan.enableRequired')}
          </Typography>
        )}
      </Paper>

      {/* Cached Models */}
      <Paper sx={{ p: 3 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h6">{t('civitai.cachedModels.title', { count: models.length })}</Typography>
          <Button
            variant="outlined"
            color="error"
            size="small"
            startIcon={<Delete />}
            onClick={() => setClearCacheDialog(true)}
          >
            {t('civitai.cachedModels.clearCache')}
          </Button>
        </Box>

        {models.length > 0 ? (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{t('civitai.cachedModels.modelName')}</TableCell>
                <TableCell>{t('civitai.cachedModels.type')}</TableCell>
                <TableCell>{t('civitai.cachedModels.hash')}</TableCell>
                <TableCell>{t('civitai.cachedModels.cachedAt')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {models.map((model) => (
                <TableRow key={model.id}>
                  <TableCell>{model.model_name || t('civitai.cachedModels.unknown')}</TableCell>
                  <TableCell>
                    <Chip
                      label={model.model_type || t('civitai.cachedModels.unknown')}
                      size="small"
                      color={model.model_type === 'checkpoint' ? 'primary' : 'secondary'}
                    />
                  </TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>
                    {model.model_hash}
                  </TableCell>
                  <TableCell>
                    {new Date(model.created_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Typography color="text.secondary" align="center" py={3}>
            {t('civitai.cachedModels.empty')}
          </Typography>
        )}
      </Paper>

      {/* Clear Cache Dialog */}
      <Dialog open={clearCacheDialog} onClose={() => setClearCacheDialog(false)}>
        <DialogTitle>{t('civitai.dialogs.clearCache.title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('civitai.dialogs.clearCache.message')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearCacheDialog(false)}>{t('civitai.dialogs.cancel')}</Button>
          <Button onClick={handleClearCache} color="error">{t('civitai.dialogs.clearCache.confirm')}</Button>
        </DialogActions>
      </Dialog>

      {/* Reset Stats Dialog */}
      <Dialog open={resetStatsDialog} onClose={() => setResetStatsDialog(false)}>
        <DialogTitle>{t('civitai.dialogs.resetStats.title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('civitai.dialogs.resetStats.message')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetStatsDialog(false)}>{t('civitai.dialogs.cancel')}</Button>
          <Button onClick={handleResetStats} color="warning">{t('civitai.dialogs.resetStats.confirm')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default CivitaiSettings;
