import type { Dispatch, SetStateAction } from 'react'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
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

      <div className="grid gap-4 md:grid-cols-3">
        <label htmlFor="nai-model" className="grid gap-2 text-sm">
          <span>Model</span>
          <Select
            value={params.model}
            onValueChange={(value) =>
              onChange((previous) => ({
                ...previous,
                model: value,
              }))
            }
            disabled={disabled}
          >
            <SelectTrigger id="nai-model" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NAI_MODEL_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label htmlFor="nai-action" className="grid gap-2 text-sm">
          <span>Mode</span>
          <Select
            value={params.action}
            onValueChange={(value) =>
              onChange((previous) => ({
                ...previous,
                action: value as NAIParams['action'],
              }))
            }
            disabled={disabled}
          >
            <SelectTrigger id="nai-action" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="generate">Text to image</SelectItem>
              <SelectItem value="img2img">Image to image</SelectItem>
              <SelectItem value="infill">Infill</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <label htmlFor="nai-resolution-fixed" className="grid gap-2 text-sm">
          <span>Resolution</span>
          <Select
            value={params.resolutionConfig.fixed}
            onValueChange={(value) =>
              onChange((previous) => ({
                ...previous,
                resolution: value,
                resolutionConfig: {
                  ...previous.resolutionConfig,
                  mode: 'fixed',
                  fixed: value,
                },
              }))
            }
            disabled={disabled || params.action !== 'generate'}
          >
            <SelectTrigger id="nai-resolution-fixed" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {resolutionOptions.map((resolutionKey) => (
                <SelectItem key={resolutionKey} value={resolutionKey}>
                  {resolutionKey}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <label htmlFor="nai-prompt" className="grid gap-2 text-sm">
        <span>Prompt</span>
        <Textarea
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

      <label htmlFor="nai-negative-prompt" className="grid gap-2 text-sm">
        <span>Negative prompt</span>
        <Textarea
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

      <div className="grid gap-4 md:grid-cols-2">
        <label htmlFor="nai-uc-preset" className="grid gap-2 text-sm">
          <span>UC preset</span>
          <Select
            value={params.uc_preset}
            onValueChange={(value) =>
              onChange((previous) => ({
                ...previous,
                uc_preset: value as NAIParams['uc_preset'],
              }))
            }
            disabled={disabled}
          >
            <SelectTrigger id="nai-uc-preset" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="heavy">Heavy</SelectItem>
              <SelectItem value="human_focus">Human focus</SelectItem>
            </SelectContent>
          </Select>
        </label>

        <label htmlFor="nai-rating-preset" className="grid gap-2 text-sm">
          <span>Rating</span>
          <Select
            value={params.rating_preset}
            onValueChange={(value) =>
              onChange((previous) => ({
                ...previous,
                rating_preset: value as NAIParams['rating_preset'],
              }))
            }
            disabled={disabled}
          >
            <SelectTrigger id="nai-rating-preset" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="general">General</SelectItem>
              <SelectItem value="sensitive">Sensitive</SelectItem>
              <SelectItem value="questionable">Questionable</SelectItem>
              <SelectItem value="explicit">Explicit</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      <label htmlFor="nai-auto-quality-tags" className="flex items-center justify-between gap-3 py-1 text-sm">
        <span>Apply model quality tags automatically</span>
        <Switch
          aria-label="Apply model quality tags automatically"
          checked={params.auto_quality_tags}
          disabled={disabled}
          onCheckedChange={(checked) =>
            onChange((previous) => ({
              ...previous,
              auto_quality_tags: checked,
            }))
          }
        />
      </label>

      <div className="grid gap-2 rounded-md border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
        <div><span className="font-medium text-foreground">Quality</span> {qualityTagsPreview || 'Off'}</div>
        <div><span className="font-medium text-foreground">UC</span> {ucPresetPreview || 'None'}</div>
        <div><span className="font-medium text-foreground">Support</span> {modelSupport}</div>
      </div>
    </section>
  )
}
