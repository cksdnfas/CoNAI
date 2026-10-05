import { useMemo, useState } from 'react'
import { ArrowUpRight, Crown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { ListRow } from '@/components/ui/list-row'
import { useI18n } from '@/i18n'
import type { ChatProfileSummary, CodexChatThread } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { GROUP_MEMBER_MAX } from './chat-group'
import { ChatProfileAvatar } from './chat-profile-avatar'

/**
 * Pick who to chat with. A tap on a profile starts a direct chat. Ticking profiles (the check that shows on hover,
 * always on touch) collects a room instead: the first one ticked represents it, the rest join as members.
 */
export function ChatProfilePicker({ profiles, threads, layout, disabled, onPick, onPickGroup, onRecent }: {
  profiles: ChatProfileSummary[]; threads: CodexChatThread[]; layout: 'panel' | 'page'; disabled: boolean
  onPick: (profileId: number) => void
  /** Profiles in the order they were ticked: the first represents the room. */
  onPickGroup: (profileIds: number[]) => void
  onRecent: (threadId: number) => void
}) {
  const { t, formatDate, formatNumber } = useI18n()
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<number[]>([])
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
  // When the latest chat moved: the clock today, the day otherwise.
  const whenLabel = (date: Date) => date.toDateString() === new Date().toDateString()
    ? formatDate(date, { hour: 'numeric', minute: '2-digit' })
    : formatDate(date, date.getFullYear() === new Date().getFullYear() ? { month: 'short', day: 'numeric' } : { dateStyle: 'medium' })

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-4xl">
        <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t({ ko: '프로필 검색', en: 'Search profiles' })} aria-label={t({ ko: '프로필 검색', en: 'Search profiles' })} className="mb-4" />
        <div className={cn('grid gap-x-6', layout === 'page' && 'md:grid-cols-2')}>
          {usable.map((profile) => {
            const last = recent.get(profile.id)
            const pickedIndex = picked.indexOf(profile.id)
            const isPicked = pickedIndex >= 0
            const blocked = selecting && !isPicked && (picked.length >= GROUP_MEMBER_MAX || takenNames.has(profile.name.trim().toLowerCase()))
            const lastDate = last ? new Date(`${last.updated_date.replace(' ', 'T')}Z`) : null
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
                    <ChatProfileAvatar name={profile.name} avatar={profile.avatar} engine={profile.engine} size="lg" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-semibold">{profile.name}</span>
                          {/* Who stands for the room: the first one ticked. */}
                          {pickedIndex === 0 ? <Crown aria-label={t({ ko: '대표', en: 'Representative' })} className="size-3.5 shrink-0 text-secondary-text" /> : null}
                        </span>
                        <span className="ml-auto shrink-0 text-2xs text-muted-foreground">{profile.engine === 'codex' ? 'Codex' : 'API LLM'} · {profile.model || t({ ko: '기본 모델', en: 'Default model' })}</span>
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
              {/* The latest chat with this profile, in the text column: its title and when it last moved, picked up with one tap. */}
              {last && lastDate && !selecting ? (
                <Button variant="link" size="xs" disabled={disabled} className="-mt-1.5 mb-1 ml-13 max-w-[calc(100%-3.25rem)] justify-start gap-1.5 font-normal" onClick={() => onRecent(last.id)}>
                  <ArrowUpRight className="size-3 shrink-0" />
                  <span className="truncate">{last.title || t({ ko: '새 채팅', en: 'New chat' })}</span>
                  <time className="shrink-0 text-2xs text-muted-foreground" dateTime={lastDate.toISOString()}>{whenLabel(lastDate)}</time>
                </Button>
              ) : null}
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
              <ChatProfileAvatar key={profile.id} name={profile.name} avatar={profile.avatar} engine={profile.engine} size="sm" className={cn('ring-2 ring-background', index > 0 && '-ml-1.5')} />
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
