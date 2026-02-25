import type { RatingWeights, RatingWeightsUpdate } from '../../../../../types/rating';

export const getCurrentWeight = (
  weights: RatingWeights | null,
  localWeights: RatingWeightsUpdate,
  key: keyof RatingWeightsUpdate
): number => {
  if (!weights) return 0;
  const localValue = localWeights[key];
  if (localValue !== undefined) return localValue;

  const weightKey = key as 'general_weight' | 'sensitive_weight' | 'questionable_weight' | 'explicit_weight';
  return weights[weightKey] ?? 0;
};

export const round3 = (value: number): number => Math.round(value * 1000) / 1000;
