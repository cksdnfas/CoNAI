import type { Dispatch, SetStateAction } from 'react'
import { NAI_MODEL_OPTIONS, NAI_QUALITY_TAGS, NAI_UC_PRESETS, RESOLUTIONS } from '../constants/nai.constants'
import type { NAIParams } from '../types/nai.types'

interface NAIBasicSettingsProps {
  params: NAIParams
  onChange: Dispatch<SetStateAction<NAIParams>>
  disabled?: boolean
}

export default function NAIBasicSettings({ params, onChange, disabled = false }: NAIBasicSettingsProps) {
  const resolutionOptions = Object.keys(RESOLUTIONS)
  const qualityTagsPreview = params.auto_quality_tags ? NAI_QUALITY_TAGS[params.model] || '' : ''
  const ucPresetPreview = params.uc_preset !== 'none' ? NAI_UC_PRESETS[params.model]?.[params.uc_preset] || '' : ''
  const selectedModel = NAI_MODEL_OPTIONS.find((option) => option.value === params.model)
  const modelSupport = selectedModel
    ? [selectedModel.supportsVibe ? 'Vibe' : null, selectedModel.supportsCharacterRef ? 'Character Ref' : null]
        .filter(Boolean)
        .join(', ') || 'Basic generate only'
    : 'Unknown'

  return (
    <section className="space-y-4 rounded-md border p-3">
      <h3 className="text-sm font-semibold">NAI Basic Settings</h3>

      <div className="grid gap-3 md:grid-cols-3">
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

        <label htmlFor="nai-action" className="block space-y-1 text-sm">
          <span>Mode</span>
          <select
            id="nai-action"
            value={params.action}
            disabled={disabled}
            onChange={(event) =>
              onChange((previous) => ({
                ...previous,
                action: event.target.value as NAIParams['action'],
              }))
            }
          >
            <option value="generate">Text to image</option>
            <option value="img2img">Image to image</option>
            <option value="infill">Infill</option>
          </select>
        </label>

        <label htmlFor="nai-resolution-fixed" className="block space-y-1 text-sm">
          <span>Resolution</span>
          <select
            id="nai-resolution-fixed"
            value={params.resolutionConfig.fixed}
            disabled={disabled || params.action !== 'generate'}
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
      </div>

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

      <div className="grid gap-3 md:grid-cols-2">
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
          <span>Rating</span>
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
      </div>

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

      <div className="grid gap-2 rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
        <div><span className="font-medium text-foreground">Quality</span> {qualityTagsPreview || 'Off'}</div>
        <div><span className="font-medium text-foreground">UC</span> {ucPresetPreview || 'None'}</div>
        <div><span className="font-medium text-foreground">Support</span> {modelSupport}</div>
      </div>
    </section>
  )
}
