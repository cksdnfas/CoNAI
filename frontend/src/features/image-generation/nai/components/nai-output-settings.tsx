import type { ChangeEvent, Dispatch, SetStateAction } from 'react'
import { X } from 'lucide-react'
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
    <section className="space-y-4 rounded-md border p-3">
      <h3 className="text-sm font-semibold">NAI Output Settings</h3>

      <label htmlFor="nai-output-samples" className="block max-w-[180px] space-y-1 text-sm">
        <span>Samples</span>
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
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2 rounded-md border border-dashed p-3">
            <label htmlFor="nai-source-image" className="block space-y-1 text-sm">
              <span>Source</span>
              <input
                id="nai-source-image"
                type="file"
                accept="image/*"
                disabled={disabled}
                onChange={(event) => void handleImageFile(event, 'source_image')}
              />
            </label>

            {params.source_image ? (
              <div className="relative overflow-hidden rounded-md border bg-muted/20 p-2">
                <img src={params.source_image} alt="Source preview" className="max-h-48 w-full rounded object-contain" />
                <button
                  type="button"
                  className="absolute top-2 right-2 rounded-full border bg-background/80 p-1"
                  onClick={() => onChange((previous) => ({ ...previous, source_image: null }))}
                  disabled={disabled}
                  aria-label="Clear source image"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>

          {params.action === 'infill' ? (
            <div className="space-y-2 rounded-md border border-dashed p-3">
              <label htmlFor="nai-mask-image" className="block space-y-1 text-sm">
                <span>Mask</span>
                <input
                  id="nai-mask-image"
                  type="file"
                  accept="image/*"
                  disabled={disabled}
                  onChange={(event) => void handleImageFile(event, 'mask_image')}
                />
              </label>

              {params.mask_image ? (
                <div className="relative overflow-hidden rounded-md border bg-muted/20 p-2">
                  <img src={params.mask_image} alt="Mask preview" className="max-h-48 w-full rounded object-contain" />
                  <button
                    type="button"
                    className="absolute top-2 right-2 rounded-full border bg-background/80 p-1"
                    onClick={() => onChange((previous) => ({ ...previous, mask_image: null }))}
                    disabled={disabled}
                    aria-label="Clear mask image"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
