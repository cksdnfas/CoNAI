import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  CircularProgress,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { RatingTierInput } from '../../../../../types/rating';

interface TierDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  tier: Partial<RatingTierInput>;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  onUpdateTier: (updates: Partial<RatingTierInput>) => void;
}

export const TierDialog: React.FC<TierDialogProps> = ({
  open,
  mode,
  tier,
  saving,
  onClose,
  onSave,
  onUpdateTier,
}) => {
  const { t } = useTranslation('settings');

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {mode === 'create'
          ? t('rating.tiers.dialog.createTitle')
          : t('rating.tiers.dialog.editTitle')}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label={t('rating.tiers.dialog.tierName')}
            value={tier.tier_name || ''}
            onChange={(e) => onUpdateTier({ tier_name: e.target.value })}
            fullWidth
            required
          />
          <TextField
            label={t('rating.tiers.dialog.minScore')}
            type="number"
            value={tier.min_score ?? ''}
            onChange={(e) => onUpdateTier({ min_score: parseFloat(e.target.value) })}
            fullWidth
            required
          />
          <TextField
            label={t('rating.tiers.dialog.maxScore')}
            type="number"
            value={tier.max_score ?? ''}
            onChange={(e) =>
              onUpdateTier({
                max_score: e.target.value === '' ? null : parseFloat(e.target.value),
              })
            }
            fullWidth
          />
          <TextField
            label={t('rating.tiers.dialog.order')}
            type="number"
            value={tier.tier_order ?? ''}
            onChange={(e) => onUpdateTier({ tier_order: parseInt(e.target.value, 10) })}
            fullWidth
            required
          />
          <TextField
            label={t('rating.tiers.dialog.color')}
            value={tier.color || ''}
            onChange={(e) => onUpdateTier({ color: e.target.value })}
            fullWidth
            placeholder={t('rating.tiers.dialog.colorPlaceholder')}
            helperText={t('rating.tiers.dialog.colorHelper')}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('rating.tiers.dialog.cancel')}
        </Button>
        <Button onClick={onSave} variant="contained" disabled={saving}>
          {saving ? <CircularProgress size={20} /> : t('rating.tiers.dialog.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
