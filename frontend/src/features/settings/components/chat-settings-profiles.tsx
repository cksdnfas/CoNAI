import { useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLibraryLocation } from '@/components/common/use-library-location'
import { LibraryFolderContent, libraryFolderView } from '@/components/common/library-folder-content'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, FileUp, FolderInput, FolderPlus, Pencil, Plus, Power, SquarePen, Trash2, UserRound } from 'lucide-react'
import { NameDialog } from '@/components/common/entry-dialogs'
import { CharacterCard } from '@/components/common/character-card'
import { PageToolbar } from '@/components/common/page-toolbar'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { PathBreadcrumbs } from '@/components/common/path-breadcrumbs'
import { ToolbarSearchField } from '@/components/common/search-field'
import { ActionMenuButton, type ActionMenuEntry } from '@/components/ui/action-menu'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Heading } from '@/components/ui/heading'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { RowGroup } from '@/components/ui/row-group'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { CharacterFolderPickerModal, CharacterFolderSidebar } from '@/features/characters/components/character-folder-nav'
import { CharacterSettingGrid } from '@/features/characters/components/character-setting-grid'
import { characterThumbnailUrl, folderSubtreeIds } from '@/features/characters/character-library-shared'
import { CHARACTER_SETTINGS_PAGE_SIZE } from '@/lib/api-character-library'
import { ChatHealthDot, ChatHealthTip, useChatHealth } from '@/features/codex-chat/chat-health'
import { getChatScopeCopy } from '@/features/codex-chat/chat-scope-copy'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_LOREBOOKS_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  CHAT_PROFILE_FOLDERS_QUERY_KEY,
  CHAT_PROFILE_LIBRARY_QUERY_KEY,
  MODEL_SLOTS_QUERY_KEY,
  importChatProfileCard,
  listChatProfileFolders,
  listChatProfilePage,
  createChatProfileFolder,
  updateChatProfileFolder,
  deleteChatProfileFolder,
  chatProfileAssetUrl,
  getChatAdminProfile,
  listChatProfileNames,
  listModelSlots,
  reorderChatProfiles,
  updateChatProfile,
  type ChatCardImportReport,
  type ChatProfile,
  type ChatProfileInput,
  type ChatProfileFolder,
  type ModelSlot,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { type ChatProfileEditorPageState } from './chat-profile-editor'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageChoice, pageNumber, pageObject, pageText } from '@/features/codex-chat/page-action-helpers'
import { ChatCardImportReportModal } from './chat-card-import-report'

/** An API LLM profile's model row: its own, else the chat representative model it falls back to. */
function profileModelRow(profile: ChatProfile, slots: ModelSlot[]) {
  if (profile.engine !== 'llm') return undefined
  return slots.find((item) => item.id === profile.modelSlotId) ?? slots.find((item) => item.isDefault)
}

/** `connection · model` (through `대표 · name` when the profile picked a representative model), else the engine and its model. */
function profileModelLine(profile: ChatProfile, slots: ModelSlot[], t: ReturnType<typeof useI18n>['t']) {
  const slot = profileModelRow(profile, slots)
  const reaches = slot?.kind === 'route' ? ` (${slot.model ? `${slot.providerLabel} · ${slot.model}` : t({ ko: '비어 있음', en: 'empty' })})` : ''
  if (slot) return `${slot.label}${reaches}${profile.llmRuntime === 'pi' ? ' · pi' : ''}`
  if (profile.engine === 'claude') return `Claude Code · ${profile.model || 'sonnet'}`
  if (profile.engine === 'codex') return `Codex · ${profile.model || t({ ko: '기본 모델', en: 'default model' })}`
  return t({ ko: '모델 없음', en: 'No model' })
}

/** Short chip text for the row: the model, else the engine. The full line is its tooltip. */
function profileModelChip(profile: ChatProfile, slots: ModelSlot[]) {
  const slot = profileModelRow(profile, slots)
  if (slot) return slot.model || slot.label
  if (profile.engine === 'claude') return 'Claude Code'
  return profile.engine === 'codex' ? 'Codex' : '—'
}

/** The one tool chip of a profile: the allowed-tool count, else just "tools". */
function profileToolChip(profile: ChatProfile, t: ReturnType<typeof useI18n>['t']) {
  if (Array.isArray(profile.toolAllowlist)) return t({ ko: '도구 {count}', en: '{count} tools' }, { count: profile.toolAllowlist.length })
  return t({ ko: '도구', en: 'Tools' })
}

/**
 * A copy of a profile to open in the editor: every setting, under a name not taken yet. A profile that wrote its own
 * reply suggestions leaves that to the copy's default; nothing is saved until the editor saves.
 */
function copyDraft(profile: ChatProfile, profiles: Array<{ name: string }>, t: ReturnType<typeof useI18n>['t']): ChatProfileInput {
  const base = t({ ko: '{name} 사본', en: '{name} copy' }, { name: profile.name })
  const taken = new Set(profiles.map((entry) => entry.name))
  let name = base
  for (let count = 2; taken.has(name); count += 1) name = `${base} ${count}`
  return { ...profile, name, suggestProfileId: profile.suggestProfileId === profile.id ? null : profile.suggestProfileId }
}

/**
 * 캐릭터 › 채팅 프로필: the chat profiles (Codex and API LLM) in their chat order. A profile opens in its editor page
 * (?profile=<id>); a new one, a copy or a card import opens a new profile's page with that draft.
 */
type FolderName = { name: string; parentId: number | null; folder?: ChatProfileFolder }
type MoveTarget = { kind: 'folder'; folder: ChatProfileFolder } | { kind: 'profile'; profile: ChatProfile }

export function ChatSettingsProfiles({ viewSwitch }: { viewSwitch?: ReactNode }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { params, folderId, query, page, searchText, setSearchText, update, openFolder, creationFolderId } = useLibraryLocation(CHARACTER_SETTINGS_PAGE_SIZE, 'profiles')
  const openEditor = (profile: ChatProfile | null, state?: ChatProfileEditorPageState) => {
    const next = new URLSearchParams(params)
    next.set('view', 'profiles')
    next.set('profile', String(profile?.id ?? 'new'))
    navigate(`/characters?${next}`, { state: profile ? state : { ...state, initialFolderId: creationFolderId, ...(state?.draft ? { draft: { ...state.draft, folderId: creationFolderId } } : {}) } })
  }
  const [nameDialog, setNameDialog] = useState<FolderName | null>(null)
  const [moving, setMoving] = useState<MoveTarget | null>(null)
  // A card import: what came over and what did not, shown before its draft opens.
  const [imported, setImported] = useState<{ draft: ChatProfileInput; report: ChatCardImportReport } | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  const foldersQuery = useQuery({ queryKey: CHAT_PROFILE_FOLDERS_QUERY_KEY, queryFn: listChatProfileFolders })
  const folders = foldersQuery.data ?? []
  const { path, currentFolder, subfolders, folderMissing } = libraryFolderView(folders, folderId, foldersQuery.isSuccess)
  const scope = { folderId, query, limit: CHARACTER_SETTINGS_PAGE_SIZE, offset: page * CHARACTER_SETTINGS_PAGE_SIZE }
  const profilesQuery = useQuery({ queryKey: [...CHAT_PROFILE_LIBRARY_QUERY_KEY, scope], queryFn: () => listChatProfilePage(scope), enabled: !folderMissing })
  const slotsQuery = useQuery({ queryKey: MODEL_SLOTS_QUERY_KEY, queryFn: listModelSlots })

  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })
  const refresh = () => Promise.all([CHAT_PROFILE_FOLDERS_QUERY_KEY, CHAT_PROFILE_LIBRARY_QUERY_KEY, CHAT_ADMIN_PROFILES_QUERY_KEY, CHAT_PROFILES_QUERY_KEY].map((queryKey) => queryClient.invalidateQueries({ queryKey })))
  const nameMutation = useMutation({
    mutationFn: (state: FolderName) => state.folder ? updateChatProfileFolder(state.folder.id, { name: state.name }) : createChatProfileFolder({ name: state.name, parentId: state.parentId }),
    onSuccess: async () => { setNameDialog(null); await refresh() },
    onError,
  })
  const moveMutation = useMutation({
    mutationFn: async ({ target, to }: { target: MoveTarget; to: number | null }) => {
      if (target.kind === 'folder') await updateChatProfileFolder(target.folder.id, { parentId: to })
      else await updateChatProfile(target.profile.id, { folderId: to }, target.profile.revision)
    },
    onSuccess: async () => { setMoving(null); await refresh() },
    onError: (error) => { void refresh(); onError(error) },
  })
  const removeFolder = async (folder: ChatProfileFolder, review = true) => {
    if (review && !await confirm({ title: t({ ko: '‘{name}’ 폴더 삭제', en: 'Delete folder ‘{name}’' }, { name: folder.name }), description: t({ ko: '프로필과 하위 폴더는 지워지지 않고 상위 폴더로 옮겨져. 이름이 겹치면 먼저 이름을 바꿔줘.', en: 'Profiles and subfolders move to the parent, never deleted. Resolve duplicate folder names first.' }), tone: 'destructive', confirmLabel: t({ ko: '삭제', en: 'Delete' }) })) return
    await deleteChatProfileFolder(folder.id)
    if (folderId === folder.id) openFolder(folder.parentId)
    await refresh()
  }
  const importMutation = useMutation({
    mutationFn: importChatProfileCard,
    onSuccess: ({ importReport, ...draft }) => {
      // A card's own lorebook is added to the shared lorebooks and linked to the draft.
      if (draft.lorebookIds?.length) void queryClient.invalidateQueries({ queryKey: CHAT_LOREBOOKS_QUERY_KEY })
      if (importReport && (importReport.converted.length || importReport.dropped.length)) setImported({ draft, report: importReport })
      else openEditor(null, { draft })
    },
    onError,
  })
  const toggleMutation = useMutation({
    mutationFn: (profile: ChatProfile) => updateChatProfile(profile.id, { isEnabled: !profile.isEnabled }, profile.revision),
    onSuccess: refresh,
    onError: (error) => { void refresh(); onError(error) },
  })

  const profiles = profilesQuery.data?.items ?? []
  const slots = slotsQuery.data ?? []
  const healthOf = useChatHealth()

  const copy = async (profile: ChatProfile) => {
    const [full, names] = await Promise.all([getChatAdminProfile(profile.id), listChatProfileNames()])
    openEditor(null, { draft: copyDraft(full, names, t), copyOf: profile.id })
  }
  const folderMenu = (folder: ChatProfileFolder): ActionMenuEntry[] => [
    { key: 'create', label: t({ ko: '하위 폴더 추가', en: 'Add subfolder' }), icon: FolderPlus, onSelect: () => setNameDialog({ name: '', parentId: folder.id }) },
    { key: 'rename', label: t({ ko: '이름 바꾸기', en: 'Rename' }), icon: Pencil, onSelect: () => setNameDialog({ name: folder.name, parentId: folder.parentId, folder }) },
    { key: 'move', label: t({ ko: '옮기기', en: 'Move' }), icon: FolderInput, onSelect: () => setMoving({ kind: 'folder', folder }) },
    { key: 'delete', label: t({ ko: '폴더 삭제', en: 'Delete folder' }), icon: Trash2, destructive: true, onSelect: () => void removeFolder(folder).catch(onError) },
  ]
  const profileMenu = (profile: ChatProfile): ActionMenuEntry[] => [
    { key: 'open', label: t({ ko: '편집', en: 'Edit' }), icon: SquarePen, onSelect: () => openEditor(profile) },
    { key: 'copy', label: t({ ko: '복사', en: 'Copy' }), icon: Copy, onSelect: () => void copy(profile).catch(onError) },
    { key: 'move', label: t({ ko: '폴더로 옮기기', en: 'Move to folder' }), icon: FolderInput, onSelect: () => setMoving({ kind: 'profile', profile }) },
    { key: 'enable', label: profile.isEnabled ? t({ ko: '사용 끄기', en: 'Disable' }) : t({ ko: '사용 켜기', en: 'Enable' }), icon: Power, disabled: toggleMutation.isPending, onSelect: () => toggleMutation.mutate(profile) },
  ]

  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)
  const reorderMutation = useMutation({
    mutationFn: (ids: number[]) => reorderChatProfiles(ids, folderId),
    onMutate: async (ids) => {
      const key = [...CHAT_PROFILE_LIBRARY_QUERY_KEY, scope]
      await queryClient.cancelQueries({ queryKey: key, exact: true })
      const previous = queryClient.getQueryData<Awaited<ReturnType<typeof listChatProfilePage>>>(key)
      if (previous) {
        const byId = new Map(previous.items.map((profile) => [profile.id, profile]))
        queryClient.setQueryData(key, { ...previous, items: ids.flatMap((id) => byId.get(id) ?? []) })
      }
      return { key, previous }
    },
    onSuccess: refresh,
    onError: (error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous)
      void refresh()
      showSnackbar({ message: getErrorMessage(error, t({ ko: '순서를 바꾸지 못했어.', en: 'Could not reorder.' })), tone: 'error' })
    },
  })
  const drop = (event: DragEvent, targetId: number) => {
    event.preventDefault()
    if (query || reorderMutation.isPending || dragId === null || dragId === targetId) return
    const ids = profiles.map((profile) => profile.id).filter((id) => id !== dragId)
    ids.splice(ids.indexOf(targetId) + (profiles.findIndex((profile) => profile.id === dragId) < profiles.findIndex((profile) => profile.id === targetId) ? 1 : 0), 0, dragId)
    reorderMutation.mutate(ids)
  }

  // A connected chat can open the editor for a new or listed profile; it fills and saves from there.
  useChatPageRegistration({
    kind: 'settings', title: t({ ko: '캐릭터 · 채팅 프로필', en: 'Characters · Chat profiles' }), resourceId: 'chat', priority: 5, fields: [],
    data: { section: 'chat', folderId: folderId ?? 0, query, page, total: profilesQuery.data?.total ?? 0, folders: folders.map(({ id, name, parentId, profileCount }) => ({ id, name, parentId: parentId ?? 0, profileCount })), profiles: profiles.map((profile) => ({ id: profile.id, name: profile.name, folderId: profile.folderId ?? 0, revision: profile.revision, tagline: profile.tagline, engine: profile.engine, isEnabled: profile.isEnabled })) },
    actions: [
      pageAction('profile.open_folder', t({ ko: '폴더 열기', en: 'Open folder' }), 'Open a profile folder; 0 is top level.', pageObject({ folderId: pageChoice([0, ...folders.map((folder) => folder.id)]) }, ['folderId'])),
      pageAction('profile.search', t({ ko: '프로필 검색', en: 'Search profiles' }), 'Search names across profile folders; page is zero-based.', pageObject({ query: pageText(), page: pageNumber(0, undefined, true) }, ['query'])),
      pageAction('profile.folder_create', t({ ko: '폴더 만들기', en: 'Create folder' }), 'Create a profile folder after review.', pageObject({ name: pageText(), parentId: pageChoice([0, ...folders.map((folder) => folder.id)]) }, ['name', 'parentId']), 'save'),
      ...(folders.length ? [
        pageAction('profile.folder_rename', t({ ko: '폴더 이름 바꾸기', en: 'Rename folder' }), 'Rename the selected folder after review.', pageObject({ id: pageChoice(folders.map((folder) => folder.id)), name: pageText() }, ['id', 'name']), 'save'),
        pageAction('profile.folder_move', t({ ko: '폴더 옮기기', en: 'Move folder' }), 'Move a folder after review; cycles are rejected.', pageObject({ id: pageChoice(folders.map((folder) => folder.id)), parentId: pageChoice([0, ...folders.map((folder) => folder.id)]) }, ['id', 'parentId']), 'save'),
        pageAction('profile.folder_delete', t({ ko: '폴더 삭제', en: 'Delete folder' }), 'Profiles and subfolders move to the parent, never deleted. Duplicate sibling names reject the operation.', pageObject({ id: pageChoice(folders.map((folder) => folder.id)) }, ['id']), 'save'),
      ] : []),
      pageAction('profile.open_create', t({ ko: '새 프로필 편집기 열기', en: 'Open new profile editor' }), t({ ko: '빈 프로필 편집기를 열어. 열린 편집기가 바로 돌아오니 이어서 profile.draft로 채워.', en: 'Open an empty profile editor; it comes back so you can fill it with profile.draft next.' })),
      ...(profiles.length ? [
        pageAction('profile.move', t({ ko: '프로필 옮기기', en: 'Move profile' }), 'Move a listed profile after review, checking its listed revision.', pageObject({ id: pageChoice(profiles.map((profile) => profile.id)), folderId: pageChoice([0, ...folders.map((folder) => folder.id)]) }, ['id', 'folderId']), 'save'),
        pageAction('profile.open_edit', t({ ko: '프로필 편집기 열기', en: 'Open profile editor' }), t({ ko: '목록(data.profiles)의 프로필 편집기를 열어.', en: 'Open the editor of a listed profile (data.profiles).' }), pageObject({ id: pageChoice(profiles.map((profile) => profile.id)) }, ['id'])),
        pageAction('profile.copy', t({ ko: '프로필 복사', en: 'Copy profile' }), t({ ko: '목록 프로필의 사본 초안을 열어. 저장해야 생겨.', en: 'Open a copy of a listed profile as a new draft; saved only from the editor.' }), pageObject({ id: pageChoice(profiles.map((profile) => profile.id)) }, ['id'])),
      ] : []),
    ],
    apply: () => {},
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      const to = (value: unknown) => Number(value) > 0 ? Number(value) : null
      if (id === 'profile.open_folder') { openFolder(to(args.folderId)); return }
      if (id === 'profile.search') { update({ q: String(args.query ?? '') || null, page: String(args.page ?? 0) }); return }
      if (id === 'profile.folder_create') { await createChatProfileFolder({ name: String(args.name), parentId: to(args.parentId) }); await refresh(); return }
      if (id === 'profile.folder_rename' || id === 'profile.folder_move') {
        await updateChatProfileFolder(Number(args.id), id === 'profile.folder_rename' ? { name: String(args.name) } : { parentId: to(args.parentId) })
        await refresh(); return
      }
      if (id === 'profile.folder_delete') {
        const folder = folders.find((entry) => entry.id === Number(args.id))
        if (!folder) throw new Error('폴더를 찾을 수 없어.')
        await removeFolder(folder, false); return
      }
      if (id === 'profile.open_create') { openEditor(null); return }
      const profile = profiles.find((entry) => entry.id === Number(args.id))
      if (!profile) throw new Error('목록에 없는 프로필이야.')
      if (id === 'profile.move') { await moveMutation.mutateAsync({ target: { kind: 'profile', profile }, to: to(args.folderId) }); return }
      if (id === 'profile.copy') { await copy(profile); return }
      openEditor(profile)
    },
  }, { preserveOnSearchChange: true })

  return (
    <PageWithSidebar storageKey="characters" sidebarLabel={t('characterLibraryPage.folders')}
      sidebar={<CharacterFolderSidebar folders={folders} selectedId={query ? null : folderId} loading={foldersQuery.isPending} error={foldersQuery.error} onSelect={openFolder} onCreate={() => setNameDialog({ name: '', parentId: creationFolderId })} getMenu={folderMenu} />}
      toolbar={<PageToolbar start={<>{viewSwitch}{query ? <Heading level={3} as="h1" className="truncate">{t({ ko: '‘{query}’ 검색 결과', en: 'Results for ‘{query}’' }, { query })}</Heading> : <PathBreadcrumbs ariaLabel={t({ ko: '폴더 경로', en: 'Folder path' })} items={[{ key: 'root', label: t({ ko: '채팅 프로필', en: 'Chat profiles' }), onClick: () => openFolder(null) }, ...path.map((folder) => ({ key: String(folder.id), label: folder.name, onClick: () => openFolder(folder.id) }))]} />}</>}
        actions={<>
            <IconButton size="icon-sm" variant="ghost" label={t({ ko: '새 폴더', en: 'New folder' })} onClick={() => setNameDialog({ name: '', parentId: creationFolderId })}><FolderPlus /></IconButton>
            {currentFolder && !query ? <ActionMenuButton entries={folderMenu(currentFolder)} label={t({ ko: '폴더 작업', en: 'Folder actions' })} /> : null}
            <input ref={importRef} type="file" accept=".png,.json,image/png,application/json" className="hidden" aria-label={t({ ko: '캐릭터 카드 파일', en: 'Character card file' })} onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) importMutation.mutate(file)
            }} />
            <IconButton size="icon-sm" variant="ghost" disabled={importMutation.isPending} onClick={() => importRef.current?.click()} label={t({ ko: '캐릭터 카드 가져오기', en: 'Import character card' })}><FileUp /></IconButton>
            <Button size="sm" onClick={() => openEditor(null)}><Plus />{t({ ko: '새 프로필', en: 'New profile' })}</Button>
          </>}>
        <ToolbarSearchField value={searchText} onChange={setSearchText} placeholder={t({ ko: '프로필 이름 검색', en: 'Search profiles by name' })} />
      </PageToolbar>}
    >
      <LibraryFolderContent folderMissing={folderMissing} subfolders={subfolders} query={query} rootLabel={t({ ko: '채팅 프로필', en: 'Chat profiles' })} onOpen={openFolder} getMenu={folderMenu}>
        <RowGroup heading={t({ ko: '채팅 프로필', en: 'Chat profiles' })} count={profilesQuery.data?.total}>
          <CharacterSettingGrid query={profilesQuery} page={page} onPageChange={(next) => update({ page: next ? String(next) : null })}
            errorTitle={t({ ko: '프로필을 불러오지 못했어', en: 'Could not load profiles' })}
            empty={<EmptyState icon={UserRound} title={query ? t({ ko: '맞는 프로필이 없어', en: 'No matching profiles' }) : t({ ko: '여기엔 프로필이 없어', en: 'No profiles here' })} />}
            renderSetting={(profile) => <div key={profile.id} className="min-w-0"
            onDragOver={(event) => { if (dragId !== null) { event.preventDefault(); setOverId(profile.id) } }}
            onDragLeave={() => setOverId((current) => (current === profile.id ? null : current))}
            onDrop={(event) => { drop(event, profile.id); setDragId(null); setOverId(null) }}
          >
              <CharacterCard name={profile.name} onOpen={() => openEditor(profile)} selected={overId === profile.id && dragId !== profile.id} dimmed={!profile.isEnabled} menu={profileMenu(profile)} actionsButton
                draggable={!query && !reorderMutation.isPending}
                onDragStart={(event) => { setDragId(profile.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(profile.id)) }}
                onDragEnd={() => { setDragId(null); setOverId(null) }}
                mediaSrc={profile.libraryReferenceHash ? characterThumbnailUrl(profile.libraryReferenceHash) : profile.avatarThumbnailUrl ?? (profile.hasAvatar ? chatProfileAssetUrl(profile.id, 'avatar', profile.assetVersion) : profile.avatar)}
                crop={profile.libraryReferenceHash ? null : profile.avatarCrop}
                avatarProps={{ name: profile.name, avatar: profile.avatar, profile, engine: profile.engine, size: 'sm' }}
                decorateAvatar={(avatar) => <ChatHealthDot down={healthOf(profile.id)}>{avatar}</ChatHealthDot>}
              >
            <div className="mt-2 flex min-w-0 flex-wrap gap-1">
              {!profile.isEnabled ? <Chip size="sm" tone="muted">{t({ ko: '꺼짐', en: 'Disabled' })}</Chip> : null}
              <Tip content={healthOf(profile.id) ? <ChatHealthTip down={healthOf(profile.id)!} /> : profileModelLine(profile, slots, t)}>
                <span className="min-w-0"><Chip size="sm" tone={healthOf(profile.id) ? 'destructive' : 'muted'} className="max-w-full"><span className="truncate">{profileModelChip(profile, slots)}</span></Chip></span>
              </Tip>
              {profile.mcpEnabled ? <Tip content={profile.mcpScopes.map((scope) => getChatScopeCopy(scope, t).label).join(' · ')}><span><Chip size="sm" tone="muted">{profileToolChip(profile, t)}</Chip></span></Tip> : null}
            </div>
              </CharacterCard>
          </div>}
          />
        </RowGroup>
      </LibraryFolderContent>
      {nameDialog ? <NameDialog open title={nameDialog.folder ? t({ ko: '폴더 이름 바꾸기', en: 'Rename folder' }) : t({ ko: '새 폴더', en: 'New folder' })} value={nameDialog.name} onChange={(name) => setNameDialog({ ...nameDialog, name })} onSubmit={() => nameMutation.mutate(nameDialog)} onClose={() => setNameDialog(null)} busy={nameMutation.isPending} /> : null}
      {moving ? <CharacterFolderPickerModal title={t({ ko: '폴더로 옮기기', en: 'Move to folder' })} folders={folders} value={moving.kind === 'folder' ? moving.folder.parentId : moving.profile.folderId ?? null} excludeIds={moving.kind === 'folder' ? folderSubtreeIds(folders, moving.folder.id) : undefined} busy={moveMutation.isPending} onPick={(to) => moveMutation.mutate({ target: moving, to })} onClose={() => setMoving(null)} /> : null}

      <ChatCardImportReportModal
        report={imported?.report ?? null}
        onClose={() => {
          if (imported) openEditor(null, { draft: imported.draft })
          setImported(null)
        }}
      />
    </PageWithSidebar>
  )
}
