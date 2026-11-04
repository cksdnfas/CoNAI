import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { CHARACTER_APPEARANCE_SECTION_KEYS, CHAT_PROFILE_TEXT_LIMITS, composeCharacterAppearance, formatDanbooruTagForPrompt, joinPromptParts, type CharacterAppearanceSections, type ChatPageData } from '@conai/shared'
import { BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, ExternalLink, Folder, Image as ImageIcon, Import, Library } from 'lucide-react'
import { CharacterCard } from '@/components/common/character-card'
import { OverlayCardHoverOnly } from '@/components/common/overlay-card'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { SearchField, ToolbarSearchField } from '@/components/common/search-field'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EditorFooter } from '@/components/ui/editor-footer'
import { Chip, ToggleChip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { Field, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { SwitchLine } from '@/components/ui/switch-line'
import { IconButton } from '@/components/ui/icon-button'
import { ErrorState } from '@/components/ui/error-state'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Text } from '@/components/ui/text'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageChoice, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { ImageListColumnFloatingControl } from '@/features/images/components/image-list/image-list-column-floating-control'
import { useImageListColumnPreference } from '@/features/images/components/image-list/image-list-column-preferences'
import { LoadMoreSentinel } from '@/features/posts/post-attach-shared'
import { useI18n, type AppLanguage } from '@/i18n'
import { createCharacterSetting, fillCharacterAppearance, importCharacterCatalogReferences, type CharacterAppearanceFill, type CharacterFacetKey, type CharacterSettingFilters } from '@/lib/api-character-library'
import { getDanbooruBrowserCharacters, getDanbooruBrowserSummary, getDanbooruCharacterFacets } from '@/lib/api-danbooru-browser'
import { buildApiUrl } from '@/lib/api-url'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import type { DanbooruBrowserCharacterRecord } from '@/types/danbooru-browser'
import { folderPath, loadNextBatch, localizedTagName, refreshCharacterViews, useCharacterFolders } from './character-library-shared'
import { CharacterFacetPanel } from './components/character-facet-panel'
import { CharacterFolderPickerModal } from './components/character-folder-nav'
import { useSectionLabels } from './components/character-look-editor'

/** Characters per loaded batch (the dictionary's page size; the server caps it there). */
const CATALOG_PAGE_SIZE = 30

/** The catalog's dimensions narrow by every chosen tag, so one value per dimension keeps a choice meaningful. */
function singleChoice(previous: CharacterSettingFilters, next: CharacterSettingFilters): CharacterSettingFilters {
  return Object.fromEntries(Object.entries(next).map(([key, tags]) => {
    const before = previous[key as CharacterFacetKey] ?? []
    const added = (tags ?? []).filter((tag) => !before.includes(tag))
    return [key, added.length ? [added[added.length - 1]] : tags ?? []]
  }).filter(([, tags]) => (tags as string[]).length))
}

const catalogName = (character: DanbooruBrowserCharacterRecord, language: AppLanguage) => localizedTagName(language, character.displayName, character.translatedName)
const catalogFillKey = (character: DanbooruBrowserCharacterRecord) => ['character-library', 'catalog-fill', character.name]
/** The look an import would get, as one prompt line (sections, then the default outfit). */
const catalogLookText = (fill: CharacterAppearanceFill) => composeCharacterAppearance({ sections: fill.sections, outfits: fill.outfitTags ? [{ name: '', tags: fill.outfitTags }] : [] })
/** A fill's comma list as distinct tags (dictionary fills hold plain tags, so a comma always separates two). */
const fillTags = (text: string) => [...new Set(text.split(',').map((tag) => tag.trim()).filter(Boolean))]

/** One import from the catalog; `open` goes to the new setting afterwards, otherwise the catalog stays. */
type CatalogImport = { character: DanbooruBrowserCharacterRecord; folderId: number | null; name: string; fill?: CharacterAppearanceFill; withImages: boolean; open: boolean }

/**
 * 캐릭터 카탈로그: the installed Danbooru dictionary's characters (by work, appearance filters, most posts or name), each
 * with its dictionary sample images, work and frequent appearance tags, imported into the appearance library as a new
 * setting (sections and a default outfit). The URL holds `q`, `copyright`, `tags` (comma list) and `sort`; the list
 * loads in batches as it scrolls.
 */
export function CharacterCatalogPage({ viewSwitch }: { viewSwitch: ReactNode }) {
  const { t, formatNumber, language } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = useFeaturePermissions()
  const { canViewImages } = useImagePermissions()
  const canImport = permissions.has('characters.edit')
  // Sample images join the library as the new setting's reference images.
  const canImportImages = canImport && canViewImages && permissions.has('images.upload')
  const [params, setParams] = useSearchParams()
  const query = params.get('q')?.trim() ?? ''
  const copyrightTagId = Number(params.get('copyright')) || null
  const tags = (params.get('tags') ?? '').split(',').filter(Boolean)
  const sort = params.get('sort') === 'name' ? 'name' as const : 'posts' as const
  const [searchText, setSearchText] = useState(query)
  const [copyrightText, setCopyrightText] = useState('')
  const [open, setOpen] = useState<DanbooruBrowserCharacterRecord | null>(null)
  /** Settings made from catalog characters while on this page (tag id → setting id), so the dialog offers to open them. */
  const [imported, setImported] = useState<ReadonlyMap<number, number>>(new Map())
  /** The folder imports go to; it stays while the dialog moves between characters. */
  const [importFolderId, setImportFolderId] = useState<number | null>(null)
  const foldersQuery = useCharacterFolders()
  // A folder missing from the cached list (made in another tab just now) is never named as the top level.
  const folderName = (folderId: number | null) => folderId === null ? t({ ko: '최상위', en: 'Top level' }) : foldersQuery.data?.find((folder) => folder.id === folderId)?.name ?? t({ ko: '고른 폴더', en: 'the chosen folder' })
  const columns = useImageListColumnPreference('catalog')
  const update = (changes: Record<string, string | null>) => setParams((current) => {
    const next = new URLSearchParams(current)
    next.set('view', 'catalog')
    for (const [key, value] of Object.entries(changes)) { if (value === null) next.delete(key); else next.set(key, value) }
    // An address from the paged catalog drops its page.
    next.delete('page')
    return next
  })

  const summary = useQuery({ queryKey: ['danbooru-browser', 'summary'], queryFn: getDanbooruBrowserSummary })
  const facets = useQuery({ queryKey: ['danbooru-browser', 'character-facets'], queryFn: getDanbooruCharacterFacets, staleTime: Infinity })
  const list = useInfiniteQuery({
    queryKey: ['danbooru-browser', 'catalog', query, copyrightTagId, tags.join(','), sort],
    queryFn: ({ pageParam }) => getDanbooruBrowserCharacters({ query, page: pageParam, limit: CATALOG_PAGE_SIZE, relatedTagLimit: 0, tags, sort, ...(copyrightTagId ? { copyrightTagId } : {}) }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined),
    placeholderData: keepPreviousData,
  })
  const items = list.data?.pages.flatMap((batch) => batch.items) ?? []
  const total = list.data?.pages[0]?.pagination.total ?? items.length
  const loadMore = async () => (await loadNextBatch(list)).flatMap((batch) => batch.items)
  // The assistant reads the latest loaded batch, as the paged catalog showed it; offset places it in the list.
  const assistantItems = items.slice(-CATALOG_PAGE_SIZE)
  // The dialog steps through the loaded characters (the next batch loads past the last); one no longer listed has no neighbours.
  const openIndex = open ? items.findIndex((item) => item.tagId === open.tagId) : -1
  const available = summary.data?.database.available ?? true
  const copyrights = (summary.data?.tree ?? []).filter((node) => node.section === 'characters' && node.filter?.copyrightTagId !== undefined)
  const shownCopyrights = copyrightText.trim() ? copyrights.filter((node) => `${node.label} ${node.translatedLabel ?? ''}`.toLowerCase().includes(copyrightText.trim().toLowerCase())) : copyrights
  // The catalog's filters are flat tags on the server; per dimension in the panel.
  const dimensionOf = new Map((facets.data?.dimensions ?? []).flatMap((dimension) => dimension.values.map((value) => [value.tag, dimension.key] as const)))
  const filters: CharacterSettingFilters = {}
  for (const tag of tags) { const key = dimensionOf.get(tag); if (key) filters[key] = [...(filters[key] ?? []), tag] }
  const setFilters = (next: CharacterSettingFilters) => update({ tags: Object.values(singleChoice(filters, next)).flat().join(',') || null })

  const withSamples = (character: DanbooruBrowserCharacterRecord) => canImportImages && character.images.length > 0
  const importMutation = useMutation({
    mutationFn: async ({ character, folderId, name, fill, withImages }: CatalogImport) => {
      const look = fill ?? await fillCharacterAppearance({ source: 'danbooru', character: character.name })
      const setting = await createCharacterSetting({ folderId, name, sections: look.sections, outfits: look.outfitTags ? [{ name: t({ ko: '기본', en: 'Default' }), tags: look.outfitTags }] : [] })
      if (!withImages) return { setting, images: null }
      // The setting exists either way: a failed image import is reported beside it, not as a failed import.
      const images = await importCharacterCatalogReferences(setting.id, { character: character.name, revision: setting.revision })
        .then((result) => ({ result }), (error: unknown) => ({ error }))
      return { setting: 'result' in images ? images.result.setting : setting, images }
    },
    onSuccess: ({ setting, images }, input) => {
      void refreshCharacterViews(queryClient, { folderIds: [setting.folderId], settingIds: [setting.id], foldersChanged: true })
      setImported((current) => new Map(current).set(input.character.tagId, setting.id))
      const openSetting = () => setParams({ setting: String(setting.id) })
      if (input.open) { setOpen(null); openSetting() }
      const action = input.open ? undefined : { label: t({ ko: '열기', en: 'Open' }), onClick: openSetting }
      if (images && 'error' in images) {
        showSnackbar({ message: `${t({ ko: '‘{name}’ 외형은 가져왔지만 샘플 이미지는 넣지 못했어.', en: 'Imported ‘{name}’, but its sample images could not be added.' }, { name: setting.name })} ${getErrorMessage(images.error, '')}`.trim(), tone: 'error', action })
        return
      }
      if (input.open) return
      showSnackbar({
        message: [
          t({ ko: '‘{name}’ 외형을 {folder}에 가져왔어.', en: 'Imported ‘{name}’ into {folder}.' }, { name: setting.name, folder: folderName(setting.folderId) }),
          images?.result.added ? t({ ko: '샘플 이미지 {count}장을 참고 이미지로 넣었어.', en: 'Added {count} sample images as references.' }, { count: images.result.added }) : '',
          images?.result.dropped ? t({ ko: '{count}장은 넣지 못했어.', en: '{count} could not be added.' }, { count: images.result.dropped }) : '',
        ].filter(Boolean).join(' '),
        // Every sample dropped: the image step failed even though the setting exists.
        tone: images && !images.result.added && images.result.dropped ? 'error' : 'info',
        action,
      })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '외형 설정으로 가져오지 못했어.', en: 'Could not import it as a setting.' })), tone: 'error' }),
  })
  // The mutation's pending state reaches the screen a tick late, so a fast double Enter could import twice.
  const importLock = useRef(false)
  const runImport = async (input: CatalogImport) => {
    if (importLock.current) throw new Error(t({ ko: '다른 가져오기가 아직 진행 중이야.', en: 'Another import is still running.' }))
    importLock.current = true
    try { return await importMutation.mutateAsync(input) } finally { importLock.current = false }
  }
  // Failures are reported by the mutation's snackbar; screen imports only need to not double-run.
  const importFromScreen = (input: CatalogImport) => { if (!importLock.current) void runImport(input).catch(() => undefined) }

  // The library's look for a card's quick copy (it needs characters.edit, like the import); else the character tag.
  const copyLook = async (character: DanbooruBrowserCharacterRecord) => {
    try {
      const fill = canImport ? await queryClient.fetchQuery({ queryKey: catalogFillKey(character), queryFn: ({ signal }) => fillCharacterAppearance({ source: 'danbooru', character: character.name }, signal) }) : null
      await copyTextToClipboard(fill ? catalogLookText(fill) : formatDanbooruTagForPrompt(character.name))
      showSnackbar({ message: t({ ko: '태그를 복사했어.', en: 'Copied the tags.' }), tone: 'info' })
    } catch (error) { showSnackbar({ message: getErrorMessage(error, t({ ko: '복사하지 못했어.', en: 'Could not copy.' })), tone: 'error' }) }
  }

  useChatPageRegistration({
    kind: 'page',
    title: t({ ko: '캐릭터 카탈로그', en: 'Character catalog' }),
    resourceId: 'catalog',
    priority: 0,
    dirty: false,
    fields: [],
    data: {
      available,
      query,
      copyrightTagId: copyrightTagId ?? 0,
      tags,
      sort,
      total,
      hasMore: Boolean(list.hasNextPage),
      offset: items.length - assistantItems.length,
      characters: assistantItems.map((item) => ({ tagId: item.tagId, name: item.name, translatedName: item.translatedName ?? '', works: item.copyrights.map((copyright) => copyright.name), posts: item.worksCount })),
      filterChoices: (facets.data?.dimensions ?? []).map((dimension) => ({ key: dimension.key, tags: dimension.values.slice(0, 40).map((value) => value.tag) })),
    } as Record<string, ChatPageData>,
    actions: [
      pageAction('character.catalog_search', t({ ko: '카탈로그 검색', en: 'Search the catalog' }), t({ ko: '이름(영문 태그·한국어), 작품 tag id(0은 전체), 외형 태그(쉼표, data.filterChoices)와 정렬로 카탈로그를 봐. 목록은 첫 묶음부터 보여.', en: 'Browse by name, work tag id (0: all), appearance tags (comma list from data.filterChoices) and sort; the list starts from the first batch.' }), pageObject({ query: pageText(200), copyrightTagId: pageNumber(0, undefined, true), tags: pageText(2000), sort: pageChoice(['posts', 'name']) })),
      ...(list.hasNextPage ? [pageAction('character.catalog_load_more', t({ ko: '카탈로그 더 불러오기', en: 'Load more characters' }), t({ ko: '목록의 다음 묶음을 불러와. data.characters는 마지막으로 불러온 묶음이고 offset은 그 첫 캐릭터의 위치야. hasMore가 false면 다 불러온 거야.', en: 'Load the next batch; data.characters is the latest loaded batch and offset is its first character’s position. hasMore false means everything is loaded.' }), pageObject({}))] : []),
      ...(canImport ? [pageAction('character.catalog_import', t({ ko: '외형으로 가져오기', en: 'Import as a setting' }), t({ ko: 'data.characters의 캐릭터를 외형 라이브러리 폴더(0은 최상위)에 새 외형 설정으로 만들어. 이름을 비우면 카드에 보이는 이름을 써. includeSampleImages(기본: 가능하면 켬)는 사전의 샘플 이미지를 참고 이미지로 함께 넣어. 카탈로그 화면은 그대로 남아.', en: 'Create a setting from a listed character in a library folder (0: top level); an empty name uses the name shown on its card. includeSampleImages (default: on when possible) adds the dictionary sample images as reference images. The catalog stays open.' }), pageObject({ tagId: pageChoice(assistantItems.length ? assistantItems.map((item) => item.tagId) : [0]), folderId: pageNumber(0, undefined, true), name: pageText(60), includeSampleImages: { type: 'boolean' } }, ['tagId', 'folderId']), 'save')] : []),
    ],
    apply: () => {},
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (id === 'character.catalog_search') {
        update({
          q: args.query !== undefined ? String(args.query).trim() || null : params.get('q'),
          copyright: args.copyrightTagId !== undefined ? (Number(args.copyrightTagId) > 0 ? String(args.copyrightTagId) : null) : params.get('copyright'),
          tags: args.tags !== undefined ? String(args.tags).split(',').map((tag) => tag.trim()).filter(Boolean).join(',') || null : params.get('tags'),
          sort: args.sort !== undefined ? (args.sort === 'name' ? 'name' : null) : params.get('sort'),
        })
        return
      }
      if (id === 'character.catalog_load_more') {
        if (!list.hasNextPage) throw new Error('카탈로그 목록을 이미 다 불러왔어.')
        await loadMore()
        return
      }
      if (id !== 'character.catalog_import') throw new Error('캐릭터 카탈로그에 없는 작업이야.')
      const character = items.find((item) => item.tagId === Number(args.tagId))
      if (!character) throw new Error('지금 목록에 없는 캐릭터야. character.catalog_search로 다시 찾아줘.')
      if (args.includeSampleImages === true && !withSamples(character)) throw new Error(canImportImages ? '이 캐릭터는 사전에 샘플 이미지가 없어. includeSampleImages 없이 다시 가져와줘.' : '샘플 이미지를 넣으려면 images.view와 images.upload 권한이 필요해. includeSampleImages 없이 가져와줘.')
      const { setting, images } = await runImport({
        character,
        folderId: Number(args.folderId) > 0 ? Number(args.folderId) : null,
        name: String(args.name ?? '').trim() || catalogName(character, language),
        withImages: withSamples(character) && args.includeSampleImages !== false,
        open: false,
      })
      // The setting exists now: name it, so the assistant edits it instead of importing again into a name conflict.
      if (images && 'error' in images) throw new Error(`외형 설정 ‘${setting.name}’(settingId ${setting.id})은 만들었지만 샘플 이미지는 넣지 못했어: ${getErrorMessage(images.error, '알 수 없는 오류')}`)
      if (images && !images.result.added && images.result.dropped) throw new Error(`외형 설정 ‘${setting.name}’(settingId ${setting.id})은 만들었지만 샘플 이미지 ${images.result.dropped}장을 하나도 넣지 못했어.`)
    },
  })

  const toolbar = (
    <PageToolbar
      start={viewSwitch}
      actions={(
        <Select variant="default" controlSize="compact" className="w-auto" aria-label={t({ ko: '정렬', en: 'Sort' })} value={sort} onChange={(event) => update({ sort: event.target.value === 'name' ? 'name' : null })}>
          <option value="posts">{t({ ko: '많이 그려진 순', en: 'Most posts' })}</option>
          <option value="name">{t({ ko: '이름순', en: 'Name' })}</option>
        </Select>
      )}
    >
      <ToolbarSearchField value={searchText} onChange={(text) => { setSearchText(text); update({ q: text.trim() || null }) }} placeholder={t({ ko: '캐릭터 이름 (영문 태그·한국어)', en: 'Character name' })} />
    </PageToolbar>
  )

  return (
    <PageWithSidebar
      storageKey="characters-catalog"
      sidebarLabel={t({ ko: '작품', en: 'Works' })}
      toolbar={toolbar}
      sidebar={(
        <div className="space-y-3">
          <SearchField value={copyrightText} onChange={setCopyrightText} placeholder={t({ ko: '작품 검색', en: 'Search works' })} />
          <div className="space-y-1">
            <Button type="button" variant="nav" size="sm" data-active={copyrightTagId === null ? 'true' : undefined} onClick={() => update({ copyright: null })}><Library />{t({ ko: '모든 작품', en: 'All works' })}</Button>
            {shownCopyrights.map((node) => (
              <Button key={node.id} type="button" variant="nav" size="sm" data-active={copyrightTagId === node.filter?.copyrightTagId ? 'true' : undefined} onClick={() => update({ copyright: String(node.filter?.copyrightTagId) })}>
                <span className="min-w-0 flex-1 truncate">{localizedTagName(language, node.label, node.translatedLabel)}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatNumber(node.count)}</span>
              </Button>
            ))}
          </div>
          <CharacterFacetPanel facets={facets.data} filters={filters} loading={facets.isPending} onChange={setFilters} />
        </div>
      )}
    >
      {!available ? (
        <EmptyState icon={Library} title={t({ ko: 'Danbooru 사전이 설치되어 있지 않아', en: 'No Danbooru dictionary is installed' })} action={<Button asChild size="sm"><Link to="/prompts?tab=danbooru">{t({ ko: '프롬프트에서 설치', en: 'Install in Prompts' })}</Link></Button>} />
      ) : list.isPending ? (
        <div className="grid gap-4 pt-2" style={{ gridTemplateColumns: `repeat(${columns.columnCount}, minmax(0, 1fr))` }}>{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} radius="sm" className="aspect-[3/4] w-full" />)}</div>
      ) : list.isError && !list.data ? (
        <ErrorState title={t({ ko: '카탈로그를 불러오지 못했어', en: 'Could not load the catalog' })} error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length ? (
        <section className="space-y-3">
          <Text as="p" variant="caption">{t({ ko: '캐릭터 {count}명', en: '{count} characters' }, { count: formatNumber(total) })}</Text>
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns.columnCount}, minmax(0, 1fr))` }}>
            {items.map((item) => {
              const work = item.copyrights[0]
              const name = catalogName(item, language)
              return (
                <CharacterCard
                  key={item.tagId}
                  name={name}
                  mediaSrc={canViewImages && item.images[0] ? buildApiUrl(item.images[0].url) : null}
                  onOpen={() => setOpen(item)}
                  subtitle={name !== item.displayName ? item.displayName : undefined}
                  meta={<span className="flex items-center gap-1" aria-label={t({ ko: '이미지 {count}장', en: '{count} posts' }, { count: formatNumber(item.worksCount) })}><ImageIcon />{formatNumber(item.worksCount)}</span>}
                  topStart={work ? <Badge variant="overlay" size="sm" className="max-w-full"><BookOpen /><span className="truncate">{localizedTagName(language, work.displayName, work.translatedName)}</span></Badge> : undefined}
                  topEnd={<OverlayCardHoverOnly><IconButton asChild variant="overlay" size="icon-sm" label="Danbooru"><a href={item.danbooruUrl} target="_blank" rel="noopener noreferrer"><ExternalLink /></a></IconButton></OverlayCardHoverOnly>}
                  actions={<>
                    {canImport ? (imported.has(item.tagId)
                      ? <IconButton size="icon-sm" label={t({ ko: '가져온 외형 열기', en: 'Open the imported setting' })} onClick={() => setParams({ setting: String(imported.get(item.tagId)) })}><Check /></IconButton>
                      : <IconButton size="icon-sm" label={t({ ko: '{folder}에 가져오기', en: 'Import into {folder}' }, { folder: folderName(importFolderId) })} disabled={importMutation.isPending} onClick={() => importFromScreen({ character: item, folderId: importFolderId, name, withImages: withSamples(item), open: false })}><Import /></IconButton>) : null}
                    <IconButton variant="overlay" size="icon-sm" label={t({ ko: '태그 복사', en: 'Copy tags' })} onClick={() => void copyLook(item)}><Copy /></IconButton>
                  </>}
                />
              )
            })}
          </div>
          {list.isFetchNextPageError ? (
            <ErrorState size="compact" title={t({ ko: '다음 캐릭터를 불러오지 못했어', en: 'Could not load more characters' })} error={list.error} onRetry={() => void list.fetchNextPage()} isRetrying={list.isFetchingNextPage} />
          ) : <>
            <LoadMoreSentinel rootMargin="800px" enabled={list.hasNextPage && !list.isFetchingNextPage} onVisible={() => void list.fetchNextPage({ cancelRefetch: false })} />
            {list.isFetchingNextPage ? <LoadingState variant="inline" /> : null}
          </>}
        </section>
      ) : <EmptyState icon={Library} title={t({ ko: '맞는 캐릭터가 없어', en: 'No matching characters' })} />}

      <ImageListColumnFloatingControl value={columns.columnCount} defaultValue={columns.defaultColumnCount} min={columns.minColumnCount} max={columns.maxColumnCount} onChange={columns.setColumnCount} onReset={columns.resetColumnCount} />
      {open ? (
        <CatalogCharacterModal
          character={open}
          position={{ index: openIndex, count: total }}
          canImport={canImport}
          canViewImages={canViewImages}
          canImportImages={withSamples(open)}
          folderId={importFolderId}
          onFolderChange={setImportFolderId}
          importing={importMutation.isPending}
          importedSettingId={imported.get(open.tagId) ?? null}
          onImport={(input) => importFromScreen({ character: open, folderId: importFolderId, ...input })}
          onOpenSetting={(settingId) => { setOpen(null); setParams({ setting: String(settingId) }) }}
          onPrevious={openIndex > 0 ? () => setOpen(items[openIndex - 1]) : null}
          onNext={openIndex >= 0 && openIndex < items.length - 1 ? () => setOpen(items[openIndex + 1])
            : openIndex >= 0 && list.hasNextPage ? () => {
              const from = open.tagId
              void loadMore().then(
                // Closed or moved on while the batch loaded: a late batch must not reopen or jump the dialog.
                (loaded) => setOpen((current) => (current?.tagId === from && loaded[openIndex + 1] ? loaded[openIndex + 1] : current)),
                (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '다음 캐릭터를 불러오지 못했어.', en: 'Could not load more characters.' })), tone: 'error' }),
              )
            } : null}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </PageWithSidebar>
  )
}

/**
 * One catalog character: its dictionary sample images, works, the tags an import would get (each one can be left
 * out), where it goes and the import itself, with the listed neighbours a step away (‹ ›, ← →). The dialog stays
 * mounted while it moves on (its back-button entry and focus stay); only the per-character choices start over, and the
 * folder is the page's and stays.
 */
function CatalogCharacterModal({ character, position, canImport, canViewImages, canImportImages, folderId, onFolderChange, importing, importedSettingId, onImport, onOpenSetting, onPrevious, onNext, onClose }: {
  character: DanbooruBrowserCharacterRecord
  /** Its place in the listed page (`index` -1 when it is no longer listed). */
  position: { index: number; count: number }
  canImport: boolean
  canViewImages: boolean
  /** Its sample images can go along as reference images. */
  canImportImages: boolean
  folderId: number | null
  onFolderChange: (folderId: number | null) => void
  importing: boolean
  /** The setting already made from it on this page. */
  importedSettingId: number | null
  onImport: (input: { name: string; fill?: CharacterAppearanceFill; withImages: boolean; open: boolean }) => void
  onOpenSetting: (settingId: number) => void
  onPrevious: (() => void) | null
  onNext: (() => void) | null
  onClose: () => void
}) {
  const { t, formatNumber, language } = useI18n()
  const { showSnackbar } = useSnackbar()
  const labels = useSectionLabels()
  /** The choices for the shown character; `excluded` holds left-out tags as `<row>\u0000<tag>` (a tag may sit in a section and the outfit). */
  const freshChoices = () => ({ tagId: character.tagId, imageIndex: 0, excluded: new Set<string>() as ReadonlySet<string>, withImages: true, name: catalogName(character, language) })
  const [stored, setChoices] = useState(freshChoices)
  // Start over during render, not in an effect, so another character never shows the previous one's choices.
  if (stored.tagId !== character.tagId) setChoices(freshChoices())
  const { imageIndex, excluded, withImages, name } = stored.tagId === character.tagId ? stored : freshChoices()
  const choose = (patch: Partial<Omit<typeof stored, 'tagId'>>) => setChoices((current) => ({ ...current, ...patch }))
  const [pickingFolder, setPickingFolder] = useState(false)
  const foldersQuery = useCharacterFolders()
  const folders = foldersQuery.data ?? []
  const folderLabel = [t({ ko: '최상위', en: 'Top level' }), ...folderPath(new Map(folders.map((folder) => [folder.id, folder])), folderId).map((folder) => folder.name)].join(' / ')
  // The preview uses the library's fill (it needs characters.edit, like the import).
  const preview = useQuery({ queryKey: catalogFillKey(character), queryFn: ({ signal }) => fillCharacterAppearance({ source: 'danbooru', character: character.name }, signal), enabled: canImport })
  const images = canViewImages ? character.images : []
  const shownImage = images[Math.min(imageIndex, images.length - 1)]

  const kept = (row: string, tag: string) => !excluded.has(`${row}\u0000${tag}`)
  const toggle = (row: string, tag: string) => setChoices((current) => {
    const next = new Set(current.excluded)
    const key = `${row}\u0000${tag}`
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return { ...current, excluded: next }
  })
  const fill = preview.data
  const rows = fill ? [
    ...CHARACTER_APPEARANCE_SECTION_KEYS.map((key) => ({ key: key as string, label: labels[key].label, tags: fillTags(fill.sections[key]) })),
    { key: 'outfit', label: t({ ko: '기본 의상', en: 'Default outfit' }), tags: fillTags(fill.outfitTags) },
  ].filter((row) => row.tags.length) : []
  const chosen: CharacterAppearanceFill | undefined = fill ? {
    name: fill.name,
    sections: Object.fromEntries(CHARACTER_APPEARANCE_SECTION_KEYS.map((key) => [key, joinPromptParts(fillTags(fill.sections[key]).filter((tag) => kept(key, tag)))])) as CharacterAppearanceSections,
    outfitTags: joinPromptParts(fillTags(fill.outfitTags).filter((tag) => kept('outfit', tag))),
  } : undefined
  const composed = chosen ? catalogLookText(chosen) : ''
  const copy = async () => {
    try {
      await copyTextToClipboard(composed || formatDanbooruTagForPrompt(character.name))
      showSnackbar({ message: t({ ko: '태그를 복사했어.', en: 'Copied the tags.' }), tone: 'info' })
    } catch (error) { showSnackbar({ message: getErrorMessage(error, t({ ko: '복사하지 못했어.', en: 'Could not copy.' })), tone: 'error' }) }
  }
  const importBlocked = importing || !chosen || !name.trim()
  const submit = (open: boolean) => {
    if (importBlocked) return
    onImport({ name: name.trim(), fill: chosen, withImages: canImportImages && withImages, open })
  }

  // ← → step through the listed characters unless a field or the folder picker has the keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (pickingFolder || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')) return
      const step = event.key === 'ArrowLeft' ? onPrevious : event.key === 'ArrowRight' ? onNext : null
      if (!step) return
      event.preventDefault()
      step()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickingFolder, onPrevious, onNext])

  return (
    <Modal
      open
      size={images.length ? 'xl' : 'lg'}
      title={catalogName(character, language)}
      description={[character.displayName, ...character.copyrights.slice(0, 3).map((copyright) => localizedTagName(language, copyright.displayName, copyright.translatedName))].join(' · ')}
      status={importedSettingId !== null ? <Chip tone="primary" size="sm"><Check />{t({ ko: '가져옴', en: 'Imported' })}</Chip> : undefined}
      onClose={onClose}
    >
      <ModalBody>
        <div className={cn('grid gap-6', images.length > 0 && 'lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]')}>
          {shownImage ? (
            <div className="min-w-0 space-y-2">
              <div className="relative aspect-[3/4] overflow-hidden rounded-lg bg-fill">
                <img src={buildApiUrl(shownImage.url)} alt={t({ ko: '{name} 샘플 이미지 {index}', en: '{name} sample image {index}' }, { name: catalogName(character, language), index: imageIndex + 1 })} className="size-full object-cover" />
                {images.length > 1 ? <Badge variant="overlay" size="sm" className="absolute right-2 bottom-2 tabular-nums">{imageIndex + 1} / {images.length}</Badge> : null}
              </div>
              {images.length > 1 ? (
                <div className="grid grid-cols-6 gap-1.5">
                  {images.map((image, index) => (
                    // eslint-disable-next-line no-restricted-syntax -- the thumbnail itself is the control
                    <button
                      key={image.fileName}
                      type="button"
                      aria-pressed={index === imageIndex}
                      aria-label={t({ ko: '샘플 이미지 {index} 보기', en: 'Show sample image {index}' }, { index: index + 1 })}
                      onClick={() => choose({ imageIndex: index })}
                      className={cn('aspect-[3/4] cursor-pointer overflow-hidden rounded-sm bg-fill outline-none focus-visible:ring-2 focus-visible:ring-ring', index === imageIndex && 'ring-2 ring-primary ring-offset-2 ring-offset-background')}
                    >
                      <img src={buildApiUrl(image.url)} alt="" loading="lazy" className="size-full object-cover" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="min-w-0 space-y-5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Text as="span" variant="caption">{t({ ko: 'Danbooru 게시물 {count}개', en: '{count} Danbooru posts' }, { count: formatNumber(character.worksCount) })}</Text>
              <Button asChild variant="ghost" size="xs"><a href={character.danbooruUrl} target="_blank" rel="noopener noreferrer"><ExternalLink />{t({ ko: 'Danbooru에서 보기', en: 'Open on Danbooru' })}</a></Button>
            </div>

            {canImport ? (preview.isPending ? <LoadingState variant="inline" /> : preview.isError ? (
              <ErrorState title={t({ ko: '외형 태그를 읽지 못했어', en: 'Could not read the appearance tags' })} error={preview.error} onRetry={() => void preview.refetch()} />
            ) : (
              <section className="space-y-3">
                <div className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1">
                  <h3 className="text-sm font-semibold text-foreground">{t({ ko: '가져올 외형 태그', en: 'Tags to import' })}</h3>
                  {rows.length ? <span className="text-xs text-muted-foreground">{t({ ko: '누르면 빠지고, 다시 누르면 들어가', en: 'Click to leave one out, again to keep it' })}</span> : null}
                  <span className="flex-1" />
                  <Button variant="ghost" size="sm" disabled={!composed} onClick={() => void copy()}><Copy />{t({ ko: '태그 복사', en: 'Copy tags' })}</Button>
                </div>
                {rows.length ? (
                  <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2">
                    {rows.map((row) => (
                      <Fragment key={row.key}>
                        <dt className="pt-1 text-xs text-muted-foreground">{row.label}</dt>
                        <dd className="flex min-w-0 flex-wrap gap-1.5">
                          {row.tags.map((tag) => {
                            const on = kept(row.key, tag)
                            return <ToggleChip key={tag} size="sm" pressed={on} onClick={() => toggle(row.key, tag)}>{on ? tag : <s>{tag}</s>}</ToggleChip>
                          })}
                        </dd>
                      </Fragment>
                    ))}
                  </dl>
                ) : <Text as="p" variant="muted">{t({ ko: '자주 쓰인 외형 태그가 없어.', en: 'No frequent appearance tags.' })}</Text>}
              </section>
            )) : null}

            {canImport && canImportImages ? (
              <div className="space-y-1">
                <SwitchLine
                  label={t({ ko: '샘플 이미지 {count}장을 참고 이미지로 함께 가져오기', en: 'Also import the {count} sample images as references' }, { count: images.length })}
                  checked={withImages}
                  disabled={importedSettingId !== null}
                  onCheckedChange={(checked) => choose({ withImages: checked })}
                />
                <Text as="p" variant="caption">{t({ ko: '이미지 탭의 미분류 참고 이미지로 들어가고, 첫 장이 기준 이미지가 돼.', en: 'They join the uncategorized references; the first becomes the reference image.' })}</Text>
              </div>
            ) : null}

            {canImport && importedSettingId === null ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldGroup label={t({ ko: '저장 위치', en: 'Folder' })}>
                  <Button type="button" variant="field" size="field" className="w-full" disabled={importing || foldersQuery.isPending} onClick={() => setPickingFolder(true)}>
                    <span className="flex min-w-0 items-center gap-2"><Folder className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{folderLabel}</span></span>
                    <ChevronDown className="text-muted-foreground" />
                  </Button>
                </FieldGroup>
                <Field label={t({ ko: '외형 설정 이름', en: 'Setting name' })}>
                  <Input variant="settings" value={name} maxLength={CHAT_PROFILE_TEXT_LIMITS.name} disabled={importing} onChange={(event) => choose({ name: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); submit(false) } }} />
                </Field>
              </div>
            ) : null}
          </div>
        </div>
      </ModalBody>
      <EditorFooter onSave={canImport && importedSettingId === null ? () => submit(false) : undefined} canSave={!importBlocked} saveLabel={t({ ko: '가져오기', en: 'Import' })}>
        {position.count > 1 && position.index >= 0 ? (
          <div className="flex items-center gap-1">
            <IconButton size="icon-sm" variant="ghost" label={t({ ko: '이전 캐릭터', en: 'Previous character' })} disabled={!onPrevious} onClick={() => onPrevious?.()}><ChevronLeft /></IconButton>
            <span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">{position.index + 1} / {position.count}</span>
            <IconButton size="icon-sm" variant="ghost" label={t({ ko: '다음 캐릭터', en: 'Next character' })} disabled={!onNext} onClick={() => onNext?.()}><ChevronRight /></IconButton>
          </div>
        ) : null}
        {!canImport ? (
          <Button variant="ghost" size="sm" onClick={() => void copy()}><Copy />{t({ ko: '태그 복사', en: 'Copy tags' })}</Button>
        ) : importedSettingId !== null ? (
          <Button variant="ghost" size="sm" onClick={() => onOpenSetting(importedSettingId)}>{t({ ko: '가져온 외형 열기', en: 'Open the imported setting' })}</Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" disabled={importBlocked} onClick={() => submit(true)}>{t({ ko: '가져와서 열기', en: 'Import and open' })}</Button>
          </>
        )}
      </EditorFooter>
      {pickingFolder ? (
        <CharacterFolderPickerModal
          title={t({ ko: '폴더 고르기', en: 'Choose folder' })}
          folders={folders}
          value={folderId}
          submitLabel={t({ ko: '선택', en: 'Select' })}
          onPick={(picked) => { onFolderChange(picked); setPickingFolder(false) }}
          onClose={() => setPickingFolder(false)}
        />
      ) : null}
    </Modal>
  )
}
