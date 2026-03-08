import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, Image as ImageIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { parsePrompt, parsePromptWithLoRAs } from '@conai/shared'
import { extractMetadata, type ParsedMetadata } from '@/utils/metadata-reader'

export default function PromptPreview() {
  const { t } = useTranslation(['upload', 'common'])
  const [metadata, setMetadata] = useState<ParsedMetadata | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError(t('upload:promptPreview.invalidFileType'))
        return
      }

      setLoading(true)
      setError(null)

      try {
        const previewUrl = URL.createObjectURL(file)
        setImagePreview(previewUrl)

        const extracted = await extractMetadata(file)
        setMetadata(extracted)
      } catch (err) {
        console.error('Failed to extract metadata:', err)
        setError(t('upload:promptPreview.extractionFailed'))
      } finally {
        setLoading(false)
      }
    },
    [t],
  )

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setDragActive(false)

      if (event.dataTransfer.files && event.dataTransfer.files.length > 0) {
        void handleFile(event.dataTransfer.files[0])
      }
    },
    [handleFile],
  )

  const handleDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(true)
  }, [])

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
  }, [])

  const handleFileInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (event.target.files && event.target.files.length > 0) {
        void handleFile(event.target.files[0])
      }
    },
    [handleFile],
  )

  const parsedPrompt = metadata?.positivePrompt ? parsePrompt(metadata.positivePrompt) : null
  const parsedNegative = metadata?.negativePrompt ? parsePrompt(metadata.negativePrompt) : null
  const loraInfo = metadata?.positivePrompt ? parsePromptWithLoRAs(metadata.positivePrompt) : null

  useEffect(() => {
    return () => {
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview)
      }
    }
  }, [imagePreview])

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-lg font-semibold">{t('upload:promptPreview.title')}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t('upload:promptPreview.description')}</p>
      </div>

      <button
        type="button"
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          'w-full cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors',
          dragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60 hover:bg-accent/40',
        )}
        onClick={() => document.getElementById('prompt-preview-input')?.click()}
      >
        <input id="prompt-preview-input" type="file" accept="image/*" className="hidden" onChange={handleFileInput} />
        <ImageIcon className="mx-auto mb-2 h-10 w-10 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{dragActive ? t('upload:promptPreview.dropHere') : t('upload:promptPreview.dragOrClick')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('upload:promptPreview.noUpload')}</p>
      </button>

      {loading ? (
        <div className="my-3 flex justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {metadata && !loading ? (
        <div className="space-y-3 pt-1">
          {imagePreview ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{t('upload:promptPreview.imagePreview')}</p>
              <div className="flex justify-center rounded-md border bg-muted/30 p-2">
                <img src={imagePreview} alt="Preview" className="max-h-[400px] max-w-full rounded object-contain" />
              </div>
            </div>
          ) : null}

          <div className="space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{t('upload:promptPreview.aiTool')}</p>
            <Badge variant={metadata.aiTool && metadata.aiTool !== 'Unknown' ? 'default' : 'outline'}>{metadata.aiTool || 'Unknown'}</Badge>
          </div>

          {parsedPrompt ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{t('upload:promptPreview.positivePrompt')}</p>
              <ScrollArea className="max-h-48 rounded-md border bg-muted/20 p-3">
                <p className="whitespace-pre-wrap text-sm">{parsedPrompt.cleaned}</p>
              </ScrollArea>
              {parsedPrompt.terms.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    {t('upload:promptPreview.terms')} ({parsedPrompt.terms.length})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {parsedPrompt.terms.slice(0, 20).map((term: string) => (
                      <Badge key={term} variant="outline">
                        {term}
                      </Badge>
                    ))}
                    {parsedPrompt.terms.length > 20 ? (
                      <Badge variant="outline">+{parsedPrompt.terms.length - 20} more</Badge>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {parsedNegative && parsedNegative.cleaned ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{t('upload:promptPreview.negativePrompt')}</p>
              <ScrollArea className="max-h-40 rounded-md border bg-muted/20 p-3">
                <p className="whitespace-pre-wrap text-sm">{parsedNegative.cleaned}</p>
              </ScrollArea>
            </div>
          ) : null}

          {loraInfo && loraInfo.loras.length > 0 ? (
            <div className="space-y-1">
              <p className="text-sm font-medium text-muted-foreground">
                {t('upload:promptPreview.loraModels')} ({loraInfo.loras.length})
              </p>
              <div className="flex flex-wrap gap-1">
                {loraInfo.loras.map((lora: string) => (
                  <Badge key={lora} variant="secondary">
                    {lora}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          {metadata.parameters && Object.keys(metadata.parameters).length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">{t('upload:promptPreview.parameters')}</p>
              <div className="space-y-1 rounded-md border bg-muted/20 p-3 text-sm">
                  {Object.entries(metadata.parameters)
                    .filter(([, value]) => value !== undefined && value !== null)
                    .map(([key, value]) => (
                      <p key={key}>
                        <span className="font-semibold">{key}:</span> {String(value)}
                      </p>
                    ))}
              </div>
            </div>
          ) : null}

          <details className="rounded-md border">
            <summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-sm font-medium">
              {t('upload:promptPreview.rawMetadata')}
              <ChevronDown className="h-4 w-4" />
            </summary>
            <ScrollArea className="max-h-96 border-t bg-muted/20 p-3">
              <pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(metadata.rawMetadata, null, 2)}</pre>
            </ScrollArea>
          </details>
        </div>
      ) : null}
    </div>
  )
}
