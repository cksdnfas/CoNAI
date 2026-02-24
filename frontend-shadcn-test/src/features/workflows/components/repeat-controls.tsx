import { Repeat2, Square } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'

export interface RepeatConfig {
  enabled: boolean
  count: number
  delaySeconds: number
}

export interface RepeatState {
  isRunning: boolean
  currentIteration: number
  totalIterations: number
}

interface RepeatControlsProps {
  config: RepeatConfig
  state: RepeatState
  onConfigChange: (config: RepeatConfig) => void
  onStop: () => void
  namespace?: 'imageGeneration' | 'workflows'
}

export default function RepeatControls({
  config,
  state,
  onConfigChange,
  onStop,
  namespace = 'imageGeneration',
}: RepeatControlsProps) {
  const { t } = useTranslation([namespace])

  const getKey = (key: string) => {
    if (namespace === 'imageGeneration') {
      return `nai.repeat.${key}`
    }
    return `repeat.${key}`
  }

  const handleEnabledChange = (checked: boolean) => {
    onConfigChange({ ...config, enabled: checked })
  }

  const handleCountChange = (value: string) => {
    const numValue = parseInt(value, 10)
    if (!Number.isNaN(numValue) && numValue >= -1 && numValue <= 999) {
      onConfigChange({ ...config, count: numValue })
    }
  }

  const handleDelayChange = (value: string) => {
    const numValue = parseInt(value, 10)
    if (!Number.isNaN(numValue) && numValue >= 1 && numValue <= 300) {
      onConfigChange({ ...config, delaySeconds: numValue })
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Repeat2 className="h-4 w-4" />
        <h3 className="text-sm font-semibold">{t(getKey('title'))}</h3>
      </div>
      <Separator />

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(event) => handleEnabledChange(event.target.checked)}
          disabled={state.isRunning}
        />
        {t(getKey('enable'))}
      </label>

      {config.enabled ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t(getKey('count'))}</p>
            <Input
              type="number"
              value={config.count}
              onChange={(event) => handleCountChange(event.target.value)}
              disabled={state.isRunning}
              min={-1}
              max={999}
            />
            <p className="text-xs text-muted-foreground">{config.count === -1 ? t(getKey('infinite')) : t(getKey('countHelp'))}</p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t(getKey('delay'))}</p>
            <Input
              type="number"
              value={config.delaySeconds}
              onChange={(event) => handleDelayChange(event.target.value)}
              disabled={state.isRunning}
              min={1}
              max={300}
            />
            <p className="text-xs text-muted-foreground">{t(getKey('delayHelp'))}</p>
          </div>

          {state.isRunning ? (
            <div className="space-y-2">
              <Badge>
                {config.count === -1
                  ? t(getKey('progress'), { current: state.currentIteration })
                  : t(getKey('progressWithTotal'), { current: state.currentIteration, total: state.totalIterations })}
              </Badge>
              <Button type="button" variant="outline" className="w-full" onClick={onStop}>
                <Square className="h-4 w-4" />
                {t(getKey('stop'))}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
