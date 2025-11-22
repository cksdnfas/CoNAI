import { useState } from 'react';
import {
  Box,
  Typography,
  Chip,
  FormControlLabel,
  Switch,
  Alert,
  Divider,
  Stack
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, SwapHoriz as SwapHorizIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { RESOLUTIONS, RESOLUTION_KEYS } from '../constants/nai.constants';
import type { ResolutionConfig, CustomResolution } from '../types/nai.types';
import CustomResolutionDialog from './CustomResolutionDialog';

interface ResolutionSettingsProps {
  config: ResolutionConfig;
  onChange: (config: ResolutionConfig) => void;
  disabled?: boolean;
}

export default function ResolutionSettings({ config, onChange, disabled = false }: ResolutionSettingsProps) {
  const { t } = useTranslation('imageGeneration');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingResolution, setEditingResolution] = useState<CustomResolution | undefined>();

  // 해상도 키에서 실제 해상도 정보 가져오기
  const getResolution = (key: string): { width: number; height: number } | undefined => {
    if (key in RESOLUTIONS) {
      return RESOLUTIONS[key as keyof typeof RESOLUTIONS];
    }
    const custom = config.customResolutions.find(r => `custom_${r.id}` === key);
    if (custom) {
      return { width: custom.width, height: custom.height };
    }
    return undefined;
  };

  // 최종 해상도 계산 (가로세로 전환 적용)
  const getFinalResolution = (res: { width: number; height: number }) => {
    if (config.swapDimensions) {
      return { width: res.height, height: res.width };
    }
    return res;
  };

  // 선택된 해상도 목록
  const selectedResolutions = config.mode === 'fixed' ? [config.fixed] : config.random;

  // 해상도 토글 (자동 모드 전환)
  const handleResolutionToggle = (key: string) => {
    const isSelected = selectedResolutions.includes(key);

    if (isSelected) {
      // 선택 해제
      const newSelected = selectedResolutions.filter(k => k !== key);

      if (newSelected.length === 0) {
        // 모두 해제되면 첫 번째 해상도 선택 (고정 모드)
        onChange({ ...config, mode: 'fixed', fixed: RESOLUTION_KEYS[0], random: [] });
      } else if (newSelected.length === 1) {
        // 1개만 남으면 고정 모드
        onChange({ ...config, mode: 'fixed', fixed: newSelected[0], random: [] });
      } else {
        // 2개 이상이면 랜덤 모드 유지
        onChange({ ...config, mode: 'random', random: newSelected });
      }
    } else {
      // 선택 추가
      const newSelected = [...selectedResolutions, key];

      if (newSelected.length === 1) {
        // 1개면 고정 모드
        onChange({ ...config, mode: 'fixed', fixed: newSelected[0], random: [] });
      } else {
        // 2개 이상이면 랜덤 모드로 자동 전환
        onChange({ ...config, mode: 'random', random: newSelected });
      }
    }
  };

  // 가로세로 전환 토글
  const handleSwapToggle = () => {
    onChange({ ...config, swapDimensions: !config.swapDimensions });
  };

  // 커스텀 해상도 추가
  const handleAddCustomResolution = (resolution: Omit<CustomResolution, 'id'>) => {
    const id = Date.now().toString();
    const newCustom: CustomResolution = { ...resolution, id };
    onChange({
      ...config,
      customResolutions: [...config.customResolutions, newCustom]
    });
  };

  // 커스텀 해상도 수정
  const handleEditCustomResolution = (resolution: Omit<CustomResolution, 'id'>) => {
    if (!editingResolution) return;

    const updated = config.customResolutions.map(r =>
      r.id === editingResolution.id ? { ...resolution, id: editingResolution.id } : r
    );
    onChange({ ...config, customResolutions: updated });
    setEditingResolution(undefined);
  };

  // 커스텀 해상도 삭제
  const handleDeleteCustomResolution = (id: string) => {
    const key = `custom_${id}`;
    onChange({
      ...config,
      customResolutions: config.customResolutions.filter(r => r.id !== id),
      random: config.random.filter(k => k !== key),
      fixed: config.fixed === key ? RESOLUTION_KEYS[0] : config.fixed
    });
  };

  // 다이얼로그 열기
  const openAddDialog = () => {
    setEditingResolution(undefined);
    setDialogOpen(true);
  };

  const openEditDialog = (resolution: CustomResolution) => {
    setEditingResolution(resolution);
    setDialogOpen(true);
  };

  // 현재 선택된 최종 해상도 표시
  const renderFinalResolutionInfo = () => {
    const selections = config.mode === 'fixed' ? [config.fixed] : config.random;

    if (selections.length === 0) {
      return (
        <Alert severity="warning" sx={{ mt: 2 }}>
          {t('nai.resolution.selectAtLeastOne')}
        </Alert>
      );
    }

    const resolutionList = selections
      .map(key => {
        const res = getResolution(key);
        if (!res) return null;
        const final = getFinalResolution(res);
        return { key, ...final };
      })
      .filter(Boolean);

    if (selections.length === 1) {
      // 단일 해상도 (고정 모드)
      const res = resolutionList[0];
      if (!res) return null;

      return (
        <Alert severity="info" sx={{ mt: 2 }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2">
              {t('nai.resolution.finalResolution')}:
            </Typography>
            <Chip
              label={`${res.width}×${res.height}`}
              color="primary"
              size="small"
            />
            {config.swapDimensions && (
              <Typography variant="caption" color="text.secondary">
                ({t('nai.resolution.swapped')})
              </Typography>
            )}
          </Stack>
        </Alert>
      );
    }

    // 다중 해상도 (랜덤 모드)
    return (
      <Alert severity="info" sx={{ mt: 2 }}>
        <Typography variant="body2" gutterBottom>
          {t('nai.resolution.randomPool')} ({resolutionList.length}):
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
          {resolutionList.map((res) => (
            <Chip
              key={res!.key}
              label={`${res!.width}×${res!.height}`}
              color="primary"
              size="small"
              variant="outlined"
            />
          ))}
        </Box>
        {config.swapDimensions && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {t('nai.resolution.randomSwapInfo')}
          </Typography>
        )}
      </Alert>
    );
  };

  return (
    <Box>
      {/* 해상도 선택 */}
      <Typography variant="body2" color="text.secondary" gutterBottom>
        {t('nai.resolution.selectResolution')}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
        {RESOLUTION_KEYS.map(key => {
          const isSelected = selectedResolutions.includes(key);
          return (
            <Chip
              key={key}
              label={key}
              onClick={() => !disabled && handleResolutionToggle(key)}
              color={isSelected ? 'primary' : 'default'}
              variant={isSelected ? 'filled' : 'outlined'}
              disabled={disabled}
              sx={{ cursor: disabled ? 'default' : 'pointer' }}
            />
          );
        })}
        {config.customResolutions.map(custom => {
          const key = `custom_${custom.id}`;
          const isSelected = selectedResolutions.includes(key);
          return (
            <Chip
              key={key}
              label={`${custom.width}×${custom.height}`}
              onClick={() => !disabled && handleResolutionToggle(key)}
              color={isSelected ? 'primary' : 'default'}
              variant={isSelected ? 'filled' : 'outlined'}
              disabled={disabled}
              onDelete={disabled ? undefined : () => handleDeleteCustomResolution(custom.id)}
              deleteIcon={<DeleteIcon />}
              sx={{ cursor: disabled ? 'default' : 'pointer' }}
            />
          );
        })}
        <Chip
          icon={<AddIcon />}
          label={t('nai.resolution.addCustom')}
          onClick={openAddDialog}
          disabled={disabled}
          variant="outlined"
          sx={{ cursor: disabled ? 'default' : 'pointer' }}
        />
      </Box>

      <Divider sx={{ my: 2 }} />

      {/* 가로세로 전환 옵션 */}
      <FormControlLabel
        control={
          <Switch
            checked={config.swapDimensions}
            onChange={handleSwapToggle}
            disabled={disabled}
          />
        }
        label={
          <Stack direction="row" spacing={1} alignItems="center">
            <SwapHorizIcon fontSize="small" />
            <Box>
              <Typography variant="body2">{t('nai.resolution.swapDimensions')}</Typography>
              <Typography variant="caption" color="text.secondary">
                {t('nai.resolution.swapDimensionsDesc')}
              </Typography>
            </Box>
          </Stack>
        }
      />

      {/* 최종 해상도 정보 */}
      {renderFinalResolutionInfo()}

      {/* 커스텀 해상도 다이얼로그 */}
      <CustomResolutionDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          setEditingResolution(undefined);
        }}
        onSave={editingResolution ? handleEditCustomResolution : handleAddCustomResolution}
        editResolution={editingResolution}
      />
    </Box>
  );
}
