import React from 'react'
import { CircleHelp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

interface SimilarityThresholdsProps {
  duplicateThreshold: number
  similarThreshold: number
  colorThreshold: number
  searchLimit: number
  onSetDuplicateThreshold: (value: number) => void
  onSetSimilarThreshold: (value: number) => void
  onSetColorThreshold: (value: number) => void
  onSetSearchLimit: (value: number) => void
}

function ThresholdRow({
  label,
  value,
  min,
  max,
  step,
  marks,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  marks: [string, string, string]
  onChange: (value: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full"
      />
      <div className="text-muted-foreground flex justify-between text-xs">
        <span>{marks[0]}</span>
        <span>{marks[1]}</span>
        <span>{marks[2]}</span>
      </div>
    </div>
  )
}

export const SimilarityThresholds: React.FC<SimilarityThresholdsProps> = ({
  duplicateThreshold,
  similarThreshold,
  colorThreshold,
  searchLimit,
  onSetDuplicateThreshold,
  onSetSimilarThreshold,
  onSetColorThreshold,
  onSetSearchLimit,
}) => {
  const { t } = useTranslation('settings')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1">
          {t('similarity.thresholds.title')}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" className="text-muted-foreground">
                  <CircleHelp className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('similarity.thresholds.localStorageNote')}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <ThresholdRow
          label={t('similarity.thresholds.duplicate.label', { value: duplicateThreshold })}
          value={duplicateThreshold}
          min={0}
          max={10}
          step={1}
          marks={[
            t('similarity.thresholds.duplicate.strict'),
            t('similarity.thresholds.duplicate.recommended'),
            t('similarity.thresholds.duplicate.lenient'),
          ]}
          onChange={onSetDuplicateThreshold}
        />

        <ThresholdRow
          label={t('similarity.thresholds.similar.label', { value: similarThreshold })}
          value={similarThreshold}
          min={5}
          max={25}
          step={1}
          marks={[
            t('similarity.thresholds.similar.strict'),
            t('similarity.thresholds.similar.recommended'),
            t('similarity.thresholds.similar.lenient'),
          ]}
          onChange={onSetSimilarThreshold}
        />

        <ThresholdRow
          label={t('similarity.thresholds.color.label', { value: colorThreshold })}
          value={colorThreshold}
          min={70}
          max={100}
          step={5}
          marks={[
            t('similarity.thresholds.color.min'),
            t('similarity.thresholds.color.recommended'),
            t('similarity.thresholds.color.max'),
          ]}
          onChange={onSetColorThreshold}
        />

        <div className="space-y-1">
          <label htmlFor="search-limit" className="text-sm font-medium">
            {t('similarity.thresholds.searchLimit.label')}
          </label>
          <select
            id="search-limit"
            className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
            value={searchLimit}
            onChange={(event) => onSetSearchLimit(Number(event.target.value))}
          >
            <option value={10}>{t('similarity.thresholds.searchLimit.options.10')}</option>
            <option value={20}>{t('similarity.thresholds.searchLimit.options.20')}</option>
            <option value={50}>{t('similarity.thresholds.searchLimit.options.50')}</option>
            <option value={100}>{t('similarity.thresholds.searchLimit.options.100')}</option>
          </select>
        </div>
      </CardContent>
    </Card>
  )
}
