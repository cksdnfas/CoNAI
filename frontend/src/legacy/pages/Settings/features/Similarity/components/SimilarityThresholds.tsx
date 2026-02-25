import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Slider,
  Stack,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { InfoTooltip } from '../../../../../components/common';

interface SimilarityThresholdsProps {
  duplicateThreshold: number;
  similarThreshold: number;
  colorThreshold: number;
  searchLimit: number;
  onSetDuplicateThreshold: (value: number) => void;
  onSetSimilarThreshold: (value: number) => void;
  onSetColorThreshold: (value: number) => void;
  onSetSearchLimit: (value: number) => void;
}

export const SimilarityThresholds: React.FC<SimilarityThresholdsProps> = ({
  duplicateThreshold,
  similarThreshold,
  colorThreshold,
  searchLimit,
  onSetDuplicateThreshold,
  onSetSimilarThreshold,
  onSetColorThreshold,
  onSetSearchLimit,
}) => {
  const { t } = useTranslation('settings');

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">
            {t('similarity.thresholds.title')}
          </Typography>
          <InfoTooltip title={t('similarity.thresholds.localStorageNote')} />
        </Box>

        <Stack spacing={2}>
          {/* Duplicate Threshold */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <Typography>
                {t('similarity.thresholds.duplicate.label', { value: duplicateThreshold })}
              </Typography>
              <InfoTooltip title={t('similarity.thresholds.duplicate.description')} />
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Box sx={{ width: '90%' }}>
                <Slider
                  value={duplicateThreshold}
                  onChange={(_, value) => onSetDuplicateThreshold(value as number)}
                  min={0}
                  max={10}
                  step={1}
                  marks={[
                    { value: 0, label: t('similarity.thresholds.duplicate.strict') },
                    { value: 5, label: t('similarity.thresholds.duplicate.recommended') },
                    { value: 10, label: t('similarity.thresholds.duplicate.lenient') },
                  ]}
                />
              </Box>
            </Box>
          </Box>

          {/* Similar Threshold */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <Typography>
                {t('similarity.thresholds.similar.label', { value: similarThreshold })}
              </Typography>
              <InfoTooltip title={t('similarity.thresholds.similar.description')} />
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Box sx={{ width: '90%' }}>
                <Slider
                  value={similarThreshold}
                  onChange={(_, value) => onSetSimilarThreshold(value as number)}
                  min={5}
                  max={25}
                  step={1}
                  marks={[
                    { value: 5, label: t('similarity.thresholds.similar.strict') },
                    { value: 15, label: t('similarity.thresholds.similar.recommended') },
                    { value: 25, label: t('similarity.thresholds.similar.lenient') },
                  ]}
                />
              </Box>
            </Box>
          </Box>

          {/* Color Threshold */}
          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              <Typography>
                {t('similarity.thresholds.color.label', { value: colorThreshold })}
              </Typography>
              <InfoTooltip title={t('similarity.thresholds.color.description')} />
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Box sx={{ width: '90%' }}>
                <Slider
                  value={colorThreshold}
                  onChange={(_, value) => onSetColorThreshold(value as number)}
                  min={70}
                  max={100}
                  step={5}
                  marks={[
                    { value: 70, label: t('similarity.thresholds.color.min') },
                    { value: 85, label: t('similarity.thresholds.color.recommended') },
                    { value: 100, label: t('similarity.thresholds.color.max') },
                  ]}
                />
              </Box>
            </Box>
          </Box>

          {/* Search Limit */}
          <FormControl fullWidth>
            <InputLabel>{t('similarity.thresholds.searchLimit.label')}</InputLabel>
            <Select
              value={searchLimit}
              label={t('similarity.thresholds.searchLimit.label')}
              onChange={(e) => onSetSearchLimit(e.target.value as number)}
            >
              <MenuItem value={10}>{t('similarity.thresholds.searchLimit.options.10')}</MenuItem>
              <MenuItem value={20}>{t('similarity.thresholds.searchLimit.options.20')}</MenuItem>
              <MenuItem value={50}>{t('similarity.thresholds.searchLimit.options.50')}</MenuItem>
              <MenuItem value={100}>{t('similarity.thresholds.searchLimit.options.100')}</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </CardContent>
    </Card>
  );
};
