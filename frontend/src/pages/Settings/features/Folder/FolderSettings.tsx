import React, { useState, useEffect } from 'react';
import { Box, Typography, Divider, Paper, TextField, Button, Alert, Tooltip } from '@mui/material';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { InfoTooltip } from '../../../../components/common';
import WatchedFoldersList from './components/WatchedFoldersList';
import BackgroundStatusMonitor from './BackgroundStatusMonitor';

const FolderSettings: React.FC = () => {
  const { t } = useTranslation('settings');
  const [phase2Interval, setPhase2Interval] = useState<number>(30);
  const [autoTagPollingInterval, setAutoTagPollingInterval] = useState<number>(30);
  const [autoTagBatchSize, setAutoTagBatchSize] = useState<number>(10);
  const [saving, setSaving] = useState(false);
  const [savingAutoTag, setSavingAutoTag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [autoTagError, setAutoTagError] = useState<string | null>(null);
  const [autoTagSuccess, setAutoTagSuccess] = useState<string | null>(null);

  useEffect(() => {
    loadPhase2Interval();
    loadAutoTagConfig();
  }, []);

  const loadPhase2Interval = async () => {
    try {
      const response = await axios.get('/api/settings/phase2-interval');
      setPhase2Interval(response.data.data.interval);
    } catch (err) {
      console.error('Failed to load phase2 interval:', err);
    }
  };

  const loadAutoTagConfig = async () => {
    try {
      const response = await axios.get('/api/settings/auto-tag-config');
      setAutoTagPollingInterval(response.data.data.pollingInterval);
      setAutoTagBatchSize(response.data.data.batchSize);
    } catch (err) {
      console.error('Failed to load auto-tag config:', err);
    }
  };

  const handleSaveInterval = async () => {
    if (phase2Interval < 5 || phase2Interval > 300) {
      setError(t('folderSettings.scheduler.backgroundHash.errorRange'));
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await axios.put('/api/settings/phase2-interval', {
        interval: phase2Interval
      });

      setSuccess(response.data.message);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || t('folderSettings.scheduler.backgroundHash.errorSave'));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAutoTagConfig = async () => {
    if (autoTagPollingInterval < 5 || autoTagPollingInterval > 300) {
      setAutoTagError(t('folderSettings.scheduler.autoTagger.errorPollingRange'));
      return;
    }

    if (autoTagBatchSize < 1 || autoTagBatchSize > 100) {
      setAutoTagError(t('folderSettings.scheduler.autoTagger.errorBatchRange'));
      return;
    }

    setSavingAutoTag(true);
    setAutoTagError(null);
    setAutoTagSuccess(null);

    try {
      const response = await axios.put('/api/settings/auto-tag-config', {
        pollingInterval: autoTagPollingInterval,
        batchSize: autoTagBatchSize
      });

      setAutoTagSuccess(response.data.message);
      setTimeout(() => setAutoTagSuccess(null), 3000);
    } catch (err: any) {
      setAutoTagError(err.response?.data?.error || t('folderSettings.scheduler.autoTagger.errorSave'));
    } finally {
      setSavingAutoTag(false);
    }
  };

  return (
    <Box>


      {/* 스케줄러 설정 */}
      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" sx={{ mb: 3 }}>
          {t('folderSettings.scheduler.title')}
        </Typography>

        {/* 백그라운드 해시 감시 간격 */}
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 'medium' }}>
              {t('folderSettings.scheduler.backgroundHash.title')}
            </Typography>
            <InfoTooltip title={t('folderSettings.scheduler.backgroundHash.tooltip')} />
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {success && (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
              {success}
            </Alert>
          )}

          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <Tooltip title={t('folderSettings.scheduler.backgroundHash.intervalTooltip')} arrow>
              <TextField
                type="number"
                value={phase2Interval}
                onChange={(e) => setPhase2Interval(parseInt(e.target.value) || 30)}
                inputProps={{ min: 5, max: 300 }}
                label={t('folderSettings.scheduler.backgroundHash.intervalLabel')}
                size="small"
                sx={{ width: 200 }}
              />
            </Tooltip>
            <Button
              variant="outlined"
              size="small"
              onClick={handleSaveInterval}
              disabled={saving}
            >
              {saving ? t('folderSettings.scheduler.backgroundHash.savingButton') : t('folderSettings.scheduler.backgroundHash.saveButton')}
            </Button>
          </Box>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* 자동 태깅 스케줄러 설정 */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 'medium' }}>
              {t('folderSettings.scheduler.autoTagger.title')}
            </Typography>
            <InfoTooltip title={t('folderSettings.scheduler.autoTagger.tooltip')} />
          </Box>

          {autoTagError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setAutoTagError(null)}>
              {autoTagError}
            </Alert>
          )}

          {autoTagSuccess && (
            <Alert severity="success" sx={{ mb: 2 }} onClose={() => setAutoTagSuccess(null)}>
              {autoTagSuccess}
            </Alert>
          )}

          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
            <Tooltip title={t('folderSettings.scheduler.autoTagger.pollingIntervalTooltip')} arrow>
              <TextField
                type="number"
                value={autoTagPollingInterval}
                onChange={(e) => setAutoTagPollingInterval(parseInt(e.target.value) || 30)}
                inputProps={{ min: 5, max: 300 }}
                label={t('folderSettings.scheduler.autoTagger.pollingIntervalLabel')}
                size="small"
                sx={{ width: 200 }}
              />
            </Tooltip>
            <Tooltip title={t('folderSettings.scheduler.autoTagger.batchSizeTooltip')} arrow>
              <TextField
                type="number"
                value={autoTagBatchSize}
                onChange={(e) => setAutoTagBatchSize(parseInt(e.target.value) || 10)}
                inputProps={{ min: 1, max: 100 }}
                label={t('folderSettings.scheduler.autoTagger.batchSizeLabel')}
                size="small"
                sx={{ width: 200 }}
              />
            </Tooltip>
            <Button
              variant="outlined"
              size="small"
              onClick={handleSaveAutoTagConfig}
              disabled={savingAutoTag}
            >
              {savingAutoTag ? t('folderSettings.scheduler.autoTagger.savingButton') : t('folderSettings.scheduler.autoTagger.saveButton')}
            </Button>
          </Box>
        </Box>
      </Paper>

      {/* 백그라운드 작업 모니터링 */}
      <Box sx={{ mb: 3 }}>
        <BackgroundStatusMonitor />
      </Box>

      <Divider sx={{ my: 3 }} />

      {/* 감시 폴더 목록 */}
      <Box>
        <WatchedFoldersList />
      </Box>
    </Box>
  );
};

export default FolderSettings;
