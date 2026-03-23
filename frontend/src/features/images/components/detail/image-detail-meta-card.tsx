import { CollapsibleScoreMeterList, ScoreMeterList, StackedRatingBar, TagBundleSection } from '@/components/common/tag-result-ui'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import type { ImageRecord } from '@/types/image'
import { formatBytes, getImageArtistPromptSection, getImageAutoPromptContent } from './image-detail-utils'

interface ImageDetailMetaCardProps {
  image: ImageRecord
}

export function ImageDetailMetaCard({ image }: ImageDetailMetaCardProps) {
  const autoPromptContent = getImageAutoPromptContent(image)
  const artistPromptSection = getImageArtistPromptSection(image)

  return (
    <Card className="bg-surface-container">
      <CardContent className="space-y-3 p-6 text-sm text-muted-foreground">
        {image.is_processing ? (
          <div className="flex items-center justify-end">
            <Badge variant="secondary">Processing</Badge>
          </div>
        ) : null}

        <div className="rounded-sm bg-surface-high p-4">
          <p className="text-[11px] uppercase tracking-[0.18em]">Composite hash</p>
          <p className="mt-2 break-all font-mono text-foreground">{image.composite_hash || '—'}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-sm bg-surface-high p-4">
            <p className="text-[11px] uppercase tracking-[0.18em]">Dimensions</p>
            <p className="mt-2 text-foreground">{image.width && image.height ? `${image.width} × ${image.height}` : '—'}</p>
          </div>
          <div className="rounded-sm bg-surface-high p-4">
            <p className="text-[11px] uppercase tracking-[0.18em]">File size</p>
            <p className="mt-2 text-foreground">{formatBytes(image.file_size)}</p>
          </div>
          {image.ai_metadata?.model_name ? (
            <div className="rounded-sm bg-surface-high p-4 sm:col-span-2">
              <p className="text-[11px] uppercase tracking-[0.18em]">Model</p>
              <p className="mt-2 text-foreground">{image.ai_metadata.model_name}</p>
            </div>
          ) : null}
          {image.original_file_path ? (
            <div className="rounded-sm bg-surface-high p-4 sm:col-span-2">
              <p className="text-[11px] uppercase tracking-[0.18em]">Path</p>
              <p className="mt-2 break-all font-mono text-xs text-foreground/88">{image.original_file_path}</p>
            </div>
          ) : null}
          {autoPromptContent ? (
            <div className="rounded-sm bg-surface-high p-4 sm:col-span-2">
              <p className="text-[11px] uppercase tracking-[0.18em]">Auto prompt</p>
              <div className="mt-3 space-y-3">
                {autoPromptContent.ratingEntries.length > 0 ? <StackedRatingBar title="rating" entries={autoPromptContent.ratingEntries} /> : null}
                {autoPromptContent.characterEntries.length > 0 ? (
                  <ScoreMeterList title="character" entries={autoPromptContent.characterEntries} accentClassName="bg-primary/60" />
                ) : null}
                {autoPromptContent.generalTags.length > 0 ? <TagBundleSection label="general" tags={autoPromptContent.generalTags} /> : null}
                {autoPromptContent.generalEntries.length > 0 ? (
                  <CollapsibleScoreMeterList title="general" entries={autoPromptContent.generalEntries} accentClassName="bg-primary/80" />
                ) : null}
              </div>
            </div>
          ) : null}
          {artistPromptSection ? (
            <div className="rounded-sm bg-surface-high p-4 sm:col-span-2">
              <p className="text-[11px] uppercase tracking-[0.18em]">Artist prompt</p>
              <div className="mt-3 space-y-3">
                <TagBundleSection label={artistPromptSection.label} tags={artistPromptSection.tags} />
                <CollapsibleScoreMeterList title={artistPromptSection.label} entries={artistPromptSection.entries} accentClassName="bg-primary/80" />
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
