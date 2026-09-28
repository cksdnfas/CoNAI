import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, FilePenLine, Search, Settings2, SlidersHorizontal } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
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
import { useHomeSearch, type TextSearchScope } from '@/features/home/home-search-context'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { useI18n } from '@/i18n'
import { resolvePromptGroups } from '@/lib/api-prompts'
import { getAppSettings } from '@/lib/api-settings-general'
import { updateKaloscopeSettings } from '@/lib/api-settings-kaloscope'
import { buildArtistPromptTagUrl } from '@/lib/artist-prompt-links'
import { copyTextToClipboard } from '@/lib/clipboard'
import { buildDanbooruTagUrl } from '@/lib/danbooru-tag-links'
import { buildGroupedPromptSections, formatGroupedPromptText, getImageExtractedPromptCards, getImagePromptTermItems, type ExtractedPromptActionScope, type PromptGroupingDisplayOptions } from '@/lib/image-extracted-prompts'
import type { ImageRecord } from '@/types/image'
import { prepareImageSourceState } from '@/features/images/image-source-navigation'
import { ArtistPromptLinkSettingsModal } from './artist-prompt-link-settings-modal'
import { DetailSettingsFlyout, detailSettingsLabelClassName } from './detail-settings-flyout'
import { formatBytes, getDownloadName, getImageArtistPromptSection, getImageAutoPromptContent, getImageAutoPromptCopyText, getImageGenerationParamItems, parseImageTimestamp } from './image-detail-utils'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'

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
          <NumberStepperInput
            id="prompt-grouping-depth-input"

            min={PROMPT_GROUPING_DEPTH_MIN}
            max={PROMPT_GROUPING_DEPTH_MAX}
            step={1}
            value={options.classificationDepth}
            onValueCommit={(nextValue) => onChange({ classificationDepth: clampPromptGroupingDepth(Number(nextValue)) })}
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

function getTextSearchScopeForExtractedPrompt(scope: ExtractedPromptActionScope): TextSearchScope {
  if (scope === 'negative') {
    return 'negative'
  }

  if (scope === 'lora') {
    return 'lora'
  }

  return 'positive'
}

function getImageModelSearchValue(image: ImageRecord) {
  const modelName = image.ai_metadata?.model_name
  return typeof modelName === 'string' ? modelName.trim() : ''
}

export function ImageDetailMetaCard({ image }: ImageDetailMetaCardProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const imageViewModal = useImageViewModal()
  const { addScopedTextChip } = useHomeSearch()
  const { showSnackbar } = useSnackbar()
  const { t, formatDateTime } = useI18n()
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
  const positivePromptTermItems = useMemo(() => getImagePromptTermItems(image, 'positive'), [image])
  const negativePromptTermItems = useMemo(() => getImagePromptTermItems(image, 'negative'), [image])
  const positivePromptTerms = useMemo(() => positivePromptTermItems.map((term) => term.searchValue), [positivePromptTermItems])
  const negativePromptTerms = useMemo(() => negativePromptTermItems.map((term) => term.searchValue), [negativePromptTermItems])
  const autoPromptContent = getImageAutoPromptContent(image)
  const artistPromptSection = getImageArtistPromptSection(image)
  const autoPromptCopyText = useMemo(() => getImageAutoPromptCopyText(image), [image])
  const generationParamItems = getImageGenerationParamItems(image, t)
  const fileName = image.original_file_path ? getDownloadName(image.original_file_path) : null
  const firstSeenDate = parseImageTimestamp(image.first_seen_date)
  const firstSeenLabel = firstSeenDate ? formatDateTime(firstSeenDate) : null
  const technicalItems = [
    image.original_file_path ? { id: 'path', label: t({ ko: '파일 경로', en: 'File path' }), value: image.original_file_path } : null,
    image.composite_hash ? { id: 'hash', label: t({ ko: '복합 해시', en: 'Composite hash' }), value: image.composite_hash } : null,
  ].filter((item): item is { id: string; label: string; value: string } => item !== null)
  const modelSearchValue = getImageModelSearchValue(image)
  const canEditMetadata = Boolean(image.composite_hash) && image.file_type === 'image'
  const canTogglePromptGrouping = positivePromptTermItems.length > 0 || negativePromptTermItems.length > 0
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
      if (item.id === 'positive-prompt' && positivePromptTermItems.length > 0) {
        if (positivePromptGroupQuery.isPending) {
          return { ...item, text: t('images.components.detail.image.detail.meta.card.organizing.groups') }
        }

        if (positivePromptGroupQuery.data) {
          const groupedSections = buildGroupedPromptSections(positivePromptTermItems, positivePromptGroupQuery.data, promptGroupingOptions, t)
          const groupedText = formatGroupedPromptText(groupedSections)
          return { ...item, text: groupedText || item.text, groupedSections }
        }
      }

      if (item.id === 'negative-prompt' && negativePromptTermItems.length > 0) {
        if (negativePromptGroupQuery.isPending) {
          return { ...item, text: t('images.components.detail.image.detail.meta.card.organizing.groups') }
        }

        if (negativePromptGroupQuery.data) {
          const groupedSections = buildGroupedPromptSections(negativePromptTermItems, negativePromptGroupQuery.data, promptGroupingOptions, t)
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
    negativePromptTermItems,
    positivePromptGroupQuery.data,
    positivePromptGroupQuery.isPending,
    positivePromptTermItems,
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

  const handleCopyTechnicalValue = async (value: string) => {
    try {
      await copyTextToClipboard(value)
      showSnackbar({ message: t({ ko: '복사했습니다.', en: 'Copied.' }), tone: 'info' })
    } catch {
      showSnackbar({ message: t({ ko: '복사하지 못했습니다.', en: 'Could not copy.' }), tone: 'error' })
    }
  }

  const handleSaveArtistPromptLinkTemplate = (template: string) => {
    void artistPromptLinkMutation.mutateAsync({ artistLinkUrlTemplate: template })
  }

  const handleAddExtractedPromptSearchFilter = (scope: ExtractedPromptActionScope, tag: string) => {
    imageViewModal?.closeImageView()
    addScopedTextChip(getTextSearchScopeForExtractedPrompt(scope), tag, { apply: true })
  }

  const handleAddAutoPromptSearchFilter = (tag: string) => {
    imageViewModal?.closeImageView()
    addScopedTextChip('auto', tag, { apply: true })
  }

  const handleAddModelSearchFilter = (modelName: string) => {
    imageViewModal?.closeImageView()
    addScopedTextChip('model', modelName, { apply: true })
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
                const sourceState = prepareImageSourceState(location)
                imageViewModal?.closeImageView()
                navigate(`/images/${image.composite_hash}/metadata`, { state: sourceState })
              }}
            >
              <FilePenLine className="h-4 w-4" />
              {t('metadata.image.metadata.edit.page.edit.metadata')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {fileName ? (
          <div className={firstSeenLabel ? metaItemClassName : `${metaItemClassName} sm:col-span-2`}>
            <p className="text-[11px] uppercase tracking-[0.18em]">{t({ ko: '파일 이름', en: 'File name' })}</p>
            <p className="mt-2 break-all text-foreground">{fileName}</p>
          </div>
        ) : null}
        {firstSeenLabel ? (
          <div className={fileName ? metaItemClassName : `${metaItemClassName} sm:col-span-2`}>
            <p className="text-[11px] uppercase tracking-[0.18em]">{t({ ko: '추가된 날짜', en: 'Added' })}</p>
            <p className="mt-2 text-foreground">{firstSeenLabel}</p>
          </div>
        ) : null}
        <div className={metaItemClassName}>
          <p className="text-[11px] uppercase tracking-[0.18em]">{t({ ko: '크기', en: 'Dimensions' })}</p>
          <p className="mt-2 text-foreground">{image.width && image.height ? `${image.width} × ${image.height}` : '—'}</p>
        </div>
        <div className={metaItemClassName}>
          <p className="text-[11px] uppercase tracking-[0.18em]">{t({ ko: '파일 크기', en: 'File size' })}</p>
          <p className="mt-2 text-foreground">{formatBytes(image.file_size)}</p>
        </div>
        {modelSearchValue ? (
          <div className={`${metaItemClassName} sm:col-span-2`}>
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] uppercase tracking-[0.18em]">{t({ ko: '모델', en: 'Model' })}</p>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={() => handleAddModelSearchFilter(modelSearchValue)}
                aria-label={t({ ko: '이 모델로 검색', en: 'Search this model' })}
                title={t({ ko: '이 모델로 검색', en: 'Search this model' })}
              >
                <Search className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-2 break-words text-foreground">{modelSearchValue}</p>
          </div>
        ) : null}
        {generationParamItems.map((item) => (
          <div key={item.id} className={metaItemClassName}>
            <p className="text-[11px] uppercase tracking-[0.18em]">{item.label}</p>
            <p className="mt-2 break-words text-foreground">{item.value}</p>
          </div>
        ))}
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
              <ExtractedPromptSections items={displayedPromptCards} onAddSearchFilter={handleAddExtractedPromptSearchFilter} />
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
                getTagHref={buildDanbooruTagUrl}
                onAddSearchFilter={handleAddAutoPromptSearchFilter}
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
                onAddSearchFilter={handleAddAutoPromptSearchFilter}
              />
            </div>
          </div>
        ) : null}
      </div>

      {technicalItems.length > 0 ? (
        <details className={metaItemClassName}>
          <summary className="cursor-pointer select-none text-[11px] uppercase tracking-[0.18em] marker:text-muted-foreground">
            {t({ ko: '기술 정보', en: 'Technical details' })}
          </summary>
          <div className="mt-3 space-y-3">
            {technicalItems.map((item) => (
              <div key={item.id}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] uppercase tracking-[0.18em]">{item.label}</p>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => void handleCopyTechnicalValue(item.value)}
                    aria-label={t({ ko: '{label} 복사', en: 'Copy {label}' }, { label: item.label })}
                    title={t({ ko: '{label} 복사', en: 'Copy {label}' }, { label: item.label })}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
                <p className="mt-1 break-all font-mono text-xs text-foreground/88">{item.value}</p>
              </div>
            ))}
          </div>
        </details>
      ) : null}

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
