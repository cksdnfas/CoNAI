import type { ChangeEvent, Dispatch, SetStateAction } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { NAIParams } from '../types/nai.types'

interface NAIInputImagesProps {
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

function ImagePreview({
  alt,
  image,
  onClear,
  disabled,
}: {
  alt: string
  image: string | null
  onClear: () => void
  disabled: boolean
}) {
  if (!image) {
    return (
      <div className="rounded-md border border-dashed px-3 py-8 text-center text-xs text-muted-foreground">
        No image selected
      </div>
    )
  }

  return (
    <div className="relative overflow-hidden rounded-md border bg-muted/20 p-2">
      <img src={image} alt={alt} className="max-h-48 w-full rounded object-contain" />
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        className="absolute top-2 right-2"
        onClick={onClear}
        disabled={disabled}
        aria-label={`Clear ${alt}`}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}

export default function NAIInputImages({ params, onChange, disabled = false }: NAIInputImagesProps) {
  if (params.action === 'generate') {
    return null
  }

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
      <h3 className="text-sm font-semibold">Input Images</h3>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="nai-source-image" className="grid gap-2 text-sm">
            <span>Source image</span>
            <Input
              id="nai-source-image"
              type="file"
              accept="image/*"
              disabled={disabled}
              onChange={(event) => void handleImageFile(event, 'source_image')}
            />
          </label>
          <ImagePreview
            alt="Source preview"
            image={params.source_image}
            disabled={disabled}
            onClear={() => onChange((previous) => ({ ...previous, source_image: null }))}
          />
        </div>

        {params.action === 'infill' ? (
          <div className="space-y-2">
            <label htmlFor="nai-mask-image" className="grid gap-2 text-sm">
              <span>Mask image</span>
              <Input
                id="nai-mask-image"
                type="file"
                accept="image/*"
                disabled={disabled}
                onChange={(event) => void handleImageFile(event, 'mask_image')}
              />
            </label>
            <ImagePreview
              alt="Mask preview"
              image={params.mask_image}
              disabled={disabled}
              onClear={() => onChange((previous) => ({ ...previous, mask_image: null }))}
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}
