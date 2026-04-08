import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, FilePenLine, Settings2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ExtractedPromptSections } from '@/components/common/extracted-prompt-sections'
import { SegmentedControl } from '@/components/common/segmented-control'
import {
  ArtistPromptSection,
  CharacterPromptSection,
  GeneralPromptSection,
  RatingPromptSection,
} from '@/components/common/prompt-result-sections'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { getAppSettings, resolvePromptGroups, updateKaloscopeSettings } from '@/lib/api'
import { buildArtistPromptTagUrl } from '@/lib/artist-prompt-links'
import { buildGroupedPromptSections, formatGroupedPromptText, getImageExtractedPromptCards, getImagePromptTerms } from '@/lib/image-extracted-prompts'
import type { ImageRecord } from '@/types/image'
import { ArtistPromptLinkSettingsModal } from './artist-prompt-link-settings-modal'
import { formatBytes, getImageArtistPromptSection, getImageAutoPromptContent, getImageAutoPromptCopyText, getImageGenerationParamItems } from './image-detail-utils'

interface ImageDetailMetaCardProps {
  image: ImageRecord
}

type PromptDisplayMode = 'plain' | 'grouped'

const PROMPT_DISPLAY_MODE_STORAGE_KEY = 'conai:image-detail:prompt-display-mode'

function loadPromptDisplayMode(): PromptDisplayMode {
  if (typeof window === 'undefined') {
    return 'plain'
  }

  return window.localStorage.getItem(PROMPT_DISPLAY_MODE_STORAGE_KEY) === 'grouped' ? 'grouped' : 'plain'
}

function persistPromptDisplayMode(mode: PromptDisplayMode) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(PROMPT_DISPLAY_MODE_STORAGE_KEY, mode)
}

export function ImageDetailMetaCard({ image }: ImageDetailMetaCardProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const imageViewModal = useImageViewModal()
  const { showSnackbar } = useSnackbar()
  const [promptDisplayMode, setPromptDisplayMode] = useState<PromptDisplayMode>(() => loadPromptDisplayMode())
  const [isArtistPromptSettingsOpen, setIsArtistPromptSettingsOpen] = useState(false)
  const extractedPromptCards = useMemo(() => getImageExtractedPromptCards(image), [image])

  const handlePromptDisplayModeChange = (nextMode: PromptDisplayMode) => {
    setPromptDisplayMode(nextMode)
    persistPromptDisplayMode(nextMode)
  }
  const positivePromptTerms = useMemo(() => getImagePromptTerms(image, 'positive'), [image])
  const negativePromptTerms = useMemo(() => getImagePromptTerms(image, 'negative'), [image])
  const autoPromptContent = getImageAutoPromptContent(image)
  const artistPromptSection = getImageArtistPromptSection(image)
  const autoPromptCopyText = useMemo(() => getImageAutoPromptCopyText(image), [image])
  const generationParamItems = getImageGenerationParamItems(image)
  const canEditMetadata = Boolean(image.composite_hash) && image.file_type === 'image'
  const canTogglePromptGrouping = positivePromptTerms.length > 0 || negativePromptTerms.length > 0
  const metaItemClassName = 'rounded-sm border border-border bg-surface-container p-4'

  const settingsQuery = useQuery({
    queryKey: ['app-settings'],
    queryFn: getAppSettings,
    staleTime: 60_000,
  })

  const artistPromptLinkMutation = useMutation({
    mutationFn: updateKaloscopeSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(['app-settings'], settings)
      showSnackbar({ message: 'Artist prompt 링크 설정을 저장했어.', tone: 'info' })
      setIsArtistPromptSettingsOpen(false)
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : 'Artist prompt 링크 설정 저장에 실패했어.', tone: 'error' })
    },
  })

  const artistLinkUrlTemplate = settingsQuery.data?.kaloscope.artistLinkUrlTemplate

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
          const groupedSections = buildGroupedPromptSections(positivePromptTerms, positivePromptGroupQuery.data)
          const groupedText = formatGroupedPromptText(groupedSections)
          return { ...item, text: groupedText || item.text, groupedSections }
        }
      }

      if (item.id === 'negative-prompt' && negativePromptTerms.length > 0) {
        if (negativePromptGroupQuery.isPending) {
          return { ...item, text: '그룹 정리 중…' }
        }

        if (negativePromptGroupQuery.data) {
          const groupedSections = buildGroupedPromptSections(negativePromptTerms, negativePromptGroupQuery.data)
          const groupedText = formatGroupedPromptText(groupedSections)
          return { ...item, text: groupedText || item.text, groupedSections }
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

  const handleCopyAutoPrompt = async () => {
    if (!autoPromptCopyText) {
      return
    }

    try {
      await navigator.clipboard.writeText(autoPromptCopyText)
      showSnackbar({ message: 'Auto prompt를 복사했어.', tone: 'info' })
    } catch {
      showSnackbar({ message: 'Auto prompt 복사에 실패했어.', tone: 'error' })
    }
  }

  const handleSaveArtistPromptLinkTemplate = (template: string) => {
    void artistPromptLinkMutation.mutateAsync({ artistLinkUrlTemplate: template })
  }

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
                <SegmentedControl
                  value={promptDisplayMode}
                  items={[
                    { value: 'plain', label: '일반' },
                    { value: 'grouped', label: '그룹' },
                  ]}
                  onChange={(nextMode) => handlePromptDisplayModeChange(nextMode as PromptDisplayMode)}
                  size="xs"
                />
              ) : null}
            </div>
            <div className="mt-3">
              <ExtractedPromptSections items={displayedPromptCards} />
            </div>
          </div>
        ) : null}
        {autoPromptContent ? (
          <div className={`${metaItemClassName} sm:col-span-2`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.18em]">Auto prompt</p>
              <Button type="button" size="sm" variant="outline" onClick={() => void handleCopyAutoPrompt()} disabled={!autoPromptCopyText}>
                <Copy className="h-4 w-4" />
                복사
              </Button>
            </div>
            <div className="mt-3 space-y-3">
              <RatingPromptSection entries={autoPromptContent.ratingEntries} />
              <CharacterPromptSection entries={autoPromptContent.characterEntries} />
              <GeneralPromptSection tags={autoPromptContent.generalTags} entries={autoPromptContent.generalEntries} collapsibleScores />
            </div>
          </div>
        ) : null}
        {artistPromptSection ? (
          <div className={`${metaItemClassName} sm:col-span-2`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.18em]">Artist prompt</p>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                onClick={() => setIsArtistPromptSettingsOpen(true)}
                aria-label="Artist prompt 링크 설정"
                title="Artist prompt 링크 설정"
              >
                <Settings2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="mt-3">
              <ArtistPromptSection
                label={artistPromptSection.label}
                tags={artistPromptSection.tags}
                entries={artistPromptSection.entries}
                collapsibleScores
                getTagHref={(tag) => buildArtistPromptTagUrl(tag, artistLinkUrlTemplate)}
              />
            </div>
          </div>
        ) : null}
      </div>

      <ArtistPromptLinkSettingsModal
        open={isArtistPromptSettingsOpen}
        initialTemplate={artistLinkUrlTemplate ?? ''}
        isSaving={artistPromptLinkMutation.isPending}
        onClose={() => setIsArtistPromptSettingsOpen(false)}
        onSave={handleSaveArtistPromptLinkTemplate}
      />
    </div>
  )
}
