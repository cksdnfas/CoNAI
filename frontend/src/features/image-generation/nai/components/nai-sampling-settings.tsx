import type { Dispatch, SetStateAction } from 'react'
import type { NAIParams } from '../types/nai.types'

interface NAISamplingSettingsProps {
  params: NAIParams
  onChange: Dispatch<SetStateAction<NAIParams>>
  disabled?: boolean
}

export default function NAISamplingSettings({ params, onChange, disabled = false }: NAISamplingSettingsProps) {
  return (
    <section className="space-y-4 rounded-md border p-3">
      <h3 className="text-sm font-semibold">NAI Sampling Settings</h3>

      <div className="grid gap-3 md:grid-cols-2">
        <label htmlFor="nai-sampler" className="block space-y-1 text-sm">
          <span>Sampler</span>
          <select
            id="nai-sampler"
            value={params.sampler}
            disabled={disabled}
            onChange={(event) =>
              onChange((previous) => ({
                ...previous,
                sampler: event.target.value,
              }))
            }
          >
            <option value="k_euler">Euler</option>
            <option value="k_euler_ancestral">Euler Ancestral</option>
            <option value="k_dpmpp_2m">DPM++ 2M</option>
            <option value="ddim">DDIM</option>
          </select>
        </label>

        {params.action === 'generate' ? (
          <label htmlFor="nai-noise-schedule" className="block space-y-1 text-sm">
            <span>Noise schedule</span>
            <select
              id="nai-noise-schedule"
              value={params.noise_schedule}
              disabled={disabled}
              onChange={(event) =>
                onChange((previous) => ({
                  ...previous,
                  noise_schedule: event.target.value,
                }))
              }
            >
              <option value="karras">Karras</option>
              <option value="native">Native</option>
              <option value="exponential">Exponential</option>
            </select>
          </label>
        ) : (
          <div />
        )}

        <label htmlFor="nai-seed" className="block space-y-1 text-sm">
          <span>Seed</span>
          <input
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

        <label htmlFor="nai-steps" className="block space-y-1 text-sm">
          <span>Steps</span>
          <input
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

        <label htmlFor="nai-scale" className="block space-y-1 text-sm">
          <span>Guidance scale</span>
          <input
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

        <label htmlFor="nai-cfg-rescale" className="block space-y-1 text-sm">
          <span>CFG rescale</span>
          <input
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

        <label htmlFor="nai-uncond-scale" className="block space-y-1 text-sm">
          <span>Uncond scale</span>
          <input
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

        {params.action !== 'generate' ? (
          <>
            <label htmlFor="nai-strength" className="block space-y-1 text-sm">
              <span>Strength</span>
              <input
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

            <label htmlFor="nai-noise" className="block space-y-1 text-sm">
              <span>Noise</span>
              <input
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

      <label htmlFor="nai-variety-plus" className="flex items-center gap-2 text-sm">
        <input
          id="nai-variety-plus"
          type="checkbox"
          checked={params.variety_plus}
          disabled={disabled}
          onChange={(event) =>
            onChange((previous) => ({
              ...previous,
              variety_plus: event.target.checked,
            }))
          }
        />
        Variety plus
      </label>
    </section>
  )
}
