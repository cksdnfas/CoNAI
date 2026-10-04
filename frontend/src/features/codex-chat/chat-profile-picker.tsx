import { useMemo, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ListRow } from '@/components/ui/list-row'
import { useI18n } from '@/i18n'
import type { ChatProfileSummary, CodexChatThread } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { ChatProfileAvatar } from './chat-profile-avatar'

export function ChatProfilePicker({ profiles, threads, layout, disabled, onPick, onRecent }: {
  profiles: ChatProfileSummary[]; threads: CodexChatThread[]; layout: 'panel' | 'page'; disabled: boolean
  onPick: (profileId: number) => void; onRecent: (threadId: number) => void
}) {
  const { t, formatDateTime } = useI18n()
  const [query, setQuery] = useState('')
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
  return <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
    <div className="mx-auto max-w-4xl">
      <Input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t({ ko: '프로필 검색', en: 'Search profiles' })} aria-label={t({ ko: '프로필 검색', en: 'Search profiles' })} className="mb-4" />
      <div className={cn('grid gap-x-6', layout === 'page' && 'md:grid-cols-2')}>
        {usable.map((profile) => {
          const last = recent.get(profile.id)
          return <div key={profile.id} className="border-b border-line py-4">
            <ListRow asChild interactive><button type="button" disabled={disabled} onClick={() => onPick(profile.id)} className="w-full items-start gap-4 text-left disabled:opacity-50">
              <ChatProfileAvatar name={profile.name} avatar={profile.avatar} engine={profile.engine} size="xl" />
              <span className="min-w-0 flex-1 space-y-1">
                <span className="block truncate font-semibold">{profile.name}</span>
                {profile.tagline ? <span className="block truncate text-xs text-muted-foreground">{profile.tagline}</span> : null}
                <span className="block truncate text-2xs text-muted-foreground">{profile.engine === 'codex' ? 'Codex' : 'API LLM'} · {profile.model || t({ ko: '기본 모델', en: 'Default model' })}</span>
                {last ? <time className="block text-2xs text-muted-foreground" dateTime={`${last.updated_date.replace(' ', 'T')}Z`}>{formatDateTime(new Date(`${last.updated_date.replace(' ', 'T')}Z`))}</time> : null}
              </span>
            </button></ListRow>
            {last ? <div className="ml-20"><Button variant="link" size="xs" disabled={disabled} className="max-w-full justify-start" onClick={() => onRecent(last.id)}><ArrowUpRight className="size-3 shrink-0" /><span className="truncate">{last.title || t({ ko: '새 채팅', en: 'New chat' })}</span></Button></div> : null}
          </div>
        })}
      </div>
      {usable.length === 0 ? <p className="py-6 text-sm text-muted-foreground">{t({ ko: '프로필이 없어.', en: 'No profiles.' })}</p> : null}
    </div>
  </div>
}
