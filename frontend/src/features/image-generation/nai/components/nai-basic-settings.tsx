import type { Dispatch, SetStateAction } from 'react'
import { NAI_MODEL_OPTIONS, RESOLUTIONS } from '../constants/nai.constants'
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
          {NAI_MODEL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
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

      <label htmlFor="nai-uc-preset" className="block space-y-1 text-sm">
        <span>UC preset</span>
        <select
          id="nai-uc-preset"
          value={params.uc_preset}
          disabled={disabled}
          onChange={(event) =>
            onChange((previous) => ({
              ...previous,
              uc_preset: event.target.value as NAIParams['uc_preset'],
            }))
          }
        >
          <option value="none">None</option>
          <option value="light">Light</option>
          <option value="heavy">Heavy</option>
          <option value="human_focus">Human focus</option>
        </select>
      </label>

      <label htmlFor="nai-rating-preset" className="block space-y-1 text-sm">
        <span>Rating preset</span>
        <select
          id="nai-rating-preset"
          value={params.rating_preset}
          disabled={disabled}
          onChange={(event) =>
            onChange((previous) => ({
              ...previous,
              rating_preset: event.target.value as NAIParams['rating_preset'],
            }))
          }
        >
          <option value="general">General</option>
          <option value="sensitive">Sensitive</option>
          <option value="questionable">Questionable</option>
          <option value="explicit">Explicit</option>
        </select>
      </label>

      <label htmlFor="nai-auto-quality-tags" className="flex items-center gap-2 text-sm">
        <input
          id="nai-auto-quality-tags"
          type="checkbox"
          checked={params.auto_quality_tags}
          disabled={disabled}
          onChange={(event) =>
            onChange((previous) => ({
              ...previous,
              auto_quality_tags: event.target.checked,
            }))
          }
        />
        Apply model quality tags automatically
      </label>
    </section>
  )
}
