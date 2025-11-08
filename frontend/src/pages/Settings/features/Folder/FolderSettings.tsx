import React, { useState, useEffect } from 'react';
import { Box, Typography, Divider, Paper, TextField, Button, Alert, IconButton, Tooltip } from '@mui/material';
import { InfoOutlined as InfoOutlinedIcon } from '@mui/icons-material';
import axios from 'axios';
import WatchedFoldersList from './components/WatchedFoldersList';
import BackgroundStatusMonitor from './BackgroundStatusMonitor';

const FolderSettings: React.FC = () => {
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
      setError('간격은 5-300초 사이여야 합니다');
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
      setError(err.response?.data?.error || '설정 저장에 실패했습니다');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAutoTagConfig = async () => {
    if (autoTagPollingInterval < 5 || autoTagPollingInterval > 300) {
      setAutoTagError('폴링 간격은 5-300초 사이여야 합니다');
      return;
    }

    if (autoTagBatchSize < 1 || autoTagBatchSize > 100) {
      setAutoTagError('배치 크기는 1-100 사이여야 합니다');
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
      setAutoTagError(err.response?.data?.error || '설정 저장에 실패했습니다');
    } finally {
      setSavingAutoTag(false);
    }
  };

  return (
    <Box>
      <Typography variant="h5" gutterBottom>
        폴더 관리
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
        감시 폴더를 설정하고, 백그라운드 작업 상태를 모니터링합니다.
      </Typography>

      {/* 스케줄러 설정 */}
      <Paper sx={{ p: 3, mb: 4 }}>
        <Typography variant="h6" sx={{ mb: 3 }}>
          스케줄러 설정
        </Typography>

        {/* 백그라운드 해시 감시 간격 */}
        <Box sx={{ mb: 4 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 'medium' }}>
              백그라운드 해시 감시 간격
            </Typography>
            <Tooltip
              title="업로드된 파일의 해시를 생성하는 백그라운드 작업(Phase 2) 실행 간격입니다. 간격이 짧을수록 빠르게 처리되지만 시스템 부하가 증가합니다."
              arrow
            >
              <IconButton size="small">
                <InfoOutlinedIcon fontSize="small" color="action" />
              </IconButton>
            </Tooltip>
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
            <Tooltip title="미처리된 해시 작업을 확인하는 주기입니다. 5-300초 사이로 설정할 수 있습니다." arrow>
              <TextField
                type="number"
                value={phase2Interval}
                onChange={(e) => setPhase2Interval(parseInt(e.target.value) || 30)}
                inputProps={{ min: 5, max: 300 }}
                label="간격 (초)"
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
              {saving ? '저장 중...' : '저장'}
            </Button>
          </Box>
        </Box>

        <Divider sx={{ my: 3 }} />

        {/* 자동 태깅 스케줄러 설정 */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 'medium' }}>
              자동 태깅 스케줄러
            </Typography>
            <Tooltip
              title="자동 태깅 스케줄러의 폴링 간격과 배치 크기를 설정합니다. 폴링 간격이 짧고 배치 크기가 클수록 빠르게 처리되지만 시스템 부하가 증가합니다."
              arrow
            >
              <IconButton size="small">
                <InfoOutlinedIcon fontSize="small" color="action" />
              </IconButton>
            </Tooltip>
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
            <Tooltip title="미태깅 이미지를 확인하는 주기입니다. 5-300초 사이로 설정할 수 있습니다." arrow>
              <TextField
                type="number"
                value={autoTagPollingInterval}
                onChange={(e) => setAutoTagPollingInterval(parseInt(e.target.value) || 30)}
                inputProps={{ min: 5, max: 300 }}
                label="폴링 간격 (초)"
                size="small"
                sx={{ width: 200 }}
              />
            </Tooltip>
            <Tooltip title="한 번에 처리할 이미지 개수입니다. 1-100개 사이로 설정할 수 있습니다." arrow>
              <TextField
                type="number"
                value={autoTagBatchSize}
                onChange={(e) => setAutoTagBatchSize(parseInt(e.target.value) || 10)}
                inputProps={{ min: 1, max: 100 }}
                label="배치 크기 (개)"
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
              {savingAutoTag ? '저장 중...' : '저장'}
            </Button>
          </Box>
        </Box>
      </Paper>

      {/* 백그라운드 작업 모니터링 */}
      <Box sx={{ mb: 4 }}>
        <BackgroundStatusMonitor />
      </Box>

      <Divider sx={{ my: 4 }} />

      {/* 감시 폴더 목록 */}
      <Box>
        <WatchedFoldersList />
      </Box>
    </Box>
  );
};

export default FolderSettings;
