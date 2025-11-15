import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  LinearProgress,
  Alert,
  Chip,
  Divider,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Image as ImageIcon,
} from '@mui/icons-material';
import { thumbnailApi, type ThumbnailRegenerationProgress, type ThumbnailStats } from '../../../services/settingsApi';

interface ThumbnailRegenerationModalProps {
  open: boolean;
  onClose: () => void;
}

const ThumbnailRegenerationModal: React.FC<ThumbnailRegenerationModalProps> = ({ open, onClose }) => {
  const [stats, setStats] = useState<ThumbnailStats | null>(null);
  const [progress, setProgress] = useState<ThumbnailRegenerationProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // 통계 및 진행 상황 로드
  useEffect(() => {
    if (open) {
      loadStats();
      loadProgress();
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [open]);

  // 재생성 중일 때 진행 상황 폴링
  useEffect(() => {
    if (isRegenerating) {
      intervalRef.current = setInterval(async () => {
        await loadProgress();
      }, 1000); // 1초마다 업데이트

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
        }
      };
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }
  }, [isRegenerating]);

  // 진행 상황 확인하여 완료 시 통계 다시 로드
  useEffect(() => {
    if (progress && progress.currentPhase === 'completed') {
      setIsRegenerating(false);
      loadStats();
    } else if (progress && progress.isRunning) {
      setIsRegenerating(true);
    } else if (progress && !progress.isRunning) {
      setIsRegenerating(false);
    }
  }, [progress]);

  const loadStats = async () => {
    try {
      const data = await thumbnailApi.getStats();
      setStats(data);
    } catch (err) {
      console.error('Failed to load thumbnail stats:', err);
      setError('통계를 불러오는데 실패했습니다');
    }
  };

  const loadProgress = async () => {
    try {
      const data = await thumbnailApi.getProgress();
      setProgress(data);
    } catch (err) {
      console.error('Failed to load progress:', err);
    }
  };

  const handleStartRegeneration = async () => {
    setLoading(true);
    setError(null);

    try {
      await thumbnailApi.regenerate();
      setIsRegenerating(true);

      // 즉시 진행 상황 업데이트 시작
      await loadProgress();
    } catch (err: any) {
      console.error('Failed to start thumbnail regeneration:', err);
      if (err.response?.status === 409) {
        setError('썸네일 재생성이 이미 실행 중입니다');
      } else {
        setError('썸네일 재생성 시작에 실패했습니다');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!isRegenerating) {
      onClose();
    }
  };

  // 진행률 계산
  const getProgressPercentage = () => {
    if (!progress || progress.totalFiles === 0) return 0;
    return Math.round((progress.processedFiles / progress.totalFiles) * 100);
  };

  // 단계별 텍스트
  const getPhaseText = (phase: string) => {
    switch (phase) {
      case 'verification':
        return '파일 검증 중...';
      case 'deletion':
        return '기존 썸네일 삭제 중...';
      case 'generation':
        return '썸네일 생성 중...';
      case 'completed':
        return '완료';
      case 'idle':
      default:
        return '대기 중';
    }
  };

  // 소요 시간 계산
  const getElapsedTime = () => {
    if (!progress || !progress.startTime) return '0초';
    const elapsed = Math.floor((Date.now() - progress.startTime) / 1000);
    if (elapsed < 60) return `${elapsed}초`;
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return `${minutes}분 ${seconds}초`;
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <ImageIcon color="primary" />
          <Typography variant="h6">썸네일 재생성</Typography>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {/* 통계 정보 */}
        {stats && !isRegenerating && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle1" gutterBottom fontWeight="bold">
              현재 상태
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                  전체 파일:
                </Typography>
                <Typography variant="body2" fontWeight="medium">
                  {stats.totalFiles.toLocaleString()}개
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                  썸네일 있음:
                </Typography>
                <Typography variant="body2" fontWeight="medium" color="success.main">
                  {stats.withThumbnails.toLocaleString()}개
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                  썸네일 없음:
                </Typography>
                <Typography variant="body2" fontWeight="medium" color="error.main">
                  {stats.withoutThumbnails.toLocaleString()}개
                </Typography>
              </Box>
            </Box>
          </Box>
        )}

        {/* 진행 상황 */}
        {isRegenerating && progress && (
          <Box sx={{ mb: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle1" fontWeight="bold">
                {getPhaseText(progress.currentPhase)}
              </Typography>
              <Chip
                label={progress.currentPhase === 'completed' ? '완료' : '진행 중'}
                color={progress.currentPhase === 'completed' ? 'success' : 'primary'}
                size="small"
              />
            </Box>

            {progress.currentPhase === 'generation' && (
              <>
                <LinearProgress
                  variant="determinate"
                  value={getProgressPercentage()}
                  sx={{ mb: 1, height: 8, borderRadius: 4 }}
                />
                <Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 2 }}>
                  {progress.processedFiles.toLocaleString()} / {progress.totalFiles.toLocaleString()} ({getProgressPercentage()}%)
                </Typography>
              </>
            )}

            <Divider sx={{ my: 2 }} />

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                  삭제된 썸네일:
                </Typography>
                <Typography variant="body2" fontWeight="medium">
                  {progress.deletedThumbnails.toLocaleString()}개
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                  생성된 썸네일:
                </Typography>
                <Typography variant="body2" fontWeight="medium" color="success.main">
                  {progress.generatedThumbnails.toLocaleString()}개
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                  소요 시간:
                </Typography>
                <Typography variant="body2" fontWeight="medium">
                  {getElapsedTime()}
                </Typography>
              </Box>
            </Box>
          </Box>
        )}

        {/* 완료 메시지 */}
        {progress && progress.currentPhase === 'completed' && (
          <Alert severity="success" icon={<CheckCircleIcon />}>
            썸네일 재생성이 완료되었습니다!
          </Alert>
        )}

        {/* 안내 메시지 */}
        {!isRegenerating && (
          <Alert severity="info" sx={{ mt: 2 }}>
            썸네일 재생성은 다음 순서로 진행됩니다:
            <br />
            1. 파일 검증 실행
            <br />
            2. 기존 썸네일 삭제
            <br />
            3. 새 썸네일 생성
            <br />
            <br />
            <strong>주의:</strong> 파일 수에 따라 시간이 오래 걸릴 수 있습니다.
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={isRegenerating}>
          {isRegenerating ? '진행 중...' : '닫기'}
        </Button>
        {!isRegenerating && (
          <Button
            onClick={handleStartRegeneration}
            variant="contained"
            color="primary"
            disabled={loading || isRegenerating}
          >
            {loading ? '시작 중...' : '재생성 시작'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ThumbnailRegenerationModal;
