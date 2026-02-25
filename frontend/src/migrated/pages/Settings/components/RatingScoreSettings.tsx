import React, { useState, useEffect } from 'react';
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
  Divider,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Chip,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Calculate as CalculateIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { ratingApi } from '../../../services/ratingApi';
import type {
  RatingWeights,
  RatingWeightsUpdate,
  RatingTier,
  RatingTierInput,
  RatingData,
  RatingScoreResult,
} from '../../../types/rating';

const RatingScoreSettings: React.FC = () => {
  const { t } = useTranslation('settings');

  // Weights state
  const [weights, setWeights] = useState<RatingWeights | null>(null);
  const [localWeights, setLocalWeights] = useState<RatingWeightsUpdate>({});
  const [weightsLoading, setWeightsLoading] = useState(true);
  const [weightsHasChanges, setWeightsHasChanges] = useState(false);

  // Tiers state
  const [tiers, setTiers] = useState<RatingTier[]>([]);
  const [tiersLoading, setTiersLoading] = useState(true);
  const [tierDialog, setTierDialog] = useState<{
    open: boolean;
    mode: 'create' | 'edit';
    tier: Partial<RatingTierInput>;
    editId?: number;
  }>({
    open: false,
    mode: 'create',
    tier: {},
  });

  // Test calculator state
  const [testRating, setTestRating] = useState<RatingData>({
    general: 0.001,
    sensitive: 0.045,
    questionable: 0.735,
    explicit: 0.470,
  });
  const [testResult, setTestResult] = useState<RatingScoreResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  // Preview state
  const [previewResult, setPreviewResult] = useState<RatingScoreResult | null>(null);

  // Global state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (weights) {
      const changed =
        localWeights.general_weight !== undefined ||
        localWeights.sensitive_weight !== undefined ||
        localWeights.questionable_weight !== undefined ||
        localWeights.explicit_weight !== undefined;
      setWeightsHasChanges(changed);
    }
  }, [localWeights, weights]);

  // Auto-calculate preview when weights change
  useEffect(() => {
    if (localWeights && Object.keys(localWeights).length > 0) {
      calculatePreview();
    }
  }, [localWeights]);

  const loadData = async () => {
    await Promise.all([loadWeights(), loadTiers()]);
  };

  const loadWeights = async () => {
    setWeightsLoading(true);
    setError(null);
    try {
      const data = await ratingApi.getWeights();
      setWeights(data);
      setLocalWeights({});
    } catch (err) {
      setError(t('rating.weights.alerts.loadFailed'));
      console.error('Failed to load weights:', err);
    } finally {
      setWeightsLoading(false);
    }
  };

  const loadTiers = async () => {
    setTiersLoading(true);
    setError(null);
    try {
      const data = await ratingApi.getAllTiers();
      setTiers(data);
    } catch (err) {
      setError(t('rating.tiers.alerts.loadFailed'));
      console.error('Failed to load tiers:', err);
    } finally {
      setTiersLoading(false);
    }
  };

  const calculatePreview = async () => {
    if (!weights) return;

    try {
      const currentWeights: RatingWeightsUpdate = {
        general_weight: localWeights.general_weight ?? weights.general_weight,
        sensitive_weight: localWeights.sensitive_weight ?? weights.sensitive_weight,
        questionable_weight: localWeights.questionable_weight ?? weights.questionable_weight,
        explicit_weight: localWeights.explicit_weight ?? weights.explicit_weight,
      };

      // Calculate preview manually (simplified)
      const round3 = (v: number) => Math.round(v * 1000) / 1000;
      const score =
        round3(0.001) * (currentWeights.general_weight || 0) +
        round3(0.045) * (currentWeights.sensitive_weight || 0) +
        round3(0.735) * (currentWeights.questionable_weight || 0) +
        round3(0.470) * (currentWeights.explicit_weight || 0);

      const matchedTier = tiers.find(
        (t) => t.min_score <= score && (t.max_score === null || t.max_score > score)
      );

      setPreviewResult({
        score,
        tier: matchedTier || null,
        breakdown: {
          general: round3(0.001) * (currentWeights.general_weight || 0),
          sensitive: round3(0.045) * (currentWeights.sensitive_weight || 0),
          questionable: round3(0.735) * (currentWeights.questionable_weight || 0),
          explicit: round3(0.470) * (currentWeights.explicit_weight || 0),
        },
        rawRating: { general: 0.001, sensitive: 0.045, questionable: 0.735, explicit: 0.470 },
      });
    } catch (err) {
      console.error('Failed to calculate preview:', err);
    }
  };

  const handleSaveWeights = async () => {
    if (!weightsHasChanges) return;

    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const updated = await ratingApi.updateWeights(localWeights);
      setWeights(updated);
      setLocalWeights({});
      setSuccessMessage(t('rating.weights.alerts.saveSuccess'));
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(t('rating.weights.alerts.saveFailed'));
      console.error('Failed to save weights:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleResetWeights = () => {
    setLocalWeights({});
  };

  const handleOpenTierDialog = (mode: 'create' | 'edit', tier?: RatingTier) => {
    if (mode === 'edit' && tier) {
      setTierDialog({
        open: true,
        mode: 'edit',
        tier: {
          tier_name: tier.tier_name,
          min_score: tier.min_score,
          max_score: tier.max_score,
          tier_order: tier.tier_order,
          color: tier.color,
        },
        editId: tier.id,
      });
    } else {
      // Create new tier with next order
      const nextOrder = tiers.length > 0 ? Math.max(...tiers.map((t) => t.tier_order)) + 1 : 1;
      setTierDialog({
        open: true,
        mode: 'create',
        tier: {
          tier_name: '',
          min_score: 0,
          max_score: null,
          tier_order: nextOrder,
          color: '#2196f3',
        },
      });
    }
  };

  const handleCloseTierDialog = () => {
    setTierDialog({ open: false, mode: 'create', tier: {} });
  };

  const handleSaveTier = async () => {
    const { mode, tier, editId } = tierDialog;
    if (!tier.tier_name || tier.min_score === undefined || tier.tier_order === undefined) {
      setError(t('rating.tiers.dialog.requiredFields'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (mode === 'create') {
        await ratingApi.createTier(tier as RatingTierInput);
        setSuccessMessage(t('rating.tiers.alerts.created'));
      } else if (editId) {
        await ratingApi.updateTier(editId, tier);
        setSuccessMessage(t('rating.tiers.alerts.updated'));
      }
      await loadTiers();
      handleCloseTierDialog();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(t('rating.tiers.alerts.saveFailed'));
      console.error('Failed to save tier:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTier = async (id: number) => {
    if (!window.confirm(t('rating.tiers.alerts.deleteConfirm'))) return;

    setSaving(true);
    setError(null);
    try {
      await ratingApi.deleteTier(id);
      await loadTiers();
      setSuccessMessage(t('rating.tiers.alerts.deleted'));
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(t('rating.tiers.alerts.deleteFailed'));
      console.error('Failed to delete tier:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleCalculateTest = async () => {
    setTestLoading(true);
    setError(null);
    try {
      const result = await ratingApi.calculateScore(testRating);
      setTestResult(result);
    } catch (err) {
      setError(t('rating.calculator.failed'));
      console.error('Failed to calculate score:', err);
    } finally {
      setTestLoading(false);
    }
  };

  const getCurrentWeight = (key: keyof RatingWeightsUpdate): number => {
    if (!weights) return 0;
    const localValue = localWeights[key];
    if (localValue !== undefined) return localValue;

    // Map RatingWeightsUpdate keys to RatingWeights keys
    const weightKey = key as 'general_weight' | 'sensitive_weight' | 'questionable_weight' | 'explicit_weight';
    return weights[weightKey] ?? 0;
  };

  if (weightsLoading || tiersLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {successMessage && (
        <Alert severity="success" sx={{ mb: 3 }}>
          {successMessage}
        </Alert>
      )}

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      {/* Section 1: Weight Configuration */}
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
                {t('rating.weights.general', { value: getCurrentWeight('general_weight') })}
              </Typography>
              <Slider
                value={getCurrentWeight('general_weight')}
                onChange={(_, value) =>
                  setLocalWeights({ ...localWeights, general_weight: value as number })
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
                {t('rating.weights.sensitive', { value: getCurrentWeight('sensitive_weight') })}
              </Typography>
              <Slider
                value={getCurrentWeight('sensitive_weight')}
                onChange={(_, value) =>
                  setLocalWeights({ ...localWeights, sensitive_weight: value as number })
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
                {t('rating.weights.questionable', { value: getCurrentWeight('questionable_weight') })}
              </Typography>
              <Slider
                value={getCurrentWeight('questionable_weight')}
                onChange={(_, value) =>
                  setLocalWeights({ ...localWeights, questionable_weight: value as number })
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
                {t('rating.weights.explicit', { value: getCurrentWeight('explicit_weight') })}
              </Typography>
              <Slider
                value={getCurrentWeight('explicit_weight')}
                onChange={(_, value) =>
                  setLocalWeights({ ...localWeights, explicit_weight: value as number })
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
                onClick={handleSaveWeights}
                disabled={!weightsHasChanges || saving}
                fullWidth
              >
                {saving ? <CircularProgress size={24} /> : t('rating.weights.buttons.save')}
              </Button>
              <Button
                variant="outlined"
                onClick={handleResetWeights}
                disabled={!weightsHasChanges || saving}
                fullWidth
              >
                {t('rating.weights.buttons.cancel')}
              </Button>
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {/* Section 2: Tier Configuration */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box>
              <Typography variant="h6" gutterBottom>
                {t('rating.tiers.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {t('rating.tiers.description')}
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => handleOpenTierDialog('create')}
            >
              {t('rating.tiers.addButton')}
            </Button>
          </Box>

          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>{t('rating.tiers.table.order')}</TableCell>
                  <TableCell>{t('rating.tiers.table.name')}</TableCell>
                  <TableCell>{t('rating.tiers.table.scoreRange')}</TableCell>
                  <TableCell>{t('rating.tiers.table.color')}</TableCell>
                  <TableCell align="right">{t('rating.tiers.table.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {tiers.map((tier) => (
                  <TableRow key={tier.id}>
                    <TableCell>{tier.tier_order}</TableCell>
                    <TableCell>
                      <Chip
                        label={tier.tier_name}
                        sx={{
                          bgcolor: tier.color || undefined,
                          color: 'white',
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      {t('rating.tiers.table.scoreFormat', {
                        min: tier.min_score,
                        max: tier.max_score !== null ? tier.max_score : t('rating.tiers.table.infinity'),
                      })}
                    </TableCell>
                    <TableCell>
                      <Box
                        sx={{
                          width: 24,
                          height: 24,
                          bgcolor: tier.color || '#ccc',
                          borderRadius: 1,
                        }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <IconButton
                        size="small"
                        onClick={() => handleOpenTierDialog('edit', tier)}
                        disabled={saving}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => handleDeleteTier(tier.id)}
                        disabled={saving}
                        color="error"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
                {tiers.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} align="center">
                      <Typography variant="body2" color="text.secondary">
                        {t('rating.tiers.table.empty')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </CardContent>
      </Card>

      {/* Section 3: Score Calculator */}
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
                  setTestRating({ ...testRating, general: value as number })
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
                  setTestRating({ ...testRating, sensitive: value as number })
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
                  setTestRating({ ...testRating, questionable: value as number })
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
                  setTestRating({ ...testRating, explicit: value as number })
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
              onClick={handleCalculateTest}
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

      {/* Tier Edit/Create Dialog */}
      <Dialog open={tierDialog.open} onClose={handleCloseTierDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {tierDialog.mode === 'create'
            ? t('rating.tiers.dialog.createTitle')
            : t('rating.tiers.dialog.editTitle')}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label={t('rating.tiers.dialog.tierName')}
              value={tierDialog.tier.tier_name || ''}
              onChange={(e) =>
                setTierDialog({
                  ...tierDialog,
                  tier: { ...tierDialog.tier, tier_name: e.target.value },
                })
              }
              fullWidth
              required
            />
            <TextField
              label={t('rating.tiers.dialog.minScore')}
              type="number"
              value={tierDialog.tier.min_score ?? ''}
              onChange={(e) =>
                setTierDialog({
                  ...tierDialog,
                  tier: { ...tierDialog.tier, min_score: parseFloat(e.target.value) },
                })
              }
              fullWidth
              required
            />
            <TextField
              label={t('rating.tiers.dialog.maxScore')}
              type="number"
              value={tierDialog.tier.max_score ?? ''}
              onChange={(e) =>
                setTierDialog({
                  ...tierDialog,
                  tier: {
                    ...tierDialog.tier,
                    max_score: e.target.value === '' ? null : parseFloat(e.target.value),
                  },
                })
              }
              fullWidth
            />
            <TextField
              label={t('rating.tiers.dialog.order')}
              type="number"
              value={tierDialog.tier.tier_order ?? ''}
              onChange={(e) =>
                setTierDialog({
                  ...tierDialog,
                  tier: { ...tierDialog.tier, tier_order: parseInt(e.target.value, 10) },
                })
              }
              fullWidth
              required
            />
            <TextField
              label={t('rating.tiers.dialog.color')}
              value={tierDialog.tier.color || ''}
              onChange={(e) =>
                setTierDialog({
                  ...tierDialog,
                  tier: { ...tierDialog.tier, color: e.target.value },
                })
              }
              fullWidth
              placeholder={t('rating.tiers.dialog.colorPlaceholder')}
              helperText={t('rating.tiers.dialog.colorHelper')}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseTierDialog} disabled={saving}>
            {t('rating.tiers.dialog.cancel')}
          </Button>
          <Button onClick={handleSaveTier} variant="contained" disabled={saving}>
            {saving ? <CircularProgress size={20} /> : t('rating.tiers.dialog.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RatingScoreSettings;
