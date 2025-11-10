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
  Divider
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Clear as ClearIcon,
  PlayArrow as PlayArrowIcon,
  Label as LabelIcon
} from '@mui/icons-material';
import { backgroundQueueApi } from '../../../../services/backgroundQueueApi';
import type { BackgroundQueueStatus } from '../../../../types/folder';

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

  // 상태 조회
  const fetchStatus = async () => {
    try {
      setError(null);
      const [queueData, hashData] = await Promise.all([
        backgroundQueueApi.getQueueStatus(),
        backgroundQueueApi.getHashStats()
      ]);
      setStatus(queueData);
      setHashStats(hashData);
    } catch (err) {
      console.error('Failed to fetch background queue status:', err);
      setError('백그라운드 큐 상태를 불러오는데 실패했습니다');
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

  if (loading) {
    return (
      <Paper sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 200 }}>
          <CircularProgress />
        </Box>
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper sx={{ p: 3 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
        <Button onClick={fetchStatus} variant="outlined">
          다시 시도
        </Button>
      </Paper>
    );
  }

  if (!status) {
    return null;
  }

  return (
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

      {/* 해시 미생성 이미지 처리 */}
      {hashStats && (
        <Box>
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

      {/* 자동 새로고침 안내 */}
      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" color="text.secondary">
          {autoRefresh ? '5초마다 자동으로 업데이트됩니다.' : '자동 업데이트가 비활성화되었습니다.'}
        </Typography>
      </Box>
    </Paper>
  );
};

export default BackgroundStatusMonitor;
