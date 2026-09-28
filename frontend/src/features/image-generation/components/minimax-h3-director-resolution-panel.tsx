import type { ReactNode } from 'react'
import type { WorkflowNodeNumericBounds } from '@/lib/api-image-generation-types'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { FormField } from '../image-generation-shared'
import { DimensionInputs, ResolutionPicker } from './resolution-picker'
import {
  MINIMAX_H3_DIRECTOR_ASPECT_OPTIONS,
  MINIMAX_H3_DIRECTOR_INPUT_SCALING_OPTIONS,
  MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS,
  type MiniMaxH3DirectorGraphInputKey,
  type MiniMaxH3DirectorResolutionState,
} from './minimax-h3-director-dasiwa-utils'

type MiniMaxH3DirectorResolutionPanelProps = {
  value: MiniMaxH3DirectorResolutionState
  canvas: [number, number]
  numericBounds?: WorkflowNodeNumericBounds
  hiddenControls?: string[]
  onChange: (value: MiniMaxH3DirectorResolutionState) => void
  renderInputPort?: (inputKey: MiniMaxH3DirectorGraphInputKey) => ReactNode
}

/** DaSiWa v0.4.30-compatible aspect, pixel-budget, and reference-scaling controls. */
export function MiniMaxH3DirectorResolutionPanel({ value, canvas, numericBounds, hiddenControls, onChange, renderInputPort }: MiniMaxH3DirectorResolutionPanelProps) {
  const { t } = useI18n()
  const patch = (next: Partial<MiniMaxH3DirectorResolutionState>) => onChange({ ...value, ...next })
  const mpBounds = numericBounds?.resolution_mp
  const presets = Object.entries(MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS).filter(([, mp]) =>
    mp >= (mpBounds?.min ?? 0) && mp <= (mpBounds?.max ?? Infinity))

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-foreground">{t({ ko: '출력 규격', en: 'Output dimensions' })}</div>
        <div className="text-xs tabular-nums text-primary">{canvas[0]} × {canvas[1]} · 32px</div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 13rem), 1fr))' }}>
        <ResolutionPicker
          mode="ratio"
          ratio={value.aspect}
          ratios={MINIMAX_H3_DIRECTOR_ASPECT_OPTIONS.map(([id, label]) => ({ value: id, label }))}
          onRatioChange={(aspect) => patch({ aspect: aspect as MiniMaxH3DirectorResolutionState['aspect'] })}
          ratioLabel={t({ ko: '비율', en: 'Aspect' })}
          tier={value.resolution}
          tiers={[
            { value: 'auto', label: 'Auto' },
            ...presets.map(([preset]) => ({ value: preset, label: preset })),
            { value: 'custom', label: 'CUSTOM' },
          ]}
          onTierChange={(resolution) => patch({ resolution: resolution as MiniMaxH3DirectorResolutionState['resolution'] })}
          tierLabel={t({ ko: '해상도 / 메가픽셀', en: 'Resolution / megapixels' })}
          renderAbove={(slot) => renderInputPort?.(slot === 'ratio' ? 'resolution.aspect' : 'resolution.resolution')}
        />

        {!hiddenControls?.includes('resolution.input_scaling') ? <div className="space-y-1">
          {renderInputPort?.('resolution.input_scaling')}
          <FormField label={t({ ko: '입력 스케일링', en: 'Input scaling' })}>
            <Select value={value.input_scaling} onChange={(event) => patch({ input_scaling: event.target.value as MiniMaxH3DirectorResolutionState['input_scaling'] })}>
              {MINIMAX_H3_DIRECTOR_INPUT_SCALING_OPTIONS.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </Select>
          </FormField>
        </div> : null}
      </div>

      {value.aspect === 'custom' ? (
        <DimensionInputs
          className="grid grid-cols-2 gap-3 sm:max-w-md"
          width={String(value.custom_aspect_w)}
          height={String(value.custom_aspect_h)}
          widthLabel={t({ ko: '비율 너비', en: 'Ratio width' })}
          heightLabel={t({ ko: '비율 높이', en: 'Ratio height' })}
          bounds={{ min: 1, step: 1 }}
          onWidthCommit={(next) => patch({ custom_aspect_w: Math.max(1, Number(next)) })}
          onHeightCommit={(next) => patch({ custom_aspect_h: Math.max(1, Number(next)) })}
          renderAbove={(axis) => renderInputPort?.(axis === 'width' ? 'resolution.custom_aspect_w' : 'resolution.custom_aspect_h')}
        />
      ) : null}

      {value.resolution === 'custom' ? (
        <div className="space-y-3">
          <div className="max-w-xs space-y-1">
            {renderInputPort?.('resolution.custom_mode')}
            <FormField label={t({ ko: 'CUSTOM 방식', en: 'CUSTOM mode' })}>
              <Select value={value.custom_mode} onChange={(event) => patch({ custom_mode: event.target.value === 'fixed' ? 'fixed' : 'mp' })}>
                <option value="mp">{t({ ko: '메가픽셀', en: 'Megapixels' })}</option>
                <option value="fixed">{t({ ko: '고정 픽셀', en: 'Fixed pixels' })}</option>
              </Select>
            </FormField>
          </div>
          {value.custom_mode === 'mp' ? (
            <div className="max-w-xs space-y-1">
              {renderInputPort?.('resolution.custom_mp')}
              <FormField label="MP">
                <NumberStepperInput min={mpBounds?.min ?? 0.01} max={mpBounds?.max} step={0.01} value={String(value.custom_mp)} onValueCommit={(next) => patch({ custom_mp: Number(next) })} />
              </FormField>
            </div>
          ) : (
            <DimensionInputs
              className="grid grid-cols-2 gap-3 sm:max-w-md"
              width={String(value.custom_width)}
              height={String(value.custom_height)}
              widthLabel={t({ ko: '고정 너비', en: 'Fixed width' })}
              heightLabel={t({ ko: '고정 높이', en: 'Fixed height' })}
              bounds={{ min: numericBounds?.width?.min ?? 32, max: numericBounds?.width?.max, step: 32 }}
              heightBounds={{ min: numericBounds?.height?.min ?? 32, max: numericBounds?.height?.max, step: 32 }}
              onWidthCommit={(next) => patch({ custom_width: Number(next) })}
              onHeightCommit={(next) => patch({ custom_height: Number(next) })}
              renderAbove={(axis) => renderInputPort?.(axis === 'width' ? 'resolution.custom_width' : 'resolution.custom_height')}
            />
          )}
        </div>
      ) : null}
    </section>
  )
}
