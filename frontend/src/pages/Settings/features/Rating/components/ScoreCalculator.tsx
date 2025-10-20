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
  Divider,
} from '@mui/material';
import {
  Calculate as CalculateIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { RatingData, RatingScoreResult } from '../../../../../types/rating';

interface ScoreCalculatorProps {
  testRating: RatingData;
  testResult: RatingScoreResult | null;
  testLoading: boolean;
  onUpdateTestRating: (updates: RatingData) => void;
  onCalculateTest: () => void;
}

export const ScoreCalculator: React.FC<ScoreCalculatorProps> = ({
  testRating,
  testResult,
  testLoading,
  onUpdateTestRating,
  onCalculateTest,
}) => {
  const { t } = useTranslation('settings');

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          {t('rating.calculator.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          {t('rating.calculator.description')}
        </Typography>

        <Stack spacing={3} sx={{ mt: 3 }}>
          <Box>
            <Typography gutterBottom>
              {t('rating.calculator.general', { value: testRating.general.toFixed(3) })}
            </Typography>
            <Slider
              value={testRating.general}
              onChange={(_, value) =>
                onUpdateTestRating({ ...testRating, general: value as number })
              }
              min={0}
              max={1}
              step={0.001}
              marks={[
                { value: 0, label: '0.0' },
                { value: 0.5, label: '0.5' },
                { value: 1, label: '1.0' },
              ]}
            />
          </Box>

          <Box>
            <Typography gutterBottom>
              {t('rating.calculator.sensitive', { value: testRating.sensitive.toFixed(3) })}
            </Typography>
            <Slider
              value={testRating.sensitive}
              onChange={(_, value) =>
                onUpdateTestRating({ ...testRating, sensitive: value as number })
              }
              min={0}
              max={1}
              step={0.001}
              marks={[
                { value: 0, label: '0.0' },
                { value: 0.5, label: '0.5' },
                { value: 1, label: '1.0' },
              ]}
            />
          </Box>

          <Box>
            <Typography gutterBottom>
              {t('rating.calculator.questionable', { value: testRating.questionable.toFixed(3) })}
            </Typography>
            <Slider
              value={testRating.questionable}
              onChange={(_, value) =>
                onUpdateTestRating({ ...testRating, questionable: value as number })
              }
              min={0}
              max={1}
              step={0.001}
              marks={[
                { value: 0, label: '0.0' },
                { value: 0.5, label: '0.5' },
                { value: 1, label: '1.0' },
              ]}
            />
          </Box>

          <Box>
            <Typography gutterBottom>
              {t('rating.calculator.explicit', { value: testRating.explicit.toFixed(3) })}
            </Typography>
            <Slider
              value={testRating.explicit}
              onChange={(_, value) =>
                onUpdateTestRating({ ...testRating, explicit: value as number })
              }
              min={0}
              max={1}
              step={0.001}
              marks={[
                { value: 0, label: '0.0' },
                { value: 0.5, label: '0.5' },
                { value: 1, label: '1.0' },
              ]}
            />
          </Box>

          <Button
            variant="contained"
            startIcon={testLoading ? <CircularProgress size={20} /> : <CalculateIcon />}
            onClick={onCalculateTest}
            disabled={testLoading}
          >
            {testLoading ? t('rating.calculator.calculating') : t('rating.calculator.calculate')}
          </Button>

          {testResult && (
            <Alert severity="success">
              <Typography variant="subtitle2" gutterBottom>
                {t('rating.calculator.result.title')}
              </Typography>
              <Box sx={{ mt: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <Typography
                    variant="body1"
                    dangerouslySetInnerHTML={{
                      __html: t('rating.calculator.result.score', {
                        score: testResult.score.toFixed(2),
                      }),
                    }}
                  />
                  {testResult.tier && (
                    <Chip
                      label={testResult.tier.tier_name}
                      sx={{
                        bgcolor: testResult.tier.color || undefined,
                        color: 'white',
                      }}
                    />
                  )}
                </Box>
                <Divider sx={{ my: 1 }} />
                <Typography variant="caption" color="text.secondary">
                  {t('rating.calculator.result.breakdown')}
                </Typography>
                <Box sx={{ mt: 1 }}>
                  <Typography variant="body2">
                    {t('rating.calculator.result.generalScore', {
                      score: testResult.breakdown.general.toFixed(3),
                    })}
                  </Typography>
                  <Typography variant="body2">
                    {t('rating.calculator.result.sensitiveScore', {
                      score: testResult.breakdown.sensitive.toFixed(3),
                    })}
                  </Typography>
                  <Typography variant="body2">
                    {t('rating.calculator.result.questionableScore', {
                      score: testResult.breakdown.questionable.toFixed(3),
                    })}
                  </Typography>
                  <Typography variant="body2">
                    {t('rating.calculator.result.explicitScore', {
                      score: testResult.breakdown.explicit.toFixed(3),
                    })}
                  </Typography>
                </Box>
              </Box>
            </Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};
