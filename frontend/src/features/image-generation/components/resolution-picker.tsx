import type { ReactNode } from 'react'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { Select } from '@/components/ui/select'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import { FormField } from '../image-generation-shared'

export type ResolutionOption = { value: string; label: string }

/** Provider limits for one pixel axis; each caller passes its own (NAI 64px grid, MiniMax 32px + node bounds, ...). */
export type DimensionBounds = { min?: number; max?: number; step?: number }

type DimensionAxis = 'width' | 'height'

/** Stack an optional slot (e.g. a module-graph input-port toggle) above one field. */
function FieldSlot({ above, children }: { above?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1">
      {above}
      {children}
    </div>
  )
}

type DimensionInputsProps = {
  width: string
  height: string
  onWidthCommit: (value: string) => void
  onHeightCommit: (value: string) => void
  widthLabel?: string
  heightLabel?: string
  bounds?: DimensionBounds
  /** Per-axis override when width and height have different limits. */
  heightBounds?: DimensionBounds
  renderAbove?: (axis: DimensionAxis) => ReactNode
  /** Wraps the pair in its own grid; omit to drop both fields straight into the parent grid. */
  className?: string
}

/** Width / height stepper pair shared by the NAI, Codex and MiniMax resolution controls. */
export function DimensionInputs({
  width,
  height,
  onWidthCommit,
  onHeightCommit,
  widthLabel,
  heightLabel,
  bounds,
  heightBounds = bounds,
  renderAbove,
  className,
}: DimensionInputsProps) {
  const { t } = useI18n()
  const fields = (
    <>
      <FieldSlot above={renderAbove?.('width')}>
        <FormField label={widthLabel ?? t({ ko: '너비', en: 'Width' })}>
          <NumberStepperInput min={bounds?.min} max={bounds?.max} step={bounds?.step} value={width} onValueCommit={onWidthCommit} />
        </FormField>
      </FieldSlot>
      <FieldSlot above={renderAbove?.('height')}>
        <FormField label={heightLabel ?? t({ ko: '높이', en: 'Height' })}>
          <NumberStepperInput min={heightBounds?.min} max={heightBounds?.max} step={heightBounds?.step} value={height} onValueCommit={onHeightCommit} />
        </FormField>
      </FieldSlot>
    </>
  )

  return className ? <div className={className}>{fields}</div> : fields
}

type OptionSelectFieldProps = {
  label: string
  hint?: string
  value: string
  options: readonly ResolutionOption[]
  onChange: (value: string) => void
  above?: ReactNode
}

function OptionSelectField({ label, hint, value, options, onChange, above }: OptionSelectFieldProps) {
  return (
    <FieldSlot above={above}>
      <FormField label={label}>
        <Tip content={hint}>
          <div>
            <Select value={value} onChange={(event) => onChange(event.target.value)}>
              {options.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </Select>
          </div>
        </Tip>
      </FormField>
    </FieldSlot>
  )
}

/** Preset list + free width/height (NAI): picking a preset fills W/H, editing W/H is the custom path. */
type PresetResolutionPickerProps = {
  mode: 'preset'
  preset: string
  presets: readonly ResolutionOption[]
  onPresetChange: (value: string) => void
  presetLabel?: string
} & Omit<DimensionInputsProps, 'className' | 'renderAbove'>

/** Aspect ratio + size tier (Codex, MiniMax Director): the provider derives pixels from the pair. */
type RatioResolutionPickerProps = {
  mode: 'ratio'
  ratio: string
  ratios: readonly ResolutionOption[]
  onRatioChange: (value: string) => void
  ratioLabel?: string
  tier: string
  tiers: readonly ResolutionOption[]
  onTierChange: (value: string) => void
  tierLabel?: string
  /** Short read-out shown as the tier select's tooltip, e.g. the resulting pixel size. */
  tierHint?: string
  renderAbove?: (slot: 'ratio' | 'tier') => ReactNode
}

export type ResolutionPickerProps = PresetResolutionPickerProps | RatioResolutionPickerProps

/**
 * Shared resolution control. Renders its fields without a wrapper so they sit in the caller's grid next to
 * other settings; every bound/option list comes from the caller so each provider keeps its own constraints.
 */
export function ResolutionPicker(props: ResolutionPickerProps) {
  const { t } = useI18n()

  if (props.mode === 'ratio') {
    return (
      <>
        <OptionSelectField
          label={props.ratioLabel ?? t({ ko: '비율', en: 'Aspect Ratio' })}
          value={props.ratio}
          options={props.ratios}
          onChange={props.onRatioChange}
          above={props.renderAbove?.('ratio')}
        />
        <OptionSelectField
          label={props.tierLabel ?? t({ ko: '해상도', en: 'Resolution' })}
          hint={props.tierHint}
          value={props.tier}
          options={props.tiers}
          onChange={props.onTierChange}
          above={props.renderAbove?.('tier')}
        />
      </>
    )
  }

  return (
    <>
      <OptionSelectField
        label={props.presetLabel ?? t({ ko: '해상도 프리셋', en: 'Preset' })}
        value={props.preset}
        options={props.presets}
        onChange={props.onPresetChange}
      />
      <DimensionInputs
        width={props.width}
        height={props.height}
        onWidthCommit={props.onWidthCommit}
        onHeightCommit={props.onHeightCommit}
        widthLabel={props.widthLabel}
        heightLabel={props.heightLabel}
        bounds={props.bounds}
        heightBounds={props.heightBounds}
      />
    </>
  )
}
