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

const BackgroundStatusMonitor: React.FC = () => {
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
      setError('백그라운드 작업 상태를 불러오는데 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  // 큐 초기화
  const handleClearQueue = async () => {
    if (!window.confirm('백그라운드 큐를 초기화하시겠습니까? 대기 중인 모든 작업이 취소됩니다.')) {
      return;
    }

    try {
      await backgroundQueueApi.clearQueue();
      await fetchStatus();
    } catch (err) {
      console.error('Failed to clear queue:', err);
      setError('큐 초기화에 실패했습니다');
    }
  };

  // 자동 태깅 수동 트리거
  const handleTriggerAutoTag = async () => {
    try {
      await backgroundQueueApi.triggerAutoTag();
      await fetchStatus();
    } catch (err) {
      console.error('Failed to trigger auto-tag:', err);
      setError('자동 태깅 트리거에 실패했습니다');
    }
  };

  // 해시 재생성 트리거
  const handleRebuildHashes = async () => {
    if (!hashStats || hashStats.imagesWithoutHash === 0) {
      return;
    }

    if (!window.confirm(`${hashStats.imagesWithoutHash}개의 이미지 해시를 생성하시겠습니까?`)) {
      return;
    }

    try {
      setRebuildingHashes(true);
      setError(null);
      const result = await backgroundQueueApi.rebuildHashes();
      await fetchStatus();

      if (result.failed > 0) {
        setError(`해시 생성 완료: 성공 ${result.processed}개, 실패 ${result.failed}개`);
      }
    } catch (err) {
      console.error('Failed to rebuild hashes:', err);
      setError('해시 재생성에 실패했습니다');
    } finally {
      setRebuildingHashes(false);
    }
  };

  // 파일 검증 수동 실행
  const handleTriggerVerification = async () => {
    if (!verificationStats) return;

    const confirmMsg = `총 ${verificationStats.totalFiles}개의 파일을 검증하시겠습니까?\n파일이 많을 경우 시간이 소요될 수 있습니다.`;
    if (!window.confirm(confirmMsg)) {
      return;
    }

    try {
      setVerifying(true);
      setError(null);
      await fileVerificationApi.triggerVerification();
      await fetchStatus();
    } catch (err) {
      console.error('Failed to trigger verification:', err);
      setError('파일 검증 실행에 실패했습니다');
    } finally {
      setVerifying(false);
    }
  };

  // 파일 검증 설정 저장
  const handleSaveVerificationSettings = async () => {
    const interval = parseInt(tempInterval, 10);
    if (isNaN(interval) || interval < 300 || interval > 86400) {
      setError('검증 간격은 300-86400초 사이여야 합니다');
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
      setError('파일 검증 설정 저장에 실패했습니다');
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
    if (!dateString) return '없음';
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
          <Typography variant="h6">백그라운드 작업 모니터링</Typography>
          <Box>
            <IconButton onClick={fetchStatus} size="small" title="새로고침">
              <RefreshIcon />
            </IconButton>
            <IconButton
              onClick={handleClearQueue}
              size="small"
              color="error"
              title="큐 초기화"
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
            백그라운드 큐
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <Chip
              label={`대기 중: ${status.queue.queueLength}개`}
              color={status.queue.queueLength > 0 ? 'primary' : 'default'}
            />
            <Chip
              label={status.queue.processing ? '처리 중' : '대기'}
              color={status.queue.processing ? 'success' : 'default'}
            />
          </Box>

          {/* 작업 타입별 통계 */}
          {status.queue.queueLength > 0 && (
            <List dense>
              <ListItem>
                <ListItemText
                  primary="메타데이터 추출"
                  secondary={`${status.queue.tasksByType.metadata_extraction}개 대기 중`}
                />
                {status.queue.tasksByType.metadata_extraction > 0 && (
                  <CircularProgress size={20} />
                )}
              </ListItem>
              <ListItem>
                <ListItemText
                  primary="프롬프트 수집"
                  secondary={`${status.queue.tasksByType.prompt_collection}개 대기 중`}
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
              자동 태깅 스케줄러
            </Typography>
            <Button
              variant="outlined"
              size="small"
              startIcon={<PlayArrowIcon />}
              onClick={handleTriggerAutoTag}
              disabled={!status.autoTag.isRunning || status.autoTag.untaggedCount === 0}
            >
              수동 실행
            </Button>
          </Box>

          <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <Chip
              label={status.autoTag.isRunning ? '실행 중' : '중지됨'}
              color={status.autoTag.isRunning ? 'success' : 'default'}
              icon={status.autoTag.isRunning ? <CircularProgress size={16} /> : undefined}
            />
            <Chip
              label={`미태깅 이미지: ${status.autoTag.untaggedCount}개`}
              color={status.autoTag.untaggedCount > 0 ? 'warning' : 'default'}
            />
            <Chip
              label={`폴링 간격: ${status.autoTag.pollingIntervalSeconds}초`}
              variant="outlined"
            />
            <Chip
              label={`배치 크기: ${status.autoTag.batchSize}개`}
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
                미디어 해시 상태
              </Typography>
              <Button
                variant="outlined"
                size="small"
                startIcon={rebuildingHashes ? <CircularProgress size={16} /> : <PlayArrowIcon />}
                onClick={handleRebuildHashes}
                disabled={rebuildingHashes || hashStats.imagesWithoutHash === 0}
              >
                해시 생성
              </Button>
            </Box>

            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              <Chip
                label={`전체: ${hashStats.totalImages}개`}
                variant="outlined"
              />
              <Chip
                label={`해시 생성 완료: ${hashStats.imagesWithHash}개`}
                color="success"
              />
              <Chip
                label={`미생성: ${hashStats.imagesWithoutHash}개`}
                color={hashStats.imagesWithoutHash > 0 ? 'warning' : 'default'}
              />
              <Chip
                label={`완료율: ${hashStats.completionPercentage}%`}
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
                파일 검증 상태
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setVerificationLogOpen(true)}
                >
                  로그 보기
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={verifying || verificationProgress?.isRunning ? <CircularProgress size={16} /> : <PlayArrowIcon />}
                  onClick={handleTriggerVerification}
                  disabled={verifying || verificationProgress?.isRunning}
                >
                  검증 실행
                </Button>
              </Box>
            </Box>

            {/* 검증 진행 중 */}
            {verificationProgress?.isRunning && (
              <Alert severity="info" sx={{ mb: 2 }}>
                파일 검증 진행 중: {verificationProgress.checkedFiles}/{verificationProgress.totalFiles}
                ({verificationProgress.progressPercentage}%)
                {verificationProgress.missingFiles > 0 && ` - 누락: ${verificationProgress.missingFiles}개`}
              </Alert>
            )}

            {/* 검증 통계 */}
            <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap' }}>
              <Chip
                label={`전체 파일: ${verificationStats.totalFiles}개`}
                variant="outlined"
              />
              <Chip
                label={`누락 파일: ${verificationStats.missingFiles}개`}
                color={verificationStats.missingFiles > 0 ? 'warning' : 'default'}
              />
              <Chip
                label={`마지막 검증: ${formatDate(verificationStats.lastVerificationDate)}`}
                variant="outlined"
              />
            </Box>

            {/* 검증 설정 */}
            <Box sx={{ mt: 2, p: 2, borderRadius: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 'bold' }}>
                검증 스케줄러 설정
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
                    label={tempEnabled ? '활성화' : '비활성화'}
                  />
                </Box>
                <Box sx={{ flex: 1, minWidth: { xs: '100%', sm: '200px' } }}>
                  <TextField
                    label="검증 간격 (초)"
                    type="number"
                    size="small"
                    fullWidth
                    value={tempInterval}
                    onChange={(e) => setTempInterval(e.target.value)}
                    disabled={!tempEnabled}
                    inputProps={{ min: 300, max: 86400 }}
                    helperText="300-86400초 (5분-24시간)"
                    InputProps={{
                      endAdornment: (
                        <Tooltip title="파일이 많을 경우 시간 소요 및 시스템 부하가 발생할 수 있습니다">
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
                    저장
                  </Button>
                </Box>
              </Stack>
            </Box>
          </Box>
        )}

        {/* 자동 새로고침 안내 */}
        <Box sx={{ mt: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {autoRefresh ? '5초마다 자동으로 업데이트됩니다.' : '자동 업데이트가 비활성화되었습니다.'}
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
