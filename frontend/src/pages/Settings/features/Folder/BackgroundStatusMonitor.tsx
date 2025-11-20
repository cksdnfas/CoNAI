import React, { useState, useEffect } from 'react';
import {
  Paper,
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  Chip,
  IconButton,
  CircularProgress,
  Button,
  Alert,
  Divider,
  TextField,
  Switch,
  FormControlLabel,
  Tooltip,
  Stack,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Clear as ClearIcon,
  PlayArrow as PlayArrowIcon,
  Label as LabelIcon,
  CheckCircle as CheckCircleIcon,
  Info as InfoIcon,
} from '@mui/icons-material';
import { backgroundQueueApi } from '../../../../services/backgroundQueueApi';
import { fileVerificationApi } from '../../../../services/fileVerificationApi';
import type { BackgroundQueueStatus } from '../../../../types/folder';
import FileVerificationLogModal from './components/FileVerificationLogModal';
import { useTranslation } from 'react-i18next';

const BackgroundStatusMonitor: React.FC = () => {
  const { t } = useTranslation('settings');
  const [status, setStatus] = useState<BackgroundQueueStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh] = useState(true);
  const [hashStats, setHashStats] = useState<{
    totalImages: number;
    imagesWithoutHash: number;
    imagesWithHash: number;
    completionPercentage: number;
  } | null>(null);
  const [rebuildingHashes, setRebuildingHashes] = useState(false);

  // 파일 검증 상태
  const [verificationStats, setVerificationStats] = useState<any>(null);
  const [verificationProgress, setVerificationProgress] = useState<any>(null);
  const [verificationSettings, setVerificationSettings] = useState<any>(null);
  const [verificationLogOpen, setVerificationLogOpen] = useState(false);
  const [verifying, setVerifying] = useState(false);

  // 임시 설정 값
  const [tempInterval, setTempInterval] = useState<string>('3600');
  const [tempEnabled, setTempEnabled] = useState<boolean>(false);

  // 상태 조회
  const fetchStatus = async () => {
    try {
      setError(null);
      const [queueData, hashData, verifyStats, verifyProgress, verifySettings] = await Promise.all([
        backgroundQueueApi.getQueueStatus(),
        backgroundQueueApi.getHashStats(),
        fileVerificationApi.getStats(),
        fileVerificationApi.getProgress(),
        fileVerificationApi.getSettings(),
      ]);
      setStatus(queueData);
      setHashStats(hashData);
      setVerificationStats(verifyStats);
      setVerificationProgress(verifyProgress);
      setVerificationSettings(verifySettings);
      if (verifySettings) {
        setTempEnabled(verifySettings.enabled ?? false);
        setTempInterval(verifySettings.interval?.toString() ?? '3600');
      }
    } catch (err) {
      console.error('Failed to fetch background queue status:', err);
      setError(t('background.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  // 큐 초기화
  const handleClearQueue = async () => {
    if (!window.confirm(t('background.confirmReset'))) {
      return;
    }

    try {
      await backgroundQueueApi.clearQueue();
      await fetchStatus();
    } catch (err) {
      console.error('Failed to clear queue:', err);
      setError(t('background.resetFailed'));
    }
  };

  // 자동 태깅 수동 트리거
  const handleTriggerAutoTag = async () => {
    try {
      await backgroundQueueApi.triggerAutoTag();
      await fetchStatus();
    } catch (err) {
      console.error('Failed to trigger auto-tag:', err);
      setError(t('background.autoTagFailed'));
    }
  };

  // 해시 재생성 트리거
  const handleRebuildHashes = async () => {
    if (!hashStats || hashStats.imagesWithoutHash === 0) {
      return;
    }

    if (!window.confirm(t('background.confirmHashGen', { count: hashStats.imagesWithoutHash }))) {
      return;
    }

    try {
      setRebuildingHashes(true);
      setError(null);
      const result = await backgroundQueueApi.rebuildHashes();
      await fetchStatus();

      if (result.failed > 0) {
        setError(t('background.hashGenComplete', { processed: result.processed, failed: result.failed }));
      }
    } catch (err) {
      console.error('Failed to rebuild hashes:', err);
      setError(t('background.hashGenFailed'));
    } finally {
      setRebuildingHashes(false);
    }
  };

  // 파일 검증 수동 실행
  const handleTriggerVerification = async () => {
    if (!verificationStats) return;

    if (!window.confirm(t('background.confirmVerify', { count: verificationStats.totalFiles }))) {
      return;
    }

    try {
      setVerifying(true);
      setError(null);
      await fileVerificationApi.triggerVerification();
      await fetchStatus();
    } catch (err) {
      console.error('Failed to trigger verification:', err);
      setError(t('background.verifyFailed'));
    } finally {
      setVerifying(false);
    }
  };

  // 파일 검증 설정 저장
  const handleSaveVerificationSettings = async () => {
    const interval = parseInt(tempInterval, 10);
    if (isNaN(interval) || interval < 300 || interval > 86400) {
      setError(t('background.verifyIntervalError'));
      return;
    }

    try {
      setError(null);
      await fileVerificationApi.updateSettings({
        enabled: tempEnabled,
        interval,
      });
      await fetchStatus();
    } catch (err) {
      console.error('Failed to update verification settings:', err);
      setError(t('background.verifySaveFailed'));
    }
  };

  // 초기 로드
  useEffect(() => {
    fetchStatus();
  }, []);

  // 자동 새로고침 (5초마다)
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [autoRefresh]);

  // 날짜 포맷팅
  const formatDate = (dateString: string | null) => {
    if (!dateString) return t('common.none');
    const date = new Date(dateString);
    return date.toLocaleString('ko-KR', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
          <CircularProgress />
        </Box>
      </Paper>
    );
  }

  if (!status) {
    return null;
  }

  return (
    <>
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
          <Typography variant="h6">{t('background.title')}</Typography>
          <Box>
            <IconButton onClick={fetchStatus} size="small" title={t('common.refresh')}>
              <RefreshIcon />
            </IconButton>
            <IconButton
              onClick={handleClearQueue}
              size="small"
              color="error"
              title={t('background.resetQueue')}
              disabled={status.queue.queueLength === 0}
            >
              <ClearIcon />
            </IconButton>
          </Box>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* 백그라운드 큐 상태 */}
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" sx={{ mb: 2, fontWeight: 'bold' }}>
            {t('background.queue.title')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <Chip
              label={t('background.queue.pending', { count: status.queue.queueLength })}
              color={status.queue.queueLength > 0 ? 'primary' : 'default'}
            />
            <Chip
              label={status.queue.processing ? t('background.queue.processing') : t('background.queue.waiting')}
              color={status.queue.processing ? 'success' : 'default'}
            />
          </Box>

          {/* 작업 타입별 통계 */}
          {status.queue.queueLength > 0 && (
            <List dense>
              <ListItem>
                <ListItemText
                  primary={t('background.tasks.metadata')}
                  secondary={t('background.tasks.pendingCount', { count: status.queue.tasksByType.metadata_extraction })}
                />
                {status.queue.tasksByType.metadata_extraction > 0 && (
                  <CircularProgress size={20} />
                )}
              </ListItem>
              <ListItem>
                <ListItemText
                  primary={t('background.tasks.promptCollection')}
                  secondary={t('background.tasks.pendingCount', { count: status.queue.tasksByType.prompt_collection })}
                />
                {status.queue.tasksByType.prompt_collection > 0 && (
                  <CircularProgress size={20} />
                )}
              </ListItem>
            </List>
          )}
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* 자동 태깅 스케줄러 상태 */}
        <Box sx={{ mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
              <LabelIcon fontSize="small" />
              {t('background.autoTag.title')}
            </Typography>
            <Button
              variant="outlined"
              size="small"
              startIcon={<PlayArrowIcon />}
              onClick={handleTriggerAutoTag}
              disabled={!status.autoTag.isRunning || status.autoTag.untaggedCount === 0}
            >
              {t('background.autoTag.manualTrigger')}
            </Button>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <Chip
              label={status.autoTag.isRunning ? t('background.autoTag.running') : t('background.autoTag.stopped')}
              color={status.autoTag.isRunning ? 'success' : 'default'}
              icon={status.autoTag.isRunning ? <CircularProgress size={16} /> : undefined}
            />
            <Chip
              label={t('background.autoTag.untaggedCount', { count: status.autoTag.untaggedCount })}
              color={status.autoTag.untaggedCount > 0 ? 'warning' : 'default'}
            />
            <Chip
              label={t('background.autoTag.pollingInterval', { seconds: status.autoTag.pollingIntervalSeconds })}
              variant="outlined"
            />
            <Chip
              label={t('background.autoTag.batchSize', { size: status.autoTag.batchSize })}
              variant="outlined"
            />
          </Box>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* 해시 생성 상태 */}
        {hashStats && (
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold' }}>
                {t('background.hash.title')}
              </Typography>
              <Button
                variant="outlined"
                size="small"
                startIcon={rebuildingHashes ? <CircularProgress size={16} /> : <PlayArrowIcon />}
                onClick={handleRebuildHashes}
                disabled={rebuildingHashes || hashStats.imagesWithoutHash === 0}
              >
                {t('background.hash.generate')}
              </Button>
            </Box>

            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Chip
                label={t('background.hash.total', { count: hashStats.totalImages })}
                variant="outlined"
              />
              <Chip
                label={t('background.hash.completed', { count: hashStats.imagesWithHash })}
                color="success"
              />
              <Chip
                label={t('background.hash.pending', { count: hashStats.imagesWithoutHash })}
                color={hashStats.imagesWithoutHash > 0 ? 'warning' : 'default'}
              />
              <Chip
                label={t('background.hash.completion', { percent: hashStats.completionPercentage })}
                color={hashStats.completionPercentage === 100 ? 'success' : 'default'}
              />
            </Box>
          </Box>
        )}

        <Divider sx={{ my: 3 }} />

        {/* 파일 검증 상태 (NEW) */}
        {verificationStats && verificationSettings && (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: 1 }}>
                <CheckCircleIcon fontSize="small" />
                {t('background.verify.title')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setVerificationLogOpen(true)}
                >
                  {t('background.verify.viewLogs')}
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={verifying || verificationProgress?.isRunning ? <CircularProgress size={16} /> : <PlayArrowIcon />}
                  onClick={handleTriggerVerification}
                  disabled={verifying || verificationProgress?.isRunning}
                >
                  {t('background.verify.run')}
                </Button>
              </Box>
            </Box>

            {/* 검증 진행 중 */}
            {verificationProgress?.isRunning && (
              <Alert severity="info" sx={{ mb: 2 }}>
                {t('background.verify.progress', { checked: verificationProgress.checkedFiles, total: verificationProgress.totalFiles })}
                {verificationProgress.missingFiles > 0 && ` - ${t('background.verify.missing', { count: verificationProgress.missingFiles })}`}
              </Alert>
            )}

            {/* 검증 통계 */}
            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
              <Chip
                label={t('background.verify.totalFiles', { count: verificationStats.totalFiles })}
                variant="outlined"
              />
              <Chip
                label={t('background.verify.missingFiles', { count: verificationStats.missingFiles })}
                color={verificationStats.missingFiles > 0 ? 'warning' : 'default'}
              />
              <Chip
                label={t('background.verify.lastVerification', { date: formatDate(verificationStats.lastVerificationDate) })}
                variant="outlined"
              />
            </Box>

            {/* 검증 설정 */}
            <Box sx={{ mt: 2, p: 2, borderRadius: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
                {t('background.verify.schedulerTitle')}
              </Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="center">
                <Box sx={{ minWidth: { xs: '100%', sm: '150px' } }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={tempEnabled}
                        onChange={(e) => setTempEnabled(e.target.checked)}
                      />
                    }
                    label={tempEnabled ? t('common.enabled') : t('common.disabled')}
                  />
                </Box>
                <Box sx={{ flex: 1, minWidth: { xs: '100%', sm: '200px' } }}>
                  <TextField
                    label={t('background.verify.intervalLabel')}
                    type="number"
                    size="small"
                    fullWidth
                    value={tempInterval}
                    onChange={(e) => setTempInterval(e.target.value)}
                    disabled={!tempEnabled}
                    inputProps={{ min: 300, max: 86400 }}
                    helperText={t('background.verify.intervalHelper')}
                    InputProps={{
                      endAdornment: (
                        <Tooltip title={t('background.verify.intervalTooltip')}>
                          <InfoIcon fontSize="small" color="action" />
                        </Tooltip>
                      ),
                    }}
                  />
                </Box>
                <Box sx={{ minWidth: { xs: '100%', sm: '100px' } }}>
                  <Button
                    variant="contained"
                    size="small"
                    fullWidth
                    onClick={handleSaveVerificationSettings}
                    disabled={
                      !verificationSettings ||
                      (tempEnabled === verificationSettings.enabled &&
                       tempInterval === verificationSettings.interval.toString())
                    }
                  >
                    {t('common.save')}
                  </Button>
                </Box>
              </Stack>
            </Box>
          </Box>
        )}

        {/* 자동 새로고침 안내 */}
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {autoRefresh ? t('background.autoUpdate') : t('background.autoUpdateDisabled')}
          </Typography>
        </Box>
      </Paper>

      {/* 파일 검증 로그 모달 */}
      <FileVerificationLogModal
        open={verificationLogOpen}
        onClose={() => setVerificationLogOpen(false)}
      />
    </>
  );
};

export default BackgroundStatusMonitor;
