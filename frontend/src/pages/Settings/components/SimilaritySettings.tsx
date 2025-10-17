import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Chip,
  Stack,
  Slider,
  LinearProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Switch,
  FormControlLabel,
} from '@mui/material';
import {
  Search as SearchIcon,
  Refresh as RefreshIcon,
  FindInPage as FindInPageIcon,
  ContentCopy as ContentCopyIcon,
  CheckCircle as CheckCircleIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import {
  similarityApi,
  type SimilarImage,
  type DuplicateGroup,
  type SimilarityStats,
} from '../../../services/similarityApi';
import { imageApi } from '../../../services/api';
import { buildUploadsUrl } from '../../../utils/backend';
import type { ImageRecord } from '../../../types/image';
import { settingsApi } from '../../../services/settingsApi';
import { useTranslation } from 'react-i18next';

const SimilaritySettings: React.FC = () => {
  const { t } = useTranslation('settings');

  // 상태 관리
  const [stats, setStats] = useState<SimilarityStats | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuildProgress, setRebuildProgress] = useState(0);
  const [rebuildProcessed, setRebuildProcessed] = useState(0);
  const [rebuildTotal, setRebuildTotal] = useState(0);

  // 설정
  const [autoGenerateHash, setAutoGenerateHash] = useState(true);

  // 테스트 섹션
  const [testImageId, setTestImageId] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResults, setTestResults] = useState<SimilarImage[]>([]);
  const [testType, setTestType] = useState<'duplicates' | 'similar' | 'color'>('similar');
  const [queryImage, setQueryImage] = useState<ImageRecord | null>(null);

  // 전체 중복 스캔
  const [duplicateGroups, setDuplicateGroups] = useState<DuplicateGroup[]>([]);
  const [scanLoading, setScanLoading] = useState(false);

  // 설정 값
  const [duplicateThreshold, setDuplicateThreshold] = useState(5);
  const [similarThreshold, setSimilarThreshold] = useState(15);
  const [colorThreshold, setColorThreshold] = useState(85);
  const [searchLimit, setSearchLimit] = useState(20);

  useEffect(() => {
    loadStats();
    loadSettings();
  }, []);

  const loadStats = async () => {
    try {
      const loadedStats = await similarityApi.getStats();
      setStats(loadedStats);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const loadSettings = async () => {
    try {
      const loadedSettings = await settingsApi.getSettings();
      setAutoGenerateHash(loadedSettings.similarity.autoGenerateHashOnUpload);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleAutoGenerateHashChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = event.target.checked;
    setAutoGenerateHash(newValue);

    try {
      await settingsApi.updateSimilaritySettings({ autoGenerateHashOnUpload: newValue });
    } catch (error) {
      console.error('Failed to update similarity settings:', error);
      alert(t('similarity.systemStatus.autoGenerateUpdateFailed'));
      // 실패 시 원래 값으로 복원
      setAutoGenerateHash(!newValue);
    }
  };

  const handleRebuildHashes = async () => {
    setRebuilding(true);
    setRebuildProgress(0);
    setRebuildProcessed(0);
    setRebuildTotal(0);

    try {
      // 먼저 총 개수 조회
      const initialStats = await similarityApi.getStats();
      const totalToProcess = initialStats.imagesWithoutHash;
      setRebuildTotal(totalToProcess);

      if (totalToProcess === 0) {
        alert(t('similarity.systemStatus.noImagesToProcess'));
        return;
      }

      let totalProcessed = 0;
      let totalFailed = 0;
      const batchSize = 50; // 한 번에 50개씩 처리

      // 배치 단위로 반복 처리
      while (totalProcessed < totalToProcess) {
        const result = await similarityApi.rebuildHashes(batchSize);

        totalProcessed += result.processed;
        totalFailed += result.failed;

        // 진행률 업데이트
        setRebuildProcessed(totalProcessed);
        setRebuildProgress((totalProcessed / totalToProcess) * 100);

        // 더 이상 처리할 이미지가 없으면 종료
        if (result.remaining === 0) {
          break;
        }
      }

      // 완료 메시지
      if (totalFailed > 0) {
        alert(t('similarity.systemStatus.rebuildCompleteWithErrors', { success: totalProcessed, failed: totalFailed }));
      } else {
        alert(t('similarity.systemStatus.rebuildComplete', { processed: totalProcessed }));
      }

      await loadStats();
    } catch (error) {
      alert(t('similarity.systemStatus.rebuildFailed'));
      console.error('Failed to rebuild hashes:', error);
    } finally {
      setRebuilding(false);
    }
  };

  const handleTestSearch = async () => {
    const imageId = parseInt(testImageId);
    if (isNaN(imageId) || imageId <= 0) {
      alert(t('tagger.test.invalidId'));
      return;
    }

    setTestLoading(true);
    setTestResults([]);
    setQueryImage(null);
    try {
      // 원본 이미지 정보 가져오기
      const imageResponse = await imageApi.getImage(imageId);
      if (imageResponse.success && imageResponse.data) {
        setQueryImage(imageResponse.data);
      }

      let results: SimilarImage[] = [];

      if (testType === 'duplicates') {
        results = await similarityApi.findDuplicates(imageId, duplicateThreshold);
      } else if (testType === 'similar') {
        results = await similarityApi.findSimilar(imageId, {
          threshold: similarThreshold,
          limit: searchLimit,
          includeColorSimilarity: true,
        });
      } else if (testType === 'color') {
        results = await similarityApi.findSimilarByColor(imageId, colorThreshold, searchLimit);
      }

      setTestResults(results);
    } catch (error: any) {
      alert(error.response?.data?.error || t('similarity.test.searchFailed'));
      console.error('Failed to search:', error);
    } finally {
      setTestLoading(false);
    }
  };

  const handleScanDuplicates = async () => {
    setScanLoading(true);
    setDuplicateGroups([]);
    try {
      const groups = await similarityApi.findAllDuplicates({
        threshold: duplicateThreshold,
        minGroupSize: 2,
      });
      setDuplicateGroups(groups);
    } catch (error) {
      alert(t('similarity.test.searchFailed'));
      console.error('Failed to scan duplicates:', error);
    } finally {
      setScanLoading(false);
    }
  };

  const getThumbnailUrl = (image: ImageRecord): string => {
    return buildUploadsUrl(image.thumbnail_url || image.file_path);
  };

  const getMatchTypeColor = (matchType: string): 'error' | 'warning' | 'info' | 'success' => {
    switch (matchType) {
      case 'exact': return 'error';
      case 'near-duplicate': return 'warning';
      case 'similar': return 'info';
      case 'color-similar': return 'success';
      default: return 'info';
    }
  };

  const getMatchTypeLabel = (matchType: string): string => {
    switch (matchType) {
      case 'exact': return t('similarity.test.matchTypes.exact');
      case 'near-duplicate': return t('similarity.test.matchTypes.nearDuplicate');
      case 'similar': return t('similarity.test.matchTypes.similar');
      case 'color-similar': return t('similarity.test.matchTypes.colorSimilar');
      default: return t('similarity.test.matchTypes.similar');
    }
  };

  return (
    <Box>
      {/* 시스템 상태 */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t('similarity.systemStatus.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            {t('similarity.systemStatus.description')}
          </Typography>

          {stats ? (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Chip
                  label={t('similarity.systemStatus.totalImages', { count: stats.totalImages })}
                  color="primary"
                  variant="outlined"
                />
                <Chip
                  label={t('similarity.systemStatus.withHash', { count: stats.imagesWithHash })}
                  color="success"
                  icon={<CheckCircleIcon />}
                />
                <Chip
                  label={t('similarity.systemStatus.withoutHash', { count: stats.imagesWithoutHash })}
                  color="warning"
                />
                <Chip
                  label={t('similarity.systemStatus.completion', { percent: stats.completionPercentage })}
                  color={stats.completionPercentage === 100 ? 'success' : 'info'}
                />
              </Stack>

              {rebuilding && (
                <Box>
                  <Typography variant="body2" gutterBottom>
                    {t('similarity.systemStatus.rebuildProgress', {
                      processed: rebuildProcessed,
                      total: rebuildTotal,
                      percent: rebuildProgress.toFixed(0)
                    })}
                  </Typography>
                  <LinearProgress variant="determinate" value={rebuildProgress} />
                </Box>
              )}

              <FormControlLabel
                control={
                  <Switch
                    checked={autoGenerateHash}
                    onChange={handleAutoGenerateHashChange}
                    color="primary"
                  />
                }
                label={t('similarity.systemStatus.autoGenerateHash')}
              />

              <Stack direction="row" spacing={2}>
                <Button
                  variant="contained"
                  startIcon={rebuilding ? <CircularProgress size={20} /> : <RefreshIcon />}
                  onClick={handleRebuildHashes}
                  disabled={rebuilding || stats.imagesWithoutHash === 0}
                >
                  {rebuilding ? t('similarity.systemStatus.rebuildingButton') : t('similarity.systemStatus.rebuildButton', { count: stats.imagesWithoutHash })}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={loadStats}
                >
                  {t('similarity.systemStatus.refreshButton')}
                </Button>
              </Stack>

              {stats.imagesWithoutHash === 0 && (
                <Alert severity="success">
                  {t('similarity.systemStatus.allComplete')}
                </Alert>
              )}
            </Stack>
          ) : (
            <CircularProgress />
          )}
        </CardContent>
      </Card>

      <Divider sx={{ my: 3 }} />

      {/* 테스트 & 미리보기 */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t('similarity.test.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            {t('similarity.test.description')}
          </Typography>

          <Stack spacing={2}>
            <Stack direction="row" spacing={2} alignItems="flex-end">
              <TextField
                label={t('similarity.test.imageId')}
                value={testImageId}
                onChange={(e) => setTestImageId(e.target.value)}
                type="number"
                placeholder={t('similarity.test.placeholder')}
                fullWidth
              />
              <FormControl sx={{ minWidth: 150 }}>
                <InputLabel>{t('similarity.test.searchType')}</InputLabel>
                <Select
                  value={testType}
                  label={t('similarity.test.searchType')}
                  onChange={(e) => setTestType(e.target.value as any)}
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
                onClick={handleTestSearch}
                disabled={testLoading || !testImageId}
                fullWidth
              >
                {testLoading ? t('similarity.test.searching') : t('similarity.test.searchButton')}
              </Button>
            </Stack>

            {/* 검색 원본 이미지 */}
            {queryImage && (
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  {t('similarity.test.queryImage')}
                </Typography>
                <Card variant="outlined" sx={{ maxWidth: 400, mx: 'auto' }}>
                  <Box
                    component="img"
                    src={getThumbnailUrl(queryImage)}
                    alt={queryImage.filename}
                    sx={{
                      width: '100%',
                      maxHeight: 300,
                      objectFit: 'contain',
                      bgcolor: 'grey.100',
                    }}
                  />
                  <CardContent>
                    <Typography variant="body2">
                      <strong>{t('similarity.test.imageDetails.id')}</strong> {queryImage.id}
                    </Typography>
                    <Typography variant="body2" noWrap>
                      <strong>{t('similarity.test.imageDetails.filename')}</strong> {queryImage.filename}
                    </Typography>
                    <Typography variant="body2">
                      <strong>{t('similarity.test.imageDetails.size')}</strong> {queryImage.width} × {queryImage.height}
                    </Typography>
                    {queryImage.ai_tool && (
                      <Typography variant="body2">
                        <strong>{t('similarity.test.imageDetails.aiTool')}</strong> {queryImage.ai_tool}
                      </Typography>
                    )}
                  </CardContent>
                </Card>
              </Box>
            )}

            {/* 검색 결과 */}
            {testResults.length > 0 && (
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  {t('similarity.test.results', { count: testResults.length })}
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)' }, gap: 2 }}>
                  {testResults.slice(0, 12).map((result) => (
                    <Box key={result.image.id}>
                      <Card variant="outlined">
                        <Box
                          component="img"
                          src={getThumbnailUrl(result.image)}
                          alt={result.image.filename}
                          sx={{
                            width: '100%',
                            height: 150,
                            objectFit: 'cover',
                          }}
                        />
                        <CardContent sx={{ p: 1 }}>
                          <Typography variant="caption" display="block" noWrap>
                            ID: {result.image.id}
                          </Typography>
                          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                            <Chip
                              label={t('similarity.test.similarity', { percent: result.similarity.toFixed(1) })}
                              size="small"
                              color="primary"
                            />
                            <Chip
                              label={getMatchTypeLabel(result.matchType)}
                              size="small"
                              color={getMatchTypeColor(result.matchType)}
                            />
                          </Stack>
                          {result.colorSimilarity && (
                            <Typography variant="caption" color="text.secondary">
                              {t('similarity.test.colorSimilarity', { percent: result.colorSimilarity.toFixed(1) })}
                            </Typography>
                          )}
                        </CardContent>
                      </Card>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            {testResults.length === 0 && testImageId && !testLoading && (
              <Alert severity="info">
                {t('similarity.test.noResults')}
              </Alert>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Divider sx={{ my: 3 }} />

      {/* 전체 중복 분석 */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t('similarity.duplicateScan.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            {t('similarity.duplicateScan.description')}
          </Typography>

          <Stack spacing={2}>
            <Button
              variant="contained"
              color="secondary"
              startIcon={scanLoading ? <CircularProgress size={20} /> : <FindInPageIcon />}
              onClick={handleScanDuplicates}
              disabled={scanLoading}
            >
              {scanLoading ? t('similarity.duplicateScan.scanning') : t('similarity.duplicateScan.scanButton')}
            </Button>

            {duplicateGroups.length > 0 && (
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  {t('similarity.duplicateScan.foundGroups', { count: duplicateGroups.length })}
                </Typography>
                {duplicateGroups.map((group) => (
                  <Accordion key={group.groupId}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Stack direction="row" spacing={2} alignItems="center">
                        <ContentCopyIcon color="warning" />
                        <Typography>
                          {t('similarity.duplicateScan.groupLabel', { id: group.groupId, count: group.images.length })}
                        </Typography>
                        <Chip
                          label={t('similarity.duplicateScan.similarityLabel', { percent: group.similarity.toFixed(1) })}
                          size="small"
                          color="warning"
                        />
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(5, 1fr)' }, gap: 1 }}>
                        {group.images.slice(0, 5).map((image) => (
                          <Box key={image.id}>
                            <Box
                              component="img"
                              src={getThumbnailUrl(image)}
                              alt={image.filename}
                              sx={{
                                width: '100%',
                                height: 100,
                                objectFit: 'cover',
                                borderRadius: 1,
                              }}
                            />
                            <Typography variant="caption" display="block" align="center">
                              {t('similarity.duplicateScan.id', { id: image.id })}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                      {group.images.length > 5 && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                          {t('similarity.duplicateScan.moreImages', { count: group.images.length - 5 })}
                        </Typography>
                      )}
                    </AccordionDetails>
                  </Accordion>
                ))}
              </Box>
            )}

            {duplicateGroups.length === 0 && !scanLoading && (
              <Alert severity="info">
                {t('similarity.duplicateScan.noResults')}
              </Alert>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Divider sx={{ my: 3 }} />

      {/* 임계값 설정 */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t('similarity.thresholds.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            {t('similarity.thresholds.description')}
          </Typography>

          <Stack spacing={3}>
            {/* 중복 검색 임계값 */}
            <Box>
              <Typography gutterBottom>
                {t('similarity.thresholds.duplicate.label', { value: duplicateThreshold })}
              </Typography>
              <Slider
                value={duplicateThreshold}
                onChange={(_, value) => setDuplicateThreshold(value as number)}
                min={0}
                max={10}
                step={1}
                marks={[
                  { value: 0, label: t('similarity.thresholds.duplicate.strict') },
                  { value: 5, label: t('similarity.thresholds.duplicate.recommended') },
                  { value: 10, label: t('similarity.thresholds.duplicate.lenient') },
                ]}
              />
              <Typography variant="caption" color="text.secondary">
                {t('similarity.thresholds.duplicate.description')}
              </Typography>
            </Box>

            {/* 유사 검색 임계값 */}
            <Box>
              <Typography gutterBottom>
                {t('similarity.thresholds.similar.label', { value: similarThreshold })}
              </Typography>
              <Slider
                value={similarThreshold}
                onChange={(_, value) => setSimilarThreshold(value as number)}
                min={5}
                max={25}
                step={1}
                marks={[
                  { value: 5, label: t('similarity.thresholds.similar.strict') },
                  { value: 15, label: t('similarity.thresholds.similar.recommended') },
                  { value: 25, label: t('similarity.thresholds.similar.lenient') },
                ]}
              />
              <Typography variant="caption" color="text.secondary">
                {t('similarity.thresholds.similar.description')}
              </Typography>
            </Box>

            {/* 색상 유사도 임계값 */}
            <Box>
              <Typography gutterBottom>
                {t('similarity.thresholds.color.label', { value: colorThreshold })}
              </Typography>
              <Slider
                value={colorThreshold}
                onChange={(_, value) => setColorThreshold(value as number)}
                min={70}
                max={100}
                step={5}
                marks={[
                  { value: 70, label: t('similarity.thresholds.color.min') },
                  { value: 85, label: t('similarity.thresholds.color.recommended') },
                  { value: 100, label: t('similarity.thresholds.color.max') },
                ]}
              />
              <Typography variant="caption" color="text.secondary">
                {t('similarity.thresholds.color.description')}
              </Typography>
            </Box>

            {/* 검색 결과 제한 */}
            <FormControl fullWidth>
              <InputLabel>{t('similarity.thresholds.searchLimit.label')}</InputLabel>
              <Select
                value={searchLimit}
                label={t('similarity.thresholds.searchLimit.label')}
                onChange={(e) => setSearchLimit(e.target.value as number)}
              >
                <MenuItem value={10}>{t('similarity.thresholds.searchLimit.options.10')}</MenuItem>
                <MenuItem value={20}>{t('similarity.thresholds.searchLimit.options.20')}</MenuItem>
                <MenuItem value={50}>{t('similarity.thresholds.searchLimit.options.50')}</MenuItem>
                <MenuItem value={100}>{t('similarity.thresholds.searchLimit.options.100')}</MenuItem>
              </Select>
            </FormControl>

            <Alert severity="info">
              {t('similarity.thresholds.localStorageNote')}
            </Alert>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
};

export default SimilaritySettings;
