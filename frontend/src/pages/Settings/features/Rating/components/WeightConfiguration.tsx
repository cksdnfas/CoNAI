import React from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Slider,
  Button,
  Alert,
  CircularProgress,
  Stack,
  Chip,
} from '@mui/material';
import {
  Calculate as CalculateIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { RatingWeights, RatingWeightsUpdate, RatingScoreResult } from '../../../../../types/rating';
import { getCurrentWeight } from '../utils/ratingHelpers';

interface WeightConfigurationProps {
  weights: RatingWeights | null;
  localWeights: RatingWeightsUpdate;
  weightsHasChanges: boolean;
  saving: boolean;
  previewResult: RatingScoreResult | null;
  onUpdateWeights: (updates: RatingWeightsUpdate) => void;
  onSaveWeights: () => void;
  onResetWeights: () => void;
}

export const WeightConfiguration: React.FC<WeightConfigurationProps> = ({
  weights,
  localWeights,
  weightsHasChanges,
  saving,
  previewResult,
  onUpdateWeights,
  onSaveWeights,
  onResetWeights,
}) => {
  const { t } = useTranslation('settings');

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {t('rating.weights.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          {t('rating.weights.description')}
        </Typography>

        <Stack spacing={3} sx={{ mt: 3 }}>
          <Box>
            <Typography gutterBottom>
              {t('rating.weights.general', { value: getCurrentWeight(weights, localWeights, 'general_weight') })}
            </Typography>
            <Slider
              value={getCurrentWeight(weights, localWeights, 'general_weight')}
              onChange={(_, value) =>
                onUpdateWeights({ ...localWeights, general_weight: value as number })
              }
              min={0}
              max={100}
              step={1}
              marks={[
                { value: 0, label: '0' },
                { value: 50, label: '50' },
                { value: 100, label: '100' },
              ]}
            />
          </Box>

          <Box>
            <Typography gutterBottom>
              {t('rating.weights.sensitive', { value: getCurrentWeight(weights, localWeights, 'sensitive_weight') })}
            </Typography>
            <Slider
              value={getCurrentWeight(weights, localWeights, 'sensitive_weight')}
              onChange={(_, value) =>
                onUpdateWeights({ ...localWeights, sensitive_weight: value as number })
              }
              min={0}
              max={100}
              step={1}
              marks={[
                { value: 0, label: '0' },
                { value: 50, label: '50' },
                { value: 100, label: '100' },
              ]}
            />
          </Box>

          <Box>
            <Typography gutterBottom>
              {t('rating.weights.questionable', { value: getCurrentWeight(weights, localWeights, 'questionable_weight') })}
            </Typography>
            <Slider
              value={getCurrentWeight(weights, localWeights, 'questionable_weight')}
              onChange={(_, value) =>
                onUpdateWeights({ ...localWeights, questionable_weight: value as number })
              }
              min={0}
              max={100}
              step={1}
              marks={[
                { value: 0, label: '0' },
                { value: 50, label: '50' },
                { value: 100, label: '100' },
              ]}
            />
          </Box>

          <Box>
            <Typography gutterBottom>
              {t('rating.weights.explicit', { value: getCurrentWeight(weights, localWeights, 'explicit_weight') })}
            </Typography>
            <Slider
              value={getCurrentWeight(weights, localWeights, 'explicit_weight')}
              onChange={(_, value) =>
                onUpdateWeights({ ...localWeights, explicit_weight: value as number })
              }
              min={0}
              max={100}
              step={1}
              marks={[
                { value: 0, label: '0' },
                { value: 50, label: '50' },
                { value: 100, label: '100' },
              ]}
            />
          </Box>

          {/* Preview */}
          {previewResult && (
            <Alert severity="info" icon={<CalculateIcon />}>
              <Typography variant="subtitle2" gutterBottom>
                {t('rating.weights.preview.title')}
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                <Typography
                  variant="body2"
                  dangerouslySetInnerHTML={{
                    __html: t('rating.weights.preview.score', {
                      score: previewResult.score.toFixed(2),
                    }),
                  }}
                />
                {previewResult.tier && (
                  <Chip
                    label={previewResult.tier.tier_name}
                    size="small"
                    sx={{
                      bgcolor: previewResult.tier.color || undefined,
                      color: 'white',
                    }}
                  />
                )}
              </Box>
            </Alert>
          )}

          <Stack direction="row" spacing={2}>
            <Button
              variant="contained"
              onClick={onSaveWeights}
              disabled={!weightsHasChanges || saving}
              fullWidth
            >
              {saving ? <CircularProgress size={24} /> : t('rating.weights.buttons.save')}
            </Button>
            <Button
              variant="outlined"
              onClick={onResetWeights}
              disabled={!weightsHasChanges || saving}
              fullWidth
            >
              {t('rating.weights.buttons.cancel')}
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
};
