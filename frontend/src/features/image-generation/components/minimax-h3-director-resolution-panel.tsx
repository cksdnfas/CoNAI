import type { ReactNode } from 'react'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'
import { FormField } from '../image-generation-shared'
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
  onChange: (value: MiniMaxH3DirectorResolutionState) => void
  renderInputPort?: (inputKey: MiniMaxH3DirectorGraphInputKey) => ReactNode
}

/** DaSiWa v0.4.30-compatible aspect, pixel-budget, and reference-scaling controls. */
export function MiniMaxH3DirectorResolutionPanel({ value, canvas, onChange, renderInputPort }: MiniMaxH3DirectorResolutionPanelProps) {
  const { t } = useI18n()
  const patch = (next: Partial<MiniMaxH3DirectorResolutionState>) => onChange({ ...value, ...next })

  return (
    <section className="space-y-3 rounded-sm border border-border/80 bg-surface-low/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-foreground">{t({ ko: '출력 규격', en: 'Output dimensions' })}</div>
        <div className="text-xs tabular-nums text-primary">{canvas[0]} × {canvas[1]} · 32px</div>
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 13rem), 1fr))' }}>
        <div className="space-y-1">
          {renderInputPort?.('resolution.aspect')}
          <FormField label={t({ ko: '비율', en: 'Aspect' })}>
            <Select value={value.aspect} onChange={(event) => patch({ aspect: event.target.value as MiniMaxH3DirectorResolutionState['aspect'] })}>
              {MINIMAX_H3_DIRECTOR_ASPECT_OPTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </Select>
          </FormField>
        </div>

        <div className="space-y-1">
          {renderInputPort?.('resolution.resolution')}
          <FormField label={t({ ko: '해상도 / 메가픽셀', en: 'Resolution / megapixels' })}>
            <Select value={value.resolution} onChange={(event) => patch({ resolution: event.target.value as MiniMaxH3DirectorResolutionState['resolution'] })}>
              <option value="auto">{t({ ko: 'Auto · 짧은 변 768px', en: 'Auto · short edge 768px' })}</option>
              {Object.keys(MINIMAX_H3_DIRECTOR_RESOLUTION_PRESETS).map((preset) => <option key={preset} value={preset}>{preset}</option>)}
              <option value="custom">CUSTOM</option>
            </Select>
          </FormField>
        </div>

        <div className="space-y-1">
          {renderInputPort?.('resolution.input_scaling')}
          <FormField label={t({ ko: '입력 스케일링', en: 'Input scaling' })}>
            <Select value={value.input_scaling} onChange={(event) => patch({ input_scaling: event.target.value as MiniMaxH3DirectorResolutionState['input_scaling'] })}>
              {MINIMAX_H3_DIRECTOR_INPUT_SCALING_OPTIONS.map((option) => (
                <option key={option} value={option}>{option === 'Auto' ? t({ ko: 'Auto · 짧은 변 최대 2048px', en: 'Auto · short edge up to 2048px' }) : option}</option>
              ))}
            </Select>
          </FormField>
        </div>
      </div>

      {value.aspect === 'custom' ? (
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <div className="space-y-1">
            {renderInputPort?.('resolution.custom_aspect_w')}
            <FormField label={t({ ko: '비율 너비', en: 'Ratio width' })}>
              <NumberStepperInput min={1} step={1} value={String(value.custom_aspect_w)} onValueCommit={(next) => patch({ custom_aspect_w: Math.max(1, Number(next)) })} />
            </FormField>
          </div>
          <div className="space-y-1">
            {renderInputPort?.('resolution.custom_aspect_h')}
            <FormField label={t({ ko: '비율 높이', en: 'Ratio height' })}>
              <NumberStepperInput min={1} step={1} value={String(value.custom_aspect_h)} onValueCommit={(next) => patch({ custom_aspect_h: Math.max(1, Number(next)) })} />
            </FormField>
          </div>
        </div>
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
                <NumberStepperInput min={0.01} step={0.01} value={String(value.custom_mp)} onValueCommit={(next) => patch({ custom_mp: Math.max(0.01, Number(next)) })} />
              </FormField>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              <div className="space-y-1">
                {renderInputPort?.('resolution.custom_width')}
                <FormField label={t({ ko: '고정 너비', en: 'Fixed width' })}>
                  <NumberStepperInput min={32} step={32} value={String(value.custom_width)} onValueCommit={(next) => patch({ custom_width: Math.max(32, Number(next)) })} />
                </FormField>
              </div>
              <div className="space-y-1">
                {renderInputPort?.('resolution.custom_height')}
                <FormField label={t({ ko: '고정 높이', en: 'Fixed height' })}>
                  <NumberStepperInput min={32} step={32} value={String(value.custom_height)} onValueCommit={(next) => patch({ custom_height: Math.max(32, Number(next)) })} />
                </FormField>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <p className="text-[11px] text-muted-foreground">
        {t({
          ko: 'Auto 비율은 슬롯·순서상 첫 이미지/영상의 원본 크기를 사용해. 모든 결과는 MiniMax H3용 32픽셀 격자로 맞춰져.',
          en: 'Auto aspect uses the first image or video by slot and order. Every result is aligned to MiniMax H3\'s 32-pixel grid.',
        })}
      </p>
    </section>
  )
}
