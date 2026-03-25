import { ExtractedPromptSections } from '@/components/common/extracted-prompt-sections'
import {
  ArtistPromptSection,
  CharacterPromptSection,
  GeneralPromptSection,
  RatingPromptSection,
} from '@/components/common/prompt-result-sections'
import { Badge } from '@/components/ui/badge'
import { getImageExtractedPromptCards } from '@/lib/image-extracted-prompts'
import type { ImageRecord } from '@/types/image'
import { formatBytes, getImageArtistPromptSection, getImageAutoPromptContent, getImageGenerationParamItems } from './image-detail-utils'

interface ImageDetailMetaCardProps {
  image: ImageRecord
}

export function ImageDetailMetaCard({ image }: ImageDetailMetaCardProps) {
  const extractedPromptCards = getImageExtractedPromptCards(image)
  const autoPromptContent = getImageAutoPromptContent(image)
  const artistPromptSection = getImageArtistPromptSection(image)
  const generationParamItems = getImageGenerationParamItems(image)

  return (
    <div className="space-y-3 text-sm text-muted-foreground">
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
            <p className="mt-2 break-words text-foreground">{image.ai_metadata.model_name}</p>
          </div>
        ) : null}
        {generationParamItems.map((item) => (
          <div key={item.id} className="rounded-sm bg-surface-high p-4">
            <p className="text-[11px] uppercase tracking-[0.18em]">{item.label}</p>
            <p className="mt-2 break-words text-foreground">{item.value}</p>
          </div>
        ))}
        {image.original_file_path ? (
          <div className="rounded-sm bg-surface-high p-4 sm:col-span-2">
            <p className="text-[11px] uppercase tracking-[0.18em]">Path</p>
            <p className="mt-2 break-all font-mono text-xs text-foreground/88">{image.original_file_path}</p>
          </div>
        ) : null}
        {extractedPromptCards.length > 0 ? (
          <div className="rounded-sm bg-surface-high p-4 sm:col-span-2">
            <p className="text-[11px] uppercase tracking-[0.18em]">Extracted prompt</p>
            <div className="mt-3">
              <ExtractedPromptSections items={extractedPromptCards} />
            </div>
          </div>
        ) : null}
        {autoPromptContent ? (
          <div className="rounded-sm bg-surface-high p-4 sm:col-span-2">
            <p className="text-[11px] uppercase tracking-[0.18em]">Auto prompt</p>
            <div className="mt-3 space-y-3">
              <RatingPromptSection entries={autoPromptContent.ratingEntries} />
              <CharacterPromptSection entries={autoPromptContent.characterEntries} />
              <GeneralPromptSection tags={autoPromptContent.generalTags} entries={autoPromptContent.generalEntries} collapsibleScores />
            </div>
          </div>
        ) : null}
        {artistPromptSection ? (
          <div className="rounded-sm bg-surface-high p-4 sm:col-span-2">
            <p className="text-[11px] uppercase tracking-[0.18em]">Artist prompt</p>
            <div className="mt-3">
              <ArtistPromptSection
                label={artistPromptSection.label}
                tags={artistPromptSection.tags}
                entries={artistPromptSection.entries}
                collapsibleScores
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
