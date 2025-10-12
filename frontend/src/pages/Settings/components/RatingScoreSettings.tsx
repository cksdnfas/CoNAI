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
      setError('가중치 설정을 불러오는데 실패했습니다.');
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
      setError('등급 설정을 불러오는데 실패했습니다.');
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
      setSuccessMessage('가중치 설정이 저장되었습니다.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError('가중치 저장에 실패했습니다.');
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
      setError('모든 필수 항목을 입력해주세요.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (mode === 'create') {
        await ratingApi.createTier(tier as RatingTierInput);
        setSuccessMessage('등급이 추가되었습니다.');
      } else if (editId) {
        await ratingApi.updateTier(editId, tier);
        setSuccessMessage('등급이 수정되었습니다.');
      }
      await loadTiers();
      handleCloseTierDialog();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError('등급 저장에 실패했습니다.');
      console.error('Failed to save tier:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTier = async (id: number) => {
    if (!window.confirm('이 등급을 삭제하시겠습니까?')) return;

    setSaving(true);
    setError(null);
    try {
      await ratingApi.deleteTier(id);
      await loadTiers();
      setSuccessMessage('등급이 삭제되었습니다.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError('등급 삭제에 실패했습니다.');
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
      setError('점수 계산에 실패했습니다.');
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
            가중치 설정
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            각 Rating 항목의 점수 가중치를 설정합니다.
          </Typography>

          <Stack spacing={3} sx={{ mt: 3 }}>
            <Box>
              <Typography gutterBottom>General: {getCurrentWeight('general_weight')}</Typography>
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
              <Typography gutterBottom>Sensitive: {getCurrentWeight('sensitive_weight')}</Typography>
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
                Questionable: {getCurrentWeight('questionable_weight')}
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
              <Typography gutterBottom>Explicit: {getCurrentWeight('explicit_weight')}</Typography>
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
                  실시간 미리보기 (예시 Rating: general=0.001, sensitive=0.045, questionable=0.735,
                  explicit=0.470)
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                  <Typography variant="body2">
                    총점: <strong>{previewResult.score.toFixed(2)}점</strong>
                  </Typography>
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
                {saving ? <CircularProgress size={24} /> : '가중치 저장'}
              </Button>
              <Button
                variant="outlined"
                onClick={handleResetWeights}
                disabled={!weightsHasChanges || saving}
                fullWidth
              >
                취소
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
                등급 구간 설정
              </Typography>
              <Typography variant="body2" color="text.secondary">
                점수 구간별 등급을 설정합니다.
              </Typography>
            </Box>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => handleOpenTierDialog('create')}
            >
              등급 추가
            </Button>
          </Box>

          <TableContainer component={Paper} variant="outlined">
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>순서</TableCell>
                  <TableCell>등급명</TableCell>
                  <TableCell>점수 구간</TableCell>
                  <TableCell>색상</TableCell>
                  <TableCell align="right">작업</TableCell>
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
                      {tier.min_score}점 ~ {tier.max_score !== null ? `${tier.max_score}점` : '∞'}
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
                        등급이 없습니다. 등급을 추가해주세요.
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
            점수 계산 테스트
          </Typography>
          <Typography variant="body2" color="text.secondary" paragraph>
            Rating 값을 입력하여 점수를 계산해보세요.
          </Typography>

          <Stack spacing={3} sx={{ mt: 3 }}>
            <Box>
              <Typography gutterBottom>General: {testRating.general.toFixed(3)}</Typography>
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
              <Typography gutterBottom>Sensitive: {testRating.sensitive.toFixed(3)}</Typography>
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
                Questionable: {testRating.questionable.toFixed(3)}
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
              <Typography gutterBottom>Explicit: {testRating.explicit.toFixed(3)}</Typography>
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
              {testLoading ? '계산 중...' : '점수 계산하기'}
            </Button>

            {testResult && (
              <Alert severity="success">
                <Typography variant="subtitle2" gutterBottom>
                  계산 결과
                </Typography>
                <Box sx={{ mt: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                    <Typography variant="body1">
                      총점: <strong>{testResult.score.toFixed(2)}점</strong>
                    </Typography>
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
                    상세 점수:
                  </Typography>
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="body2">
                      General: {testResult.breakdown.general.toFixed(3)}점
                    </Typography>
                    <Typography variant="body2">
                      Sensitive: {testResult.breakdown.sensitive.toFixed(3)}점
                    </Typography>
                    <Typography variant="body2">
                      Questionable: {testResult.breakdown.questionable.toFixed(3)}점
                    </Typography>
                    <Typography variant="body2">
                      Explicit: {testResult.breakdown.explicit.toFixed(3)}점
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
          {tierDialog.mode === 'create' ? '등급 추가' : '등급 수정'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="등급명"
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
              label="최소 점수"
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
              label="최대 점수 (빈 값 = 무한대)"
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
              label="순서"
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
              label="색상 (Hex)"
              value={tierDialog.tier.color || ''}
              onChange={(e) =>
                setTierDialog({
                  ...tierDialog,
                  tier: { ...tierDialog.tier, color: e.target.value },
                })
              }
              fullWidth
              placeholder="#2196f3"
              helperText="예: #22c55e, #3b82f6, #f59e0b, #ef4444"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseTierDialog} disabled={saving}>
            취소
          </Button>
          <Button onClick={handleSaveTier} variant="contained" disabled={saving}>
            {saving ? <CircularProgress size={20} /> : '저장'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RatingScoreSettings;
