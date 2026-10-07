import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Copy, Search, Settings2, SlidersHorizontal } from 'lucide-react'
import { ExtractedPromptSections } from '@/components/common/extracted-prompt-sections'
import { SegmentedControl } from '@/components/common/segmented-control'
import {
  ArtistPromptSection,
  CharacterPromptSection,
  GeneralPromptSection,
  RatingPromptSection,
} from '@/components/common/prompt-result-sections'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Chip } from '@/components/ui/chip'
import { SettingRow } from '@/components/ui/setting-row'
import { Switch } from '@/components/ui/switch'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useHomeSearch, type TextSearchScope } from '@/features/home/home-search-context'
import { useImageViewModal } from '@/features/images/components/detail/image-view-modal-context'
import { useI18n } from '@/i18n'
import { resolvePromptGroups } from '@/lib/api-prompts'
import { getImageViewerSettings } from '@/lib/api-settings'
import { updateKaloscopeSettings } from '@/lib/api-settings-kaloscope'
import { buildArtistPromptTagUrl } from '@/lib/artist-prompt-links'
import { copyTextToClipboard } from '@/lib/clipboard'
import { buildDanbooruTagUrl } from '@/lib/danbooru-tag-links'
import { buildGroupedPromptSections, formatGroupedPromptText, getImageExtractedPromptCards, getImagePromptTermItems, type ExtractedPromptActionScope, type PromptGroupingDisplayOptions } from '@/lib/image-extracted-prompts'
import type { ImageRecord } from '@/types/image'
import { ArtistPromptLinkSettingsModal } from './artist-prompt-link-settings-modal'
import { DetailSettingsFlyout } from './detail-settings-flyout'
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
      <div>
        <SettingRow label={t({ ko: '분류 깊이', en: 'Classification depth' })} htmlFor="prompt-grouping-depth-input" className="min-h-11">
          <NumberStepperInput
            id="prompt-grouping-depth-input"

            min={PROMPT_GROUPING_DEPTH_MIN}
            max={PROMPT_GROUPING_DEPTH_MAX}
            step={1}
            value={options.classificationDepth}
            onValueCommit={(nextValue) => onChange({ classificationDepth: clampPromptGroupingDepth(Number(nextValue)) })}
            className="h-8 w-16 rounded-sm border border-transparent bg-field px-2 text-center font-mono text-sm font-semibold text-foreground outline-none transition-colors focus:border-primary/55"
          />
        </SettingRow>

        <SettingRow label={t({ ko: 'Danbooru를 루트 그룹으로 취급', en: 'Treat Danbooru as the root group' })} htmlFor="prompt-grouping-danbooru-root" className="min-h-11">
          <Switch
            id="prompt-grouping-danbooru-root"
            checked={options.treatDanbooruAsRoot}
            onCheckedChange={(checked) => onChange({ treatDanbooruAsRoot: checked })}
          />
        </SettingRow>
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

/** Titled block of the metadata column: a small heading row (optional actions) over flat content. */
function MetaSection({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <h3 className="text-xs font-bold text-foreground">{title}</h3>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

/**
 * Flat metadata column shared by the image page and the viewer: file name, key-value lines, prompt blocks behind a
 * left accent line, groups as chips and a collapsed "기술 정보". No cards; sections are spacing plus small headings.
 */
export function ImageDetailMetaCard({ image }: ImageDetailMetaCardProps) {
  const canConfigure = useAuthStatusQuery().data?.isAdmin === true
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
  const groups = image.groups ?? []
  const canTogglePromptGrouping = positivePromptTermItems.length > 0 || negativePromptTermItems.length > 0

  const settingsQuery = useQuery({
    queryKey: ['image-viewer-settings'],
    queryFn: getImageViewerSettings,
    staleTime: 60_000,
  })

  const artistPromptLinkMutation = useMutation({
    mutationFn: updateKaloscopeSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['image-viewer-settings'] })
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
      showSnackbar({ message: t({ ko: '복사했어.', en: 'Copied.' }), tone: 'info' })
    } catch {
      showSnackbar({ message: t({ ko: '복사하지 못했어.', en: 'Could not copy.' }), tone: 'error' })
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

  const sizeLabel = [image.width && image.height ? `${image.width} × ${image.height}` : null, image.file_size ? formatBytes(image.file_size) : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="space-y-7 text-sm text-muted-foreground">
      <div>
        <div className="flex min-h-8 items-start gap-2">
          <h2 className="min-w-0 flex-1 pt-1 text-sm font-bold break-all text-foreground">
            {fileName ?? t('images.components.detail.image.detail.meta.card.metadata')}
          </h2>
          {image.is_processing ? <Badge variant="secondary">{t({ ko: '처리 중', en: 'Processing' })}</Badge> : null}
        </div>

        <dl className="mt-3 grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
          {firstSeenLabel ? (
            <>
              <dt>{t({ ko: '추가', en: 'Added' })}</dt>
              <dd className="text-foreground">{firstSeenLabel}</dd>
            </>
          ) : null}
          <dt>{t({ ko: '크기', en: 'Size' })}</dt>
          <dd className="text-foreground tabular-nums">{sizeLabel || '—'}</dd>
          {modelSearchValue ? (
            <>
              <dt>{t({ ko: '모델', en: 'Model' })}</dt>
              <dd className="flex min-w-0 items-start gap-1 text-foreground">
                <span className="min-w-0 break-words">{modelSearchValue}</span>
                <IconButton
                  size="icon-xs"
                  variant="ghost"
                  className="-my-0.5 shrink-0"
                  onClick={() => handleAddModelSearchFilter(modelSearchValue)}
                  label={t({ ko: '이 모델로 검색', en: 'Search this model' })}
                >
                  <Search />
                </IconButton>
              </dd>
            </>
          ) : null}
          {generationParamItems.map((item) => (
            <div key={item.id} className="contents">
              <dt>{item.label}</dt>
              <dd className="break-words text-foreground">{item.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {extractedPromptCards.length > 0 ? (
        <MetaSection
          title={t({ ko: '프롬프트', en: 'Prompt' })}
          actions={canTogglePromptGrouping ? (
            <>
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
            </>
          ) : undefined}
        >
          <ExtractedPromptSections items={displayedPromptCards} variant="accent" onAddSearchFilter={handleAddExtractedPromptSearchFilter} />
        </MetaSection>
      ) : null}

      {autoPromptContent ? (
        <MetaSection title={t({ ko: '자동 프롬프트', en: 'Auto prompt' })}>
          <div className="space-y-3">
            <RatingPromptSection entries={autoPromptContent.ratingEntries} />
            <CharacterPromptSection entries={autoPromptContent.characterEntries} />
            <GeneralPromptSection
              tags={autoPromptContent.generalTags}
              entries={autoPromptContent.generalEntries}
              collapsibleScores
              getTagHref={buildDanbooruTagUrl}
              onAddSearchFilter={handleAddAutoPromptSearchFilter}
              tagsHeaderAction={(
                <IconButton
                  size="icon-xs"
                  variant="ghost"
                  onClick={() => void handleCopyAutoPrompt()}
                  disabled={!autoPromptCopyText}
                  label={t('images.components.detail.image.detail.meta.card.auto.prompt.copy')}
                >
                  <Copy className="h-3.5 w-3.5" />
                </IconButton>
              )}
            />
          </div>
        </MetaSection>
      ) : null}

      {artistPromptSection ? (
        <MetaSection
          title={t({ ko: '작가 프롬프트', en: 'Artist prompt' })}
          actions={canConfigure ? (
            <IconButton
              size="icon-sm"
              variant="ghost"
              onClick={() => setIsArtistPromptSettingsOpen(true)}
              label={t('images.components.detail.image.detail.meta.card.artist.prompt.link.settings')}
            >
              <Settings2 className="h-4 w-4" />
            </IconButton>
          ) : null}
        >
          <ArtistPromptSection
            label={artistPromptSection.label}
            tags={artistPromptSection.tags}
            entries={artistPromptSection.entries}
            collapsibleScores
            getTagHref={(tag) => buildArtistPromptTagUrl(tag, artistLinkUrlTemplate)}
            onAddSearchFilter={handleAddAutoPromptSearchFilter}
          />
        </MetaSection>
      ) : null}

      {groups.length > 0 ? (
        <MetaSection title={t({ ko: '그룹', en: 'Groups' })}>
          <ul className="flex flex-wrap gap-1.5">
            {groups.map((group) => (
              <li key={group.id}>
                <Chip tone="muted" className="text-foreground">
                  <span className="size-2 shrink-0 rounded-full bg-primary" style={group.color ? { backgroundColor: group.color } : undefined} aria-hidden />
                  {group.name}
                </Chip>
              </li>
            ))}
          </ul>
        </MetaSection>
      ) : null}

      {technicalItems.length > 0 ? (
        <details className="group/tech border-t border-line pt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-bold text-foreground select-none [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open/tech:rotate-90" />
            {t({ ko: '기술 정보', en: 'Technical details' })}
          </summary>
          <dl className="mt-2">
            {technicalItems.map((item) => (
              <div key={item.id} className="border-b border-line py-2 last:border-b-0">
                <div className="flex items-center justify-between gap-3">
                  <dt>{item.label}</dt>
                  <IconButton
                    size="icon-xs"
                    variant="ghost"
                    onClick={() => void handleCopyTechnicalValue(item.value)}
                    label={t({ ko: '{label} 복사', en: 'Copy {label}' }, { label: item.label })}
                  >
                    <Copy />
                  </IconButton>
                </div>
                <dd className="mt-0.5 font-mono text-xs break-all text-foreground/88">{item.value}</dd>
              </div>
            ))}
          </dl>
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
