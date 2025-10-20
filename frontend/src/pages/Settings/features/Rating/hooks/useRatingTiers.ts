import { useState, useEffect } from 'react';
import { ratingApi } from '../../../../../services/ratingApi';
import type { RatingTier, RatingTierInput } from '../../../../../types/rating';

interface TierDialog {
  open: boolean;
  mode: 'create' | 'edit';
  tier: Partial<RatingTierInput>;
  editId?: number;
}

export const useRatingTiers = () => {
  const [tiers, setTiers] = useState<RatingTier[]>([]);
  const [tiersLoading, setTiersLoading] = useState(true);
  const [tierDialog, setTierDialog] = useState<TierDialog>({
    open: false,
    mode: 'create',
    tier: {},
  });

  useEffect(() => {
    loadTiers();
  }, []);

  const loadTiers = async () => {
    setTiersLoading(true);
    try {
      const data = await ratingApi.getAllTiers();
      setTiers(data);
    } catch (error) {
      console.error('Failed to load tiers:', error);
      throw error;
    } finally {
      setTiersLoading(false);
    }
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
      throw new Error('Required fields missing');
    }

    try {
      if (mode === 'create') {
        await ratingApi.createTier(tier as RatingTierInput);
      } else if (editId) {
        await ratingApi.updateTier(editId, tier);
      }
      await loadTiers();
      handleCloseTierDialog();
      return mode;
    } catch (error) {
      console.error('Failed to save tier:', error);
      throw error;
    }
  };

  const handleDeleteTier = async (id: number) => {
    try {
      await ratingApi.deleteTier(id);
      await loadTiers();
    } catch (error) {
      console.error('Failed to delete tier:', error);
      throw error;
    }
  };

  return {
    tiers,
    tiersLoading,
    tierDialog,
    setTierDialog,
    loadTiers,
    handleOpenTierDialog,
    handleCloseTierDialog,
    handleSaveTier,
    handleDeleteTier,
  };
};
