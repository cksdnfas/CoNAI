import type { ChangeEvent, Dispatch, SetStateAction } from 'react'
import type { NAIParams } from '../types/nai.types'

interface NAIOutputSettingsProps {
  params: NAIParams
  onChange: Dispatch<SetStateAction<NAIParams>>
  disabled?: boolean
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function NAIOutputSettings({ params, onChange, disabled = false }: NAIOutputSettingsProps) {
  const handleImageFile = async (event: ChangeEvent<HTMLInputElement>, field: 'source_image' | 'mask_image') => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const encoded = await readFileAsDataUrl(file)
    onChange((previous) => ({
      ...previous,
      [field]: encoded,
    }))
  }

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

      {params.action !== 'generate' ? (
        <div className="space-y-3 rounded-md border border-dashed p-3">
          <p className="text-sm font-medium">Image inputs</p>

          <label htmlFor="nai-source-image" className="block space-y-1 text-sm">
            <span>Source image</span>
            <input id="nai-source-image" type="file" accept="image/*" disabled={disabled} onChange={(event) => void handleImageFile(event, 'source_image')} />
          </label>

          {params.action === 'infill' ? (
            <label htmlFor="nai-mask-image" className="block space-y-1 text-sm">
              <span>Mask image</span>
              <input id="nai-mask-image" type="file" accept="image/*" disabled={disabled} onChange={(event) => void handleImageFile(event, 'mask_image')} />
            </label>
          ) : null}

          <div className="text-xs text-muted-foreground">
            <p>Source {params.source_image ? 'loaded' : 'empty'}</p>
            {params.action === 'infill' ? <p>Mask {params.mask_image ? 'loaded' : 'empty'}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  )
}
