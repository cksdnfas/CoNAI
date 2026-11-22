import { useCallback, useEffect, useEffectEvent, useState } from 'react'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Location } from 'react-router-dom'
import { ART_STYLE_LIMITS, type ArtStyleBulkInput, type ArtStyleCreateInput, type ArtStyleExportInput } from '@conai/shared'
import { positiveLibraryId, useLibraryLocation } from '@/components/common/use-library-location'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { loadNextBatch } from '@/features/characters/character-library-shared'
import { useEditorPageGuard } from '@/features/settings/use-unsaved-settings-guard'
import { useI18n } from '@/i18n'
import {
  ART_STYLES_PAGE_SIZE,
  artStyleBadgesQueryKey,
  artStylePagesQueryKey,
  bulkArtStyles,
  createArtStyle,
  downloadArtStyleExport,
  getArtStyle,
  importArtStyles,
  invalidateArtStyles,
  isArtStyleNameConflict,
  listArtStyleBadges,
  listArtStyles,
  type ArtStyleScope,
  type ArtStyleSort,
  type ArtStyleSummary,
} from '@/lib/api-art-styles'
import { copyTextToClipboard } from '@/lib/clipboard'
import { getErrorMessage } from '@/lib/error-message'
import { useArtStyleEditor, type ArtStyleEditorTarget } from './use-art-style-editor'

const SORTS: readonly ArtStyleSort[] = ['name', 'updated', 'created', 'created_asc']
/** The URL's `b` (selected badges as a JSON array: a badge may hold a comma); anything malformed reads as none. */
function parseBadges(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? [...new Set(parsed.filter((badge): badge is string => typeof badge === 'string' && badge.trim().length > 0))].slice(0, ART_STYLE_LIMITS.badges) : []
  } catch { return [] }
}
const leavesStyle = (current: Location, next: Location) => current.pathname !== next.pathname || new URLSearchParams(current.search).get('style') !== new URLSearchParams(next.search).get('style')

/** A copy's title: ` (2)`, ` (3)`… after the original, within the title limit. */
export function copyTitle(title: string, copy: number) {
  const suffix = ` (${copy})`
  return title.slice(0, ART_STYLE_LIMITS.title - suffix.length) + suffix
}

/**
 * Everything the art styles view holds (/characters?view=styles): the URL state (`q` search, `b` badges, `sort`,
 * `fav`, `style` the open style), the scrolled list and badge counts, the several-select, the open style's editor and
 * every action the screen offers. The page renders from it, and the page assistant (stage A3) reads and drives the same
 * state and actions.
 */
export function useArtStyleLibrary() {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = useFeaturePermissions()
  const { canViewImages } = useImagePermissions()
  const canEdit = permissions.has('characters.edit')
  const { params, query, searchText, setSearchText, update } = useLibraryLocation(ART_STYLES_PAGE_SIZE, ['style'])
  const sortParam = params.get('sort') as ArtStyleSort | null
  const sort: ArtStyleSort = sortParam && SORTS.includes(sortParam) ? sortParam : 'name'
  const favoriteOnly = params.get('fav') === '1'
  const badges = parseBadges(params.get('b'))
  const styleParam = params.get('style')
  const openStyleId = positiveLibraryId(styleParam)
  const editorTarget: ArtStyleEditorTarget = styleParam === 'new' && canEdit ? { new: true } : openStyleId !== null ? { styleId: openStyleId } : null

  const editor = useArtStyleEditor({ target: editorTarget, onCreated: (style) => update({ style: String(style.id) }, true), onClose: () => update({ style: null }) })
  const allowLeave = useCallback((current: Location, next: Location) => current.pathname === next.pathname && editor.deletedRef.current && !new URLSearchParams(next.search).has('style'), [editor.deletedRef])
  useEditorPageGuard(canEdit && editor.dirty, t({ ko: '스타일에 저장하지 않은 변경이 있어. 나가면 사라져.', en: 'This style has unsaved changes that will be lost.' }), leavesStyle, allowLeave)

  /** One URL change for any of the list's scope fields (the assistant may change several at once). */
  const setListView = (changes: { query?: string; sort?: ArtStyleSort; favorite?: boolean; badges?: string[] }) => update({
    ...(changes.query !== undefined ? { q: changes.query.trim() || null } : {}),
    ...(changes.sort !== undefined ? { sort: changes.sort === 'name' ? null : changes.sort } : {}),
    ...(changes.favorite !== undefined ? { fav: changes.favorite ? '1' : null } : {}),
    ...(changes.badges !== undefined ? { b: changes.badges.length ? JSON.stringify(changes.badges) : null } : {}),
  })
  const toggleBadge = (badge: string) => setListView({ badges: badges.includes(badge) ? badges.filter((item) => item !== badge) : [...badges, badge].slice(0, ART_STYLE_LIMITS.badges) })
  const search = (text: string, replace = false) => update({ q: text.trim() || null }, replace)
  const openStyle = (id: number) => { if (!editor.isBusy()) update({ style: String(id) }) }
  const openNewStyle = () => { if (canEdit && !editor.isBusy()) update({ style: 'new' }) }
  const closeStyle = () => {
    if (editor.isBusy()) showSnackbar({ message: t({ ko: '이미지 작업이나 저장이 끝난 뒤 닫을 수 있어.', en: 'Close it after the image operation or save finishes.' }), tone: 'info' })
    else update({ style: null })
  }
  // The shared location stops its search debounce while a style is open; the field still searches (keeping it open).
  const searchOpenEditor = useEffectEvent((text: string) => search(text, true))
  useEffect(() => {
    if (!editor.open || searchText.trim() === query) return
    const timer = window.setTimeout(() => searchOpenEditor(searchText), 300)
    return () => window.clearTimeout(timer)
  }, [editor.open, searchText, query])

  const scope: ArtStyleScope = { query, badges, favorite: favoriteOnly, sort, limit: ART_STYLES_PAGE_SIZE }
  const list = useInfiniteQuery({
    queryKey: artStylePagesQueryKey(scope),
    queryFn: ({ pageParam, signal }) => listArtStyles({ ...scope, offset: pageParam }, signal),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.reduce((sum, page) => sum + page.items.length, 0) : undefined),
    placeholderData: keepPreviousData,
  })
  /** Every loaded style of the scope, in order (undefined until the first batch lands). */
  const loaded = list.data?.pages.flatMap((batch) => batch.items)
  const total = list.data?.pages[0]?.total
  const loadMore = list.hasNextPage ? async () => (await loadNextBatch(list)).flatMap((batch) => batch.items) : null
  const badgeCounts = useQuery({
    queryKey: artStyleBadgesQueryKey(scope),
    queryFn: ({ signal }) => listArtStyleBadges(scope, signal),
    placeholderData: keepPreviousData,
  })
  // A selected badge stays listed (counted 0) so it can be switched off even when no style of the scope has it.
  const badgeList = [...(badgeCounts.data ?? []), ...badges.filter((badge) => !badgeCounts.data?.some((entry) => entry.badge === badge)).map((badge) => ({ badge, count: 0 }))]

  /** Styles chosen for a bulk action, kept across scopes; `selectMode` makes a card click choose instead of open. */
  const [selected, setSelected] = useState<ReadonlyMap<number, ArtStyleSummary>>(new Map())
  const [selectMode, setSelectMode] = useState(false)
  const toggleSelected = (style: ArtStyleSummary) => setSelected((current) => {
    const next = new Map(current)
    if (next.has(style.id)) next.delete(style.id)
    else next.set(style.id, style)
    return next
  })
  const selectAllLoaded = () => setSelected((current) => new Map([...current, ...(loaded ?? []).map((item) => [item.id, item] as const)]))
  const clearSelection = () => { setSelected(new Map()); setSelectMode(false) }

  const onError = (error: unknown, fallback: string) => showSnackbar({ message: getErrorMessage(error, fallback), tone: 'error' })

  const createMutation = useMutation({
    mutationFn: (input: ArtStyleCreateInput) => createArtStyle(input),
    onSuccess: (style) => {
      void invalidateArtStyles(queryClient, { styleIds: [style.id], listsChanged: true })
      openStyle(style.id)
    },
    onError: (error) => {
      onError(error, t({ ko: '스타일을 만들지 못했어.', en: 'Could not create the style.' }))
    },
  })
  const create = (title: string) => createMutation.mutateAsync({ title: title.trim() })

  /** A copy of a style under the next free " (n)" title; the server copies its images for people who see them. */
  const duplicate = async (style: Pick<ArtStyleSummary, 'id'>) => {
    try {
      const source = await getArtStyle(style.id)
      const input: Omit<ArtStyleCreateInput, 'title'> = {
        description: source.description, badges: source.badges, keywords: source.keywords, positive: source.positive, negative: source.negative,
        duplicateOf: source.id,
      }
      for (let copy = 2; copy < 100; copy += 1) {
        try {
          const created = await createArtStyle({ ...input, title: copyTitle(source.title, copy) })
          void invalidateArtStyles(queryClient, { styleIds: [created.id], listsChanged: true })
          showSnackbar({ message: t({ ko: '‘{name}’(으)로 복제했어.', en: 'Duplicated as ‘{name}’.' }, { name: created.title }), tone: 'info' })
          return created
        } catch (error) { if (!isArtStyleNameConflict(error)) throw error }
      }
      throw new Error(t({ ko: '복제할 이름을 찾지 못했어.', en: 'Could not find a free title for the copy.' }))
    } catch (error) { onError(error, t({ ko: '복제하지 못했어.', en: 'Could not duplicate.' })); return null }
  }

  const bulkMutation = useMutation({
    mutationFn: (input: ArtStyleBulkInput) => {
      if (editor.isBusy()) throw new Error(t({ ko: '이미지 작업이나 저장이 끝난 뒤 다시 해줘.', en: 'Wait for the image operation or save to finish.' }))
      return bulkArtStyles(input)
    },
    onSuccess: (_, input) => {
      if (input.action === 'delete') editor.closeIfDeleted(input.ids)
      void invalidateArtStyles(queryClient, { styleIds: input.ids, listsChanged: input.action === 'delete' || favoriteOnly })
      if (input.action !== 'favorite' || input.ids.length > 1) clearSelection()
    },
    onError: (error) => onError(error, t({ ko: '선택한 스타일을 바꾸지 못했어.', en: 'Could not change the selected styles.' })),
  })
  const bulk = (input: ArtStyleBulkInput) => bulkMutation.mutateAsync(input)
  const toggleFavorite = (style: Pick<ArtStyleSummary, 'id' | 'favorite'>) => bulkMutation.mutate({ action: 'favorite', ids: [style.id], favorite: !style.favorite })

  const remove = async (style: ArtStyleSummary) => {
    if (editor.isBusy()) return
    const ok = await confirm({ title: t({ ko: '‘{name}’ 삭제', en: 'Delete ‘{name}’' }, { name: style.title }), description: t({ ko: '스타일과 참조 이미지가 함께 지워져.', en: 'The style and its reference images are deleted.' }), confirmLabel: t({ ko: '삭제', en: 'Delete' }), tone: 'destructive' })
    if (ok) bulkMutation.mutate({ action: 'delete', ids: [style.id] })
  }
  const removeSelected = async () => {
    const ok = await confirm({
      title: t({ ko: '스타일 {count}개 삭제', en: 'Delete {count} styles' }, { count: selected.size }),
      description: t({ ko: '선택한 스타일을 모두 지울까? 참조 이미지도 함께 지워져.', en: 'Delete every selected style? Their reference images are deleted too.' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (ok) bulkMutation.mutate({ action: 'delete', ids: [...selected.keys()] })
  }

  const copyPositive = async (style: Pick<ArtStyleSummary, 'id' | 'title'>) => {
    try {
      const positive = editor.base?.id === style.id ? editor.draftRef.current.positive : (await getArtStyle(style.id)).positive
      if (!positive.trim()) { showSnackbar({ message: t({ ko: '‘{name}’에는 긍정 프롬프트가 없어.', en: '‘{name}’ has no positive prompt.' }, { name: style.title }), tone: 'info' }); return }
      await copyTextToClipboard(positive)
      showSnackbar({ message: t({ ko: '‘{name}’ 긍정 프롬프트를 복사했어.', en: 'Copied the positive prompt of ‘{name}’.' }, { name: style.title }), tone: 'info' })
    } catch (error) { onError(error, t({ ko: '복사하지 못했어.', en: 'Could not copy.' })) }
  }
  /** `{}` exports every style (not only the listed ones). */
  const exportStyles = async (input: ArtStyleExportInput, name: string) => {
    try {
      const count = await downloadArtStyleExport(input, name)
      showSnackbar({ message: t({ ko: '스타일 {count}개를 내보냈어.', en: 'Exported {count} styles.' }, { count }), tone: 'info' })
    } catch (error) { onError(error, t({ ko: '내보내지 못했어.', en: 'Could not export.' })) }
  }
  const importFile = async (file: File) => {
    try {
      const result = await importArtStyles(file)
      void invalidateArtStyles(queryClient, { styleIds: [], listsChanged: true })
      showSnackbar({
        message: [
          t({ ko: '스타일 {count}개를 가져왔어.', en: 'Imported {count} styles.' }, { count: result.created }),
          result.renamed ? t({ ko: '이름이 겹친 {count}개는 번호를 붙였어.', en: '{count} taken titles got a number.' }, { count: result.renamed }) : '',
          result.importedImages ? t({ ko: '참조 이미지 {count}장도 함께 가져왔어.', en: 'Brought {count} reference images along.' }, { count: result.importedImages }) : '',
          result.droppedImages ? t({ ko: '쓸 수 없는 이미지 {count}장은 빼고 가져왔어.', en: '{count} unusable images were left out.' }, { count: result.droppedImages }) : '',
        ].filter(Boolean).join(' '),
        tone: 'info',
      })
      return result
    } catch (error) { onError(error, t({ ko: '가져오지 못했어. CoNAI에서 내보낸 스타일 묶음 ZIP인지 확인해줘.', en: 'Could not import. Check that it is a style bundle ZIP exported from CoNAI.' })); return null }
  }

  return {
    canEdit,
    canViewImages,
    /** Uploads are staged as generation inputs (generation.execute); the library pick is for every editor. */
    canUpload: canEdit && canViewImages && permissions.has('generation.execute'),
    /** The file store pick (files.view). */
    canPickFiles: canEdit && canViewImages && permissions.has('files.view'),
    // List state (URL)
    query, searchText, setSearchText, search,
    sort, favoriteOnly, badges, setListView, toggleBadge,
    // List data
    list, loaded, total, loadMore,
    badgeCounts, badgeList,
    // Selection
    selected, selectMode, setSelectMode, toggleSelected, selectAllLoaded, clearSelection,
    // The open style
    openStyleId, editor, openStyle, openNewStyle, closeStyle,
    // Actions
    create, createPending: createMutation.isPending,
    duplicate, bulk, bulkPending: bulkMutation.isPending, toggleFavorite, remove, removeSelected,
    copyPositive, exportStyles, importFile,
  }
}

export type ArtStyleLibrary = ReturnType<typeof useArtStyleLibrary>
