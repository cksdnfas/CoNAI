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
import { useTranslation } from 'react-i18next';
import { thumbnailApi, type ThumbnailRegenerationProgress, type ThumbnailStats } from '../../../services/settingsApi';

interface ThumbnailRegenerationModalProps {
  open: boolean;
  onClose: () => void;
}

const ThumbnailRegenerationModal: React.FC<ThumbnailRegenerationModalProps> = ({ open, onClose }) => {
  const { t } = useTranslation('settings');
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
      setError(t('thumbnailRegeneration.messages.loadStatsFailed'));
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
        setError(t('thumbnailRegeneration.messages.alreadyRunning'));
      } else {
        setError(t('thumbnailRegeneration.messages.startFailed'));
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
        return t('thumbnailRegeneration.phases.verifying');
      case 'deletion':
        return t('thumbnailRegeneration.phases.deleting');
      case 'generation':
        return t('thumbnailRegeneration.phases.generating');
      case 'completed':
        return t('thumbnailRegeneration.phases.completed');
      case 'idle':
      default:
        return t('thumbnailRegeneration.phases.waiting');
    }
  };

  // 소요 시간 계산
  const getElapsedTime = () => {
    if (!progress || !progress.startTime) return t('thumbnailRegeneration.time.seconds', { elapsed: 0 });
    const elapsed = Math.floor((Date.now() - progress.startTime) / 1000);
    if (elapsed < 60) return t('thumbnailRegeneration.time.seconds', { elapsed });
    const minutes = Math.floor(elapsed / 60);
    const seconds = elapsed % 60;
    return t('thumbnailRegeneration.time.minutesSeconds', { minutes, seconds });
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" gap={1}>
          <ImageIcon color="primary" />
          <Typography variant="h6">{t('thumbnailRegeneration.title')}</Typography>
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
              {t('thumbnailRegeneration.sections.currentStatus')}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                  {t('thumbnailRegeneration.stats.totalFiles')}
                </Typography>
                <Typography variant="body2" fontWeight="medium">
                  {stats.totalFiles.toLocaleString()}개
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                  {t('thumbnailRegeneration.stats.withThumbnail')}
                </Typography>
                <Typography variant="body2" fontWeight="medium" color="success.main">
                  {stats.withThumbnails.toLocaleString()}개
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                  {t('thumbnailRegeneration.stats.withoutThumbnail')}
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
                label={progress.currentPhase === 'completed' ? t('thumbnailRegeneration.status.completed') : t('thumbnailRegeneration.status.inProgress')}
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
                  {t('thumbnailRegeneration.progress.deletedThumbnails')}
                </Typography>
                <Typography variant="body2" fontWeight="medium">
                  {progress.deletedThumbnails.toLocaleString()}개
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                  {t('thumbnailRegeneration.progress.generatedThumbnails')}
                </Typography>
                <Typography variant="body2" fontWeight="medium" color="success.main">
                  {progress.generatedThumbnails.toLocaleString()}개
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="body2" color="text.secondary">
                  {t('thumbnailRegeneration.progress.elapsedTime')}
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
            {t('thumbnailRegeneration.messages.success')}
          </Alert>
        )}

        {/* 안내 메시지 */}
        {!isRegenerating && (
          <Alert severity="info" sx={{ mt: 2 }}>
            {t('thumbnailRegeneration.instructions.title')}
            <br />
            {t('thumbnailRegeneration.instructions.step1')}
            <br />
            {t('thumbnailRegeneration.instructions.step2')}
            <br />
            {t('thumbnailRegeneration.instructions.step3')}
            <br />
            <br />
            <strong>{t('thumbnailRegeneration.instructions.warning')}</strong> {t('thumbnailRegeneration.instructions.warningText')}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={isRegenerating}>
          {isRegenerating ? t('thumbnailRegeneration.buttons.inProgress') : t('thumbnailRegeneration.buttons.close')}
        </Button>
        {!isRegenerating && (
          <Button
            onClick={handleStartRegeneration}
            variant="contained"
            color="primary"
            disabled={loading || isRegenerating}
          >
            {loading ? t('thumbnailRegeneration.buttons.starting') : t('thumbnailRegeneration.buttons.start')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ThumbnailRegenerationModal;
