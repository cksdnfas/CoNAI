import type { Dispatch, SetStateAction } from 'react'
import { RESOLUTIONS } from '../constants/nai.constants'
import type { NAIParams } from '../types/nai.types'

interface NAIBasicSettingsProps {
  params: NAIParams
  onChange: Dispatch<SetStateAction<NAIParams>>
  disabled?: boolean
}

export default function NAIBasicSettings({ params, onChange, disabled = false }: NAIBasicSettingsProps) {
  const resolutionOptions = Object.keys(RESOLUTIONS)

  return (
    <section className="space-y-3 rounded-md border p-3">
      <h3>NAI Basic Settings</h3>

      <label htmlFor="nai-model" className="block space-y-1 text-sm">
        <span>Model</span>
        <select
          id="nai-model"
          value={params.model}
          disabled={disabled}
          onChange={(event) =>
            onChange((previous) => ({
              ...previous,
              model: event.target.value,
            }))
          }
        >
          <option value="nai-diffusion-4-5-curated">NAI Diffusion 4.5 Curated</option>
          <option value="nai-diffusion-4-5-full">NAI Diffusion 4.5 Full</option>
          <option value="nai-diffusion-3">NAI Diffusion 3</option>
        </select>
      </label>

      <label htmlFor="nai-resolution-fixed" className="block space-y-1 text-sm">
        <span>Resolution</span>
        <select
          id="nai-resolution-fixed"
          value={params.resolutionConfig.fixed}
          disabled={disabled}
          onChange={(event) =>
            onChange((previous) => ({
              ...previous,
              resolution: event.target.value,
              resolutionConfig: {
                ...previous.resolutionConfig,
                mode: 'fixed',
                fixed: event.target.value,
              },
            }))
          }
        >
          {resolutionOptions.map((resolutionKey) => (
            <option key={resolutionKey} value={resolutionKey}>
              {resolutionKey}
            </option>
          ))}
        </select>
      </label>

      <label htmlFor="nai-prompt" className="block space-y-1 text-sm">
        <span>Prompt</span>
        <textarea
          id="nai-prompt"
          aria-label="NAI prompt"
          rows={4}
          value={params.prompt}
          disabled={disabled}
          onChange={(event) =>
            onChange((previous) => ({
              ...previous,
              prompt: event.target.value,
            }))
          }
        />
      </label>

      <label htmlFor="nai-negative-prompt" className="block space-y-1 text-sm">
        <span>Negative prompt</span>
        <textarea
          id="nai-negative-prompt"
          rows={2}
          value={params.negative_prompt}
          disabled={disabled}
          onChange={(event) =>
            onChange((previous) => ({
              ...previous,
              negative_prompt: event.target.value,
            }))
          }
        />
      </label>

      <button
        type="button"
        disabled={disabled}
        onClick={() =>
          onChange((previous) => ({
            ...previous,
            prompt: 'updated-basic-prompt',
          }))
        }
      >
        Update basic prompt
      </button>
    </section>
  )
}
