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
  Tooltip,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useTranslation } from 'react-i18next';

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
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
          <Typography variant="h6">
            {t('similarity.thresholds.title')}
          </Typography>
          <Tooltip title={t('similarity.thresholds.localStorageNote')} arrow>
            <InfoOutlinedIcon fontSize="small" sx={{ ml: 1, color: 'text.secondary' }} />
          </Tooltip>
        </Box>
        <Typography variant="body2" color="text.secondary" paragraph>
          {t('similarity.thresholds.description')}
        </Typography>

        <Stack spacing={3}>
          {/* Duplicate Threshold */}
          <Box>
            <Typography gutterBottom>
              {t('similarity.thresholds.duplicate.label', { value: duplicateThreshold })}
            </Typography>
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
            <Typography variant="caption" color="text.secondary">
              {t('similarity.thresholds.duplicate.description')}
            </Typography>
          </Box>

          {/* Similar Threshold */}
          <Box>
            <Typography gutterBottom>
              {t('similarity.thresholds.similar.label', { value: similarThreshold })}
            </Typography>
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
            <Typography variant="caption" color="text.secondary">
              {t('similarity.thresholds.similar.description')}
            </Typography>
          </Box>

          {/* Color Threshold */}
          <Box>
            <Typography gutterBottom>
              {t('similarity.thresholds.color.label', { value: colorThreshold })}
            </Typography>
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
            <Typography variant="caption" color="text.secondary">
              {t('similarity.thresholds.color.description')}
            </Typography>
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
