import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { SegmentedControl } from '@/components/common/segmented-control'
import { ChatProfileEditorPage } from '@/features/settings/components/chat-profile-editor'
import { ChatSettingsProfiles } from '@/features/settings/components/chat-settings-profiles'
import { registerTranslationCatalog } from '@/i18n'
import { settingsCatalog } from '@/i18n/resources/settings'
import { Folder, FolderInput, FolderPlus, Pencil, Plus, SquarePen, Trash2, UserRound } from 'lucide-react'
import { NameDialog } from '@/components/common/entry-dialogs'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { PathBreadcrumbs } from '@/components/common/path-breadcrumbs'
import { ToolbarSearchField } from '@/components/common/search-field'
import { ActionContextMenu, ActionMenuButton, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Heading } from '@/components/ui/heading'
import { IconButton } from '@/components/ui/icon-button'
import { RowGroup } from '@/components/ui/row-group'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useFeaturePermissions } from '@/features/auth/use-feature-permissions'
import { useI18n } from '@/i18n'
import {
  CHARACTER_SETTINGS_PAGE_SIZE,
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
import { folderPath, folderSubtreeIds, refreshCharacterViews, sortFoldersByName, useCharacterFolders, useCharacterSettingsPage } from './character-library-shared'
import { CharacterFolderPickerModal, CharacterFolderSidebar } from './components/character-folder-nav'
import { CharacterSettingCard } from './components/character-setting-card'
import { CharacterSettingGrid } from './components/character-setting-grid'
import { CharacterSettingEditorPage } from './components/character-setting-editor-page'
import { CharacterSettingSaveDialog } from './components/character-setting-save-dialog'
import { useCharacterLibraryChatPage } from './use-character-library-chat-page'
import { useCharacterSettingEditor, type SettingEditorTarget } from './use-character-setting-editor'

type NameDialogState = { mode: 'create'; parentId: number | null; name: string } | { mode: 'rename'; folder: CharacterFolder; name: string }
type MoveState = { kind: 'folder'; folder: CharacterFolder } | { kind: 'setting'; setting: CharacterSettingSummary }

const positiveId = (value: string | null) => (value && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : null)

/**
 * 캐릭터: the appearance library and (administrators) the chat profiles. The library's URL holds the open folder
 * (`folder`), the name search across the library (`q`), the page (`page`), the setting open in its editor page
 * (`setting`) and a new setting's draft (`new`: its folder id or `root`); the profiles' the profile open in its editor
 * page (`profile`: an id or `new`). An open editor replaces the list and its tabs.
 */
registerTranslationCatalog(settingsCatalog)

export function CharacterLibraryPage() {
  const { t } = useI18n()
  const permissions = useFeaturePermissions()
  const [params] = useSearchParams()
  if (!permissions.isAdmin || params.get('view') !== 'profiles' || params.has('setting') || params.has('new')) return <AppearanceLibraryPage />
  if (params.has('profile')) return <ChatProfileEditorPage />
  return (
    <div className="space-y-6">
      <PageToolbar start={<CharacterViewSwitch />} actions={<Button asChild variant="ghost"><Link to="/chat">{t({ ko: '채팅 열기', en: 'Open chat' })}</Link></Button>} />
      <ChatSettingsProfiles />
    </div>
  )
}

/** Administrators switch the page between the appearance library and the chat profiles; the switch leads the toolbar. */
function CharacterViewSwitch() {
  const { t } = useI18n()
  const permissions = useFeaturePermissions()
  const [params, setParams] = useSearchParams()
  if (!permissions.isAdmin) return null
  return (
    <SegmentedControl
      value={params.get('view') === 'profiles' ? 'profiles' : 'appearance'}
      onChange={(value) => setParams(value === 'profiles' ? { view: 'profiles' } : {})}
      size="sm"
      semantics="tabs"
      ariaLabel={t({ ko: '캐릭터 보기', en: 'Character views' })}
      items={[
        { value: 'appearance', label: t({ ko: '외형 라이브러리', en: 'Appearance library' }) },
        { value: 'profiles', label: t({ ko: '채팅 프로필', en: 'Chat profiles' }) },
      ]}
    />
  )
}

function AppearanceLibraryPage() {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = useFeaturePermissions()
  const canEdit = permissions.has('characters.edit')
  const [searchParams, setSearchParams] = useSearchParams()
  const folderId = positiveId(searchParams.get('folder'))
  const query = searchParams.get('q')?.trim() ?? ''
  const page = positiveId(searchParams.get('page')) ?? 0
  const openSettingId = positiveId(searchParams.get('setting'))
  // `new`: a new setting drafted in a folder (`root` for the top level); an open saved setting wins.
  const newParam = searchParams.get('new')
  const newIn = openSettingId === null && newParam !== null && (newParam === 'root' || positiveId(newParam) !== null) ? { folderId: positiveId(newParam) } : null
  const editing = openSettingId !== null || newIn !== null
  const [nameDialog, setNameDialog] = useState<NameDialogState | null>(null)
  const [moving, setMoving] = useState<MoveState | null>(null)
  /** A new setting's name and folder, asked before it is made and opened in its editor page. */
  const [creating, setCreating] = useState<{ folderId: number | null } | null>(null)
  const [searchText, setSearchText] = useState(query)
  const [syncedQuery, setSyncedQuery] = useState(query)
  if (syncedQuery !== query) { setSyncedQuery(query); setSearchText(query) }

  const update = (changes: Record<string, string | null>, replace = false) => setSearchParams((current) => {
    const next = new URLSearchParams(current)
    for (const [key, value] of Object.entries(changes)) { if (value === null) next.delete(key); else next.set(key, value) }
    return next
  }, { replace })
  const pageParam = (offset: number) => (offset > 0 ? String(Math.floor(offset / CHARACTER_SETTINGS_PAGE_SIZE)) : null)
  const openFolder = (id: number | null, offset = 0) => update({ folder: id === null ? null : String(id), q: null, page: pageParam(offset), setting: null, new: null })
  const search = (text: string, offset = 0) => update({ q: text.trim() || null, page: pageParam(offset), setting: null, new: null })
  const openSetting = (id: number) => update({ setting: String(id), new: null })
  const newSetting = (inFolder: number | null) => update({ setting: null, new: inFolder === null ? 'root' : String(inFolder) })
  const closeEditor = () => update({ setting: null, new: null })

  // Live name search: the URL follows the field after a short pause.
  useEffect(() => {
    if (editing || searchText.trim() === query) return
    const timer = window.setTimeout(() => update({ q: searchText.trim() || null, page: null, setting: null, new: null }, true), 300)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- typed text schedules the change; opening an editor cancels it
  }, [searchText, editing])

  const foldersQuery = useCharacterFolders()
  const folders = foldersQuery.data ?? []
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const currentFolder = folderId !== null ? byId.get(folderId) ?? null : null
  const path = folderPath(byId, folderId)
  const subfolders = folders.filter((folder) => folder.parentId === folderId).sort(sortFoldersByName)
  const scope = { folder: query ? 'all' as const : folderId ?? 'root' as const, query, offset: page * CHARACTER_SETTINGS_PAGE_SIZE, limit: CHARACTER_SETTINGS_PAGE_SIZE }
  const folderMissing = folderId !== null && foldersQuery.isSuccess && !currentFolder
  const settingsQuery = useCharacterSettingsPage(scope, !folderMissing)
  const settingsPage = settingsQuery.data

  const target: SettingEditorTarget = openSettingId !== null ? { settingId: openSettingId } : newIn ? { newIn: newIn.folderId } : null
  const editor = useCharacterSettingEditor({
    target,
    onCreated: (setting) => update({ setting: String(setting.id), new: null }, true),
    onClose: closeEditor,
  })

  const onError = (error: unknown, fallback: string) => showSnackbar({ message: getErrorMessage(error, fallback), tone: 'error' })
  const createMutation = useMutation({
    mutationFn: (input: { folderId: number | null; name: string }) => createCharacterSetting({ ...input, appearance: '' }),
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
      void refreshCharacterViews(queryClient, { folderIds: [folder.id, folder.parentId], settingIds: [], foldersChanged: true })
      if (folderId !== null && removed.has(folderId)) openFolder(folder.parentId)
    } catch (error) { onError(error, t({ ko: '폴더를 지우지 못했어.', en: 'Could not delete the folder.' })) }
  }
  const deleteSetting = async (setting: CharacterSettingSummary) => {
    try {
      const preview = await getCharacterSettingDeletePreview(setting.id)
      const ok = await confirm({ title: t({ ko: '‘{name}’ 삭제', en: 'Delete ‘{name}’' }, { name: setting.name }), description: describeDeletion(preview) || undefined, confirmLabel: t({ ko: '삭제', en: 'Delete' }), tone: 'destructive' })
      if (!ok) return
      await deleteCharacterSetting(setting.id, setting.revision)
      void refreshCharacterViews(queryClient, { folderIds: [setting.folderId], settingIds: [setting.id] })
    } catch (error) {
      if (!isCharacterRevisionConflict(error)) { onError(error, t({ ko: '외형 설정을 지우지 못했어.', en: 'Could not delete the setting.' })); return }
      void refreshCharacterViews(queryClient, { folderIds: [setting.folderId], settingIds: [setting.id] })
      showSnackbar({ message: t({ ko: '다른 곳에서 이 외형 설정이 바뀌었어. 목록을 새로 불러왔으니 확인하고 다시 지워줘.', en: 'This setting changed elsewhere. The list is refreshed; check it and delete again.' }), tone: 'error' })
    }
  }

  const folderMenu = (folder: CharacterFolder): ActionMenuEntry[] => canEdit ? [
    { key: 'subfolder', label: t({ ko: '하위 폴더 추가', en: 'Add subfolder' }), icon: FolderPlus, onSelect: () => setNameDialog({ mode: 'create', parentId: folder.id, name: '' }) },
    { key: 'setting', label: t({ ko: '외형 설정 추가', en: 'Add appearance setting' }), icon: Plus, onSelect: () => setCreating({ folderId: folder.id }) },
    { key: 'rename', label: t({ ko: '이름 바꾸기', en: 'Rename' }), icon: Pencil, onSelect: () => setNameDialog({ mode: 'rename', folder, name: folder.name }) },
    { key: 'move', label: t({ ko: '다른 위치로 옮기기', en: 'Move to…' }), icon: FolderInput, onSelect: () => setMoving({ kind: 'folder', folder }) },
    '-',
    { key: 'delete', label: t({ ko: '폴더 삭제', en: 'Delete folder' }), icon: Trash2, destructive: true, onSelect: () => void deleteFolder(folder) },
  ] : []
  const settingMenu = (setting: CharacterSettingSummary): ActionMenuEntry[] => [
    { key: 'open', label: canEdit ? t({ ko: '편집', en: 'Edit' }) : t({ ko: '열기', en: 'Open' }), icon: SquarePen, onSelect: () => openSetting(setting.id) },
    canEdit ? { key: 'move', label: t({ ko: '다른 폴더로 옮기기', en: 'Move to…' }), icon: FolderInput, onSelect: () => setMoving({ kind: 'setting', setting }) } : null,
    canEdit ? '-' : null,
    canEdit ? { key: 'delete', label: t({ ko: '삭제', en: 'Delete' }), icon: Trash2, destructive: true, onSelect: () => void deleteSetting(setting) } : null,
  ]

  useCharacterLibraryChatPage({
    folders, folderId, path, subfolders, query, settingsPage, offset: scope.offset, editor, canEdit,
    openFolder, search, openSetting, newSetting,
  })

  const rootLabel = t('characterLibraryPage.title')
  if (editor.open) {
    return <CharacterSettingEditorPage editor={editor} folders={folders} canEdit={canEdit} admin={permissions.isAdmin} rootLabel={rootLabel} onOpenFolder={(id) => openFolder(id)} />
  }
  const toolbar = (
    <PageToolbar
      start={<>
        <CharacterViewSwitch />
        {query ? <Heading level={3} as="h1" className="truncate">{t({ ko: '‘{query}’ 검색 결과', en: 'Results for ‘{query}’' }, { query })}</Heading> : (
          <PathBreadcrumbs
            ariaLabel={t({ ko: '폴더 경로', en: 'Folder path' })}
            items={[{ key: 'root', label: rootLabel, onClick: () => openFolder(null) }, ...path.map((folder) => ({ key: String(folder.id), label: folder.name, onClick: () => openFolder(folder.id) }))]}
          />
        )}
      </>}
      actions={(
        <>
          {canEdit ? <IconButton variant="ghost" size="icon-sm" label={t({ ko: '새 폴더', en: 'New folder' })} onClick={() => setNameDialog({ mode: 'create', parentId: query ? null : folderId, name: '' })}><FolderPlus /></IconButton> : null}
          {currentFolder && !query && canEdit ? <ActionMenuButton entries={folderMenu(currentFolder)} label={t({ ko: '폴더 작업', en: 'Folder actions' })} /> : null}
          {canEdit ? <Button size="sm" onClick={() => setCreating({ folderId: query ? null : folderId })}><Plus />{t({ ko: '새 외형 설정', en: 'New appearance setting' })}</Button> : null}
        </>
      )}
    >
      <ToolbarSearchField value={searchText} onChange={setSearchText} placeholder={t({ ko: '외형 설정 이름 검색', en: 'Search settings by name' })} />
    </PageToolbar>
  )

  return (
    <PageWithSidebar
      storageKey="characters"
      sidebarLabel={t('characterLibraryPage.folders')}
      sidebar={<CharacterFolderSidebar folders={folders} selectedId={query ? null : folderId} loading={foldersQuery.isPending} error={foldersQuery.isError ? foldersQuery.error : null} onSelect={(id) => openFolder(id)} onCreate={canEdit ? () => setNameDialog({ mode: 'create', parentId: folderId, name: '' }) : undefined} getMenu={canEdit ? folderMenu : undefined} />}
      toolbar={toolbar}
    >
      <section className="min-w-0 space-y-6">
        {folderMissing ? (
          <EmptyState icon={Folder} title={t({ ko: '폴더를 찾지 못했어', en: 'Folder not found' })} action={<Button variant="secondary" size="sm" onClick={() => openFolder(null)}>{rootLabel}</Button>} />
        ) : <>
          {!query && subfolders.length ? (
            <RowGroup heading={t('characterLibraryPage.folders')} count={subfolders.length}>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-4">
                {subfolders.map((folder) => (
                  <ActionContextMenu key={folder.id} entries={folderMenu(folder)}>
                    <Button type="button" variant="nav" size="sm" onClick={() => openFolder(folder.id)}>
                      <Folder />
                      <span className="min-w-0 flex-1 truncate">{folder.name}</span>
                      {folder.settingCount ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{folder.settingCount}</span> : null}
                    </Button>
                  </ActionContextMenu>
                ))}
              </div>
            </RowGroup>
          ) : null}
          <RowGroup heading={t('characterLibraryPage.settings')} count={settingsPage?.total}>
            <CharacterSettingGrid
              query={settingsQuery}
              page={page}
              onPageChange={(next) => update({ page: next > 0 ? String(next) : null })}
              renderSetting={(setting) => <CharacterSettingCard key={setting.id} setting={setting} onOpen={() => openSetting(setting.id)} menu={settingMenu(setting)} />}
              empty={(
                <EmptyState
                  icon={UserRound}
                  title={query ? t({ ko: '맞는 외형 설정이 없어', en: 'No matching settings' }) : t({ ko: '여기엔 외형 설정이 없어', en: 'No appearance settings here' })}
                  action={!query && canEdit ? <Button size="sm" onClick={() => setCreating({ folderId })}><Plus />{t({ ko: '새 외형 설정', en: 'New appearance setting' })}</Button> : undefined}
                />
              )}
            />
          </RowGroup>
        </>}
      </section>

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
