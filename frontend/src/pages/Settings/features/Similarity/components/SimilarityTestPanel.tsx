import React, { useEffect, useState } from 'react';
import {
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  CircularProgress,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Box,
  LinearProgress,
  Chip,
} from '@mui/material';
import {
  Search as SearchIcon,
  Refresh as RefreshIcon,
  CheckCircle as CheckCircleIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../../../../types/image';
import type { SimilarImage, SimilarityStats } from '../../../../../services/similarityApi';
import { similarityApi } from '../../../../../services/similarityApi';
import { SimilarityResultsDisplay } from './SimilarityResultsDisplay';

interface SimilarityTestPanelProps {
  testImageId: string;
  testLoading: boolean;
  testType: 'duplicates' | 'similar' | 'color';
  queryImage: ImageRecord | null;
  testResults: SimilarImage[];
  onSetTestImageId: (id: string) => void;
  onSetTestType: (type: 'duplicates' | 'similar' | 'color') => void;
  onTestSearch: () => void;
}

export const SimilarityTestPanel: React.FC<SimilarityTestPanelProps> = ({
  testImageId,
  testLoading,
  testType,
  queryImage,
  testResults,
  onSetTestImageId,
  onSetTestType,
  onTestSearch,
}) => {
  const { t } = useTranslation('settings');
  const [stats, setStats] = useState<SimilarityStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [rebuildMessage, setRebuildMessage] = useState<string>('');
  const [rebuildSuccess, setRebuildSuccess] = useState<boolean>(false);

  // Load stats on mount
  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setStatsLoading(true);
    try {
      const data = await similarityApi.getStats();
      setStats(data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setStatsLoading(false);
    }
  };

  const handleRebuildHashes = async () => {
    setRebuildLoading(true);
    setRebuildMessage('');
    setRebuildSuccess(false);
    try {
      const result = await similarityApi.rebuildHashes(100);
      setRebuildMessage(t('similarity.test.rebuild.success', {
        processed: result.processed,
        failed: result.failed,
        remaining: result.remaining
      }));
      setRebuildSuccess(true);
      // Reload stats after rebuild
      await loadStats();
    } catch (error: any) {
      setRebuildMessage(t('similarity.test.rebuild.error', {
        error: error.response?.data?.error || error.message
      }));
      setRebuildSuccess(false);
    } finally {
      setRebuildLoading(false);
    }
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {t('similarity.test.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          {t('similarity.test.description')}
        </Typography>

        {/* Hash Generation Stats */}
        {statsLoading ? (
          <Box sx={{ mb: 2 }}>
            <CircularProgress size={20} />
          </Box>
        ) : stats ? (
          <Box sx={{ mb: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="body2" color="text.secondary">
                {t('similarity.test.hashStatus')}:
              </Typography>
              <Chip
                size="small"
                icon={stats.completionPercentage >= 100 ? <CheckCircleIcon /> : <WarningIcon />}
                label={`${stats.imagesWithHash} / ${stats.totalImages} (${stats.completionPercentage.toFixed(1)}%)`}
                color={stats.completionPercentage >= 100 ? 'success' : 'warning'}
              />
            </Stack>
            {stats.completionPercentage < 100 && (
              <LinearProgress
                variant="determinate"
                value={stats.completionPercentage}
                sx={{ mb: 1 }}
              />
            )}
            {stats.imagesWithoutHash > 0 && (
              <Button
                size="small"
                variant="outlined"
                startIcon={rebuildLoading ? <CircularProgress size={16} /> : <RefreshIcon />}
                onClick={handleRebuildHashes}
                disabled={rebuildLoading}
                sx={{ mt: 1 }}
              >
                {rebuildLoading ? t('similarity.test.rebuild.rebuilding') : t('similarity.test.rebuild.button', { count: stats.imagesWithoutHash })}
              </Button>
            )}
            {rebuildMessage && (
              <Alert severity={rebuildSuccess ? 'success' : 'error'} sx={{ mt: 1 }}>
                {rebuildMessage}
              </Alert>
            )}
          </Box>
        ) : null}

        <Stack spacing={2}>
          <Stack direction="row" spacing={2} alignItems="flex-end">
            <TextField
              label={t('similarity.test.imageId')}
              value={testImageId}
              onChange={(e) => onSetTestImageId(e.target.value)}
              type="text"
              placeholder="e.g., a1b2c3d4e5f6... (48-character composite hash)"
              fullWidth
            />
            <FormControl sx={{ minWidth: 150 }}>
              <InputLabel>{t('similarity.test.searchType')}</InputLabel>
              <Select
                value={testType}
                label={t('similarity.test.searchType')}
                onChange={(e) => onSetTestType(e.target.value as any)}
              >
                <MenuItem value="duplicates">{t('similarity.test.types.duplicates')}</MenuItem>
                <MenuItem value="similar">{t('similarity.test.types.similar')}</MenuItem>
                <MenuItem value="color">{t('similarity.test.types.color')}</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              startIcon={testLoading ? <CircularProgress size={20} /> : <SearchIcon />}
              onClick={onTestSearch}
              disabled={testLoading || !testImageId}
              fullWidth
            >
              {testLoading ? t('similarity.test.searching') : t('similarity.test.searchButton')}
            </Button>
          </Stack>

          {/* Results Display */}
          {queryImage && (
            <SimilarityResultsDisplay
              queryImage={queryImage}
              testResults={testResults}
            />
          )}

          {testResults.length === 0 && testImageId && !testLoading && (
            <Alert severity="info">
              {t('similarity.test.noResults')}
            </Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};
