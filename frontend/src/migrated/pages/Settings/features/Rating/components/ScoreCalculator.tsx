import React from 'react'
import { Calculator } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import type { RatingData, RatingScoreResult } from '../../../../../types/rating'

interface ScoreCalculatorProps {
  testRating: RatingData
  testResult: RatingScoreResult | null
  testLoading: boolean
  onUpdateTestRating: (updates: RatingData) => void
  onCalculateTest: () => void
}

function RatioRow({
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
        max={1}
        step={0.001}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full"
      />
      <div className="text-muted-foreground flex justify-between text-xs">
        <span>0.0</span>
        <span>0.5</span>
        <span>1.0</span>
      </div>
    </div>
  )
}

export const ScoreCalculator: React.FC<ScoreCalculatorProps> = ({
  testRating,
  testResult,
  testLoading,
  onUpdateTestRating,
  onCalculateTest,
}) => {
  const { t } = useTranslation('settings')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('rating.calculator.title')}</CardTitle>
        <CardDescription>{t('rating.calculator.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <RatioRow
          label={t('rating.calculator.general', { value: testRating.general.toFixed(3) })}
          value={testRating.general}
          onChange={(value) => onUpdateTestRating({ ...testRating, general: value })}
        />

        <RatioRow
          label={t('rating.calculator.sensitive', { value: testRating.sensitive.toFixed(3) })}
          value={testRating.sensitive}
          onChange={(value) => onUpdateTestRating({ ...testRating, sensitive: value })}
        />

        <RatioRow
          label={t('rating.calculator.questionable', { value: testRating.questionable.toFixed(3) })}
          value={testRating.questionable}
          onChange={(value) => onUpdateTestRating({ ...testRating, questionable: value })}
        />

        <RatioRow
          label={t('rating.calculator.explicit', { value: testRating.explicit.toFixed(3) })}
          value={testRating.explicit}
          onChange={(value) => onUpdateTestRating({ ...testRating, explicit: value })}
        />

        <Button onClick={onCalculateTest} disabled={testLoading}>
          {testLoading ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" /> : <Calculator className="h-4 w-4" />}
          {testLoading ? t('rating.calculator.calculating') : t('rating.calculator.calculate')}
        </Button>

        {testResult ? (
          <Alert>
            <AlertDescription className="space-y-3">
              <div className="font-medium">{t('rating.calculator.result.title')}</div>
              <div className="flex items-center gap-2">
                <span>{t('rating.calculator.result.score', { score: testResult.score.toFixed(2) })}</span>
                {testResult.tier ? (
                  <Badge style={{ backgroundColor: testResult.tier.color || undefined, color: '#fff' }}>
                    {testResult.tier.tier_name}
                  </Badge>
                ) : null}
              </div>
              <Separator />
              <div className="text-muted-foreground text-xs">{t('rating.calculator.result.breakdown')}</div>
              <div className="space-y-1 text-sm">
                <div>{t('rating.calculator.result.generalScore', { score: testResult.breakdown.general.toFixed(3) })}</div>
                <div>{t('rating.calculator.result.sensitiveScore', { score: testResult.breakdown.sensitive.toFixed(3) })}</div>
                <div>{t('rating.calculator.result.questionableScore', { score: testResult.breakdown.questionable.toFixed(3) })}</div>
                <div>{t('rating.calculator.result.explicitScore', { score: testResult.breakdown.explicit.toFixed(3) })}</div>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
