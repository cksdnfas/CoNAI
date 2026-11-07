import { FileUp, Folder, FolderPlus, Plus, TriangleAlert, UserRound } from 'lucide-react'
import { ListPager } from '@/components/common/list-pager'
import { PathBreadcrumbs } from '@/components/common/path-breadcrumbs'
import { SearchField } from '@/components/common/search-field'
import { ActionContextMenu, ActionMenuButton } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/chip'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { ResourceRow } from '@/components/ui/resource-row'
import { RowGroup } from '@/components/ui/row-group'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'
import { ChatHealthDot, ChatHealthTip } from '@/features/codex-chat/chat-health'
import { ChatProfileAvatar } from '@/features/codex-chat/chat-profile-avatar'
import { getChatScopeCopy } from '@/features/codex-chat/chat-scope-copy'
import { getErrorMessage } from '@/lib/error-message'
import { ChatProfileLibraryDialogs, profileToolChip, useChatProfileLibrary } from './chat-settings-profiles'
import { profileModelChip, profileModelLine, removedModelNotices } from './chat-profile-model-line'
import { SettingsRowsSkeleton } from './settings-rows'

/**
 * Settings › 채팅 › 프로필: the same chat profile library as the workspace, drawn as rows so it sits among the other
 * settings. Everything (folders, search, enable, copy, move, card import, the editor modal) works here, inside Settings.
 */
export function ChatProfilesCompact({ active }: { active: boolean }) {
  const library = useChatProfileLibrary({ active })
  const {
    t, folderId, query, page, searchText, setSearchText, update, openFolder, creationFolderId,
    path, subfolders, folderMissing, profiles, profilesQuery, slots, healthOf,
    openEditor, folderMenu, profileMenu, toggleMutation, setNameDialog, importRef, importMutation,
  } = library
  const { isPending: loading, isError, error } = profilesQuery
  const total = profilesQuery.data?.total
  return (
    <section data-settings-group="profiles" data-setting-id="chat.profiles" className="scroll-mt-36 space-y-3">
      <RowGroup
        heading={t({ ko: '프로필', en: 'Profiles' })}
        count={total}
        actions={<>
          <IconButton size="icon-sm" variant="ghost" label={t({ ko: '새 폴더', en: 'New folder' })} onClick={() => setNameDialog({ name: '', parentId: creationFolderId })}><FolderPlus /></IconButton>
          <input ref={importRef} type="file" accept=".png,.json,image/png,application/json" className="hidden" aria-label={t({ ko: '캐릭터 카드 파일', en: 'Character card file' })} onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) importMutation.mutate(file)
          }} />
          <IconButton size="icon-sm" variant="ghost" disabled={importMutation.isPending} onClick={() => importRef.current?.click()} label={t({ ko: '캐릭터 카드 가져오기', en: 'Import character card' })}><FileUp /></IconButton>
          <Button size="compact" variant="ghost" aria-label={t({ ko: '새 프로필', en: 'New profile' })} onClick={() => openEditor(null)}><Plus />{t({ ko: '추가', en: 'Add' })}</Button>
        </>}
      >
        <div className="space-y-2 pb-2">
          <SearchField value={searchText} onChange={setSearchText} placeholder={t({ ko: '프로필 이름 검색', en: 'Search profiles by name' })} className="max-w-80" />
          {folderId !== null && !query ? (
            <PathBreadcrumbs ariaLabel={t({ ko: '폴더 경로', en: 'Folder path' })} items={[{ key: 'root', label: t({ ko: '최상위', en: 'Top level' }), onClick: () => openFolder(null) }, ...path.map((folder) => ({ key: String(folder.id), label: folder.name, onClick: () => openFolder(folder.id) }))]} />
          ) : null}
        </div>
        {folderMissing ? <EmptyState icon={Folder} title={t({ ko: '폴더를 찾지 못했어', en: 'Folder not found' })} /> : <>
          {!query ? subfolders.map((folder) => (
            <ResourceRow
              key={folder.id}
              leading={<Folder />}
              name={folder.name}
              aside={folder.profileCount ? <span>{folder.profileCount}</span> : null}
              trailing={<ActionMenuButton entries={folderMenu(folder)} label={t({ ko: '폴더 작업', en: 'Folder actions' })} />}
              onOpen={() => openFolder(folder.id)}
              openLabel={t({ ko: '폴더 열기', en: 'Open folder' })}
            />
          )) : null}
          {loading ? <SettingsRowsSkeleton rows={2} /> : null}
          {isError && !profilesQuery.data ? <p className="py-3 text-sm text-destructive">{getErrorMessage(error, t({ ko: '프로필을 불러오지 못했어', en: 'Could not load profiles' }))}</p> : null}
          {profilesQuery.isSuccess && profiles.length === 0 && (query || !subfolders.length) ? (
            <EmptyState icon={UserRound} title={query ? t({ ko: '맞는 프로필이 없어', en: 'No matching profiles' }) : t({ ko: '여기엔 프로필이 없어', en: 'No profiles here' })} />
          ) : null}
          {profiles.map((profile) => {
            const down = healthOf(profile.id)
            return (
              <ActionContextMenu key={profile.id} entries={profileMenu(profile)}><ResourceRow
                dimmed={!profile.isEnabled}
                leading={<ChatHealthDot down={down}><ChatProfileAvatar name={profile.name} avatar={profile.avatar} profile={profile} engine={profile.engine} size="sm" /></ChatHealthDot>}
                name={profile.name}
                extra={<>
                  <Tip content={down ? <ChatHealthTip down={down} /> : profileModelLine(profile, slots, t)}>
                    <span className="min-w-0"><Chip size="sm" tone={down ? 'destructive' : 'muted'} className="max-w-48"><span className="truncate">{profileModelChip(profile, slots)}</span></Chip></span>
                  </Tip>
                  {profile.removedModelRoles?.length ? (
                    <Tip content={<span className="whitespace-pre-line">{removedModelNotices(profile.removedModelRoles, t).join('\n')}</span>}>
                      <span><Chip size="sm" tone="warning"><TriangleAlert />{t({ ko: '삭제된 모델', en: 'Deleted model' })}</Chip></span>
                    </Tip>
                  ) : null}
                  {profile.mcpEnabled ? <Tip content={profile.mcpScopes.map((scope) => getChatScopeCopy(scope, t).label).join(' · ')}><span><Chip size="sm" tone="muted">{profileToolChip(profile, t)}</Chip></span></Tip> : null}
                </>}
                trailing={<>
                  <Switch size="sm" checked={profile.isEnabled} disabled={toggleMutation.isPending} onCheckedChange={() => toggleMutation.mutate(profile)} aria-label={t({ ko: '{name} 사용', en: 'Use {name}' }, { name: profile.name })} />
                  <ActionMenuButton entries={profileMenu(profile)} label={t({ ko: '프로필 작업', en: 'Profile actions' })} />
                </>}
                onOpen={() => openEditor(profile)}
              /></ActionContextMenu>
            )
          })}
        </>}
      </RowGroup>
      <ListPager hasPrevious={page > 0} hasNext={Boolean(profilesQuery.data?.hasMore)} onPrevious={() => update({ page: page - 1 ? String(page - 1) : null })} onNext={() => update({ page: String(page + 1) })} />
      <ChatProfileLibraryDialogs library={library} />
    </section>
  )
}
