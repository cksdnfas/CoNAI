import type { ReactNode } from 'react'
import { compareFolderPaths, type ChatProfileFolderFields } from '@conai/shared'
import { useI18n } from '@/i18n'

type Profile = ChatProfileFolderFields & { id: number; name: string }

export function groupChatProfiles<T extends Profile>(profiles: T[]) {
  const groups = new Map<string, { key: string; path: NonNullable<Profile['folderPath']>; profiles: T[] }>()
  for (const profile of profiles) {
    const path = profile.folderPath ?? []
    const key = path.map((folder) => folder.id).join('/')
    let group = groups.get(key)
    if (!group) { group = { key, path, profiles: [] }; groups.set(key, group) }
    group.profiles.push(profile)
  }
  return [...groups.values()].sort((a, b) => compareFolderPaths(a.path, b.path)).map((group) => ({ ...group, profiles: group.profiles.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.id - b.id) }))
}

/** Shared headings for the new-chat and member pickers; directory paths are already permission-filtered by the server. */
export function ChatProfileGroups<T extends Profile>({ profiles, children, className }: { profiles: T[]; children: (profile: T) => ReactNode; className?: string }) {
  const { t } = useI18n()
  if (!profiles.some((profile) => profile.folderPath?.length)) return <div className={className}>{groupChatProfiles(profiles).flatMap((group) => group.profiles.map(children))}</div>
  return groupChatProfiles(profiles).map((group) => <section key={group.key} className="space-y-2">
    <h3 className="pt-3 text-xs font-semibold text-muted-foreground">{group.path.map((folder) => folder.name).join(' / ') || t({ ko: '최상위', en: 'Top level' })}</h3>
    <div className={className}>{group.profiles.map(children)}</div>
  </section>)
}

export function ChatProfileOptions<T extends Profile>({ profiles, prefix = '', disabled }: { profiles: T[]; prefix?: string; disabled?: (profile: T) => boolean }) {
  const { t } = useI18n()
  if (!profiles.some((profile) => profile.folderPath?.length)) return groupChatProfiles(profiles).flatMap((group) => group.profiles.map((profile) => <option key={profile.id} value={`${prefix}${profile.id}`} disabled={disabled?.(profile)}>{profile.name}</option>))
  return groupChatProfiles(profiles).map((group) => <optgroup key={group.key} label={group.path.map((folder) => folder.name).join(' / ') || t({ ko: '최상위', en: 'Top level' })}>
    {group.profiles.map((profile) => <option key={profile.id} value={`${prefix}${profile.id}`} disabled={disabled?.(profile)}>{profile.name}</option>)}
  </optgroup>)
}
