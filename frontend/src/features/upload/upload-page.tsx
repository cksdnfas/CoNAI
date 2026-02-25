import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import PromptPreview from '@/features/upload/components/prompt-preview'
import UploadZone from '@/features/upload/components/upload-zone'

export function UploadPage() {
  const { t } = useTranslation(['upload'])
  const queryClient = useQueryClient()

  const handleUploadComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['images'] })
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('upload:page.title')}</h1>
        <p className="text-sm text-muted-foreground">Upload images and inspect parsed prompt metadata.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Upload</CardTitle>
          <CardDescription>Drop files or choose files to ingest into the gallery.</CardDescription>
        </CardHeader>
        <CardContent>
          <UploadZone onUploadComplete={handleUploadComplete} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prompt Preview</CardTitle>
          <CardDescription>Preview extracted prompt and metadata from selected images.</CardDescription>
        </CardHeader>
        <CardContent>
          <PromptPreview />
        </CardContent>
      </Card>
    </div>
  )
}
