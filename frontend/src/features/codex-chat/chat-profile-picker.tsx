import { useMemo, useRef, useState } from 'react'
import { Crown, FileUp, FolderOpen, HardDriveUpload, X } from 'lucide-react'
import type { StoredFileEntry } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { ListRow } from '@/components/ui/list-row'
import { Tip } from '@/components/ui/tooltip'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { FilePicker } from '@/features/files/file-browser'
import { useI18n } from '@/i18n'
import { CHAT_BACKUP_FOLDER, type ChatProfileSummary, type CodexChatThread } from '@/lib/api-codex-chat'
import { listStoredFiles } from '@/lib/api-files'
import { cn } from '@/lib/utils'
import { GROUP_MEMBER_MAX } from './chat-group'
import { ChatProfileAvatar } from './chat-profile-avatar'

/**
 * Pick who to chat with. A tap on a profile starts a direct chat. Ticking profiles (the check that shows on hover,
 * always on touch) collects a room instead: the first one ticked represents it, the rest join as members.
 */
export function ChatProfilePicker({ profiles, threads, layout, disabled, onPick, onPickGroup, onImport, onImportFiles }: {
  profiles: ChatProfileSummary[]; threads: CodexChatThread[]; layout: 'panel' | 'page'; disabled: boolean
  onPick: (profileId: number) => void
  /** A CoNAI chat JSON to bring back as a new chat. */
  onImport?: (file: File) => void
  /** Chat JSON files already in the file store (chat backups), brought back without downloading them. */
  onImportFiles?: (entries: StoredFileEntry[]) => void
  /** Profiles in the order they were ticked: the first represents the room. */
  onPickGroup: (profileIds: number[]) => void
}) {
  const { t, formatNumber } = useI18n()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<number[]>([])
  const importRef = useRef<HTMLInputElement>(null)
  const canBrowseFiles = useAuthStatusQuery().data?.permissionKeys.includes('files.view') === true && onImportFiles !== undefined
  /** The file store picker, opened in the chat backup folder when there is one; undefined while closed. */
  const [filePickerAt, setFilePickerAt] = useState<string | null | undefined>(undefined)
  const openFilePicker = async () => {
    const root = await listStoredFiles(null).catch(() => null)
    setFilePickerAt(root?.entries.find((entry) => entry.kind === 'folder' && entry.name === CHAT_BACKUP_FOLDER)?.id ?? null)
  }
  const importLabel = t({ ko: '대화 가져오기 (JSON)', en: 'Import a chat (JSON)' })
  // Each profile's latest direct chat (threads come newest first); group rooms belong to several profiles.
  const recent = useMemo(() => {
    const result = new Map<number, CodexChatThread>()
    for (const thread of threads) if (thread.kind !== 'group' && thread.profile_id !== null && !result.has(thread.profile_id)) result.set(thread.profile_id, thread)
    return result
  }, [threads])
  const rank = useMemo(() => new Map([...recent.keys()].map((profileId, index) => [profileId, index])), [recent])
  // Most recently used first; profiles never chatted with keep their settings order after them.
  const usable = profiles
    .filter((profile) => profile.usable && `${profile.name} ${profile.tagline} ${profile.engine} ${profile.model}`.toLowerCase().includes(query.trim().toLowerCase()))
    .map((profile, index) => ({ profile, order: rank.get(profile.id) ?? recent.size + index }))
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.profile)
  const pickedProfiles = picked.flatMap((id) => profiles.find((profile) => profile.id === id) ?? [])
  const selecting = picked.length > 0
  // Same rules as inviting into a room: one profile per name, and a room size cap.
  const takenNames = new Set(pickedProfiles.map((profile) => profile.name.trim().toLowerCase()))
  const toggle = (id: number) => setPicked((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex items-center gap-2">
          <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t({ ko: '프로필 검색', en: 'Search profiles' })} aria-label={t({ ko: '프로필 검색', en: 'Search profiles' })} className="flex-1" />
          {onImport ? <>
            {canBrowseFiles ? (
              <DropdownMenu>
                <Tip content={importLabel}>
                  <DropdownMenuTrigger asChild>
                    <IconButton variant="ghost" size="icon-sm" disabled={disabled} label={importLabel} tooltip={false}><FileUp /></IconButton>
                  </DropdownMenuTrigger>
                </Tip>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => importRef.current?.click()}><HardDriveUpload />{t({ ko: '내 기기에서', en: 'From this device' })}</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void openFilePicker()}><FolderOpen />{t({ ko: '파일 보관함에서', en: 'From files' })}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : <IconButton variant="ghost" size="icon-sm" disabled={disabled} onClick={() => importRef.current?.click()} label={importLabel}><FileUp /></IconButton>}
            {filePickerAt !== undefined && onImportFiles ? (
              <FilePicker
                title={t({ ko: '보관함에서 대화 가져오기', en: 'Import chats from files' })}
                accept={['.json']}
                initialParentId={filePickerAt}
                pickLabel={(count) => count > 0 ? t({ ko: '{count}개 가져오기', en: 'Import {count}' }, { count }) : t({ ko: '가져오기', en: 'Import' })}
                onClose={() => setFilePickerAt(undefined)}
                onPick={(entries) => { setFilePickerAt(undefined); onImportFiles(entries) }}
              />
            ) : null}
            <input ref={importRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) onImport(file)
            }} />
          </> : null}
        </div>
        {/* grid-cols-1 sizes the column to the panel, so a long tagline truncates instead of widening the list. */}
        <div className={cn('grid grid-cols-1 gap-x-6', layout === 'page' && 'md:grid-cols-2')}>
          {usable.map((profile) => {
            const pickedIndex = picked.indexOf(profile.id)
            const isPicked = pickedIndex >= 0
            const blocked = selecting && !isPicked && (picked.length >= GROUP_MEMBER_MAX || takenNames.has(profile.name.trim().toLowerCase()))
            return <div key={profile.id} className="group/profile border-b border-line py-1">
              <div className="relative">
                <ListRow asChild interactive selected={isPicked}>
                  <button
                    type="button"
                    disabled={disabled || blocked}
                    // Once a room is being collected, the whole row ticks; before that a tap starts a direct chat.
                    onClick={() => (selecting ? toggle(profile.id) : onPick(profile.id))}
                    className="w-full items-center gap-3 py-2.5 pr-10 text-left disabled:opacity-50"
                  >
                    <ChatProfileAvatar name={profile.name} avatar={profile.avatar} profile={profile} engine={profile.engine} size="lg" />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate font-semibold">{profile.name}</span>
                        {/* Who stands for the room: the first one ticked. */}
                        {pickedIndex === 0 ? <Crown aria-label={t({ ko: '대표', en: 'Representative' })} className="size-3.5 shrink-0 text-secondary-text" /> : null}
                      </span>
                      {profile.tagline ? <span className="block truncate text-xs text-muted-foreground">{profile.tagline}</span> : null}
                    </span>
                  </button>
                </ListRow>
                <Checkbox
                  checked={isPicked}
                  disabled={disabled || blocked}
                  aria-label={t({ ko: '{name} 그룹에 담기', en: 'Add {name} to a group' }, { name: profile.name })}
                  className={cn(
                    "absolute right-3 top-1/2 size-5 -translate-y-1/2 rounded-[5px] transition-opacity before:absolute before:-inset-2.5 before:content-['']",
                    selecting ? 'opacity-100' : 'opacity-0 group-hover/profile:opacity-100 group-focus-within/profile:opacity-100 pointer-coarse:opacity-100',
                  )}
                  onCheckedChange={() => toggle(profile.id)}
                />
              </div>
            </div>
          })}
        </div>
        {usable.length === 0 ? <p className="py-6 text-sm text-muted-foreground">{t({ ko: '프로필이 없어.', en: 'No profiles.' })}</p> : null}
      </div>
    </div>

    {selecting ? (
      <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-2 sm:px-6">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex shrink-0">
            {pickedProfiles.map((profile, index) => (
              <ChatProfileAvatar key={profile.id} name={profile.name} avatar={profile.avatar} profile={profile} engine={profile.engine} size="sm" className={cn('ring-2 ring-background', index > 0 && '-ml-1.5')} />
            ))}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{formatNumber(picked.length)}</span> / {formatNumber(GROUP_MEMBER_MAX)}
            {pickedProfiles[0] ? <> · {t({ ko: '대표 {name}', en: 'Representative {name}' }, { name: pickedProfiles[0].name })}</> : null}
          </span>
        </span>
        <Button size="sm" disabled={disabled || picked.length < 2} onClick={() => onPickGroup(picked)}>{t({ ko: '그룹 만들기', en: 'Create group' })}</Button>
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '선택 해제', en: 'Clear selection' })} disabled={disabled} onClick={() => setPicked([])}><X /></IconButton>
      </div>
    ) : null}
  </div>
}
