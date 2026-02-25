import { Box, Typography, Alert, Button, CircularProgress, LinearProgress, Paper, Grid } from '@mui/material';
import { AutoAwesome as GenerateIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useMemo } from 'react';

import NAIAnlasDisplay from './NAIAnlasDisplay';
import NAIBasicSettings from './NAIBasicSettings';
import NAISamplingSettings from './NAISamplingSettings';
import NAIOutputSettings from './NAIOutputSettings';
import NAIGroupSelector from './NAIGroupSelector';
import RepeatControls from '../../components/RepeatControls';
import { GenerationHistoryList } from '../../components/GenerationHistoryList';
import GroupAssignModal from '../../../../components/GroupAssignModal/GroupAssignModal';

import { useNAIParams } from '../hooks/useNAIParams';
import { useNAIGroupSelection } from '../hooks/useNAIGroupSelection';
import { useRepeatExecution } from '../hooks/useRepeatExecution';
import { useNAIGeneration } from '../hooks/useNAIGeneration';
import { RESOLUTIONS } from '../constants/nai.constants';

interface NAIImageGeneratorV2Props {
  token: string;
  onLogout: () => void;
}

export default function NAIImageGeneratorV2({
  token,
  onLogout
}: NAIImageGeneratorV2Props) {
  const { t } = useTranslation(['imageGeneration']);

  // Custom hooks
  const { params, setParams } = useNAIParams();
  const {
    selectedGroupId,
    selectedGroup,
    groupModalOpen,
    setGroupModalOpen,
    handleGroupSelect,
    handleRemoveGroup
  } = useNAIGroupSelection();

  const {
    generating,
    error,
    userData,
    historyRefreshKey,
    executeSingleGeneration,
    calculateCost
  } = useNAIGeneration({ token, onLogout });

  const {
    repeatConfig,
    repeatState,
    setRepeatConfig,
    startRepeat,
    stopRepeat,
    isRepeatMode
  } = useRepeatExecution({
    onExecute: async () => {
      await executeSingleGeneration(params, selectedGroupId);
    }
  });

  // 선택된 모든 해상도 가져오기
  const getSelectedResolutions = () => {
    const config = params.resolutionConfig;
    const selections = config.mode === 'fixed' ? [config.fixed] : config.random;

    return selections
      .map(key => {
        if (key in RESOLUTIONS) {
          return RESOLUTIONS[key as keyof typeof RESOLUTIONS];
        }
        const custom = config.customResolutions.find(r => `custom_${r.id}` === key);
        return custom ? { width: custom.width, height: custom.height } : null;
      })
      .filter(Boolean) as Array<{ width: number; height: number }>;
  };

  // 비용 계산 (최소~최대 범위)
  const costInfo = useMemo(() => {
    if (!userData) {
      return {
        minCost: 0,
        maxCost: 0,
        balance: 0,
        canGenerate: false,
        buttonText: '이미지생성'
      };
    }

    const resolutions = getSelectedResolutions();
    if (resolutions.length === 0) {
      resolutions.push({ width: 832, height: 1216 }); // 폴백
    }

    // 가로세로 전환 고려
    const possibleResolutions = params.resolutionConfig.swapDimensions && params.resolutionConfig.mode === 'random'
      ? resolutions.flatMap(r => [r, { width: r.height, height: r.width }])
      : params.resolutionConfig.swapDimensions
      ? resolutions.map(r => ({ width: r.height, height: r.width }))
      : resolutions;

    // 각 해상도별 비용 계산
    const costs = possibleResolutions.map(res =>
      calculateCost({
        width: res.width,
        height: res.height,
        steps: params.steps,
        n_samples: params.n_samples,
        uncond_scale: params.uncond_scale
      })
    );

    const minCost = Math.min(...costs);
    const maxCost = Math.max(...costs);
    const balance = userData.anlasBalance;
    const canGenerate = balance >= minCost;

    let buttonText: string;
    if (!canGenerate) {
      buttonText = '이미지생성 (잔액 부족)';
    } else if (minCost === maxCost) {
      // 단일 해상도
      buttonText = `이미지생성 (비용: ${minCost} / 잔액: ${balance.toLocaleString()})`;
    } else {
      // 다중 해상도
      buttonText = `이미지생성 (비용: ${minCost}~${maxCost} / 잔액: ${balance.toLocaleString()})`;
    }

    return { minCost, maxCost, balance, canGenerate, buttonText };
  }, [userData, params.resolutionConfig, params.steps, params.n_samples, params.uncond_scale, calculateCost]);

  // 생성 버튼 클릭 핸들러
  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    console.log('[NAI Generate] Button clicked', {
      repeatConfig,
      repeatState,
      isRepeatMode
    });

    // 반복 실행 모드
    if (isRepeatMode && !repeatState.isRunning) {
      console.log('[NAI Repeat] Starting repeat mode');
      startRepeat();
      return;
    }

    // 단일 실행 모드
    if (!isRepeatMode) {
      console.log('[NAI Generate] Single execution mode');
      await executeSingleGeneration(params, selectedGroupId);
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

      {/* 이미지 생성 화면 - 2열 레이아웃 */}
      <Grid container spacing={3}>
        {/* 왼쪽: 설정 폼 */}
        <Grid size={{ xs: 12, lg: 4 }}>
          <form onSubmit={handleGenerate}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {/* 상단 생성 버튼 */}
              <Button
                fullWidth
                type="submit"
                variant="contained"
                size="large"
                disabled={generating || !params.prompt || (!!userData && !costInfo.canGenerate)}
                startIcon={generating ? <CircularProgress size={20} /> : <GenerateIcon />}
              >
                {costInfo.buttonText}
              </Button>

              {/* 기본 설정 */}
              <NAIBasicSettings params={params} onChange={setParams} disabled={generating} />

              {/* 샘플링 설정 */}
              <NAISamplingSettings params={params} onChange={setParams} disabled={generating} />

              {/* 출력 설정 */}
              <NAIOutputSettings params={params} onChange={setParams} disabled={generating} />

              {/* 그룹 할당 */}
              <NAIGroupSelector
                selectedGroup={selectedGroup}
                onOpenModal={() => setGroupModalOpen(true)}
                onRemoveGroup={handleRemoveGroup}
                disabled={generating}
              />

              {/* 반복 실행 설정 */}
              <Paper sx={{ p: 3 }}>
                <RepeatControls
                  config={repeatConfig}
                  state={repeatState}
                  onConfigChange={setRepeatConfig}
                  onStop={stopRepeat}
                  namespace="imageGeneration"
                />
              </Paper>

              {/* 하단 생성 버튼 */}
              <Button
                fullWidth
                type="submit"
                variant="contained"
                size="large"
                disabled={generating || !params.prompt || (!!userData && !costInfo.canGenerate)}
                startIcon={generating ? <CircularProgress size={20} /> : <GenerateIcon />}
              >
                {generating ? '생성 중...' : costInfo.buttonText}
              </Button>
              {generating && <LinearProgress sx={{ mt: 1 }} />}
            </Box>
          </form>
        </Grid>

        {/* 오른쪽: 히스토리 목록 */}
        <Grid size={{ xs: 12, lg: 8 }}>
          <GenerationHistoryList serviceType="novelai" refreshKey={historyRefreshKey} />
        </Grid>
      </Grid>

      {/* 그룹 선택 모달 */}
      <GroupAssignModal
        open={groupModalOpen}
        onClose={() => setGroupModalOpen(false)}
        selectedImageCount={1}
        onAssign={handleGroupSelect}
      />
    </Box>
  );
}
