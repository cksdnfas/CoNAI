import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react'
import { useLibraryLocation, positiveLibraryId as positiveId } from '@/components/common/use-library-location'
import { LibraryFolderContent, libraryFolderView } from '@/components/common/library-folder-content'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Navigate, useSearchParams } from 'react-router-dom'
import { SegmentedControl } from '@/components/common/segmented-control'
import { registerTranslationCatalog } from '@/i18n'
import { settingsCatalog } from '@/i18n/resources/settings'
import { CheckCheck, CheckSquare, Copy, Download, FolderInput, FolderPlus, Pencil, Plus, SquarePen, Star, StarOff, Trash2, Upload, UserRound } from 'lucide-react'
import { NameDialog } from '@/components/common/entry-dialogs'
import { SelectionActionBar, SelectionBarAction } from '@/components/common/selection-action-bar'
import { Select } from '@/components/ui/select'
import { ImageListColumnFloatingControl } from '@/features/images/components/image-list/image-list-column-floating-control'
import { useImageListColumnPreference } from '@/features/images/components/image-list/image-list-column-preferences'
import { copyTextToClipboard } from '@/lib/clipboard'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { PathBreadcrumbs } from '@/components/common/path-breadcrumbs'
import { ToolbarSearchField } from '@/components/common/search-field'
import { ActionMenuButton, type ActionMenuEntry } from '@/components/ui/action-menu'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { Heading } from '@/components/ui/heading'
import { LoadingState } from '@/components/ui/loading-state'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { RowGroup } from '@/components/ui/row-group'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useI18n } from '@/i18n'
import type { CharacterSettingBulkInput } from '@conai/shared'
import {
  CHARACTER_LIBRARY_QUERY_KEY,
  CHARACTER_SETTINGS_PAGE_SIZE,
  bulkCharacterSettings,
  downloadCharacterLibraryExport,
  getCharacterSetting,
  importCharacterLibrary,
  type CharacterSettingFilters,
  type CharacterSettingSort,
  createCharacterFolder,
  createCharacterSetting,
  deleteCharacterFolder,
  deleteCharacterSetting,
  getCharacterFolderDeletePreview,
  getCharacterSettingDeletePreview,
  isCharacterRevisionConflict,
  updateCharacterFolder,
  updateCharacterSetting,
  type CharacterFolder,
  type CharacterLibraryDeletePreview,
  type CharacterSettingSummary,
} from '@/lib/api-character-library'
import { getErrorMessage } from '@/lib/error-message'
import { LoadMoreSentinel } from '@/features/posts/post-attach-shared'
import { folderSubtreeIds, loadNextBatch, refreshCharacterViews, useCharacterFacets, useCharacterFolders, useCharacterSettingsPages } from './character-library-shared'
import { CharacterCatalogPage } from './character-catalog-page'
import { CharacterFacetPanel, hasActiveFilters } from './components/character-facet-panel'
import { CharacterFolderPickerModal, CharacterFolderSidebar } from './components/character-folder-nav'
import { CharacterSettingCard } from './components/character-setting-card'
import { CharacterSettingGrid } from './components/character-setting-grid'
import { CharacterSettingSaveDialog } from './components/character-setting-save-dialog'
import { useCharacterLibraryChatPage } from './use-character-library-chat-page'
import { useCharacterSettingEditor, type SettingEditorTarget } from './use-character-setting-editor'
import { useCharacterSettingGuard } from './use-character-setting-guard'
import { CharacterSettingDialog } from './components/character-setting-dialog'
import type { CharacterAppearanceTab } from '@/features/settings/components/character-appearance-editor'

type NameDialogState = { mode: 'create'; parentId: number | null; name: string } | { mode: 'rename'; folder: CharacterFolder; name: string }
type MoveState = { kind: 'folder'; folder: CharacterFolder } | { kind: 'setting'; setting: CharacterSettingSummary }

/**
 * 캐릭터: the appearance library and the Danbooru character catalog. The library's URL holds the open folder
 * (`folder`), the name search across the library (`q`), the setting open in its dialog (`setting`) and a new setting's
 * draft (`new`: its folder id or `root`); the list loads in batches as it scrolls.
 * Chat profiles are separate (they live in the chat workspace and only borrow a look from here).
 */
registerTranslationCatalog(settingsCatalog)

export function CharacterLibraryPage() {
  const permissions = useFeaturePermissions()
  const [params] = useSearchParams()
  const view = params.get('view')
  // Chat profiles were once a view of this page.
  if (view === 'profiles') {
    const next = new URLSearchParams(params)
    next.delete('view')
    return <Navigate to={`/chat/profiles${next.size ? `?${next}` : ''}`} replace />
  }
  if (params.has('setting') || params.has('new')) return <AppearanceLibraryPage />
  if (view === 'catalog' && permissions.has('prompts.view')) return <CharacterCatalogPage viewSwitch={<CharacterViewSwitch />} />
  return <AppearanceLibraryPage />
}

/** The page's views: the appearance library and the Danbooru character catalog (with the dictionary's `prompts.view`); the switch leads the toolbar and shows when both are there. */
function CharacterViewSwitch() {
  const { t } = useI18n()
  const permissions = useFeaturePermissions()
  const [params, setParams] = useSearchParams()
  const items = [
    { value: 'appearance', label: t({ ko: '외형 라이브러리', en: 'Appearance library' }) },
    ...(permissions.has('prompts.view') ? [{ value: 'catalog', label: t({ ko: '캐릭터 카탈로그', en: 'Character catalog' }) }] : []),
  ]
  // Without the catalog there is nothing to switch to: the page's name leads the toolbar instead.
  if (items.length < 2) return <Heading level={3} as="h1" className="truncate">{items[0].label}</Heading>
  const view = params.get('view')
  return (
    <SegmentedControl
      value={view === 'catalog' ? view : 'appearance'}
      onChange={(value) => setParams(value === 'appearance' ? {} : { view: value })}
      size="sm"
      semantics="tabs"
      ariaLabel={t({ ko: '캐릭터 보기', en: 'Character views' })}
      items={items}
    />
  )
}

const SORTS: readonly CharacterSettingSort[] = ['name', 'updated', 'created', 'created_asc']
/** The URL's `f` (filters as JSON); anything malformed reads as no filters. */
function parseFilters(value: string | null): CharacterSettingFilters {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((tag) => typeof tag === 'string')))
  } catch { return {} }
}

function AppearanceLibraryPage() {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = useFeaturePermissions()
  const canEdit = permissions.has('characters.edit')
  const { params: searchParams, folderId, query, searchText, setSearchText, update, openFolder: navigateFolder } = useLibraryLocation(CHARACTER_SETTINGS_PAGE_SIZE, ['setting', 'new'])
  const tabParam = searchParams.get('tab')
  const editorTab: CharacterAppearanceTab = tabParam === 'images' || tabParam === 'expressions' || tabParam === 'candidates' ? tabParam : 'tags'
  const setEditorTab = (tab: CharacterAppearanceTab) => { if (!editor.isBusy()) update({ tab: tab === 'tags' ? null : tab }, true) }
  const search = (text: string, replace = false) => update({ q: text.trim() || null, page: null }, replace)
  const openFolder = (id: number | null) => { if (!editor.isBusy()) navigateFolder(id) }
  const sortParam = searchParams.get('sort') as CharacterSettingSort | null
  const sort: CharacterSettingSort = sortParam && SORTS.includes(sortParam) ? sortParam : 'name'
  const favoriteOnly = searchParams.get('fav') === '1'
  const filters = parseFilters(searchParams.get('f'))
  // Filters and favorites look across the whole library, like a name search.
  const filtering = favoriteOnly || hasActiveFilters(filters)
  const setListView = (changes: { sort?: CharacterSettingSort; favorite?: boolean; filters?: CharacterSettingFilters }) => update({
    ...(changes.sort !== undefined ? { sort: changes.sort === 'name' ? null : changes.sort } : {}),
    ...(changes.favorite !== undefined ? { fav: changes.favorite ? '1' : null } : {}),
    ...(changes.filters !== undefined ? { f: hasActiveFilters(changes.filters) ? JSON.stringify(changes.filters) : null } : {}),
    page: null,
  })
  const columns = useImageListColumnPreference('characters')
  /** Settings chosen for a bulk action, kept across scopes; `selectMode` makes a card click choose instead of open. */
  const [selected, setSelected] = useState<ReadonlyMap<number, CharacterSettingSummary>>(new Map())
  const [selectMode, setSelectMode] = useState(false)
  const [bulkMoving, setBulkMoving] = useState(false)
  const importInput = useRef<HTMLInputElement | null>(null)
  const openSettingId = positiveId(searchParams.get('setting'))
  // `new`: a new setting drafted in a folder (`root` for the top level); an open saved setting wins.
  const newParam = searchParams.get('new')
  const newIn = openSettingId === null && newParam !== null && (newParam === 'root' || positiveId(newParam) !== null) ? { folderId: positiveId(newParam) } : null
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [moving, setMoving] = useState<MoveState | null>(null)
  /** A new setting's name and folder, asked before it is made and opened in its editor page. */
  const [creating, setCreating] = useState<{ folderId: number | null } | null>(null)
  const openSetting = (id: number) => { if (!editor.isBusy()) update({ setting: String(id), new: null }) }
  const newSetting = (inFolder: number | null) => { if (!editor.isBusy()) update({ setting: null, new: inFolder === null ? 'root' : String(inFolder) }) }
  const closeEditor = () => {
    if (editor.isBusy()) showSnackbar({ message: t({ ko: '이미지 작업이나 저장이 끝난 뒤 닫을 수 있어.', en: 'Close it after the image operation or save finishes.' }), tone: 'info' })
    else update({ setting: null, new: null })
  }

  const foldersQuery = useCharacterFolders()
  const folders = foldersQuery.data ?? []
  const { currentFolder, path, subfolders, folderMissing } = libraryFolderView(folders, folderId, foldersQuery.isSuccess)
  const scope = { folder: query || filtering ? 'all' as const : folderId ?? 'root' as const, query, limit: CHARACTER_SETTINGS_PAGE_SIZE, favorite: favoriteOnly, filters, sort }
  const settingsQuery = useCharacterSettingsPages(scope, !folderMissing)
  /** Every loaded setting of the scope, in order (undefined until the first batch lands). */
  const loaded = settingsQuery.data?.pages.flatMap((batch) => batch.items)
  const settingsTotal = settingsQuery.data?.pages[0]?.total
  const loadMore = settingsQuery.hasNextPage
    ? async () => (await loadNextBatch(settingsQuery)).flatMap((batch) => batch.items)
    : null
  const facetsQuery = useCharacterFacets({ folder: 'all', query, favorite: favoriteOnly, filters })

  const target: SettingEditorTarget = openSettingId !== null ? { settingId: openSettingId } : newIn ? { newIn: newIn.folderId } : null
  const editor = useCharacterSettingEditor({
    target,
    onCreated: (setting) => update({ setting: String(setting.id), new: null }, true),
    onClose: () => update({ setting: null, new: null }),
  })
  useCharacterSettingGuard(editor, canEdit)
  const searchOpenEditor = useEffectEvent((text: string) => search(text, true))
  useEffect(() => {
    if (!editor.open || searchText.trim() === query) return
    const timer = window.setTimeout(() => searchOpenEditor(searchText), 300)
    return () => window.clearTimeout(timer)
  }, [editor.open, searchText, query])

  const onError = (error: unknown, fallback: string) => showSnackbar({ message: getErrorMessage(error, fallback), tone: 'error' })
  const createMutation = useMutation({
    mutationFn: (input: { folderId: number | null; name: string }) => createCharacterSetting(input),
    onSuccess: (setting) => {
      setCreating(null)
      void refreshCharacterViews(queryClient, { folderIds: [setting.folderId], settingIds: [setting.id] })
      openSetting(setting.id)
    },
    onError: (error) => onError(error, t({ ko: '외형 설정을 만들지 못했어.', en: 'Could not create the setting.' })),
  })
  const nameMutation = useMutation({
    mutationFn: (state: NameDialogState) => state.mode === 'create'
      ? createCharacterFolder({ parentId: state.parentId, name: state.name.trim() })
      : updateCharacterFolder(state.folder.id, { name: state.name.trim() }),
    onSuccess: (folder, state) => {
      setNameDialog(null)
      void refreshCharacterViews(queryClient, { folderIds: [folder.id, folder.parentId], settingIds: [], foldersChanged: true })
      if (state.mode === 'create') openFolder(folder.id)
    },
    onError: (error) => onError(error, t({ ko: '폴더를 저장하지 못했어.', en: 'Could not save the folder.' })),
  })
  const moveMutation = useMutation({
    mutationFn: async ({ state, to }: { state: MoveState; to: number | null }) => {
      if (state.kind === 'folder') await updateCharacterFolder(state.folder.id, { parentId: to })
      else await updateCharacterSetting(state.setting.id, { folderId: to, revision: state.setting.revision })
    },
    onSuccess: (_, { state, to }) => {
      setMoving(null)
      void refreshCharacterViews(queryClient, state.kind === 'folder'
        ? { folderIds: [state.folder.id, state.folder.parentId, to], settingIds: [], foldersChanged: true }
        : { folderIds: [state.setting.folderId, to], settingIds: [state.setting.id] })
    },
    onError: (error, { state }) => {
      if (!isCharacterRevisionConflict(error)) { onError(error, t({ ko: '옮기지 못했어.', en: 'Could not move.' })); return }
      if (state.kind === 'setting') void refreshCharacterViews(queryClient, { folderIds: [state.setting.folderId], settingIds: [state.setting.id] })
      setMoving(null)
      showSnackbar({ message: t({ ko: '다른 곳에서 이 외형 설정이 바뀌었어. 목록을 새로 불러왔으니 다시 옮겨줘.', en: 'This setting changed elsewhere. The list is refreshed; move it again.' }), tone: 'error' })
    },
  })

  const describeDeletion = (preview: CharacterLibraryDeletePreview) => [
    preview.folders ? t({ ko: '폴더 {folders}개와 외형 설정 {settings}개가 함께 지워져.', en: '{folders} folders and {settings} settings will be deleted.' }, { folders: preview.folders, settings: preview.settings }) : '',
    // Names reach administrators only; everyone sees the count.
    !preview.linkedProfileCount ? ''
      : preview.linkedProfiles.length ? t({ ko: '연결된 프로필 {count}개({names})는 지금 값의 사본을 유지해.', en: '{count} linked profiles ({names}) keep a copy of the values.' }, { count: preview.linkedProfileCount, names: preview.linkedProfiles.slice(0, 5).map((profile) => profile.name).join(', ') })
        : t({ ko: '연결된 프로필 {count}개는 지금 값의 사본을 유지해.', en: '{count} linked profiles keep a copy of the values.' }, { count: preview.linkedProfileCount }),
  ].filter(Boolean).join('\n')
  const deleteFolder = async (folder: CharacterFolder) => {
    try {
      const preview = await getCharacterFolderDeletePreview(folder.id)
      const ok = await confirm({ title: t({ ko: '‘{name}’ 폴더 삭제', en: 'Delete folder ‘{name}’' }, { name: folder.name }), description: describeDeletion(preview), confirmLabel: t({ ko: '삭제', en: 'Delete' }), tone: 'destructive' })
      if (!ok) return
      const removed = folderSubtreeIds(folders, folder.id)
      await deleteCharacterFolder(folder.id)
      const open = editor.baseRef.current
      if (open?.folderId !== null && open?.folderId !== undefined && removed.has(open.folderId)) editor.closeIfDeleted([open.id])
      void refreshCharacterViews(queryClient, { folderIds: [folder.id, folder.parentId], settingIds: [], foldersChanged: true })
      if (folderId !== null && removed.has(folderId)) openFolder(folder.parentId)
    } catch (error) { onError(error, t({ ko: '폴더를 지우지 못했어.', en: 'Could not delete the folder.' })) }
  }
  const deleteSetting = async (setting: CharacterSettingSummary) => {
    if (editor.isBusy()) return
    try {
      const preview = await getCharacterSettingDeletePreview(setting.id)
      const ok = await confirm({ title: t({ ko: '‘{name}’ 삭제', en: 'Delete ‘{name}’' }, { name: setting.name }), description: describeDeletion(preview) || undefined, confirmLabel: t({ ko: '삭제', en: 'Delete' }), tone: 'destructive' })
      if (!ok) return
      await deleteCharacterSetting(setting.id, setting.revision)
      editor.closeIfDeleted([setting.id])
      void refreshCharacterViews(queryClient, { folderIds: [setting.folderId], settingIds: [setting.id] })
    } catch (error) {
      if (!isCharacterRevisionConflict(error)) { onError(error, t({ ko: '외형 설정을 지우지 못했어.', en: 'Could not delete the setting.' })); return }
      void refreshCharacterViews(queryClient, { folderIds: [setting.folderId], settingIds: [setting.id] })
      showSnackbar({ message: t({ ko: '다른 곳에서 이 외형 설정이 바뀌었어. 목록을 새로 불러왔으니 확인하고 다시 지워줘.', en: 'This setting changed elsewhere. The list is refreshed; check it and delete again.' }), tone: 'error' })
    }
  }

  const bulkMutation = useMutation({
    mutationFn: (input: CharacterSettingBulkInput) => {
      if (editor.isBusy()) throw new Error(t({ ko: '이미지 작업이나 저장이 끝난 뒤 다시 해줘.', en: 'Wait for the image operation or save to finish.' }))
      return bulkCharacterSettings(input)
    },
    onSuccess: (_, input) => {
      if (input.action === 'delete') editor.closeIfDeleted(input.ids)
      const settings = input.ids.map((id) => selected.get(id) ?? loaded?.find((item) => item.id === id)).filter((item): item is CharacterSettingSummary => Boolean(item))
      void refreshCharacterViews(queryClient, { folderIds: [...settings.map((setting) => setting.folderId), ...(input.action === 'move' ? [input.folderId] : [])], settingIds: input.ids, foldersChanged: input.action !== 'favorite' })
      if (input.action !== 'favorite' || input.ids.length > 1) { setSelected(new Map()); setSelectMode(false) }
      setBulkMoving(false)
    },
    onError: (error) => onError(error, t({ ko: '선택한 외형 설정을 바꾸지 못했어.', en: 'Could not change the selected settings.' })),
  })
  const toggleFavorite = (setting: CharacterSettingSummary) => bulkMutation.mutate({ action: 'favorite', ids: [setting.id], favorite: !setting.favorite })
  const deleteSelected = async () => {
    const settings = [...selected.values()]
    const linked = settings.reduce((sum, setting) => sum + setting.linkedProfileCount, 0)
    const ok = await confirm({
      title: t({ ko: '외형 설정 {count}개 삭제', en: 'Delete {count} settings' }, { count: settings.length }),
      description: [
        t({ ko: '선택한 외형 설정을 모두 지울까? 이미지와 그룹은 남아.', en: 'Delete every selected setting? Images and groups stay.' }),
        linked ? t({ ko: '연결된 프로필 {count}개는 지금 값의 사본을 유지해.', en: '{count} linked profiles keep a copy of the values.' }, { count: linked }) : '',
      ].filter(Boolean).join('\n'),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (ok) bulkMutation.mutate({ action: 'delete', ids: settings.map((setting) => setting.id) })
  }
  const copyTags = async (setting: CharacterSettingSummary) => {
    try {
      await copyTextToClipboard((await getCharacterSetting(setting.id)).appearance)
      showSnackbar({ message: t({ ko: '‘{name}’ 외형 태그를 복사했어.', en: 'Copied the tags of ‘{name}’.' }, { name: setting.name }), tone: 'info' })
    } catch (error) { onError(error, t({ ko: '복사하지 못했어.', en: 'Could not copy.' })) }
  }
  const exportSettings = async (input: { ids: number[] } | { folderId: number | null }, name: string) => {
    try {
      const count = await downloadCharacterLibraryExport(input, name)
      showSnackbar({ message: t({ ko: '외형 설정 {count}개를 내보냈어.', en: 'Exported {count} settings.' }, { count }), tone: 'info' })
    } catch (error) { onError(error, t({ ko: '내보내지 못했어.', en: 'Could not export.' })) }
  }
  const importFile = async (file: File) => {
    try {
      const result = await importCharacterLibrary(query || filtering ? null : folderId, file)
      void refreshCharacterViews(queryClient, { folderIds: [folderId], settingIds: [], foldersChanged: true })
      void queryClient.invalidateQueries({ queryKey: [CHARACTER_LIBRARY_QUERY_KEY, 'settings'] })
      showSnackbar({
        message: [
          t({ ko: '외형 설정 {settings}개, 폴더 {folders}개를 가져왔어.', en: 'Imported {settings} settings and {folders} folders.' }, { settings: result.createdSettings, folders: result.createdFolders }),
          result.renamed ? t({ ko: '이름이 겹친 {count}개는 번호를 붙였어.', en: '{count} taken names got a number.' }, { count: result.renamed }) : '',
          result.importedImages ? t({ ko: '이미지 {count}장을 라이브러리에 넣었어.', en: 'Added {count} images to the library.' }, { count: result.importedImages }) : '',
          result.droppedImages ? t({ ko: '쓸 수 없는 이미지 {count}장은 빼고 가져왔어.', en: '{count} unusable images were left out.' }, { count: result.droppedImages }) : '',
        ].filter(Boolean).join(' '),
        tone: 'info',
      })
    } catch (error) { onError(error, t({ ko: '가져오지 못했어. CoNAI에서 내보낸 외형 묶음 ZIP인지 확인해줘.', en: 'Could not import. Check that it is a bundle ZIP exported from CoNAI.' })) }
  }
  const toggleSelected = (setting: CharacterSettingSummary) => setSelected((current) => {
    const next = new Map(current)
    if (next.has(setting.id)) next.delete(setting.id)
    else next.set(setting.id, setting)
    return next
  })

  const folderMenu = (folder: CharacterFolder): ActionMenuEntry[] => canEdit ? [
    { key: 'subfolder', label: t({ ko: '하위 폴더 추가', en: 'Add subfolder' }), icon: FolderPlus, onSelect: () => setNameDialog({ mode: 'create', parentId: folder.id, name: '' }) },
    { key: 'setting', label: t({ ko: '외형 설정 추가', en: 'Add appearance setting' }), icon: Plus, onSelect: () => setCreating({ folderId: folder.id }) },
    { key: 'rename', label: t({ ko: '이름 바꾸기', en: 'Rename' }), icon: Pencil, onSelect: () => setNameDialog({ mode: 'rename', folder, name: folder.name }) },
    { key: 'move', label: t({ ko: '다른 위치로 옮기기', en: 'Move to…' }), icon: FolderInput, onSelect: () => setMoving({ kind: 'folder', folder }) },
    { key: 'export', label: t({ ko: '폴더 내보내기', en: 'Export folder' }), icon: Download, onSelect: () => void exportSettings({ folderId: folder.id }, folder.name) },
    '-',
    { key: 'delete', label: t({ ko: '폴더 삭제', en: 'Delete folder' }), icon: Trash2, destructive: true, onSelect: () => void deleteFolder(folder) },
  ] : []
  const settingMenu = (setting: CharacterSettingSummary): ActionMenuEntry[] => [
    { key: 'open', label: t({ ko: '열기', en: 'Open' }), icon: SquarePen, onSelect: () => openSetting(setting.id) },
    canEdit ? { key: 'favorite', label: setting.favorite ? t({ ko: '즐겨찾기 해제', en: 'Unfavorite' }) : t({ ko: '즐겨찾기', en: 'Favorite' }), icon: setting.favorite ? StarOff : Star, disabled: bulkMutation.isPending, onSelect: () => toggleFavorite(setting) } : null,
    canEdit ? { key: 'move', label: t({ ko: '다른 폴더로 옮기기', en: 'Move to…' }), icon: FolderInput, onSelect: () => setMoving({ kind: 'setting', setting }) } : null,
    { key: 'copy', label: t({ ko: '태그 복사', en: 'Copy tags' }), icon: Copy, onSelect: () => void copyTags(setting) },
    canEdit ? { key: 'select', label: selected.has(setting.id) ? t({ ko: '선택 해제', en: 'Deselect' }) : t({ ko: '선택', en: 'Select' }), icon: CheckSquare, onSelect: () => { setSelectMode(true); toggleSelected(setting) } } : null,
    canEdit ? '-' : null,
    canEdit ? { key: 'delete', label: t({ ko: '삭제', en: 'Delete' }), icon: Trash2, destructive: true, onSelect: () => void deleteSetting(setting) } : null,
  ]

  useCharacterLibraryChatPage({
    folders, folderId, path, subfolders, query, settings: loaded ? { items: loaded, total: settingsTotal ?? loaded.length, hasMore: Boolean(loadMore) } : undefined, loadMore, editor, canEdit, editorTab, setEditorTab,
    openFolder, search, openSetting, newSetting,
    createFolder: (parentId, name) => nameMutation.mutateAsync({ mode: 'create', parentId, name }),
    renameFolder: (folder, name) => nameMutation.mutateAsync({ mode: 'rename', folder, name }),
    moveFolder: (folder, parentId) => moveMutation.mutateAsync({ state: { kind: 'folder', folder }, to: parentId }),
    sort, favoriteOnly, filters, facets: facetsQuery.data, setListView,
    bulk: (input) => bulkMutation.mutateAsync(input),
  })

  const rootLabel = t({ ko: '외형 라이브러리', en: 'Appearance library' })
  const listed = loaded ?? []
  const listFooter: ReactNode = settingsQuery.isFetchNextPageError ? (
    <ErrorState size="compact" title={t({ ko: '다음 외형 설정을 불러오지 못했어', en: 'Could not load more settings' })} error={settingsQuery.error} onRetry={() => void settingsQuery.fetchNextPage()} isRetrying={settingsQuery.isFetchingNextPage} />
  ) : <>
    <LoadMoreSentinel rootMargin="800px" enabled={settingsQuery.hasNextPage && !settingsQuery.isFetchingNextPage} onVisible={() => void settingsQuery.fetchNextPage({ cancelRefetch: false })} />
    {settingsQuery.isFetchingNextPage ? <LoadingState variant="inline" /> : null}
  </>
  const toolbar = (
    <PageToolbar
      start={<>
        <CharacterViewSwitch />
        {query ? <Heading level={3} as="h1" className="truncate">{t({ ko: '‘{query}’ 검색 결과', en: 'Results for ‘{query}’' }, { query })}</Heading> : filtering ? <Heading level={3} as="h1" className="truncate">{t({ ko: '라이브러리 전체 · 필터 결과', en: 'Whole library · filtered' })}</Heading> : path.length ? (
          <PathBreadcrumbs
            ariaLabel={t({ ko: '폴더 경로', en: 'Folder path' })}
            items={[{ key: 'root', label: t({ ko: '최상위', en: 'Top level' }), onClick: () => openFolder(null) }, ...path.map((folder) => ({ key: String(folder.id), label: folder.name, onClick: () => openFolder(folder.id) }))]}
          />
        ) : null}
      </>}
      actions={(
        <>
          <Select variant="default" controlSize="compact" className="w-auto" aria-label={t({ ko: '정렬', en: 'Sort' })} value={sort} onChange={(event) => setListView({ sort: event.target.value as CharacterSettingSort })}>
            <option value="name">{t({ ko: '이름순', en: 'Name' })}</option>
            <option value="updated">{t({ ko: '최근 수정순', en: 'Recently edited' })}</option>
            <option value="created">{t({ ko: '최근 추가순', en: 'Newest' })}</option>
            <option value="created_asc">{t({ ko: '오래된 순', en: 'Oldest' })}</option>
          </Select>
          <IconButton variant="ghost" size="icon-sm" active={favoriteOnly} label={t({ ko: '즐겨찾기', en: 'Favorites' })} onClick={() => setListView({ favorite: !favoriteOnly })}><Star className={favoriteOnly ? 'fill-current' : undefined} /></IconButton>
          {canEdit ? <IconButton variant="ghost" size="icon-sm" active={selectMode} label={selectMode ? t({ ko: '선택 끝내기', en: 'Stop selecting' }) : t({ ko: '여러 개 선택', en: 'Select several' })} onClick={() => { if (selectMode) setSelected(new Map()); setSelectMode(!selectMode) }}><CheckSquare /></IconButton> : null}
          <ActionMenuButton
            label={t({ ko: '라이브러리 작업', en: 'Library actions' })}
            entries={[
              canEdit ? { key: 'new-folder', label: t({ ko: '새 폴더', en: 'New folder' }), icon: FolderPlus, onSelect: () => setNameDialog({ mode: 'create', parentId: query || filtering ? null : folderId, name: '' }) } : null,
              { key: 'export', label: query || filtering || folderId === null ? t({ ko: '라이브러리 전체 내보내기', en: 'Export the whole library' }) : t({ ko: '이 폴더 내보내기', en: 'Export this folder' }), icon: Download, onSelect: () => void exportSettings({ folderId: query || filtering ? null : folderId }, currentFolder && !query && !filtering ? currentFolder.name : rootLabel) },
              canEdit ? { key: 'import', label: t({ ko: '외형 묶음 ZIP 가져오기', en: 'Import a settings bundle' }), icon: Upload, onSelect: () => importInput.current?.click() } : null,
            ]}
          />
          {currentFolder && !query && !filtering && canEdit ? <ActionMenuButton entries={folderMenu(currentFolder)} label={t({ ko: '폴더 작업', en: 'Folder actions' })} /> : null}
          {canEdit ? <Button size="sm" onClick={() => setCreating({ folderId: query || filtering ? null : folderId })}><Plus />{t({ ko: '새 외형 설정', en: 'New appearance setting' })}</Button> : null}
          <input ref={importInput} type="file" accept=".zip,application/zip" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file) }} />
        </>
      )}
    >
      <ToolbarSearchField value={searchText} onChange={setSearchText} placeholder={t({ ko: '이름·태그·한국어 태그 검색', en: 'Search names and tags' })} />
    </PageToolbar>
  )

  return (
    <PageWithSidebar
      storageKey="characters"
      sidebarLabel={t('characterLibraryPage.folders')}
      sidebar={(
        <div className="space-y-3">
          <CharacterFolderSidebar folders={folders} selectedId={query || filtering ? null : folderId} loading={foldersQuery.isPending} error={foldersQuery.isError ? foldersQuery.error : null} onSelect={(id) => openFolder(id)} onCreate={canEdit ? () => setNameDialog({ mode: 'create', parentId: folderId, name: '' }) : undefined} getMenu={canEdit ? folderMenu : undefined} />
          <CharacterFacetPanel facets={facetsQuery.data} filters={filters} loading={facetsQuery.isPending} onChange={(next) => setListView({ filters: next })} />
        </div>
      )}
      toolbar={toolbar}
    >
      <LibraryFolderContent folderMissing={folderMissing} subfolders={filtering ? [] : subfolders} query={query} rootLabel={rootLabel} onOpen={openFolder} getMenu={folderMenu}>
          <RowGroup heading={t('characterLibraryPage.settings')} count={settingsTotal}>
            <CharacterSettingGrid
              errorTitle={t({ ko: '외형 설정을 불러오지 못했어', en: 'Could not load settings' })}
              items={loaded}
              pending={settingsQuery.isPending}
              error={settingsQuery.isError ? settingsQuery.error : null}
              onRetry={() => void settingsQuery.refetch()}
              retrying={settingsQuery.isFetching}
              footer={listFooter}
              columns={columns.columnCount}
              renderSetting={(setting) => (
                <CharacterSettingCard
                  key={setting.id}
                  setting={setting}
                  selected={selectMode ? selected.has(setting.id) : undefined}
                  open={openSettingId === setting.id}
                  disabled={editor.busy}
                  onOpen={() => (selectMode ? toggleSelected(setting) : openSetting(setting.id))}
                  onToggleFavorite={canEdit && !selectMode ? () => toggleFavorite(setting) : undefined}
                  onToggleSelect={canEdit ? () => { setSelectMode(true); toggleSelected(setting) } : undefined}
                  onCopyTags={() => void copyTags(setting)}
                  onEdit={canEdit ? () => openSetting(setting.id) : undefined}
                  menu={settingMenu(setting)}
                />
              )}
              empty={(
                <EmptyState
                  icon={UserRound}
                  title={query || filtering ? t({ ko: '맞는 외형 설정이 없어', en: 'No matching settings' }) : t({ ko: '여기엔 외형 설정이 없어', en: 'No appearance settings here' })}
                />
              )}
            />
          </RowGroup>
      </LibraryFolderContent>
      {editor.open ? <CharacterSettingDialog editor={editor} folders={folders} items={listed} total={settingsTotal ?? listed.length} onLoadMore={loadMore} canEdit={canEdit} admin={permissions.isAdmin} tab={editorTab} onTabChange={setEditorTab} onOpen={openSetting} onClose={closeEditor} onToggleFavorite={toggleFavorite} /> : null}

      <ImageListColumnFloatingControl
        value={columns.columnCount}
        defaultValue={columns.defaultColumnCount}
        min={columns.minColumnCount}
        max={columns.maxColumnCount}
        onChange={columns.setColumnCount}
        onReset={columns.resetColumnCount}
        aboveSelectionBar={selected.size > 0}
      />
      {canEdit ? (
        <SelectionActionBar
          selectedCount={selected.size}
          onClear={() => { setSelected(new Map()); setSelectMode(false) }}
          responsiveActions
          actions={<>
            <SelectionBarAction icon={CheckCheck} label={t({ ko: '불러온 항목 전부 선택', en: 'Select all loaded' })} variant="ghost" disabled={!listed.length} onClick={() => setSelected((current) => new Map([...current, ...listed.map((item) => [item.id, item] as const)]))} />
            <SelectionBarAction icon={Star} label={t({ ko: '즐겨찾기', en: 'Favorite' })} disabled={bulkMutation.isPending} onClick={() => bulkMutation.mutate({ action: 'favorite', ids: [...selected.keys()], favorite: true })} />
            <SelectionBarAction icon={StarOff} label={t({ ko: '즐겨찾기 해제', en: 'Unfavorite' })} disabled={bulkMutation.isPending} onClick={() => bulkMutation.mutate({ action: 'favorite', ids: [...selected.keys()], favorite: false })} />
            <SelectionBarAction icon={Download} label={t({ ko: '내보내기', en: 'Export' })} onClick={() => void exportSettings({ ids: [...selected.keys()] }, t({ ko: '선택한 외형', en: 'selected settings' }))} />
            <SelectionBarAction icon={Trash2} label={t({ ko: '삭제', en: 'Delete' })} disabled={bulkMutation.isPending} onClick={() => void deleteSelected()} />
            <SelectionBarAction icon={FolderInput} label={t({ ko: '다른 폴더로 옮기기', en: 'Move to…' })} variant="default" disabled={bulkMutation.isPending} onClick={() => setBulkMoving(true)} />
          </>}
        />
      ) : null}
      {bulkMoving ? (
        <CharacterFolderPickerModal
          title={t({ ko: '외형 설정 {count}개 옮기기', en: 'Move {count} settings' }, { count: selected.size })}
          folders={folders}
          value={null}
          busy={bulkMutation.isPending}
          onPick={(to) => bulkMutation.mutate({ action: 'move', ids: [...selected.keys()], folderId: to })}
          onClose={() => setBulkMoving(false)}
        />
      ) : null}

      {creating ? (
        <CharacterSettingSaveDialog
          title={t({ ko: '새 외형 설정', en: 'New appearance setting' })}
          initialName=""
          initialFolderId={creating.folderId}
          submitLabel={t({ ko: '만들고 편집하기', en: 'Create and edit' })}
          busy={createMutation.isPending}
          onSubmit={(input) => createMutation.mutate(input)}
          onClose={() => setCreating(null)}
        />
      ) : null}
      {nameDialog ? (
        <NameDialog
          open
          title={nameDialog.mode === 'create' ? t({ ko: '새 폴더', en: 'New folder' }) : t({ ko: '폴더 이름 바꾸기', en: 'Rename folder' })}
          value={nameDialog.name}
          onChange={(name) => setNameDialog({ ...nameDialog, name })}
          onSubmit={() => nameMutation.mutate(nameDialog)}
          onClose={() => setNameDialog(null)}
          busy={nameMutation.isPending}
        />
      ) : null}
      {moving ? (
        <CharacterFolderPickerModal
          title={moving.kind === 'folder' ? t({ ko: '‘{name}’ 옮기기', en: 'Move ‘{name}’' }, { name: moving.folder.name }) : t({ ko: '‘{name}’ 옮기기', en: 'Move ‘{name}’' }, { name: moving.setting.name })}
          folders={folders}
          value={moving.kind === 'folder' ? moving.folder.parentId : moving.setting.folderId}
          excludeIds={moving.kind === 'folder' ? folderSubtreeIds(folders, moving.folder.id) : undefined}
          busy={moveMutation.isPending}
          onPick={(to) => moveMutation.mutate({ state: moving, to })}
          onClose={() => setMoving(null)}
        />
      ) : null}
    </PageWithSidebar>
  )
}
