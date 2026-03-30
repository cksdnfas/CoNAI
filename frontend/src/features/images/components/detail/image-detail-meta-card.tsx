import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FilePenLine } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ExtractedPromptSections } from '@/components/common/extracted-prompt-sections'
import {
  ArtistPromptSection,
  CharacterPromptSection,
  GeneralPromptSection,
  RatingPromptSection,
} from '@/components/common/prompt-result-sections'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { resolvePromptGroups } from '@/lib/api'
import { formatGroupedPromptText, getImageExtractedPromptCards, getImagePromptTerms } from '@/lib/image-extracted-prompts'
import type { ImageRecord } from '@/types/image'
import { formatBytes, getImageArtistPromptSection, getImageAutoPromptContent, getImageGenerationParamItems } from './image-detail-utils'

interface ImageDetailMetaCardProps {
  image: ImageRecord
}

type PromptDisplayMode = 'plain' | 'grouped'

export function ImageDetailMetaCard({ image }: ImageDetailMetaCardProps) {
  const navigate = useNavigate()
  const imageViewModal = useImageViewModal()
  const [promptDisplayMode, setPromptDisplayMode] = useState<PromptDisplayMode>('plain')
  const extractedPromptCards = useMemo(() => getImageExtractedPromptCards(image), [image])
  const positivePromptTerms = useMemo(() => getImagePromptTerms(image, 'positive'), [image])
  const negativePromptTerms = useMemo(() => getImagePromptTerms(image, 'negative'), [image])
  const autoPromptContent = getImageAutoPromptContent(image)
  const artistPromptSection = getImageArtistPromptSection(image)
  const generationParamItems = getImageGenerationParamItems(image)
  const canEditMetadata = Boolean(image.composite_hash) && image.file_type === 'image'
  const canTogglePromptGrouping = positivePromptTerms.length > 0 || negativePromptTerms.length > 0
  const metaItemClassName = 'rounded-sm border border-border bg-surface-container p-4'

  const positivePromptGroupQuery = useQuery({
    queryKey: ['prompt-group-resolve', 'positive', positivePromptTerms],
    queryFn: () => resolvePromptGroups(positivePromptTerms, 'positive'),
    enabled: promptDisplayMode === 'grouped' && positivePromptTerms.length > 0,
    staleTime: 60_000,
  })

  const negativePromptGroupQuery = useQuery({
    queryKey: ['prompt-group-resolve', 'negative', negativePromptTerms],
    queryFn: () => resolvePromptGroups(negativePromptTerms, 'negative'),
    enabled: promptDisplayMode === 'grouped' && negativePromptTerms.length > 0,
    staleTime: 60_000,
  })

  const displayedPromptCards = useMemo(() => {
    if (promptDisplayMode !== 'grouped') {
      return extractedPromptCards
    }

    return extractedPromptCards.map((item) => {
      if (item.id === 'positive-prompt' && positivePromptTerms.length > 0) {
        if (positivePromptGroupQuery.isPending) {
          return { ...item, text: '그룹 정리 중…' }
        }

        if (positivePromptGroupQuery.data) {
          const groupedText = formatGroupedPromptText(positivePromptTerms, positivePromptGroupQuery.data)
          return { ...item, text: groupedText || item.text }
        }
      }

      if (item.id === 'negative-prompt' && negativePromptTerms.length > 0) {
        if (negativePromptGroupQuery.isPending) {
          return { ...item, text: '그룹 정리 중…' }
        }

        if (negativePromptGroupQuery.data) {
          const groupedText = formatGroupedPromptText(negativePromptTerms, negativePromptGroupQuery.data)
          return { ...item, text: groupedText || item.text }
        }
      }

      return item
    })
  }, [
    extractedPromptCards,
    negativePromptGroupQuery.data,
    negativePromptGroupQuery.isPending,
    negativePromptTerms,
    positivePromptGroupQuery.data,
    positivePromptGroupQuery.isPending,
    positivePromptTerms,
    promptDisplayMode,
  ])

  return (
    <div className="space-y-3 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-base font-semibold tracking-tight text-foreground">메타 정보</div>
        <div className="flex items-center gap-2">
          {image.is_processing ? <Badge variant="secondary">Processing</Badge> : null}
          {canEditMetadata ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                imageViewModal?.closeImageView()
                navigate(`/images/${image.composite_hash}/metadata`)
              }}
            >
              <FilePenLine className="h-4 w-4" />
              메타 수정
            </Button>
          ) : null}
        </div>
      </div>

      <div className={metaItemClassName}>
        <p className="text-[11px] uppercase tracking-[0.18em]">Composite hash</p>
        <p className="mt-2 break-all font-mono text-foreground">{image.composite_hash || '—'}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className={metaItemClassName}>
          <p className="text-[11px] uppercase tracking-[0.18em]">Dimensions</p>
          <p className="mt-2 text-foreground">{image.width && image.height ? `${image.width} × ${image.height}` : '—'}</p>
        </div>
        <div className={metaItemClassName}>
          <p className="text-[11px] uppercase tracking-[0.18em]">File size</p>
          <p className="mt-2 text-foreground">{formatBytes(image.file_size)}</p>
        </div>
        {image.ai_metadata?.model_name ? (
          <div className={`${metaItemClassName} sm:col-span-2`}>
            <p className="text-[11px] uppercase tracking-[0.18em]">Model</p>
            <p className="mt-2 break-words text-foreground">{image.ai_metadata.model_name}</p>
          </div>
        ) : null}
        {generationParamItems.map((item) => (
          <div key={item.id} className={metaItemClassName}>
            <p className="text-[11px] uppercase tracking-[0.18em]">{item.label}</p>
            <p className="mt-2 break-words text-foreground">{item.value}</p>
          </div>
        ))}
        {image.original_file_path ? (
          <div className={`${metaItemClassName} sm:col-span-2`}>
            <p className="text-[11px] uppercase tracking-[0.18em]">Path</p>
            <p className="mt-2 break-all font-mono text-xs text-foreground/88">{image.original_file_path}</p>
          </div>
        ) : null}
        {extractedPromptCards.length > 0 ? (
          <div className={`${metaItemClassName} sm:col-span-2`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.18em]">Extracted prompt</p>
              {canTogglePromptGrouping ? (
                <div className="inline-flex rounded-sm border border-border bg-background p-1">
                  <button
                    type="button"
                    className={promptDisplayMode === 'plain' ? 'rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground' : 'rounded-sm px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-surface-high hover:text-foreground'}
                    onClick={() => setPromptDisplayMode('plain')}
                  >
                    일반
                  </button>
                  <button
                    type="button"
                    className={promptDisplayMode === 'grouped' ? 'rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground' : 'rounded-sm px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-surface-high hover:text-foreground'}
                    onClick={() => setPromptDisplayMode('grouped')}
                  >
                    그룹
                  </button>
                </div>
              ) : null}
            </div>
            <div className="mt-3">
              <ExtractedPromptSections items={displayedPromptCards} />
            </div>
          </div>
        ) : null}
        {autoPromptContent ? (
          <div className={`${metaItemClassName} sm:col-span-2`}>
            <p className="text-[11px] uppercase tracking-[0.18em]">Auto prompt</p>
            <div className="mt-3 space-y-3">
              <RatingPromptSection entries={autoPromptContent.ratingEntries} />
              <CharacterPromptSection entries={autoPromptContent.characterEntries} />
              <GeneralPromptSection tags={autoPromptContent.generalTags} entries={autoPromptContent.generalEntries} collapsibleScores />
            </div>
          </div>
        ) : null}
        {artistPromptSection ? (
          <div className={`${metaItemClassName} sm:col-span-2`}>
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
