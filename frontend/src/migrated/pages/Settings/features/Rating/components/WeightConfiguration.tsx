import React from 'react'
import { Calculator } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { RatingWeights, RatingWeightsUpdate, RatingScoreResult } from '../../../../../types/rating'
import { getCurrentWeight } from '../utils/ratingHelpers'

interface WeightConfigurationProps {
  weights: RatingWeights | null
  localWeights: RatingWeightsUpdate
  weightsHasChanges: boolean
  saving: boolean
  previewResult: RatingScoreResult | null
  onUpdateWeights: (updates: RatingWeightsUpdate) => void
  onSaveWeights: () => void
  onResetWeights: () => void
}

function SliderRow({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full"
      />
      <div className="text-muted-foreground flex justify-between text-xs">
        <span>0</span>
        <span>50</span>
        <span>100</span>
      </div>
    </div>
  )
}

export const WeightConfiguration: React.FC<WeightConfigurationProps> = ({
  weights,
  localWeights,
  weightsHasChanges,
  saving,
  previewResult,
  onUpdateWeights,
  onSaveWeights,
  onResetWeights,
}) => {
  const { t } = useTranslation('settings')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('rating.weights.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <SliderRow
          label={t('rating.weights.general', { value: getCurrentWeight(weights, localWeights, 'general_weight') })}
          value={getCurrentWeight(weights, localWeights, 'general_weight')}
          onChange={(value) => onUpdateWeights({ ...localWeights, general_weight: value })}
        />

        <SliderRow
          label={t('rating.weights.sensitive', { value: getCurrentWeight(weights, localWeights, 'sensitive_weight') })}
          value={getCurrentWeight(weights, localWeights, 'sensitive_weight')}
          onChange={(value) => onUpdateWeights({ ...localWeights, sensitive_weight: value })}
        />

        <SliderRow
          label={t('rating.weights.questionable', {
            value: getCurrentWeight(weights, localWeights, 'questionable_weight'),
          })}
          value={getCurrentWeight(weights, localWeights, 'questionable_weight')}
          onChange={(value) => onUpdateWeights({ ...localWeights, questionable_weight: value })}
        />

        <SliderRow
          label={t('rating.weights.explicit', { value: getCurrentWeight(weights, localWeights, 'explicit_weight') })}
          value={getCurrentWeight(weights, localWeights, 'explicit_weight')}
          onChange={(value) => onUpdateWeights({ ...localWeights, explicit_weight: value })}
        />

        {previewResult ? (
          <Alert>
            <Calculator className="h-4 w-4" />
            <AlertDescription className="space-y-2">
              <div className="font-medium">{t('rating.weights.preview.title')}</div>
              <div className="flex items-center gap-2">
                <span>{t('rating.weights.preview.score', { score: previewResult.score.toFixed(2) })}</span>
                {previewResult.tier ? (
                  <Badge style={{ backgroundColor: previewResult.tier.color || undefined, color: '#fff' }}>
                    {previewResult.tier.tier_name}
                  </Badge>
                ) : null}
              </div>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex gap-2">
          <Button
            onClick={onSaveWeights}
            disabled={!weightsHasChanges || saving}
            className="flex-1"
          >
            {saving ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" /> : t('rating.weights.buttons.save')}
          </Button>
          <Button
            variant="outline"
            onClick={onResetWeights}
            disabled={!weightsHasChanges || saving}
            className="flex-1"
          >
            {t('rating.weights.buttons.cancel')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
