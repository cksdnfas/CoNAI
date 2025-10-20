import { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Slider,
  Typography,
  Alert,
  Grid,
  Paper,
  FormControlLabel,
  Checkbox,
  CircularProgress,
  Tabs,
  Tab,
  LinearProgress,
  Divider,
  Snackbar,
  Chip
} from '@mui/material';
import {
  AutoAwesome as GenerateIcon,
  Help as HelpIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { naiApi, imageApi } from '../../../../services/api';
import api from '../../../../services/api';
import NAIPromptHelper from './NAIPromptHelper';
import NAIImageGallery from './NAIImageGallery';
import NAIAnlasDisplay from './NAIAnlasDisplay';
import NAICostEstimator from './NAICostEstimator';

interface NAIImageGeneratorV2Props {
  token: string;
  onLogout: () => void;
}

const RESOLUTIONS = {
  'Small Portrait': { width: 512, height: 768 },
  'Small Landscape': { width: 768, height: 512 },
  'Small Square': { width: 640, height: 640 },
  'Normal Portrait': { width: 832, height: 1216 },
  'Normal Landscape': { width: 1216, height: 832 },
  'Normal Square': { width: 1024, height: 1024 },
  'Large Portrait': { width: 1024, height: 1536 },
  'Large Landscape': { width: 1536, height: 1024 },
  'Wallpaper Portrait': { width: 1088, height: 1920 },
  'Wallpaper Landscape': { width: 1920, height: 1088 }
};

const MODELS = [
  { value: 'nai-diffusion-4-5-curated', label: 'V4.5 Curated (권장)' },
  { value: 'nai-diffusion-4-5-full', label: 'V4.5 Full' },
  { value: 'nai-diffusion-4-curated-preview', label: 'V4 Curated' },
  { value: 'nai-diffusion-4-full', label: 'V4 Full' },
  { value: 'nai-diffusion-3', label: 'V3 (구버전)' },
  { value: 'nai-diffusion-3-furry', label: 'V3 Furry' }
];

const SAMPLERS = [
  { value: 'k_euler', label: 'Euler' },
  { value: 'k_euler_ancestral', label: 'Euler Ancestral' },
  { value: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
  { value: 'k_dpmpp_2m', label: 'DPM++ 2M' },
  { value: 'k_dpmpp_sde', label: 'DPM++ SDE' },
  { value: 'ddim_v3', label: 'DDIM' }
];

const NOISE_SCHEDULES = [
  { value: 'native', label: 'Native' },
  { value: 'karras', label: 'Karras (권장)' },
  { value: 'exponential', label: 'Exponential' },
  { value: 'polyexponential', label: 'Polyexponential' }
];

export default function NAIImageGeneratorV2({ token, onLogout }: NAIImageGeneratorV2Props) {
  const { t } = useTranslation(['imageGeneration']);
  const [currentTab, setCurrentTab] = useState(0);
  const [params, setParams] = useState({
    model: 'nai-diffusion-4-5-curated',
    prompt: '',
    negative_prompt: '',
    resolution: 'Normal Portrait',
    steps: 28,
    scale: 6.0,
    sampler: 'k_euler',
    n_samples: 1,
    sm: true,
    sm_dyn: false,
    qualityToggle: true,
    cfg_rescale: 0.7,
    noise_schedule: 'karras',
    uncond_scale: 1.0
  });

  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{[key: number]: 'pending' | 'uploading' | 'success' | 'error'}>({});
  const [snackbar, setSnackbar] = useState<{open: boolean; message: string; severity: 'success' | 'error'}>({
    open: false,
    message: '',
    severity: 'success'
  });

  const [userData, setUserData] = useState<{
    subscription: { tier: number; active: boolean; tierName: string };
    anlasBalance: number;
  } | null>(null);

  const handlePromptAdd = (tag: string) => {
    const currentPrompt = params.prompt.trim();
    setParams({
      ...params,
      prompt: currentPrompt ? `${currentPrompt}, ${tag}` : tag
    });
  };

  const handlePromptReplace = (prompt: string) => {
    setParams({
      ...params,
      prompt: prompt
    });
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    setError(null);
    setUploadStatus({});

    try {
      const resolution = RESOLUTIONS[params.resolution as keyof typeof RESOLUTIONS];
      const response = await naiApi.generateImage(token, {
        ...params,
        width: resolution.width,
        height: resolution.height,
        model: params.model,
        cfg_rescale: params.cfg_rescale,
        noise_schedule: params.noise_schedule,
        uncond_scale: params.uncond_scale
      });

      // 새로운 결과를 배열 맨 앞에 추가 (최신순)
      const newResult = {
        ...response,
        timestamp: new Date().toISOString(),
        id: Date.now() // 고유 ID
      };
      setResults(prev => [newResult, ...prev]);
      fetchUserData();

      // 자동 업로드 시작
      if (response.images && response.images.length > 0) {
        autoUploadImages(response.images);
      }
    } catch (err: any) {
      if (err.response?.status === 401) {
        // 토큰 만료 시 즉시 로그아웃
        onLogout();
        return;
      } else if (err.response?.status === 402) {
        setError(t('imageGeneration:nai.generate.subscriptionRequired'));
      } else {
        setError(err.response?.data?.error || err.response?.data?.details || t('imageGeneration:nai.generate.error'));
      }
    } finally {
      setGenerating(false);
    }
  };

  const fetchUserData = async () => {
    // Only fetch user data if token exists
    if (!token) {
      return;
    }

    try {
      const response = await api.get('/api/nai/user/data', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      setUserData(response.data);
    } catch (err) {
      console.error('[NAI] Failed to fetch user data:', err);
    }
  };

  useEffect(() => {
    // Only fetch on mount if token exists
    if (token) {
      fetchUserData();
    }
  }, [token]);

  const autoUploadImages = async (images: any[]) => {
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < images.length; i++) {
      setUploadStatus(prev => ({ ...prev, [i]: 'uploading' }));

      try {
        const img = images[i];
        const byteString = atob(img.data);
        const arrayBuffer = new ArrayBuffer(byteString.length);
        const uint8Array = new Uint8Array(arrayBuffer);
        for (let j = 0; j < byteString.length; j++) {
          uint8Array[j] = byteString.charCodeAt(j);
        }
        const blob = new Blob([uint8Array], { type: 'image/png' });
        const file = new File([blob], img.filename, { type: 'image/png' });

        const uploadResponse = await imageApi.uploadImage(file);

        if (uploadResponse.success) {
          setUploadStatus(prev => ({ ...prev, [i]: 'success' }));
          successCount++;
        } else {
          setUploadStatus(prev => ({ ...prev, [i]: 'error' }));
          failCount++;
        }
      } catch (err: any) {
        setUploadStatus(prev => ({ ...prev, [i]: 'error' }));
        failCount++;
      }
    }

    // 최종 결과 알림
    if (successCount > 0 && failCount === 0) {
      setSnackbar({
        open: true,
        message: t('imageGeneration:nai.generate.autoUploadSuccess', { count: successCount }),
        severity: 'success'
      });
    } else if (failCount > 0) {
      setSnackbar({
        open: true,
        message: t('imageGeneration:nai.generate.autoUploadPartial', { success: successCount, fail: failCount }),
        severity: 'error'
      });
    }
  };

  const handleUploadImage = async (imageIndex: number) => {
    if (!results || !results.images[imageIndex]) return;

    setUploading(true);
    setUploadStatus(prev => ({ ...prev, [imageIndex]: 'uploading' }));

    try {
      const img = results.images[imageIndex];
      const byteString = atob(img.data);
      const arrayBuffer = new ArrayBuffer(byteString.length);
      const uint8Array = new Uint8Array(arrayBuffer);
      for (let i = 0; i < byteString.length; i++) {
        uint8Array[i] = byteString.charCodeAt(i);
      }
      const blob = new Blob([uint8Array], { type: 'image/png' });
      const file = new File([blob], img.filename, { type: 'image/png' });

      const uploadResponse = await imageApi.uploadImage(file);

      if (uploadResponse.success) {
        setUploadStatus(prev => ({ ...prev, [imageIndex]: 'success' }));
        setSnackbar({
          open: true,
          message: t('imageGeneration:nai.generate.uploadSuccess'),
          severity: 'success'
        });
      } else {
        setUploadStatus(prev => ({ ...prev, [imageIndex]: 'error' }));
        setSnackbar({
          open: true,
          message: uploadResponse.error || t('imageGeneration:nai.generate.uploadError'),
          severity: 'error'
        });
      }
    } catch (err: any) {
      setUploadStatus(prev => ({ ...prev, [imageIndex]: 'error' }));
      setSnackbar({
        open: true,
        message: t('imageGeneration:nai.generate.uploadError'),
        severity: 'error'
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">{t('imageGeneration:nai.generate.title')}</Typography>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          <NAIAnlasDisplay token={token} />
          <Button variant="outlined" onClick={onLogout}>
            {t('imageGeneration:nai.generate.logout')}
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* 프롬프트 도우미 탭 (전체 영역 사용) */}
      {currentTab === 1 && (
        <Box>
          <Paper sx={{ mb: 3 }}>
            <Tabs value={currentTab} onChange={(_, v) => setCurrentTab(v)}>
              <Tab label="이미지 생성" />
              <Tab icon={<HelpIcon />} iconPosition="start" label="프롬프트 도우미" />
            </Tabs>
          </Paper>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12 }}>
              <NAIPromptHelper
                onPromptAdd={handlePromptAdd}
                onPromptReplace={handlePromptReplace}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Button
                fullWidth
                variant="outlined"
                onClick={() => setCurrentTab(0)}
              >
                생성 화면으로 돌아가기
              </Button>
            </Grid>
          </Grid>
        </Box>
      )}

      {/* 3열 레이아웃: 이미지 생성 화면 */}
      {currentTab === 0 && (
        <form onSubmit={handleGenerate}>
          <Paper sx={{ mb: 3 }}>
            <Tabs value={currentTab} onChange={(_, v) => setCurrentTab(v)}>
              <Tab label="이미지 생성" />
              <Tab icon={<HelpIcon />} iconPosition="start" label="프롬프트 도우미" />
            </Tabs>
          </Paper>

          <Grid container spacing={3}>
            {/* 왼쪽: 프롬프트 및 설정 영역 */}
            <Grid size={{ xs: 12, md: 12, lg: 4 }}>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {/* 모델 & 프롬프트 */}
                <Paper sx={{ p: 3 }}>
                  <Typography variant="subtitle1" gutterBottom fontWeight="bold">기본 설정</Typography>
                  <Divider sx={{ mb: 2 }} />
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12 }}>
                      <FormControl fullWidth disabled={generating}>
                        <InputLabel>모델</InputLabel>
                        <Select value={params.model} onChange={(e) => setParams({ ...params, model: e.target.value })} label="모델">
                          {MODELS.map(m => (
                            <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <FormControl fullWidth disabled={generating}>
                        <InputLabel>해상도</InputLabel>
                        <Select value={params.resolution} onChange={(e) => setParams({ ...params, resolution: e.target.value })} label="해상도">
                          {Object.keys(RESOLUTIONS).map(key => {
                            const res = RESOLUTIONS[key as keyof typeof RESOLUTIONS];
                            return (
                              <MenuItem key={key} value={key}>{key} ({res.width}×{res.height})</MenuItem>
                            );
                          })}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <TextField
                        fullWidth
                        multiline
                        rows={4}
                        label="프롬프트"
                        value={params.prompt}
                        onChange={(e) => setParams({ ...params, prompt: e.target.value })}
                        placeholder="1girl, portrait, detailed face, masterpiece..."
                        required
                        disabled={generating}
                      />
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <TextField
                        fullWidth
                        multiline
                        rows={2}
                        label="네거티브 프롬프트"
                        value={params.negative_prompt}
                        onChange={(e) => setParams({ ...params, negative_prompt: e.target.value })}
                        placeholder="bad anatomy, low quality..."
                        disabled={generating}
                      />
                    </Grid>
                  </Grid>
                </Paper>

                {/* 샘플링 설정 */}
                <Paper sx={{ p: 3 }}>
                  <Typography variant="subtitle1" gutterBottom fontWeight="bold">샘플링 설정</Typography>
                  <Divider sx={{ mb: 2 }} />
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12 }}>
                      <FormControl fullWidth disabled={generating}>
                        <InputLabel>샘플러</InputLabel>
                        <Select value={params.sampler} onChange={(e) => setParams({ ...params, sampler: e.target.value })} label="샘플러">
                          {SAMPLERS.map(s => (
                            <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <FormControl fullWidth disabled={generating}>
                        <InputLabel>Noise Schedule</InputLabel>
                        <Select value={params.noise_schedule} onChange={(e) => setParams({ ...params, noise_schedule: e.target.value })} label="Noise Schedule">
                          {NOISE_SCHEDULES.map(n => (
                            <MenuItem key={n.value} value={n.value}>{n.label}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <Typography gutterBottom>Steps: {params.steps}</Typography>
                      <Slider
                        value={params.steps}
                        onChange={(_, value) => setParams({ ...params, steps: value as number })}
                        min={1}
                        max={50}
                        marks={[
                          { value: 15, label: '15' },
                          { value: 28, label: '28' },
                          { value: 40, label: '40' }
                        ]}
                        disabled={generating}
                      />
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <Typography gutterBottom>Guidance: {params.scale}</Typography>
                      <Slider
                        value={params.scale}
                        onChange={(_, value) => setParams({ ...params, scale: value as number })}
                        min={0}
                        max={10}
                        step={0.1}
                        marks={[
                          { value: 0, label: '0' },
                          { value: 5, label: '5' },
                          { value: 7, label: '7' }
                        ]}
                        disabled={generating}
                      />
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <Typography gutterBottom>CFG Rescale: {params.cfg_rescale}</Typography>
                      <Slider
                        value={params.cfg_rescale}
                        onChange={(_, value) => setParams({ ...params, cfg_rescale: value as number })}
                        min={0}
                        max={1}
                        step={0.05}
                        marks={[
                          { value: 0, label: '0' },
                          { value: 0.2, label: '0.2' },
                          { value: 0.5, label: '0.5' }
                        ]}
                        disabled={generating}
                      />
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <Typography gutterBottom>Uncond Scale: {params.uncond_scale}</Typography>
                      <Slider
                        value={params.uncond_scale}
                        onChange={(_, value) => setParams({ ...params, uncond_scale: value as number })}
                        min={0}
                        max={1.5}
                        step={0.05}
                        marks={[
                          { value: 0, label: '0' },
                          { value: 1, label: '1' },
                          { value: 1.5, label: '1.5' }
                        ]}
                        disabled={generating}
                      />
                    </Grid>
                  </Grid>
                </Paper>

                {/* 출력 설정 */}
                <Paper sx={{ p: 3 }}>
                  <Typography variant="subtitle1" gutterBottom fontWeight="bold">출력 설정</Typography>
                  <Divider sx={{ mb: 2 }} />
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12 }}>
                      <TextField
                        fullWidth
                        type="number"
                        label="샘플 수"
                        value={params.n_samples}
                        onChange={(e) => setParams({ ...params, n_samples: parseInt(e.target.value) })}
                        inputProps={{ min: 1, max: 8 }}
                        disabled={generating}
                      />
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={params.qualityToggle}
                            onChange={(e) => setParams({ ...params, qualityToggle: e.target.checked })}
                            disabled={generating}
                          />
                        }
                        label="품질 태그 자동 추가"
                      />
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={params.sm}
                            onChange={(e) => setParams({ ...params, sm: e.target.checked })}
                            disabled={generating}
                          />
                        }
                        label="SMEA"
                      />
                    </Grid>
                    <Grid size={{ xs: 12 }}>
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={params.sm_dyn}
                            onChange={(e) => setParams({ ...params, sm_dyn: e.target.checked })}
                            disabled={generating || !params.sm}
                          />
                        }
                        label="SMEA DYN"
                      />
                    </Grid>
                  </Grid>
                </Paper>

                {/* 비용 계산 */}
                {userData && (
                  <Paper sx={{ p: 3 }}>
                    <NAICostEstimator
                      width={RESOLUTIONS[params.resolution as keyof typeof RESOLUTIONS].width}
                      height={RESOLUTIONS[params.resolution as keyof typeof RESOLUTIONS].height}
                      steps={params.steps}
                      n_samples={params.n_samples}
                      sm={params.sm}
                      sm_dyn={params.sm_dyn}
                      subscriptionTier={userData.subscription.tier}
                      anlasBalance={userData.anlasBalance}
                    />
                  </Paper>
                )}

                {/* 생성 버튼 */}
                <Button
                  fullWidth
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={generating || !params.prompt}
                  startIcon={generating ? <CircularProgress size={20} /> : <GenerateIcon />}
                >
                  {generating ? '생성 중...' : '이미지 생성'}
                </Button>
                {generating && <LinearProgress sx={{ mt: 1 }} />}
              </Box>
            </Grid>

            {/* 오른쪽: 이미지 영역 (더 넓게) */}
            <Grid size={{ xs: 12, md: 6, lg: 7 }}>
              {results.length > 0 ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  {results.map((result, resultIndex) => (
                    <Box key={result.id}>
                      <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Chip
                          label={`생성 ${results.length - resultIndex}`}
                          color="primary"
                          size="small"
                        />
                        <Typography variant="caption" color="text.secondary">
                          {new Date(result.timestamp).toLocaleString()}
                        </Typography>
                      </Box>
                      <NAIImageGallery
                        images={result.images}
                        metadata={result.metadata}
                        onUpload={handleUploadImage}
                        uploading={uploading}
                        uploadStatus={uploadStatus}
                      />
                    </Box>
                  ))}
                </Box>
              ) : (
                <Paper
                  sx={{
                    p: 4,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: 'background.default',
                    minHeight: '400px'
                  }}
                >
                  <GenerateIcon sx={{ fontSize: 64, color: 'text.disabled', mb: 2 }} />
                  <Typography variant="h6" color="text.secondary">
                    생성된 이미지가 여기에 표시됩니다
                  </Typography>
                </Paper>
              )}
            </Grid>
          </Grid>
        </form>
      )}

      {/* Snackbar for upload notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        message={snackbar.message}
      />
    </Box>
  );
}
