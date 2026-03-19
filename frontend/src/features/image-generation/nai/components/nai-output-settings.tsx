import type { Dispatch, SetStateAction } from 'react'
import type { NAIParams } from '../types/nai.types'

interface NAIOutputSettingsProps {
  params: NAIParams
  onChange: Dispatch<SetStateAction<NAIParams>>
  disabled?: boolean
}

export default function NAIOutputSettings({ params, onChange, disabled = false }: NAIOutputSettingsProps) {
  return (
    <section className="space-y-3 rounded-md border p-3">
      <h3>NAI Output Settings</h3>

      <label htmlFor="nai-output-samples" className="block space-y-1 text-sm">
        <span>Number of samples</span>
        <input
          id="nai-output-samples"
          aria-label="NAI output samples"
          type="number"
          min={1}
          max={8}
          value={params.n_samples}
          disabled={disabled}
          onChange={(event) =>
            onChange((previous) => ({
              ...previous,
              n_samples: Number(event.target.value),
            }))
          }
        />
      </label>

    </section>
  )
}
