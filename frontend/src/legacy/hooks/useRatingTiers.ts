import { useState, useEffect, useCallback } from 'react';
import type { RatingTier } from '../types/rating';
import { ratingApi } from '../services/ratingApi';

interface UseRatingTiersReturn {
  tiers: RatingTier[];
  loading: boolean;
  error: string | null;
  getTierByScore: (score: number | null) => RatingTier | null;
  refetch: () => Promise<void>;
}

/**
 * Hook to fetch and manage rating tiers
 * Provides tier lookup by score functionality
 */
export function useRatingTiers(): UseRatingTiersReturn {
  const [tiers, setTiers] = useState<RatingTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTiers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const tiersData = await ratingApi.getAllTiers();

      // Sort by tier_order for consistent lookup
      const sortedTiers = [...tiersData].sort((a, b) => a.tier_order - b.tier_order);
      setTiers(sortedTiers);
      // console.log('[useRatingTiers] Loaded tiers:', sortedTiers.map(t => ({
      //   name: t.tier_name,
      //   min: t.min_score,
      //   max: t.max_score,
      //   color: t.color
      // })));
    } catch (err) {
      console.error('[useRatingTiers] Error fetching tiers:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTiers();
  }, [fetchTiers]);

  /**
   * Find the tier that matches a given score
   * Returns the tier where min_score <= score < max_score (or max_score is null)
   */
  const getTierByScore = useCallback((score: number | null): RatingTier | null => {
    if (score === null || score === undefined) return null;
    if (tiers.length === 0) return null;

    // Find the tier that contains this score
    const matchingTier = tiers.find(tier => {
      const meetsMin = score >= tier.min_score;
      const meetsMax = tier.max_score === null || score < tier.max_score;
      return meetsMin && meetsMax;
    });

    return matchingTier || null;
  }, [tiers]);

  return {
    tiers,
    loading,
    error,
    getTierByScore,
    refetch: fetchTiers,
  };
}
