import { useState, type ReactNode } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { composeCharacterAppearance, type ChatPageData } from '@conai/shared'
import { Copy, ExternalLink, Import, Library } from 'lucide-react'
import { CharacterCard } from '@/components/common/character-card'
import { ListPager } from '@/components/common/list-pager'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { SearchField, ToolbarSearchField } from '@/components/common/search-field'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
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
import { useI18n } from '@/i18n'
import { createCharacterSetting, fillCharacterAppearance, type CharacterAppearanceFill, type CharacterFacetKey, type CharacterSettingFilters } from '@/lib/api-character-library'
import { getDanbooruBrowserCharacters, getDanbooruBrowserSummary, getDanbooruCharacterFacets } from '@/lib/api-danbooru-browser'
import { buildApiUrl } from '@/lib/api-url'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getErrorMessage } from '@/lib/error-message'
import type { DanbooruBrowserCharacterRecord } from '@/types/danbooru-browser'
import { refreshCharacterViews } from './character-library-shared'
import { CharacterFacetPanel } from './components/character-facet-panel'
import { CharacterSettingSaveDialog } from './components/character-setting-save-dialog'

/** The dictionary's page size for characters (the server caps it there). */
const CATALOG_PAGE_SIZE = 30

/** The catalog's dimensions narrow by every chosen tag, so one value per dimension keeps a choice meaningful. */
function singleChoice(previous: CharacterSettingFilters, next: CharacterSettingFilters): CharacterSettingFilters {
  return Object.fromEntries(Object.entries(next).map(([key, tags]) => {
    const before = previous[key as CharacterFacetKey] ?? []
    const added = (tags ?? []).filter((tag) => !before.includes(tag))
    return [key, added.length ? [added[added.length - 1]] : tags ?? []]
  }).filter(([, tags]) => (tags as string[]).length))
}

const catalogName = (character: DanbooruBrowserCharacterRecord) => character.translatedName || character.displayName

/**
 * 캐릭터 카탈로그: the installed Danbooru dictionary's characters (by work, appearance filters, most posts or name), each
 * with its dictionary sample images, work and frequent appearance tags, imported into the appearance library as a new
 * setting (sections and a default outfit). The URL holds `q`, `copyright`, `tags` (comma list), `sort` and `page`.
 */
export function CharacterCatalogPage({ viewSwitch }: { viewSwitch: ReactNode }) {
  const { t, formatNumber } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = useFeaturePermissions()
  const { canViewImages } = useImagePermissions()
  const canImport = permissions.has('characters.edit')
  const [params, setParams] = useSearchParams()
  const query = params.get('q')?.trim() ?? ''
  const copyrightTagId = Number(params.get('copyright')) || null
  const tags = (params.get('tags') ?? '').split(',').filter(Boolean)
  const sort = params.get('sort') === 'name' ? 'name' as const : 'posts' as const
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [searchText, setSearchText] = useState(query)
  const [copyrightText, setCopyrightText] = useState('')
  const [open, setOpen] = useState<DanbooruBrowserCharacterRecord | null>(null)
  const columns = useImageListColumnPreference('catalog')
  const update = (changes: Record<string, string | null>) => setParams((current) => {
    const next = new URLSearchParams(current)
    next.set('view', 'catalog')
    for (const [key, value] of Object.entries(changes)) { if (value === null) next.delete(key); else next.set(key, value) }
    if (!('page' in changes)) next.delete('page')
    return next
  })

  const summary = useQuery({ queryKey: ['danbooru-browser', 'summary'], queryFn: getDanbooruBrowserSummary })
  const facets = useQuery({ queryKey: ['danbooru-browser', 'character-facets'], queryFn: getDanbooruCharacterFacets, staleTime: Infinity })
  const list = useQuery({
    queryKey: ['danbooru-browser', 'catalog', query, copyrightTagId, tags.join(','), sort, page],
    queryFn: () => getDanbooruBrowserCharacters({ query, page, limit: CATALOG_PAGE_SIZE, relatedTagLimit: 0, tags, sort, ...(copyrightTagId ? { copyrightTagId } : {}) }),
    placeholderData: keepPreviousData,
  })
  const items = list.data?.items ?? []
  const pagination = list.data?.pagination
  const available = summary.data?.database.available ?? true
  const copyrights = (summary.data?.tree ?? []).filter((node) => node.section === 'characters' && node.filter?.copyrightTagId !== undefined)
  const shownCopyrights = copyrightText.trim() ? copyrights.filter((node) => `${node.label} ${node.translatedLabel ?? ''}`.toLowerCase().includes(copyrightText.trim().toLowerCase())) : copyrights
  // The catalog's filters are flat tags on the server; per dimension in the panel.
  const dimensionOf = new Map((facets.data?.dimensions ?? []).flatMap((dimension) => dimension.values.map((value) => [value.tag, dimension.key] as const)))
  const filters: CharacterSettingFilters = {}
  for (const tag of tags) { const key = dimensionOf.get(tag); if (key) filters[key] = [...(filters[key] ?? []), tag] }
  const setFilters = (next: CharacterSettingFilters) => update({ tags: Object.values(singleChoice(filters, next)).flat().join(',') || null })

  const importMutation = useMutation({
    mutationFn: async ({ character, folderId, name, fill }: { character: DanbooruBrowserCharacterRecord; folderId: number | null; name: string; fill?: CharacterAppearanceFill }) => {
      const look = fill ?? await fillCharacterAppearance({ source: 'danbooru', character: character.name })
      return createCharacterSetting({ folderId, name, sections: look.sections, outfits: look.outfitTags ? [{ name: t({ ko: '기본', en: 'Default' }), tags: look.outfitTags }] : [] })
    },
    onSuccess: (setting) => {
      void refreshCharacterViews(queryClient, { folderIds: [setting.folderId], settingIds: [setting.id], foldersChanged: true })
      setOpen(null)
      setParams({ setting: String(setting.id) })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '외형 설정으로 가져오지 못했어.', en: 'Could not import it as a setting.' })), tone: 'error' }),
  })

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
      page,
      totalPages: pagination?.totalPages ?? 1,
      total: pagination?.total ?? 0,
      characters: items.map((item) => ({ tagId: item.tagId, name: item.name, translatedName: item.translatedName ?? '', works: item.copyrights.map((copyright) => copyright.name), posts: item.worksCount })),
      filterChoices: (facets.data?.dimensions ?? []).map((dimension) => ({ key: dimension.key, tags: dimension.values.slice(0, 40).map((value) => value.tag) })),
    } as Record<string, ChatPageData>,
    actions: [
      pageAction('character.catalog_search', t({ ko: '카탈로그 검색', en: 'Search the catalog' }), t({ ko: '이름(영문 태그·한국어), 작품 tag id(0은 전체), 외형 태그(쉼표, data.filterChoices), 정렬과 쪽으로 카탈로그를 봐.', en: 'Browse by name, work tag id (0: all), appearance tags (comma list from data.filterChoices), sort and page.' }), pageObject({ query: pageText(200), copyrightTagId: pageNumber(0, undefined, true), tags: pageText(2000), sort: pageChoice(['posts', 'name']), page: pageNumber(1, undefined, true) })),
      ...(canImport ? [pageAction('character.catalog_import', t({ ko: '외형으로 가져오기', en: 'Import as a setting' }), t({ ko: 'data.characters의 캐릭터를 외형 라이브러리 폴더(0은 최상위)에 새 외형 설정으로 만들어. 이름을 비우면 한국어·표시 이름을 써.', en: 'Create a setting from a listed character in a library folder (0: top level); an empty name uses its Korean or display name.' }), pageObject({ tagId: pageChoice(items.length ? items.map((item) => item.tagId) : [0]), folderId: pageNumber(0, undefined, true), name: pageText(60) }, ['tagId', 'folderId']), 'save')] : []),
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
          page: args.page !== undefined && Number(args.page) > 1 ? String(args.page) : null,
        })
        return
      }
      if (id !== 'character.catalog_import') throw new Error('캐릭터 카탈로그에 없는 작업이야.')
      const character = items.find((item) => item.tagId === Number(args.tagId))
      if (!character) throw new Error('지금 목록에 없는 캐릭터야. character.catalog_search로 다시 찾아줘.')
      await importMutation.mutateAsync({ character, folderId: Number(args.folderId) > 0 ? Number(args.folderId) : null, name: String(args.name ?? '').trim() || catalogName(character) })
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
                <span className="min-w-0 flex-1 truncate">{node.translatedLabel || node.label}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatNumber(node.count)}</span>
              </Button>
            ))}
          </div>
          <CharacterFacetPanel facets={facets.data} filters={filters} loading={facets.isPending} onChange={setFilters} />
        </div>
      )}
    >
      {!available ? (
        <EmptyState icon={Library} title={t({ ko: 'Danbooru 사전이 설치되어 있지 않아', en: 'No Danbooru dictionary is installed' })} description={t({ ko: '프롬프트 화면의 Danbooru 탭에서 사전을 설치하면 캐릭터 카탈로그를 볼 수 있어.', en: 'Install it from the Danbooru tab of the prompts page.' })} />
      ) : list.isPending ? (
        <div className="grid gap-4 pt-2" style={{ gridTemplateColumns: `repeat(${columns.columnCount}, minmax(0, 1fr))` }}>{Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} radius="sm" className="aspect-[3/4] w-full" />)}</div>
      ) : list.isError && !list.data ? (
        <ErrorState title={t({ ko: '카탈로그를 불러오지 못했어', en: 'Could not load the catalog' })} error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length ? (
        <section className="space-y-3">
          <Text as="p" variant="caption">{t({ ko: '캐릭터 {count}명', en: '{count} characters' }, { count: formatNumber(pagination?.total ?? items.length) })}</Text>
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${columns.columnCount}, minmax(0, 1fr))` }}>
            {items.map((item) => (
              <CharacterCard
                key={item.tagId}
                name={catalogName(item)}
                mediaSrc={canViewImages && item.images[0] ? buildApiUrl(item.images[0].url) : null}
                avatarProps={{ name: catalogName(item), engine: 'llm', size: 'sm' }}
                onOpen={() => setOpen(item)}
              />
            ))}
          </div>
          <ListPager className="pt-3" hasPrevious={page > 1} hasNext={page < (pagination?.totalPages ?? 1)} onPrevious={() => update({ page: page > 2 ? String(page - 1) : null })} onNext={() => update({ page: String(page + 1) })} />
        </section>
      ) : <EmptyState icon={Library} title={t({ ko: '맞는 캐릭터가 없어', en: 'No matching characters' })} />}

      <ImageListColumnFloatingControl value={columns.columnCount} defaultValue={columns.defaultColumnCount} min={columns.minColumnCount} max={columns.maxColumnCount} onChange={columns.setColumnCount} onReset={columns.resetColumnCount} />
      {open ? <CatalogCharacterModal character={open} canImport={canImport} canViewImages={canViewImages} importing={importMutation.isPending} onImport={(input) => importMutation.mutate({ character: open, ...input })} onClose={() => setOpen(null)} /> : null}
    </PageWithSidebar>
  )
}

/** One catalog character: sample images, works, the look a library import would get, and the import itself. */
function CatalogCharacterModal({ character, canImport, canViewImages, importing, onImport, onClose }: {
  character: DanbooruBrowserCharacterRecord
  canImport: boolean
  canViewImages: boolean
  importing: boolean
  onImport: (input: { folderId: number | null; name: string; fill?: CharacterAppearanceFill }) => void
  onClose: () => void
}) {
  const { t, formatNumber } = useI18n()
  const { showSnackbar } = useSnackbar()
  const [saving, setSaving] = useState(false)
  // The preview uses the library's fill (it needs characters.edit, like the import).
  const preview = useQuery({ queryKey: ['character-library', 'catalog-fill', character.name], queryFn: ({ signal }) => fillCharacterAppearance({ source: 'danbooru', character: character.name }, signal), enabled: canImport })
  const composed = preview.data ? composeCharacterAppearance({ sections: preview.data.sections, outfits: preview.data.outfitTags ? [{ name: '', tags: preview.data.outfitTags }] : [] }) : ''
  const copy = async () => {
    try {
      await copyTextToClipboard(composed || character.name)
      showSnackbar({ message: t({ ko: '태그를 복사했어.', en: 'Copied the tags.' }), tone: 'info' })
    } catch (error) { showSnackbar({ message: getErrorMessage(error, t({ ko: '복사하지 못했어.', en: 'Could not copy.' })), tone: 'error' }) }
  }
  return (
    <Modal open size="lg" title={catalogName(character)} description={[character.displayName, ...character.copyrights.slice(0, 3).map((copyright) => copyright.translatedName || copyright.displayName)].join(' · ')} onClose={onClose}>
      <ModalBody spacing="sm">
        {canViewImages && character.images.length ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {character.images.slice(0, 8).map((image) => <img key={image.fileName} src={buildApiUrl(image.url)} alt="" loading="lazy" className="aspect-[3/4] w-full rounded-sm bg-fill object-cover" />)}
          </div>
        ) : null}
        <Text as="p" variant="caption">{t({ ko: 'Danbooru 게시물 {count}개', en: '{count} Danbooru posts' }, { count: formatNumber(character.worksCount) })}</Text>
        {canImport ? (preview.isPending ? <LoadingState variant="inline" /> : preview.isError ? (
          <ErrorState title={t({ ko: '외형 태그를 읽지 못했어', en: 'Could not read the appearance tags' })} error={preview.error} onRetry={() => void preview.refetch()} />
        ) : (
          <div className="space-y-1">
            <Text as="p" variant="caption">{t({ ko: '가져오면 들어갈 외형 태그 (자주 함께 쓰인 태그)', en: 'Tags an import gets (frequent on its posts)' })}</Text>
            <Text as="p" variant="muted" className="break-words">{composed || t({ ko: '자주 쓰인 외형 태그가 없어.', en: 'No frequent appearance tags.' })}</Text>
          </div>
        )) : null}
      </ModalBody>
      <ModalFooter>
        <Button asChild variant="ghost" size="sm"><a href={character.danbooruUrl} target="_blank" rel="noopener noreferrer"><ExternalLink />Danbooru</a></Button>
        <Button variant="ghost" size="sm" onClick={() => void copy()}><Copy />{t({ ko: '태그 복사', en: 'Copy tags' })}</Button>
        <span className="flex-1" />
        {canImport ? <Button size="sm" disabled={importing || preview.isPending} onClick={() => setSaving(true)}><Import />{t({ ko: '내 외형으로 가져오기', en: 'Import as a setting' })}</Button> : null}
      </ModalFooter>
      {saving ? (
        <CharacterSettingSaveDialog
          title={t({ ko: '외형 라이브러리로 가져오기', en: 'Import into the library' })}
          initialName={catalogName(character)}
          submitLabel={t({ ko: '가져오고 편집하기', en: 'Import and edit' })}
          busy={importing}
          onSubmit={(target) => { setSaving(false); onImport({ ...target, fill: preview.data }) }}
          onClose={() => setSaving(false)}
        />
      ) : null}
    </Modal>
  )
}
