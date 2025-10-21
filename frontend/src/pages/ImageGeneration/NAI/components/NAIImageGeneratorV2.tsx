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
  LinearProgress,
  Divider
} from '@mui/material';
import {
  AutoAwesome as GenerateIcon
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { naiApi } from '../../../../services/api';
import api from '../../../../services/api';
import NAIAnlasDisplay from './NAIAnlasDisplay';
import NAICostEstimator from './NAICostEstimator';
import RepeatControls from '../../components/RepeatControls';
import type { RepeatConfig, RepeatState } from '../../components/RepeatControls';
import { GenerationHistoryList } from '../../components/GenerationHistoryList';

interface NAIImageGeneratorV2Props {
  token: string;
  onLogout: () => void;
  externalPrompt?: string;
  onPromptChange?: (prompt: string) => void;
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

const PARAMS_STORAGE_KEY = 'nai_generation_params';

export default function NAIImageGeneratorV2({ token, onLogout, externalPrompt, onPromptChange }: NAIImageGeneratorV2Props) {
  const { t } = useTranslation(['imageGeneration']);

  // LocalStorage에서 저장된 파라미터 불러오기
  const getInitialParams = () => {
    try {
      const saved = localStorage.getItem(PARAMS_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // 프롬프트는 저장하지 않으므로 제외
        const { prompt: _, negative_prompt: __, ...savedParams } = parsed;
        // 기본값과 병합 (새로운 파라미터가 추가될 경우를 대비)
        return {
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
          uncond_scale: 1.0,
          ...savedParams
        };
      }
    } catch (e) {
      console.error('Failed to load saved params:', e);
    }
    // 기본값
    return {
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
    };
  };

  const [params, setParams] = useState(getInitialParams());

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const [userData, setUserData] = useState<{
    subscription: { tier: number; active: boolean; tierName: string };
    anlasBalance: number;
  } | null>(null);

  // 반복 실행 관련 상태
  const [repeatConfig, setRepeatConfig] = useState<RepeatConfig>({
    enabled: false,
    count: 3,
    delaySeconds: 5
  });
  const [repeatState, setRepeatState] = useState<RepeatState>({
    isRunning: false,
    currentIteration: 0,
    totalIterations: 0
  });
  const [repeatTimeoutId, setRepeatTimeoutId] = useState<number | null>(null);

  // 외부 프롬프트와 동기화
  useEffect(() => {
    if (externalPrompt !== undefined && externalPrompt !== params.prompt) {
      setParams((prev: typeof params) => ({ ...prev, prompt: externalPrompt }));
    }
  }, [externalPrompt]);

  // 프롬프트 변경 시 외부로 전달
  // Note: externalPrompt is intentionally NOT in deps - we only sync when user changes params.prompt internally
  useEffect(() => {
    if (onPromptChange && params.prompt !== externalPrompt) {
      onPromptChange(params.prompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.prompt, onPromptChange]);

  // 파라미터 변경 시 LocalStorage에 저장 (프롬프트 제외)
  useEffect(() => {
    try {
      const { prompt, negative_prompt, ...paramsToSave } = params;
      localStorage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(paramsToSave));
    } catch (e) {
      console.error('Failed to save params:', e);
    }
  }, [params]);

  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    // 반복 실행 시작 시 상태 초기화
    const isFirstRepeatExecution = repeatConfig.enabled && !repeatState.isRunning;
    if (isFirstRepeatExecution) {
      setRepeatState({
        isRunning: true,
        currentIteration: 1,
        totalIterations: repeatConfig.count === -1 ? -1 : repeatConfig.count
      });
    }

    setGenerating(true);
    setError(null);

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

      // 응답: { historyIds: number[], count: number, metadata: {...} }
      if (response.historyIds && response.historyIds.length > 0) {
        // 사용자 데이터 갱신
        fetchUserData();

        // 모든 히스토리 ID의 업로드 완료 대기
        waitForUploadCompletion(response.historyIds);

        // 반복 실행 처리
        if (repeatConfig.enabled) {
          const currentIteration = isFirstRepeatExecution ? 1 : repeatState.currentIteration;
          const shouldContinue = repeatConfig.count === -1 || currentIteration < repeatState.totalIterations;

          if (shouldContinue) {
            // 다음 반복 예약
            const timeoutId = window.setTimeout(() => {
              setRepeatState(prev => ({
                ...prev,
                currentIteration: prev.currentIteration + 1
              }));
              handleGenerate(); // 재귀 호출
            }, repeatConfig.delaySeconds * 1000);

            setRepeatTimeoutId(timeoutId);
          } else {
            // 반복 완료
            handleStopRepeat();
          }
        }
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
      // 에러 발생 시 반복 중지
      if (repeatState.isRunning || isFirstRepeatExecution) {
        handleStopRepeat();
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleStopRepeat = () => {
    if (repeatTimeoutId) {
      clearTimeout(repeatTimeoutId);
      setRepeatTimeoutId(null);
    }
    setRepeatState({
      isRunning: false,
      currentIteration: 0,
      totalIterations: 0
    });
  };

  // 업로드 완료 대기 후 히스토리 새로고침
  const waitForUploadCompletion = async (historyIds: number[]) => {
    const maxAttempts = 30; // 최대 30초 대기
    const pollInterval = 1000; // 1초마다 체크
    let attempts = 0;

    const checkCompletion = async (): Promise<boolean> => {
      try {
        // 모든 히스토리 ID의 상태 확인
        const statuses = await Promise.all(
          historyIds.map(async (id) => {
            try {
              const response = await api.get(`/api/generation-history/${id}`);
              return response.data.record.generation_status === 'completed';
            } catch {
              return false;
            }
          })
        );

        // 모두 완료되었는지 확인
        return statuses.every(status => status);
      } catch {
        return false;
      }
    };

    const poll = async () => {
      attempts++;
      const allCompleted = await checkCompletion();

      if (allCompleted) {
        // 모든 업로드 완료 - 히스토리 새로고침
        setHistoryRefreshKey(prev => prev + 1);
      } else if (attempts < maxAttempts) {
        // 아직 완료 안됨 - 계속 폴링
        setTimeout(poll, pollInterval);
      } else {
        // 타임아웃 - 그냥 새로고침
        setHistoryRefreshKey(prev => prev + 1);
      }
    };

    // 폴링 시작
    poll();
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

      {/* 이미지 생성 화면 - 2열 레이아웃 */}
      <Grid container spacing={3}>
        {/* 왼쪽: 설정 폼 */}
        <Grid size={{ xs: 12, md: 12, lg: 4 }}>
          <form onSubmit={handleGenerate}>
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

                {/* 반복 실행 설정 */}
                <Paper sx={{ p: 3 }}>
                  <RepeatControls
                    config={repeatConfig}
                    state={repeatState}
                    onConfigChange={setRepeatConfig}
                    onStop={handleStopRepeat}
                    namespace="imageGeneration"
                  />
                </Paper>

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
          </form>
        </Grid>

        {/* 오른쪽: 히스토리 목록 */}
        <Grid size={{ xs: 12, md: 12, lg: 8 }}>
          <GenerationHistoryList key={historyRefreshKey} serviceType="novelai" />
        </Grid>
      </Grid>
    </Box>
  );
}
