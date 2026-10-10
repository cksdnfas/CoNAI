import { useEffect, useMemo, useRef, useState } from 'react'
import { MessageCircle, Pause, Play, SkipForward } from 'lucide-react'
import { useI18n } from '@/i18n'
import { buildApiUrl } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import type { WallpaperWidgetInstance } from './wallpaper-types'
import {
  useWallpaperAudioCandidates,
  useWallpaperChatMessages,
  useWallpaperChatProfiles,
  useWallpaperChatThreads,
  useWallpaperDataEnvironment,
  useWallpaperPromptRoll,
  useWallpaperRecentPosts,
} from './wallpaper-widget-data'
import { WallpaperWidgetNote } from './wallpaper-monitor-widget-bodies'

function apiUrl(path: string | null | undefined) {
  if (!path) return null
  return path.startsWith('/') ? buildApiUrl(path) : path
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-[0.18em] align-middle" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span key={index} className="size-[0.32em] rounded-full bg-current" style={{ animation: `wallpaper-typing 1.2s ${index * 0.16}s infinite ease-in-out` }} />
      ))}
    </span>
  )
}

/** Strip markdown and chat markup down to a readable line. */
function plainText(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The chat this widget follows: the profile's latest chat, or the latest chat overall. */
function useFollowedThread(profileId: number | null) {
  const threadsQuery = useWallpaperChatThreads(profileId)
  const thread = threadsQuery.data?.[0] ?? null
  return { threadsQuery, thread }
}

export function WallpaperCharacterCardBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'character-card' }> }) {
  const { t } = useI18n()
  const settings = widget.settings
  const profilesQuery = useWallpaperChatProfiles()
  const { threadsQuery, thread } = useFollowedThread(settings.profileId)
  const profileId = settings.profileId ?? thread?.profileId ?? null
  const profile = (profilesQuery.data ?? []).find((item) => item.id === profileId) ?? null
  const messagesQuery = useWallpaperChatMessages(settings.showLastMessage ? (thread?.id ?? null) : null, 4, thread?.running === true)
  const running = messagesQuery.data?.running ?? thread?.running ?? false
  const lastAssistant = [...(messagesQuery.data?.messages ?? [])].reverse().find((message) => message.role === 'assistant')
  const lastLine = lastAssistant ? plainText(lastAssistant.text) : thread?.preview ? plainText(thread.preview) : ''

  if (profilesQuery.isError || threadsQuery.isError) return <WallpaperWidgetNote>{t({ ko: '채팅을 볼 수 없어.', en: 'Chat unavailable.' })}</WallpaperWidgetNote>
  if (profilesQuery.isLoading) return <WallpaperWidgetNote>{t({ ko: '불러오는 중…', en: 'Loading…' })}</WallpaperWidgetNote>
  if (!profile) return <WallpaperWidgetNote>{t({ ko: '캐릭터를 골라줘.', en: 'Pick a character.' })}</WallpaperWidgetNote>

  const avatar = apiUrl(profile.avatarThumbnailUrl)
  const background = settings.showCharacterBackground ? apiUrl(profile.backgroundUrl) : null
  const lineClamp = settings.messageLines === 1 ? 'line-clamp-1' : settings.messageLines === 3 ? 'line-clamp-3' : 'overflow-hidden'

  return (
    <div className="relative flex h-full items-center gap-[min(5cqh,16px)] overflow-hidden">
      {background ? (
        <>
          <img src={background} alt="" className="absolute inset-0 -z-0 h-full w-full object-cover opacity-45" draggable={false} />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--background)_70%,transparent),transparent)]" />
        </>
      ) : null}
      {settings.showAvatar ? (
        <div className="relative aspect-square h-[min(100cqh,46cqw)] max-h-24 shrink-0 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--foreground)_12%,transparent)]">
          {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" draggable={false} /> : null}
        </div>
      ) : null}
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-base font-semibold">{profile.name}</span>
          {settings.showTyping && running ? (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-primary"><TypingDots />{t({ ko: '입력 중', en: 'typing' })}</span>
          ) : null}
          {settings.showUnread && (thread?.unreadCount ?? 0) > 0 ? (
            <span className="ml-auto shrink-0 rounded-full bg-primary px-1.5 text-2xs font-semibold text-primary-foreground tabular-nums">{thread?.unreadCount}</span>
          ) : null}
        </div>
        {settings.showLastMessage ? (
          <div className={cn('mt-1 text-sm opacity-75', lineClamp)}>
            {lastLine || profile.tagline || ''}
          </div>
        ) : profile.tagline ? (
          <div className="mt-1 truncate text-sm opacity-60">{profile.tagline}</div>
        ) : null}
      </div>
    </div>
  )
}

export function WallpaperChatRecentBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'chat-recent' }> }) {
  const { t } = useI18n()
  const profilesQuery = useWallpaperChatProfiles()
  const { threadsQuery, thread } = useFollowedThread(widget.settings.profileId)
  const count = Math.max(1, Math.min(12, widget.settings.messageCount))
  const messagesQuery = useWallpaperChatMessages(thread?.id ?? null, count, thread?.running === true)
  const profileById = useMemo(() => new Map((profilesQuery.data ?? []).map((profile) => [profile.id, profile])), [profilesQuery.data])
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const messages = messagesQuery.data?.messages ?? []

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages.length])

  if (threadsQuery.isError) return <WallpaperWidgetNote>{t({ ko: '채팅을 볼 수 없어.', en: 'Chat unavailable.' })}</WallpaperWidgetNote>
  if (threadsQuery.isLoading) return <WallpaperWidgetNote>{t({ ko: '불러오는 중…', en: 'Loading…' })}</WallpaperWidgetNote>
  if (!thread) return <WallpaperWidgetNote>{t({ ko: '아직 대화가 없어.', en: 'No chats yet.' })}</WallpaperWidgetNote>

  return (
    <div ref={scrollRef} className="flex h-full flex-col justify-end gap-2.5 overflow-hidden">
      {messages.map((message) => {
        const speaker = message.role === 'assistant'
          ? profileById.get(message.speakerProfileId ?? thread.profileId ?? -1)
          : null
        const avatar = apiUrl(speaker?.avatarThumbnailUrl)
        if (message.role === 'user') {
          return (
            <div key={message.id} className="ml-[18%] self-end rounded-[14px] rounded-br-[4px] bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)] px-3 py-1.5 text-sm">
              <span className="line-clamp-3">{plainText(message.text)}</span>
            </div>
          )
        }
        return (
          <div key={message.id} className="mr-[12%] flex items-start gap-2">
            <span className="size-6 shrink-0 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--foreground)_12%,transparent)]">
              {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" draggable={false} /> : null}
            </span>
            <div className="min-w-0">
              {speaker ? <div className="text-2xs font-semibold opacity-60">{speaker.name}</div> : null}
              <div className="line-clamp-4 text-sm">{plainText(message.text)}</div>
            </div>
          </div>
        )
      })}
      {messagesQuery.data?.running ? <div className="pl-8 text-sm opacity-70"><TypingDots /></div> : null}
    </div>
  )
}

function formatDuration(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

function shuffled<T>(items: T[]) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap], copy[index]]
  }
  return copy
}

/** Loops one audio group; plays on its own on the live page, never in the editor. */
export function WallpaperAudioPlayerBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'audio-player' }> }) {
  const { t } = useI18n()
  const { mode } = useWallpaperDataEnvironment()
  const settings = widget.settings
  const query = useWallpaperAudioCandidates(settings.audioGroupId)
  const order = useMemo(() => (settings.shuffle ? shuffled(query.data ?? []) : (query.data ?? [])), [query.data, settings.shuffle])
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState({ current: 0, duration: 0 })
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const track = order.length > 0 ? order[index % order.length] : null
  const autoplay = mode === 'runtime' && settings.autoplay

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, settings.volume / 100))
  }, [settings.volume, track])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !track) return
    if (autoplay || playing) void audio.play().catch(() => setPlaying(false))
    // Only a new track (or the autoplay switch) restarts playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, autoplay])

  if (!settings.audioGroupId) return <WallpaperWidgetNote>{t({ ko: '오디오 그룹을 골라줘.', en: 'Pick an audio group.' })}</WallpaperWidgetNote>
  if (query.isError) return <WallpaperWidgetNote>{t({ ko: '오디오를 볼 수 없어.', en: 'Audio unavailable.' })}</WallpaperWidgetNote>
  if (!track) return <WallpaperWidgetNote>{query.isLoading ? t({ ko: '불러오는 중…', en: 'Loading…' }) : t({ ko: '그룹에 오디오가 없어.', en: 'The group has no audio.' })}</WallpaperWidgetNote>

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play().catch(() => undefined)
    else audio.pause()
  }
  const next = () => setIndex((current) => current + 1)
  const ratio = time.duration > 0 ? time.current / time.duration : 0

  return (
    <div className="flex h-full items-center gap-3">
      <audio
        ref={audioRef}
        src={apiUrl(track.fileUrl) ?? undefined}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={next}
        onTimeUpdate={(event) => setTime({ current: event.currentTarget.currentTime, duration: event.currentTarget.duration || track.duration || 0 })}
      />
      {/* eslint-disable-next-line no-restricted-syntax -- wallpaper player control sized by the widget, styled by the widget frame */}
      <button
        type="button"
        aria-label={playing ? t({ ko: '일시정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })}
        onClick={toggle}
        className="flex aspect-square h-[min(60cqh,48px)] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
      >
        {playing ? <Pause className="size-[45%]" /> : <Play className="size-[45%] translate-x-[6%]" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{track.name}</div>
        <div className="mt-1.5 flex items-center gap-2 text-2xs tabular-nums opacity-65">
          <span>{formatDuration(time.current)}</span>
          <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--foreground)_14%,transparent)]">
            <span className="block h-full rounded-full bg-current" style={{ width: `${ratio * 100}%` }} />
          </span>
          <span>{formatDuration(time.duration || track.duration || 0)}</span>
        </div>
      </div>
      {order.length > 1 ? (
        // eslint-disable-next-line no-restricted-syntax -- wallpaper player control sized by the widget
        <button type="button" aria-label={t({ ko: '다음 곡', en: 'Next track' })} onClick={next} className="flex size-8 shrink-0 items-center justify-center rounded-full opacity-70 hover:opacity-100">
          <SkipForward className="size-4" />
        </button>
      ) : null}
    </div>
  )
}

export function WallpaperPostTickerBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'post-ticker' }> }) {
  const { t, formatDateTime } = useI18n()
  const query = useWallpaperRecentPosts(Math.max(1, Math.min(10, widget.settings.count)))
  if (query.isError) return <WallpaperWidgetNote>{t({ ko: '게시판을 볼 수 없어.', en: 'Posts unavailable.' })}</WallpaperWidgetNote>
  if (query.isLoading) return <WallpaperWidgetNote>{t({ ko: '불러오는 중…', en: 'Loading…' })}</WallpaperWidgetNote>
  const posts = query.data ?? []
  if (posts.length === 0) return <WallpaperWidgetNote>{t({ ko: '아직 글이 없어.', en: 'No posts yet.' })}</WallpaperWidgetNote>

  return (
    <div className="flex h-full flex-col divide-y divide-[color-mix(in_srgb,var(--foreground)_10%,transparent)] overflow-hidden">
      {posts.map((post) => {
        const cover = widget.settings.showCover ? apiUrl(post.coverUrl) : null
        return (
          <div key={post.id} className="flex min-h-0 items-center gap-3 py-2 first:pt-0 last:pb-0">
            {cover ? <img src={cover} alt="" className="size-12 shrink-0 rounded-md object-cover" draggable={false} /> : null}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{post.title || plainText(post.excerpt ?? '')}</div>
              <div className="mt-0.5 flex items-center gap-2 text-2xs opacity-60">
                <span className="truncate">{post.authorName}</span>
                <span className="shrink-0">{formatDateTime(post.publishedAt, { month: 'short', day: 'numeric' })}</span>
                {post.commentCount > 0 ? <span className="flex shrink-0 items-center gap-0.5"><MessageCircle className="size-3" />{post.commentCount}</span> : null}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function WallpaperPromptOfDayBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'prompt-of-day' }> }) {
  const { t } = useI18n()
  const template = widget.settings.template
  const query = useWallpaperPromptRoll(template, Math.max(0, widget.settings.rerollMinutes))
  if (!template.trim()) return <WallpaperWidgetNote>{t({ ko: '와일드카드 템플릿을 적어줘.', en: 'Write a wildcard template.' })}</WallpaperWidgetNote>
  if (query.isError) return <WallpaperWidgetNote>{t({ ko: '와일드카드를 굴리지 못했어.', en: 'Could not roll the wildcards.' })}</WallpaperWidgetNote>
  const text = query.data?.text ?? ''

  return (
    <div className="flex h-full items-center overflow-hidden">
      <p
        className={cn('line-clamp-6 leading-snug', widget.settings.typeface === 'serif' ? "[font-family:'Noto_Serif_KR',ui-serif,Georgia,serif]" : null)}
        style={{ fontSize: 'max(14px, min(16cqh, 5.5cqw))' }}
      >
        {text}
      </p>
    </div>
  )
}
