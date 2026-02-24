import { useState, useEffect } from 'react';
import { ratingApi } from '../../../../../services/ratingApi';
import type {
  RatingData,
  RatingScoreResult,
  RatingWeights,
  RatingWeightsUpdate,
  RatingTier,
} from '../../../../../types/rating';
import { round3 } from '../utils/ratingHelpers';

export const useRatingCalculator = (
  weights: RatingWeights | null,
  localWeights: RatingWeightsUpdate,
  tiers: RatingTier[]
) => {
  const [testRating, setTestRating] = useState<RatingData>({
    general: 0.001,
    sensitive: 0.045,
    questionable: 0.735,
    explicit: 0.470,
  });
  const [testResult, setTestResult] = useState<RatingScoreResult | null>(null);
  const [testLoading, setTestLoading] = useState(false);
  const [previewResult, setPreviewResult] = useState<RatingScoreResult | null>(null);

  // Auto-calculate preview when weights change
  useEffect(() => {
    if (localWeights && Object.keys(localWeights).length > 0) {
      calculatePreview();
    }
  }, [localWeights, weights, tiers]);

  const calculatePreview = () => {
    if (!weights) return;

    try {
      const currentWeights: RatingWeightsUpdate = {
        general_weight: localWeights.general_weight ?? weights.general_weight,
        sensitive_weight: localWeights.sensitive_weight ?? weights.sensitive_weight,
        questionable_weight: localWeights.questionable_weight ?? weights.questionable_weight,
        explicit_weight: localWeights.explicit_weight ?? weights.explicit_weight,
      };

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
    } catch (error) {
      console.error('Failed to calculate preview:', error);
    }
  };

  const handleCalculateTest = async () => {
    setTestLoading(true);
    try {
      const result = await ratingApi.calculateScore(testRating);
      setTestResult(result);
    } catch (error) {
      console.error('Failed to calculate score:', error);
      throw error;
    } finally {
      setTestLoading(false);
    }
  };

  return {
    testRating,
    testResult,
    testLoading,
    previewResult,
    setTestRating,
    handleCalculateTest,
  };
};
