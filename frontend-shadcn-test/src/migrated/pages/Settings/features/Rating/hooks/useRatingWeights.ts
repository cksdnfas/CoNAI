import { useState, useEffect } from 'react';
import { ratingApi } from '../../../../../services/ratingApi';
import type { RatingWeights, RatingWeightsUpdate } from '../../../../../types/rating';

export const useRatingWeights = () => {
  const [weights, setWeights] = useState<RatingWeights | null>(null);
  const [localWeights, setLocalWeights] = useState<RatingWeightsUpdate>({});
  const [weightsLoading, setWeightsLoading] = useState(true);
  const [weightsHasChanges, setWeightsHasChanges] = useState(false);

  useEffect(() => {
    loadWeights();
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

  const loadWeights = async () => {
    setWeightsLoading(true);
    try {
      const data = await ratingApi.getWeights();
      setWeights(data);
      setLocalWeights({});
    } catch (error) {
      console.error('Failed to load weights:', error);
      throw error;
    } finally {
      setWeightsLoading(false);
    }
  };

  const handleSaveWeights = async () => {
    if (!weightsHasChanges) return;

    try {
      const updated = await ratingApi.updateWeights(localWeights);
      setWeights(updated);
      setLocalWeights({});
      return updated;
    } catch (error) {
      console.error('Failed to save weights:', error);
      throw error;
    }
  };

  const handleResetWeights = () => {
    setLocalWeights({});
  };

  return {
    weights,
    localWeights,
    weightsLoading,
    weightsHasChanges,
    setLocalWeights,
    loadWeights,
    handleSaveWeights,
    handleResetWeights,
  };
};
