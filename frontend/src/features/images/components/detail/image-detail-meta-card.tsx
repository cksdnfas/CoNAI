import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, FilePenLine, Settings2, SlidersHorizontal } from 'lucide-react'
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
import { useI18n } from '@/i18n'
import { resolvePromptGroups } from '@/lib/api-prompts'
import { getAppSettings, updateKaloscopeSettings } from '@/lib/api-settings'
import { buildArtistPromptTagUrl } from '@/lib/artist-prompt-links'
import { copyTextToClipboard } from '@/lib/clipboard'
import { buildGroupedPromptSections, formatGroupedPromptText, getImageExtractedPromptCards, getImagePromptTerms, type PromptGroupingDisplayOptions } from '@/lib/image-extracted-prompts'
import type { ImageRecord } from '@/types/image'
import { ArtistPromptLinkSettingsModal } from './artist-prompt-link-settings-modal'
import { DetailSettingsFlyout, detailSettingsLabelClassName } from './detail-settings-flyout'
import { formatBytes, getImageArtistPromptSection, getImageAutoPromptContent, getImageAutoPromptCopyText, getImageGenerationParamItems } from './image-detail-utils'

interface ImageDetailMetaCardProps {
  image: ImageRecord
}

type PromptDisplayMode = 'plain' | 'grouped'

const PROMPT_DISPLAY_MODE_STORAGE_KEY = 'conai:image-detail:prompt-display-mode'
const PROMPT_GROUPING_OPTIONS_STORAGE_KEY = 'conai:image-detail:prompt-grouping-options'
const DEFAULT_PROMPT_GROUPING_OPTIONS: PromptGroupingDisplayOptions = {
  classificationDepth: 1,
  treatDanbooruAsRoot: false,
}
const PROMPT_GROUPING_DEPTH_MIN = 1
const PROMPT_GROUPING_DEPTH_MAX = 6

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

function clampPromptGroupingDepth(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_PROMPT_GROUPING_OPTIONS.classificationDepth
  }

  return Math.max(PROMPT_GROUPING_DEPTH_MIN, Math.min(PROMPT_GROUPING_DEPTH_MAX, Math.trunc(value)))
}

function normalizePromptGroupingOptions(value: Partial<PromptGroupingDisplayOptions> | null | undefined): PromptGroupingDisplayOptions {
  return {
    classificationDepth: clampPromptGroupingDepth(Number(value?.classificationDepth ?? DEFAULT_PROMPT_GROUPING_OPTIONS.classificationDepth)),
    treatDanbooruAsRoot: value?.treatDanbooruAsRoot ?? DEFAULT_PROMPT_GROUPING_OPTIONS.treatDanbooruAsRoot,
  }
}

function loadPromptGroupingOptions(): PromptGroupingDisplayOptions {
  if (typeof window === 'undefined') {
    return DEFAULT_PROMPT_GROUPING_OPTIONS
  }

  try {
    return normalizePromptGroupingOptions(JSON.parse(window.localStorage.getItem(PROMPT_GROUPING_OPTIONS_STORAGE_KEY) || 'null') as Partial<PromptGroupingDisplayOptions> | null)
  } catch {
    return DEFAULT_PROMPT_GROUPING_OPTIONS
  }
}

function persistPromptGroupingOptions(options: PromptGroupingDisplayOptions) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(PROMPT_GROUPING_OPTIONS_STORAGE_KEY, JSON.stringify(options))
}

interface PromptGroupingOptionsFlyoutProps {
  isOpen: boolean
  options: PromptGroupingDisplayOptions
  onToggle: () => void
  onChange: (patch: Partial<PromptGroupingDisplayOptions>) => void
}

function PromptGroupingOptionsFlyout({ isOpen, options, onToggle, onChange }: PromptGroupingOptionsFlyoutProps) {
  const { t } = useI18n()

  return (
    <DetailSettingsFlyout
      isOpen={isOpen}
      onToggle={onToggle}
      triggerLabel={isOpen ? t({ ko: '프롬프트 그룹 표시 옵션 닫기', en: 'Close prompt grouping options' }) : t({ ko: '프롬프트 그룹 표시 옵션 열기', en: 'Open prompt grouping options' })}
      triggerTitle={t({ ko: '프롬프트 그룹 표시 옵션', en: 'Prompt grouping display options' })}
      panelWidthClassName="w-[min(22rem,calc(100vw-2rem))]"
      icon={<SlidersHorizontal className="h-4 w-4" />}
    >
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-4 rounded-sm border border-border/75 bg-surface-container/70 px-3 py-2.5">
          <label className={detailSettingsLabelClassName} htmlFor="prompt-grouping-depth-input">{t({ ko: '분류 깊이', en: 'Classification depth' })}</label>
          <input
            id="prompt-grouping-depth-input"
            type="number"
            min={PROMPT_GROUPING_DEPTH_MIN}
            max={PROMPT_GROUPING_DEPTH_MAX}
            step={1}
            value={options.classificationDepth}
            onChange={(event) => onChange({ classificationDepth: clampPromptGroupingDepth(Number(event.target.value)) })}
            className="h-8 w-16 rounded-sm border border-border bg-surface-low px-2 text-center font-mono text-sm font-semibold text-foreground outline-none transition-colors focus:border-primary"
          />
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-4 rounded-sm border border-border/75 bg-surface-container/70 px-3 py-2.5 text-sm text-foreground transition-colors hover:bg-surface-high/70">
          <span className="font-medium">{t({ ko: 'Danbooru를 루트 그룹으로 취급', en: 'Treat Danbooru as the root group' })}</span>
          <input
            type="checkbox"
            checked={options.treatDanbooruAsRoot}
            onChange={(event) => onChange({ treatDanbooruAsRoot: event.target.checked })}
            className="h-4 w-4 shrink-0 accent-primary"
          />
        </label>
      </div>
    </DetailSettingsFlyout>
  )
}

export function ImageDetailMetaCard({ image }: ImageDetailMetaCardProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const imageViewModal = useImageViewModal()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const [promptDisplayMode, setPromptDisplayMode] = useState<PromptDisplayMode>(() => loadPromptDisplayMode())
  const [promptGroupingOptions, setPromptGroupingOptions] = useState<PromptGroupingDisplayOptions>(() => loadPromptGroupingOptions())
  const [isPromptGroupingOptionsOpen, setIsPromptGroupingOptionsOpen] = useState(false)
  const [isArtistPromptSettingsOpen, setIsArtistPromptSettingsOpen] = useState(false)
  const extractedPromptCards = useMemo(() => getImageExtractedPromptCards(image, t), [image, t])

  const handlePromptDisplayModeChange = (nextMode: PromptDisplayMode) => {
    setPromptDisplayMode(nextMode)
    persistPromptDisplayMode(nextMode)
  }

  const handlePromptGroupingOptionsChange = (patch: Partial<PromptGroupingDisplayOptions>) => {
    setPromptGroupingOptions((current) => {
      const nextOptions = normalizePromptGroupingOptions({ ...current, ...patch })
      persistPromptGroupingOptions(nextOptions)
      return nextOptions
    })
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
      showSnackbar({ message: t('images.components.detail.image.detail.meta.card.artist.prompt.link.settings.saved'), tone: 'info' })
      setIsArtistPromptSettingsOpen(false)
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t('images.components.detail.image.detail.meta.card.artist.prompt.link.settings.save.failed'), tone: 'error' })
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
          return { ...item, text: t('images.components.detail.image.detail.meta.card.organizing.groups') }
        }

        if (positivePromptGroupQuery.data) {
          const groupedSections = buildGroupedPromptSections(positivePromptTerms, positivePromptGroupQuery.data, promptGroupingOptions)
          const groupedText = formatGroupedPromptText(groupedSections)
          return { ...item, text: groupedText || item.text, groupedSections }
        }
      }

      if (item.id === 'negative-prompt' && negativePromptTerms.length > 0) {
        if (negativePromptGroupQuery.isPending) {
          return { ...item, text: t('images.components.detail.image.detail.meta.card.organizing.groups') }
        }

        if (negativePromptGroupQuery.data) {
          const groupedSections = buildGroupedPromptSections(negativePromptTerms, negativePromptGroupQuery.data, promptGroupingOptions)
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
    promptGroupingOptions,
    t,
  ])

  const handleCopyAutoPrompt = async () => {
    if (!autoPromptCopyText) {
      return
    }

    try {
      await copyTextToClipboard(autoPromptCopyText)
      showSnackbar({ message: t('images.components.detail.image.detail.meta.card.auto.prompt.copied'), tone: 'info' })
    } catch {
      showSnackbar({ message: t('images.components.detail.image.detail.meta.card.auto.prompt.copy.failed'), tone: 'error' })
    }
  }

  const handleSaveArtistPromptLinkTemplate = (template: string) => {
    void artistPromptLinkMutation.mutateAsync({ artistLinkUrlTemplate: template })
  }

  return (
    <div className="space-y-3 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-base font-semibold tracking-tight text-foreground">{t('images.components.detail.image.detail.meta.card.metadata')}</div>
        <div className="flex items-center gap-2">
          {image.is_processing ? <Badge variant="secondary">{t({ ko: '처리 중', en: 'Processing' })}</Badge> : null}
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
              {t('metadata.image.metadata.edit.page.edit.metadata')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className={metaItemClassName}>
        <p className="text-[11px] uppercase tracking-[0.18em]">{t({ ko: '복합 해시', en: 'Composite hash' })}</p>
        <p className="mt-2 break-all font-mono text-foreground">{image.composite_hash || '—'}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className={metaItemClassName}>
          <p className="text-[11px] uppercase tracking-[0.18em]">{t({ ko: '크기', en: 'Dimensions' })}</p>
          <p className="mt-2 text-foreground">{image.width && image.height ? `${image.width} × ${image.height}` : '—'}</p>
        </div>
        <div className={metaItemClassName}>
          <p className="text-[11px] uppercase tracking-[0.18em]">{t({ ko: '파일 크기', en: 'File size' })}</p>
          <p className="mt-2 text-foreground">{formatBytes(image.file_size)}</p>
        </div>
        {image.ai_metadata?.model_name ? (
          <div className={`${metaItemClassName} sm:col-span-2`}>
            <p className="text-[11px] uppercase tracking-[0.18em]">{t({ ko: '모델', en: 'Model' })}</p>
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
            <p className="text-[11px] uppercase tracking-[0.18em]">{t({ ko: '경로', en: 'Path' })}</p>
            <p className="mt-2 break-all font-mono text-xs text-foreground/88">{image.original_file_path}</p>
          </div>
        ) : null}
        {extractedPromptCards.length > 0 ? (
          <div className={`${metaItemClassName} sm:col-span-2`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.18em]">{t({ ko: '추출 프롬프트', en: 'Extracted prompt' })}</p>
              {canTogglePromptGrouping ? (
                <div className="flex items-center gap-2">
                  <SegmentedControl
                    value={promptDisplayMode}
                    items={[
                      { value: 'plain', label: t('images.components.detail.image.detail.meta.card.plain') },
                      { value: 'grouped', label: t('images.components.detail.image.detail.meta.card.group') },
                    ]}
                    onChange={(nextMode) => handlePromptDisplayModeChange(nextMode as PromptDisplayMode)}
                    size="xs"
                  />
                  <PromptGroupingOptionsFlyout
                    isOpen={isPromptGroupingOptionsOpen}
                    options={promptGroupingOptions}
                    onToggle={() => setIsPromptGroupingOptionsOpen((current) => !current)}
                    onChange={handlePromptGroupingOptionsChange}
                  />
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.18em]">{t({ ko: '자동 프롬프트', en: 'Auto prompt' })}</p>
            </div>
            <div className="mt-3 space-y-3">
              <RatingPromptSection entries={autoPromptContent.ratingEntries} />
              <CharacterPromptSection entries={autoPromptContent.characterEntries} />
              <GeneralPromptSection
                tags={autoPromptContent.generalTags}
                entries={autoPromptContent.generalEntries}
                collapsibleScores
                tagsHeaderAction={(
                  <Button
                    type="button"
                    size="xs"
                    variant="ghost"
                    onClick={() => void handleCopyAutoPrompt()}
                    disabled={!autoPromptCopyText}
                    aria-label={t('images.components.detail.image.detail.meta.card.auto.prompt.copy')}
                    title={t('images.components.detail.image.detail.meta.card.auto.prompt.copy')}
                  >
                    <Copy className="h-3.5 w-3.5" />
                    {t({ ko: '복사', en: 'Copy' })}
                  </Button>
                )}
              />
            </div>
          </div>
        ) : null}
        {artistPromptSection ? (
          <div className={`${metaItemClassName} sm:col-span-2`}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.18em]">{t({ ko: '작가 프롬프트', en: 'Artist prompt' })}</p>
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                onClick={() => setIsArtistPromptSettingsOpen(true)}
                aria-label={t('images.components.detail.image.detail.meta.card.artist.prompt.link.settings')}
                title={t('images.components.detail.image.detail.meta.card.artist.prompt.link.settings')}
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
