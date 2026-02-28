import React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { RatingTierInput } from '../../../../../types/rating'

interface TierDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  tier: Partial<RatingTierInput>
  saving: boolean
  onClose: () => void
  onSave: () => void
  onUpdateTier: (updates: Partial<RatingTierInput>) => void
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
  const { t } = useTranslation('settings')

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? onClose() : undefined)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? t('rating.tiers.dialog.createTitle') : t('rating.tiers.dialog.editTitle')}
          </DialogTitle>
          <DialogDescription>{t('rating.tiers.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <label htmlFor="tier-name" className="text-sm font-medium">{t('rating.tiers.dialog.tierName')}</label>
            <Input
              id="tier-name"
              value={tier.tier_name || ''}
              onChange={(event) => onUpdateTier({ tier_name: event.target.value })}
              required
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="tier-min-score" className="text-sm font-medium">{t('rating.tiers.dialog.minScore')}</label>
            <Input
              id="tier-min-score"
              type="number"
              value={tier.min_score ?? ''}
              onChange={(event) => onUpdateTier({ min_score: Number(event.target.value) })}
              required
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="tier-max-score" className="text-sm font-medium">{t('rating.tiers.dialog.maxScore')}</label>
            <Input
              id="tier-max-score"
              type="number"
              value={tier.max_score ?? ''}
              onChange={(event) =>
                onUpdateTier({
                  max_score: event.target.value === '' ? null : Number(event.target.value),
                })
              }
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="tier-order" className="text-sm font-medium">{t('rating.tiers.dialog.order')}</label>
            <Input
              id="tier-order"
              type="number"
              value={tier.tier_order ?? ''}
              onChange={(event) => onUpdateTier({ tier_order: Number.parseInt(event.target.value, 10) })}
              required
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="tier-color" className="text-sm font-medium">{t('rating.tiers.dialog.color')}</label>
            <Input
              id="tier-color"
              value={tier.color || ''}
              onChange={(event) => onUpdateTier({ color: event.target.value })}
              placeholder={t('rating.tiers.dialog.colorPlaceholder')}
            />
            <p className="text-muted-foreground text-xs">{t('rating.tiers.dialog.colorHelper')}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('rating.tiers.dialog.cancel')}
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" /> : t('rating.tiers.dialog.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
