import { useState, type Dispatch, type SetStateAction } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { NAIParams } from '../types/nai.types'

interface NAISamplingSettingsProps {
  params: NAIParams
  onChange: Dispatch<SetStateAction<NAIParams>>
  disabled?: boolean
}

const SAMPLER_LABELS: Record<string, string> = {
  k_euler: 'Euler',
  k_euler_ancestral: 'Euler Ancestral',
  k_dpmpp_2m: 'DPM++ 2M',
  ddim: 'DDIM',
}

export default function NAISamplingSettings({ params, onChange, disabled = false }: NAISamplingSettingsProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const samplerLabel = SAMPLER_LABELS[params.sampler] ?? params.sampler

  return (
    <section className="space-y-4 rounded-md border p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">AI Settings</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 px-2"
          onClick={() => setShowAdvanced((previous) => !previous)}
        >
          {showAdvanced ? 'Hide advanced' : 'Show advanced'}
          {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      <div className="grid gap-2 rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground md:grid-cols-4">
        <div>
          <span className="font-medium text-foreground">Steps</span> {params.steps}
        </div>
        <div>
          <span className="font-medium text-foreground">Guidance</span> {params.scale}
        </div>
        <div>
          <span className="font-medium text-foreground">Seed</span> {params.seed ?? 'Random'}
        </div>
        <div>
          <span className="font-medium text-foreground">Sampler</span> {samplerLabel}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label htmlFor="nai-sampler" className="grid gap-2 text-sm">
          <span>Sampler</span>
          <Select
            value={params.sampler}
            onValueChange={(value) =>
              onChange((previous) => ({
                ...previous,
                sampler: value,
              }))
            }
            disabled={disabled}
          >
            <SelectTrigger id="nai-sampler" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="k_euler">Euler</SelectItem>
              <SelectItem value="k_euler_ancestral">Euler Ancestral</SelectItem>
              <SelectItem value="k_dpmpp_2m">DPM++ 2M</SelectItem>
              <SelectItem value="ddim">DDIM</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <label htmlFor="nai-seed" className="grid gap-2 text-sm">
          <span>Seed</span>
          <Input
            id="nai-seed"
            type="number"
            value={params.seed ?? ''}
            disabled={disabled}
            placeholder="Random"
            onChange={(event) =>
              onChange((previous) => ({
                ...previous,
                seed: event.target.value.trim() === '' ? null : Number(event.target.value),
              }))
            }
          />
        </label>

        <label htmlFor="nai-steps" className="grid gap-2 text-sm">
          <span>Steps</span>
          <Input
            id="nai-steps"
            aria-label="NAI steps"
            type="number"
            min={1}
            max={50}
            value={params.steps}
            disabled={disabled}
            onChange={(event) =>
              onChange((previous) => ({
                ...previous,
                steps: Number(event.target.value),
              }))
            }
          />
        </label>

        <label htmlFor="nai-scale" className="grid gap-2 text-sm">
          <span>Guidance scale</span>
          <Input
            id="nai-scale"
            type="number"
            min={0}
            max={10}
            step={0.1}
            value={params.scale}
            disabled={disabled}
            onChange={(event) =>
              onChange((previous) => ({
                ...previous,
                scale: Number(event.target.value),
              }))
            }
          />
        </label>

        {params.action !== 'generate' ? (
          <>
            <label htmlFor="nai-strength" className="grid gap-2 text-sm">
              <span>Strength</span>
              <Input
                id="nai-strength"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={params.strength}
                disabled={disabled}
                onChange={(event) =>
                  onChange((previous) => ({
                    ...previous,
                    strength: Number(event.target.value),
                  }))
                }
              />
            </label>

            <label htmlFor="nai-noise" className="grid gap-2 text-sm">
              <span>Noise</span>
              <Input
                id="nai-noise"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={params.noise}
                disabled={disabled}
                onChange={(event) =>
                  onChange((previous) => ({
                    ...previous,
                    noise: Number(event.target.value),
                  }))
                }
              />
            </label>
          </>
        ) : null}
      </div>

      {showAdvanced ? (
        <div className="space-y-4 rounded-md border border-dashed p-3">
          <div className="grid gap-4 md:grid-cols-2">
            {params.action === 'generate' ? (
              <label htmlFor="nai-noise-schedule" className="grid gap-2 text-sm">
                <span>Noise schedule</span>
                <Select
                  value={params.noise_schedule}
                  onValueChange={(value) =>
                    onChange((previous) => ({
                      ...previous,
                      noise_schedule: value,
                    }))
                  }
                  disabled={disabled}
                >
                  <SelectTrigger id="nai-noise-schedule" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="karras">Karras</SelectItem>
                    <SelectItem value="native">Native</SelectItem>
                    <SelectItem value="exponential">Exponential</SelectItem>
                  </SelectContent>
                </Select>
              </label>
            ) : null}

            <label htmlFor="nai-cfg-rescale" className="grid gap-2 text-sm">
              <span>CFG rescale</span>
              <Input
                id="nai-cfg-rescale"
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={params.cfg_rescale}
                disabled={disabled}
                onChange={(event) =>
                  onChange((previous) => ({
                    ...previous,
                    cfg_rescale: Number(event.target.value),
                  }))
                }
              />
            </label>

            <label htmlFor="nai-uncond-scale" className="grid gap-2 text-sm">
              <span>Uncond scale</span>
              <Input
                id="nai-uncond-scale"
                type="number"
                min={0}
                max={1.5}
                step={0.05}
                value={params.uncond_scale}
                disabled={disabled}
                onChange={(event) =>
                  onChange((previous) => ({
                    ...previous,
                    uncond_scale: Number(event.target.value),
                  }))
                }
              />
            </label>
          </div>

          <label htmlFor="nai-variety-plus" className="flex items-center justify-between gap-3 py-1 text-sm">
            <span>Variety plus</span>
            <Switch
              aria-label="Variety plus"
              checked={params.variety_plus}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange((previous) => ({
                  ...previous,
                  variety_plus: checked,
                }))
              }
            />
          </label>
        </div>
      ) : null}
    </section>
  )
}
