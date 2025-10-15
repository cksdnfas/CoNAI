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

const SimilaritySettings: React.FC = () => {
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
      alert('설정 업데이트 실패');
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
        alert('처리할 이미지가 없습니다.');
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
        alert(`처리 완료: ${totalProcessed}개 성공, ${totalFailed}개 실패`);
      } else {
        alert(`처리 완료: ${totalProcessed}개의 이미지 해시가 생성되었습니다.`);
      }

      await loadStats();
    } catch (error) {
      alert('해시 재생성 실패');
      console.error('Failed to rebuild hashes:', error);
    } finally {
      setRebuilding(false);
    }
  };

  const handleTestSearch = async () => {
    const imageId = parseInt(testImageId);
    if (isNaN(imageId) || imageId <= 0) {
      alert('유효한 이미지 ID를 입력하세요');
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
      alert(error.response?.data?.error || '검색 실패');
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
      alert('중복 스캔 실패');
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
      case 'exact': return '완전 동일';
      case 'near-duplicate': return '거의 동일';
      case 'similar': return '유사';
      case 'color-similar': return '색감 유사';
      default: return '유사';
    }
  };

  return (
    <Box>
      {/* 시스템 상태 */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            시스템 상태
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            이미지 유사도 검색 시스템의 현재 상태입니다.
          </Typography>

          {stats ? (
            <Stack spacing={2}>
              <Stack direction="row" spacing={1} flexWrap="wrap">
                <Chip
                  label={`전체 이미지: ${stats.totalImages}개`}
                  color="primary"
                  variant="outlined"
                />
                <Chip
                  label={`해시 생성됨: ${stats.imagesWithHash}개`}
                  color="success"
                  icon={<CheckCircleIcon />}
                />
                <Chip
                  label={`미생성: ${stats.imagesWithoutHash}개`}
                  color="warning"
                />
                <Chip
                  label={`완료율: ${stats.completionPercentage}%`}
                  color={stats.completionPercentage === 100 ? 'success' : 'info'}
                />
              </Stack>

              {rebuilding && (
                <Box>
                  <Typography variant="body2" gutterBottom>
                    해시 생성 진행 중... {rebuildProcessed}개 완료/{rebuildTotal}개 전체 ({rebuildProgress.toFixed(0)}% 완료)
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
                label="업로드 시 자동 해시 생성"
              />

              <Stack direction="row" spacing={2}>
                <Button
                  variant="contained"
                  startIcon={rebuilding ? <CircularProgress size={20} /> : <RefreshIcon />}
                  onClick={handleRebuildHashes}
                  disabled={rebuilding || stats.imagesWithoutHash === 0}
                >
                  {rebuilding ? '생성 중...' : `모든 미생성 이미지 해시 생성 (${stats.imagesWithoutHash}개)`}
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<RefreshIcon />}
                  onClick={loadStats}
                >
                  통계 새로고침
                </Button>
              </Stack>

              {stats.imagesWithoutHash === 0 && (
                <Alert severity="success">
                  모든 이미지의 해시가 생성되었습니다!
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
            테스트 & 미리보기
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            특정 이미지로 유사도 검색을 테스트합니다.
          </Typography>

          <Stack spacing={2}>
            <Stack direction="row" spacing={2} alignItems="flex-end">
              <TextField
                label="이미지 ID"
                value={testImageId}
                onChange={(e) => setTestImageId(e.target.value)}
                type="number"
                placeholder="예: 123"
                fullWidth
              />
              <FormControl sx={{ minWidth: 150 }}>
                <InputLabel>검색 타입</InputLabel>
                <Select
                  value={testType}
                  label="검색 타입"
                  onChange={(e) => setTestType(e.target.value as any)}
                >
                  <MenuItem value="duplicates">중복 검색</MenuItem>
                  <MenuItem value="similar">유사 검색</MenuItem>
                  <MenuItem value="color">색감 검색</MenuItem>
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
                {testLoading ? '검색 중...' : '검색 실행'}
              </Button>
            </Stack>

            {/* 검색 원본 이미지 */}
            {queryImage && (
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  검색 원본 이미지
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
                      <strong>ID:</strong> {queryImage.id}
                    </Typography>
                    <Typography variant="body2" noWrap>
                      <strong>파일명:</strong> {queryImage.filename}
                    </Typography>
                    <Typography variant="body2">
                      <strong>크기:</strong> {queryImage.width} × {queryImage.height}
                    </Typography>
                    {queryImage.ai_tool && (
                      <Typography variant="body2">
                        <strong>AI 도구:</strong> {queryImage.ai_tool}
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
                  검색 결과: {testResults.length}개
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
                              label={`${result.similarity.toFixed(1)}%`}
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
                              색감: {result.colorSimilarity.toFixed(1)}%
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
                유사한 이미지가 없습니다.
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
            전체 중복 분석
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            데이터베이스 전체에서 중복 이미지 그룹을 찾습니다.
          </Typography>

          <Stack spacing={2}>
            <Button
              variant="contained"
              color="secondary"
              startIcon={scanLoading ? <CircularProgress size={20} /> : <FindInPageIcon />}
              onClick={handleScanDuplicates}
              disabled={scanLoading}
            >
              {scanLoading ? '스캔 중...' : '전체 스캔 실행'}
            </Button>

            {duplicateGroups.length > 0 && (
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  발견된 중복 그룹: {duplicateGroups.length}개
                </Typography>
                {duplicateGroups.map((group) => (
                  <Accordion key={group.groupId}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Stack direction="row" spacing={2} alignItems="center">
                        <ContentCopyIcon color="warning" />
                        <Typography>
                          그룹 {group.groupId} • {group.images.length}개 이미지
                        </Typography>
                        <Chip
                          label={`${group.similarity.toFixed(1)}% 유사`}
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
                              ID: {image.id}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                      {group.images.length > 5 && (
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                          +{group.images.length - 5}개 더 있음
                        </Typography>
                      )}
                    </AccordionDetails>
                  </Accordion>
                ))}
              </Box>
            )}

            {duplicateGroups.length === 0 && !scanLoading && (
              <Alert severity="info">
                스캔을 실행하면 중복 이미지 그룹이 표시됩니다.
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
            임계값 설정
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            유사도 검색의 민감도를 조정합니다.
          </Typography>

          <Stack spacing={3}>
            {/* 중복 검색 임계값 */}
            <Box>
              <Typography gutterBottom>
                중복 검색 임계값: {duplicateThreshold}
              </Typography>
              <Slider
                value={duplicateThreshold}
                onChange={(_, value) => setDuplicateThreshold(value as number)}
                min={0}
                max={10}
                step={1}
                marks={[
                  { value: 0, label: '0 (엄격)' },
                  { value: 5, label: '5 (권장)' },
                  { value: 10, label: '10 (관대)' },
                ]}
              />
              <Typography variant="caption" color="text.secondary">
                낮을수록 엄격 (0=완전 동일, 5=거의 동일, 10=약간 다를 수 있음)
              </Typography>
            </Box>

            {/* 유사 검색 임계값 */}
            <Box>
              <Typography gutterBottom>
                유사 검색 임계값: {similarThreshold}
              </Typography>
              <Slider
                value={similarThreshold}
                onChange={(_, value) => setSimilarThreshold(value as number)}
                min={5}
                max={25}
                step={1}
                marks={[
                  { value: 5, label: '5 (엄격)' },
                  { value: 15, label: '15 (권장)' },
                  { value: 25, label: '25 (관대)' },
                ]}
              />
              <Typography variant="caption" color="text.secondary">
                낮을수록 엄격, 높을수록 더 많은 유사 이미지 검색
              </Typography>
            </Box>

            {/* 색상 유사도 임계값 */}
            <Box>
              <Typography gutterBottom>
                색상 유사도 임계값: {colorThreshold}%
              </Typography>
              <Slider
                value={colorThreshold}
                onChange={(_, value) => setColorThreshold(value as number)}
                min={70}
                max={100}
                step={5}
                marks={[
                  { value: 70, label: '70%' },
                  { value: 85, label: '85% (권장)' },
                  { value: 100, label: '100%' },
                ]}
              />
              <Typography variant="caption" color="text.secondary">
                색감 유사도 기준 (높을수록 엄격)
              </Typography>
            </Box>

            {/* 검색 결과 제한 */}
            <FormControl fullWidth>
              <InputLabel>검색 결과 제한</InputLabel>
              <Select
                value={searchLimit}
                label="검색 결과 제한"
                onChange={(e) => setSearchLimit(e.target.value as number)}
              >
                <MenuItem value={10}>10개</MenuItem>
                <MenuItem value={20}>20개 (권장)</MenuItem>
                <MenuItem value={50}>50개</MenuItem>
                <MenuItem value={100}>100개</MenuItem>
              </Select>
            </FormControl>

            <Alert severity="info">
              설정값은 로컬에만 저장되며, 검색 시 실시간으로 적용됩니다.
            </Alert>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
};

export default SimilaritySettings;
