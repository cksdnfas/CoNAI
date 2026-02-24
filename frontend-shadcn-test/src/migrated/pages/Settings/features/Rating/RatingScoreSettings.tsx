import React, { useState } from 'react';
import {
  Box,
  Alert,
  CircularProgress,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

// Hooks
import { useRatingWeights } from './hooks/useRatingWeights';
import { useRatingTiers } from './hooks/useRatingTiers';
import { useRatingCalculator } from './hooks/useRatingCalculator';

// Components
import { WeightConfiguration } from './components/WeightConfiguration';
import { TierManagement } from './components/TierManagement';
import { TierDialog } from './components/TierDialog';
import { ScoreCalculator } from './components/ScoreCalculator';
import { RatingScoreRecalculation } from './components/RatingScoreRecalculation';

const RatingScoreSettings: React.FC = () => {
  const { t } = useTranslation('settings');

  // Global state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Hooks
  const {
    weights,
    localWeights,
    weightsLoading,
    weightsHasChanges,
    setLocalWeights,
    handleSaveWeights,
    handleResetWeights,
  } = useRatingWeights();

  const {
    tiers,
    tiersLoading,
    tierDialog,
    setTierDialog,
    handleOpenTierDialog,
    handleCloseTierDialog,
    handleSaveTier,
    handleDeleteTier,
  } = useRatingTiers();

  const {
    testRating,
    testResult,
    testLoading,
    previewResult,
    setTestRating,
    handleCalculateTest,
  } = useRatingCalculator(weights, localWeights, tiers);

  // Handlers with error handling
  const onSaveWeights = async () => {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await handleSaveWeights();
      setSuccessMessage(t('rating.weights.alerts.saveSuccess'));
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(t('rating.weights.alerts.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const onSaveTier = async () => {
    setSaving(true);
    setError(null);
    try {
      const mode = await handleSaveTier();
      setSuccessMessage(
        mode === 'create'
          ? t('rating.tiers.alerts.created')
          : t('rating.tiers.alerts.updated')
      );
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      if (err.message === 'Required fields missing') {
        setError(t('rating.tiers.dialog.requiredFields'));
      } else {
        setError(t('rating.tiers.alerts.saveFailed'));
      }
    } finally {
      setSaving(false);
    }
  };

  const onDeleteTier = async (id: number) => {
    setSaving(true);
    setError(null);
    try {
      await handleDeleteTier(id);
      setSuccessMessage(t('rating.tiers.alerts.deleted'));
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(t('rating.tiers.alerts.deleteFailed'));
    } finally {
      setSaving(false);
    }
  };

  const onCalculateTest = async () => {
    setError(null);
    try {
      await handleCalculateTest();
    } catch (err) {
      setError(t('rating.calculator.failed'));
    }
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
      <WeightConfiguration
        weights={weights}
        localWeights={localWeights}
        weightsHasChanges={weightsHasChanges}
        saving={saving}
        previewResult={previewResult}
        onUpdateWeights={setLocalWeights}
        onSaveWeights={onSaveWeights}
        onResetWeights={handleResetWeights}
      />

      {/* Section 2: Tier Configuration */}
      <TierManagement
        tiers={tiers}
        saving={saving}
        onOpenTierDialog={handleOpenTierDialog}
        onDeleteTier={onDeleteTier}
      />

      {/* Section 3: Score Calculator */}
      <ScoreCalculator
        testRating={testRating}
        testResult={testResult}
        testLoading={testLoading}
        onUpdateTestRating={setTestRating}
        onCalculateTest={onCalculateTest}
      />

      {/* Section 4: Recalculate All Rating Scores */}
      <RatingScoreRecalculation />

      {/* Tier Edit/Create Dialog */}
      <TierDialog
        open={tierDialog.open}
        mode={tierDialog.mode}
        tier={tierDialog.tier}
        saving={saving}
        onClose={handleCloseTierDialog}
        onSave={onSaveTier}
        onUpdateTier={(updates) =>
          setTierDialog({
            ...tierDialog,
            tier: { ...tierDialog.tier, ...updates },
          })
        }
      />
    </Box>
  );
};

export default RatingScoreSettings;
