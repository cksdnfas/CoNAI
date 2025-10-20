import { useState } from 'react';
import {
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Typography,
  Tooltip
} from '@mui/material';
import { Speed as FastIcon, Star as BalancedIcon, Diamond as HighQualityIcon, AutoAwesome as MaxIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

export interface NAIPreset {
  steps: number;
  scale: number;
  sampler: string;
  sm: boolean;
  sm_dyn: boolean;
}

export const QUALITY_PRESETS: Record<string, NAIPreset> = {
  'fast': { steps: 15, scale: 5.0, sampler: 'k_euler', sm: false, sm_dyn: false },
  'balanced': { steps: 25, scale: 5.5, sampler: 'k_dpmpp_2s_ancestral', sm: true, sm_dyn: false },
  'high': { steps: 28, scale: 6.0, sampler: 'k_euler', sm: true, sm_dyn: false },
  'maximum': { steps: 40, scale: 7.0, sampler: 'k_dpmpp_2m', sm: true, sm_dyn: true }
};

interface NAIPresetSelectorProps {
  onPresetSelect: (preset: NAIPreset) => void;
}

export default function NAIPresetSelector({ onPresetSelect }: NAIPresetSelectorProps) {
  const { t } = useTranslation(['imageGeneration']);
  const [selectedPreset, setSelectedPreset] = useState('high');

  const handlePresetChange = (presetKey: string) => {
    setSelectedPreset(presetKey);
    onPresetSelect(QUALITY_PRESETS[presetKey]);
  };

  const getPresetIcon = (key: string): React.ReactElement => {
    switch (key) {
      case 'fast': return <FastIcon />;
      case 'balanced': return <BalancedIcon />;
      case 'high': return <HighQualityIcon />;
      case 'maximum': return <MaxIcon />;
      default: return <HighQualityIcon />;
    }
  };

  const getPresetColor = (key: string) => {
    switch (key) {
      case 'fast': return 'info';
      case 'balanced': return 'primary';
      case 'high': return 'success';
      case 'maximum': return 'secondary';
      default: return 'default';
    }
  };

  return (
    <Box>
      <FormControl fullWidth>
        <InputLabel>{t('imageGeneration:nai.presets.label')}</InputLabel>
        <Select
          value={selectedPreset}
          onChange={(e) => handlePresetChange(e.target.value)}
          label={t('imageGeneration:nai.presets.label')}
        >
          {Object.keys(QUALITY_PRESETS).map(key => (
            <MenuItem key={key} value={key}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {getPresetIcon(key)}
                <Typography>{t(`imageGeneration:nai.presets.${key}.name`)}</Typography>
                <Chip
                  label={`${QUALITY_PRESETS[key].steps} steps`}
                  size="small"
                  color={getPresetColor(key) as any}
                  sx={{ ml: 'auto' }}
                />
              </Box>
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {Object.keys(QUALITY_PRESETS).map(key => (
          <Tooltip key={key} title={t(`imageGeneration:nai.presets.${key}.description`)}>
            <span>
              <Chip
                icon={getPresetIcon(key)}
                label={t(`imageGeneration:nai.presets.${key}.name`)}
                onClick={() => handlePresetChange(key)}
                color={selectedPreset === key ? getPresetColor(key) as any : 'default'}
                variant={selectedPreset === key ? 'filled' : 'outlined'}
              />
            </span>
          </Tooltip>
        ))}
      </Box>
    </Box>
  );
}
