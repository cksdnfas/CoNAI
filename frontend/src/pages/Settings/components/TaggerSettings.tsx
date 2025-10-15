import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Switch,
  FormControlLabel,
  Select,
  MenuItem,
  Slider,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Chip,
  Stack,
  FormControl,
  InputLabel,
  Divider,
  LinearProgress,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import {
  CheckCircle as CheckCircleIcon,
  Refresh as RefreshIcon,
  CloudDownload as CloudDownloadIcon,
  PlayArrow as PlayArrowIcon,
  Science as ScienceIcon,
  CloudUpload as CloudUploadIcon,
  CloudOff as CloudOffIcon,
} from '@mui/icons-material';
import { settingsApi, taggerBatchApi, type TaggerSettings as TaggerSettingsType, type TaggerModel, type TaggerDevice, type TaggerServerStatus } from '../../../services/settingsApi';

interface TaggerSettingsProps {
  settings: TaggerSettingsType;
  onUpdate: (settings: Partial<TaggerSettingsType>) => Promise<void>;
}

const TaggerSettings: React.FC<TaggerSettingsProps> = ({ settings, onUpdate }) => {
  const [localSettings, setLocalSettings] = useState<TaggerSettingsType>(settings);
  const [models, setModels] = useState<TaggerModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dependencyStatus, setDependencyStatus] = useState<string | null>(null);
  const [dependencyAvailable, setDependencyAvailable] = useState<boolean | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Batch operations state
  const [batchProcessing, setBatchProcessing] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [batchTotal, setBatchTotal] = useState(0);
  const [untaggedCount, setUntaggedCount] = useState<number | null>(null);
  const [confirmDialog, setConfirmDialog] = useState(false);

  // Test state
  const [testImageId, setTestImageId] = useState('');
  const [testProcessing, setTestProcessing] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);

  // Model status state
  const [modelStatus, setModelStatus] = useState<TaggerServerStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  useEffect(() => {
    loadModels();
    loadUntaggedCount();
    loadModelStatus();
  }, []);

  useEffect(() => {
    // Poll model status every 5 seconds when enabled
    if (localSettings.enabled) {
      const interval = setInterval(loadModelStatus, 5000);
      return () => clearInterval(interval);
    }
  }, [localSettings.enabled]);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  useEffect(() => {
    const changed = JSON.stringify(localSettings) !== JSON.stringify(settings);
    setHasChanges(changed);
  }, [localSettings, settings]);

  const loadModels = async () => {
    try {
      const modelsList = await settingsApi.getModelsList();
      setModels(modelsList);
    } catch (error) {
      console.error('Failed to load models:', error);
    }
  };

  const loadUntaggedCount = async () => {
    try {
      const count = await taggerBatchApi.getUntaggedCount();
      setUntaggedCount(count);
    } catch (error) {
      console.error('Failed to load untagged count:', error);
    }
  };

  const loadModelStatus = async () => {
    try {
      setStatusLoading(true);
      const status = await settingsApi.getTaggerStatus();
      setModelStatus(status);
    } catch (error) {
      console.error('Failed to load model status:', error);
    } finally {
      setStatusLoading(false);
    }
  };

  const handleLoadModel = async () => {
    setLoading(true);
    try {
      await settingsApi.loadModel(localSettings.model);
      await loadModelStatus();
      alert('모델이 로드되었습니다');
    } catch (error) {
      alert('모델 로드 실패');
      console.error('Failed to load model:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleUnloadModel = async () => {
    setLoading(true);
    try {
      await settingsApi.unloadModel();
      await loadModelStatus();
      alert('모델이 언로드되었습니다');
    } catch (error) {
      alert('모델 언로드 실패');
      console.error('Failed to unload model:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCheckDependencies = async () => {
    setChecking(true);
    setDependencyStatus(null);
    try {
      const result = await settingsApi.checkDependencies();
      setDependencyAvailable(result.available);
      setDependencyStatus(result.message);
    } catch (error) {
      setDependencyAvailable(false);
      setDependencyStatus('Failed to check dependencies');
    } finally {
      setChecking(false);
    }
  };

  const handleDownloadModel = async () => {
    setDownloading(true);
    try {
      const result = await settingsApi.downloadModel(localSettings.model);
      alert(result.message);
      await loadModels();
    } catch (error) {
      alert('Failed to download model');
      console.error('Failed to download model:', error);
    } finally {
      setDownloading(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await onUpdate(localSettings);
      setHasChanges(false);
    } catch (error) {
      alert('Failed to save settings');
      console.error('Failed to save settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setLocalSettings(settings);
    setHasChanges(false);
  };

  const handleBatchTagUnprocessed = async () => {
    setBatchProcessing(true);
    setBatchProgress(0);
    setBatchTotal(0);
    try {
      const result = await taggerBatchApi.tagUnprocessed(100);
      setBatchTotal(result.total);
      setBatchProgress(result.success_count);
      alert(`완료: 성공 ${result.success_count}개, 실패 ${result.fail_count}개`);
      await loadUntaggedCount();
    } catch (error) {
      alert('미처리 이미지 태깅 실패');
      console.error('Failed to batch tag unprocessed:', error);
    } finally {
      setBatchProcessing(false);
    }
  };

  const handleBatchTagAll = async () => {
    setConfirmDialog(false);
    setBatchProcessing(true);
    setBatchProgress(0);
    setBatchTotal(0);
    try {
      const result = await taggerBatchApi.tagAll(100, true);
      setBatchTotal(result.total);
      setBatchProgress(result.success_count);
      alert(`완료: 성공 ${result.success_count}개, 실패 ${result.fail_count}개`);
      await loadUntaggedCount();
    } catch (error) {
      alert('전체 재태깅 실패');
      console.error('Failed to batch tag all:', error);
    } finally {
      setBatchProcessing(false);
    }
  };

  const handleTestImage = async () => {
    const imageId = parseInt(testImageId);
    if (isNaN(imageId) || imageId <= 0) {
      alert('유효한 이미지 ID를 입력하세요');
      return;
    }

    setTestProcessing(true);
    setTestResult(null);
    try {
      const result = await taggerBatchApi.testImage(imageId);
      setTestResult(result);
    } catch (error) {
      alert('테스트 실패');
      console.error('Failed to test image:', error);
    } finally {
      setTestProcessing(false);
    }
  };

  const currentModel = models.find(m => m.name === localSettings.model);
  const isModelDownloaded = currentModel?.downloaded || false;

  // Format relative time
  const formatRelativeTime = (isoString: string | null): string => {
    if (!isoString) return '없음';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return '방금 전';
    if (diffMins < 60) return `${diffMins}분 전`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}시간 전`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}일 전`;
  };

  return (
    <Box>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            WD v3 Tagger 설정
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            AI 기반 이미지 자동 태깅 기능을 설정합니다.
          </Typography>

          <Stack spacing={3} sx={{ mt: 3 }}>
            {/* Model Status Section */}
            {localSettings.enabled && (
              <Card variant="outlined" sx={{ bgcolor: 'background.default' }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Box flex={1}>
                      <Typography variant="subtitle1" gutterBottom>
                        모델 상태
                      </Typography>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                        <Chip
                          label={modelStatus?.modelLoaded ? '로드됨' : '언로드됨'}
                          color={modelStatus?.modelLoaded ? 'success' : 'default'}
                          size="small"
                          icon={modelStatus?.modelLoaded ? <CheckCircleIcon /> : undefined}
                        />
                        {modelStatus?.currentModel && (
                          <Chip
                            label={models.find(m => m.name === modelStatus.currentModel)?.label || modelStatus.currentModel}
                            size="small"
                            variant="outlined"
                          />
                        )}
                        {modelStatus?.currentDevice && (
                          <Chip
                            label={modelStatus.currentDevice}
                            size="small"
                            color={modelStatus.currentDevice.includes('cuda') ? 'success' : 'default'}
                            variant="outlined"
                          />
                        )}
                        {statusLoading && <CircularProgress size={16} />}
                      </Stack>
                      {modelStatus?.lastUsedAt && (
                        <Typography variant="caption" color="text.secondary">
                          마지막 사용: {formatRelativeTime(modelStatus.lastUsedAt)}
                        </Typography>
                      )}
                    </Box>
                    <Stack direction="row" spacing={1}>
                      <Button
                        onClick={handleLoadModel}
                        disabled={modelStatus?.modelLoaded || loading}
                        startIcon={<CloudUploadIcon />}
                        size="small"
                      >
                        로드
                      </Button>
                      <Button
                        onClick={handleUnloadModel}
                        disabled={!modelStatus?.modelLoaded || loading}
                        startIcon={<CloudOffIcon />}
                        color="warning"
                        size="small"
                      >
                        언로드
                      </Button>
                      <Button
                        onClick={loadModelStatus}
                        disabled={statusLoading}
                        startIcon={<RefreshIcon />}
                        size="small"
                        variant="outlined"
                      >
                        새로고침
                      </Button>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            )}

            <Divider />
            {/* Enable/Disable Toggle */}
            <FormControlLabel
              control={
                <Switch
                  checked={localSettings.enabled}
                  onChange={(e) => setLocalSettings({ ...localSettings, enabled: e.target.checked })}
                />
              }
              label="Tagger 활성화"
            />

            {/* Auto Tag on Upload */}
            <FormControlLabel
              control={
                <Switch
                  checked={localSettings.autoTagOnUpload}
                  onChange={(e) => setLocalSettings({ ...localSettings, autoTagOnUpload: e.target.checked })}
                  disabled={!localSettings.enabled}
                />
              }
              label="업로드 시 자동 태깅"
            />

            {/* Model Selection */}
            {models.length > 0 ? (
              <FormControl fullWidth disabled={!localSettings.enabled}>
                <InputLabel>모델 선택</InputLabel>
                <Select
                  value={localSettings.model}
                  label="모델 선택"
                  onChange={(e) => setLocalSettings({ ...localSettings, model: e.target.value as any })}
                >
                  {models.map((model) => (
                    <MenuItem key={model.name} value={model.name}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <Box>
                          <Typography variant="body1">{model.label}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {model.description}
                          </Typography>
                        </Box>
                        {model.downloaded && (
                          <Chip
                            size="small"
                            icon={<CheckCircleIcon />}
                            label="Downloaded"
                            color="success"
                            sx={{ ml: 2 }}
                          />
                        )}
                      </Box>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <CircularProgress size={20} />
                <Typography variant="body2" color="text.secondary">모델 목록 로딩 중...</Typography>
              </Box>
            )}

            {/* Device Selection */}
            <FormControl fullWidth disabled={!localSettings.enabled}>
              <InputLabel>디바이스 선택</InputLabel>
              <Select
                value={localSettings.device}
                label="디바이스 선택"
                onChange={(e) => setLocalSettings({ ...localSettings, device: e.target.value as TaggerDevice })}
              >
                <MenuItem value="auto">
                  <Box>
                    <Typography variant="body1">자동 (Auto)</Typography>
                    <Typography variant="caption" color="text.secondary">
                      GPU 사용 가능하면 GPU, 없으면 CPU 사용
                    </Typography>
                  </Box>
                </MenuItem>
                <MenuItem value="cpu">
                  <Box>
                    <Typography variant="body1">CPU</Typography>
                    <Typography variant="caption" color="text.secondary">
                      CPU만 사용 (느리지만 안정적)
                    </Typography>
                  </Box>
                </MenuItem>
                <MenuItem value="cuda">
                  <Box>
                    <Typography variant="body1">GPU (CUDA)</Typography>
                    <Typography variant="caption" color="text.secondary">
                      NVIDIA GPU 사용 (빠름, GPU 필요)
                    </Typography>
                  </Box>
                </MenuItem>
              </Select>
            </FormControl>

            {/* Download Status and Button */}
            {localSettings.enabled && (
              <Box>
                <Alert severity={isModelDownloaded ? 'success' : 'warning'} sx={{ mb: 2 }}>
                  {isModelDownloaded ? (
                    <>
                      <strong>{currentModel?.label}</strong> 모델이 다운로드되어 있습니다.
                    </>
                  ) : (
                    <>
                      <strong>{currentModel?.label}</strong> 모델이 다운로드되지 않았습니다. 첫 사용 시 자동으로 다운로드됩니다.
                    </>
                  )}
                </Alert>

                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={downloading ? <CircularProgress size={20} /> : <CloudDownloadIcon />}
                    onClick={handleDownloadModel}
                    disabled={downloading || isModelDownloaded}
                  >
                    {downloading ? '다운로드 정보 확인 중...' : '모델 다운로드'}
                  </Button>
                  <Button
                    fullWidth
                    variant="outlined"
                    startIcon={<RefreshIcon />}
                    onClick={loadModels}
                  >
                    상태 새로고침
                  </Button>
                </Stack>
              </Box>
            )}

            {/* General Threshold */}
            <Box>
              <Typography gutterBottom>
                General Tags Threshold: {localSettings.generalThreshold.toFixed(2)}
              </Typography>
              <Slider
                value={localSettings.generalThreshold}
                onChange={(_, value) => setLocalSettings({ ...localSettings, generalThreshold: value as number })}
                min={0}
                max={1}
                step={0.05}
                marks={[
                  { value: 0, label: '0.0' },
                  { value: 0.5, label: '0.5' },
                  { value: 1, label: '1.0' },
                ]}
                disabled={!localSettings.enabled}
              />
              <Typography variant="caption" color="text.secondary">
                낮을수록 더 많은 태그 추출 (노이즈 증가 가능)
              </Typography>
            </Box>

            {/* Character Threshold */}
            <Box>
              <Typography gutterBottom>
                Character Tags Threshold: {localSettings.characterThreshold.toFixed(2)}
              </Typography>
              <Slider
                value={localSettings.characterThreshold}
                onChange={(_, value) => setLocalSettings({ ...localSettings, characterThreshold: value as number })}
                min={0}
                max={1}
                step={0.05}
                marks={[
                  { value: 0, label: '0.0' },
                  { value: 0.5, label: '0.5' },
                  { value: 1, label: '1.0' },
                ]}
                disabled={!localSettings.enabled}
              />
              <Typography variant="caption" color="text.secondary">
                낮을수록 더 많은 캐릭터 인식 (오인식 증가 가능)
              </Typography>
            </Box>

            {/* Python Path */}
            <TextField
              label="Python 실행 경로"
              value={localSettings.pythonPath}
              onChange={(e) => setLocalSettings({ ...localSettings, pythonPath: e.target.value })}
              fullWidth
              disabled={!localSettings.enabled}
              helperText="Python 실행 파일 경로 (예: python, python3, C:\\Python39\\python.exe)"
            />

            <Divider sx={{ my: 2 }} />

            {/* Memory Management Settings */}
            {localSettings.enabled && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  메모리 관리
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  모델의 메모리 유지 방식을 설정합니다.
                </Typography>

                <Stack spacing={2}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={localSettings.keepModelLoaded}
                        onChange={(e) => setLocalSettings({ ...localSettings, keepModelLoaded: e.target.checked })}
                      />
                    }
                    label="작업 후 모델 메모리 유지"
                  />

                  <Alert severity="info">
                    {localSettings.keepModelLoaded ? (
                      <>
                        모델이 메모리에 유지됩니다. 설정한 시간이 지나면 자동으로 언로드됩니다.
                      </>
                    ) : (
                      <>
                        모델이 메모리에 유지되지 않습니다. 작업 시작 시 자동으로 로드되며, 프로그램 종료 시 언로드됩니다.
                      </>
                    )}
                  </Alert>

                  {localSettings.keepModelLoaded && (
                    <Box>
                      <Typography gutterBottom>
                        자동 언로드 시간: {localSettings.autoUnloadMinutes}분
                      </Typography>
                      <Slider
                        value={localSettings.autoUnloadMinutes}
                        onChange={(_, value) => setLocalSettings({ ...localSettings, autoUnloadMinutes: value as number })}
                        min={1}
                        max={60}
                        step={1}
                        marks={[
                          { value: 1, label: '1분' },
                          { value: 15, label: '15분' },
                          { value: 30, label: '30분' },
                          { value: 60, label: '60분' },
                        ]}
                      />
                      <Typography variant="caption" color="text.secondary">
                        마지막 사용 후 설정한 시간이 지나면 자동으로 메모리에서 언로드됩니다.
                      </Typography>
                    </Box>
                  )}
                </Stack>
              </Box>
            )}

            <Divider sx={{ my: 2 }} />

            {/* Dependency Check */}
            <Box>
              <Button
                variant="outlined"
                startIcon={checking ? <CircularProgress size={20} /> : <CheckCircleIcon />}
                onClick={handleCheckDependencies}
                disabled={checking || !localSettings.enabled}
                fullWidth
              >
                {checking ? 'Python 의존성 확인 중...' : 'Python 의존성 확인'}
              </Button>

              {dependencyStatus && (
                <Alert severity={dependencyAvailable ? 'success' : 'error'} sx={{ mt: 2 }}>
                  {dependencyStatus}
                </Alert>
              )}
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Batch Operations Section */}
            {localSettings.enabled && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  배치 작업
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  이미지 일괄 처리 작업을 실행합니다.
                </Typography>

                {untaggedCount !== null && (
                  <Alert severity="info" sx={{ mb: 2 }}>
                    미처리 이미지: {untaggedCount}개
                  </Alert>
                )}

                {batchProcessing && batchTotal > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="body2" gutterBottom>
                      진행 상황: {batchProgress} / {batchTotal}
                    </Typography>
                    <LinearProgress
                      variant="determinate"
                      value={(batchProgress / batchTotal) * 100}
                    />
                  </Box>
                )}

                <Stack spacing={2}>
                  <Button
                    variant="contained"
                    startIcon={batchProcessing ? <CircularProgress size={20} /> : <PlayArrowIcon />}
                    onClick={handleBatchTagUnprocessed}
                    disabled={batchProcessing}
                    fullWidth
                  >
                    {batchProcessing ? '처리 중...' : '미처리 이미지 태깅 (최대 100개)'}
                  </Button>

                  <Button
                    variant="outlined"
                    color="warning"
                    startIcon={batchProcessing ? <CircularProgress size={20} /> : <PlayArrowIcon />}
                    onClick={() => setConfirmDialog(true)}
                    disabled={batchProcessing}
                    fullWidth
                  >
                    전체 재태깅 (최대 100개)
                  </Button>
                </Stack>
              </Box>
            )}

            <Divider sx={{ my: 2 }} />

            {/* Test Section */}
            {localSettings.enabled && (
              <Box>
                <Typography variant="h6" gutterBottom>
                  테스트
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  특정 이미지로 현재 설정을 테스트합니다.
                </Typography>

                <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                  <TextField
                    label="이미지 ID"
                    value={testImageId}
                    onChange={(e) => setTestImageId(e.target.value)}
                    type="number"
                    fullWidth
                    placeholder="예: 123"
                  />
                  <Button
                    variant="contained"
                    startIcon={testProcessing ? <CircularProgress size={20} /> : <ScienceIcon />}
                    onClick={handleTestImage}
                    disabled={testProcessing || !testImageId}
                    sx={{ minWidth: 150 }}
                  >
                    {testProcessing ? '처리 중...' : '테스트 실행'}
                  </Button>
                </Stack>

                {testResult && (
                  <Alert severity="success" sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      태깅 결과:
                    </Typography>
                    <Typography variant="body2" component="pre" sx={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem' }}>
                      {JSON.stringify(testResult.auto_tags, null, 2)}
                    </Typography>
                  </Alert>
                )}
              </Box>
            )}

            {/* Save/Reset Buttons */}
            <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
              <Button
                variant="contained"
                onClick={handleSave}
                disabled={!hasChanges || loading}
                fullWidth
              >
                {loading ? <CircularProgress size={24} /> : '저장'}
              </Button>
              <Button
                variant="outlined"
                onClick={handleReset}
                disabled={!hasChanges || loading}
                fullWidth
              >
                취소
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {/* Confirmation Dialog for Batch Tag All */}
      <Dialog open={confirmDialog} onClose={() => setConfirmDialog(false)}>
        <DialogTitle>전체 재태깅 확인</DialogTitle>
        <DialogContent>
          <DialogContentText>
            모든 이미지의 태그를 덮어쓰시겠습니까? 이 작업은 취소할 수 없습니다.
            (최대 100개 처리)
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialog(false)}>취소</Button>
          <Button onClick={handleBatchTagAll} color="warning" variant="contained">
            확인
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TaggerSettings;
