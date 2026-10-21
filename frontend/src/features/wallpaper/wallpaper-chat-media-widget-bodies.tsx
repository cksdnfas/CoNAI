import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { MessageCircle, Pause, Play, SkipForward, SquareTerminal } from 'lucide-react'
import { useI18n } from '@/i18n'
import { buildApiUrl } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import type { WallpaperWidgetInstance } from './wallpaper-types'
import type { WallpaperChatProfile } from '@/lib/api-wallpaper-runtime'
import {
  useWallpaperAudioCandidates,
  useWallpaperChatMessages,
  useWallpaperChatProfiles,
  useWallpaperChatThreads,
  useWallpaperDataEnvironment,
  useWallpaperPromptRoll,
  useWallpaperRecentPosts,
} from './wallpaper-widget-data'
import { WallpaperWidgetErrorNote, WallpaperWidgetNote } from './wallpaper-widget-note'

function apiUrl(path: string | null | undefined) {
  if (!path) return null
  return path.startsWith('/') ? buildApiUrl(path) : path
}

function TypingDots() {
  return (
    <span className="inline-flex items-center align-middle" style={{ gap: '0.18em' }} aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <span key={index} className="size-[0.32em] rounded-full bg-current" style={{ animation: `wallpaper-typing 1.2s ${index * 0.16}s infinite ease-in-out` }} />
      ))}
    </span>
  )
}

/** A character's face: its avatar, else what the chat shows without one (a terminal for Codex, the first letter). */
function ChatProfileFace({ profile, className, style }: { profile: WallpaperChatProfile | null | undefined; className: string; style?: CSSProperties }) {
  const avatar = apiUrl(profile?.avatarThumbnailUrl)
  return (
    <span className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full', className)} style={{ background: 'color-mix(in srgb,var(--foreground) 12%,transparent)', ...style }}>
      {avatar ? (
        <img src={avatar} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : profile?.engine === 'codex' ? (
        <SquareTerminal className="size-[60%] opacity-80" />
      ) : profile ? (
        <span className="font-semibold opacity-75" style={{ fontSize: '0.75em' }}>{Array.from(profile.name.trim())[0] ?? '?'}</span>
      ) : null}
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

  if (profilesQuery.isError || threadsQuery.isError) return <WallpaperWidgetErrorNote error={profilesQuery.error ?? threadsQuery.error} />
  if (profilesQuery.isLoading) return <WallpaperWidgetNote>{t({ ko: '불러오는 중…', en: 'Loading…' })}</WallpaperWidgetNote>
  if (!profile) return <WallpaperWidgetNote>{t({ ko: '캐릭터를 골라줘.', en: 'Pick a character.' })}</WallpaperWidgetNote>

  const background = settings.showCharacterBackground ? apiUrl(profile.backgroundUrl) : null
  const lineClamp = settings.messageLines === 1 ? 'line-clamp-1' : settings.messageLines === 3 ? 'line-clamp-3' : 'overflow-hidden'

  return (
    // Type follows the box (name plus up to three message lines fit the height); the avatar fills it.
    <div className="relative flex h-full items-center overflow-hidden" style={{ gap: '0.9em', fontSize: 'clamp(12px, min(13cqh, 4.4cqw), 30px)' }}>
      {background ? (
        <>
          <img src={background} alt="" className="absolute inset-0 -z-0 h-full w-full object-cover opacity-45" draggable={false} />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg,color-mix(in srgb,var(--background) 70%,transparent),transparent)' }} />
        </>
      ) : null}
      {settings.showAvatar ? (
        <ChatProfileFace profile={profile} className="relative aspect-square h-[min(100cqh,40cqw)]" style={{ fontSize: '2.2em' }} />
      ) : null}
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center" style={{ gap: '0.5em' }}>
          <span className="truncate font-semibold" style={{ fontSize: '1.15em' }}>{profile.name}</span>
          {settings.showTyping && running ? (
            <span className="flex shrink-0 items-center text-primary" style={{ gap: '0.35em', fontSize: '0.8em' }}><TypingDots />{t({ ko: '입력 중', en: 'typing' })}</span>
          ) : null}
          {settings.showUnread && (thread?.unreadCount ?? 0) > 0 ? (
            <span className="ml-auto shrink-0 rounded-full bg-primary font-semibold text-primary-foreground tabular-nums" style={{ paddingInline: '0.45em', fontSize: '0.72em' }}>{thread?.unreadCount}</span>
          ) : null}
        </div>
        {settings.showLastMessage ? (
          <div className={cn('leading-snug opacity-75', lineClamp)} style={{ marginTop: '0.25em' }}>
            {lastLine || profile.tagline || ''}
          </div>
        ) : profile.tagline ? (
          <div className="truncate opacity-60" style={{ marginTop: '0.25em' }}>{profile.tagline}</div>
        ) : null}
      </div>
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
  /** The browser refused to start without a gesture (autoplay policy); the next tap starts it. */
  const [blocked, setBlocked] = useState(false)
  const [time, setTime] = useState({ current: 0, duration: 0 })
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const track = order.length > 0 ? order[index % order.length] : null
  const autoplay = mode === 'runtime' && settings.autoplay
  // Whether playback should carry on to the next track. Kept apart from `playing` because 'ended' fires a pause
  // first, which made a manually started group stop after its first track.
  const wantsPlayRef = useRef(autoplay)

  const startPlayback = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.play().then(() => setBlocked(false)).catch((error: unknown) => {
      // A src swap aborts a pending play; only a refused autoplay needs the tap prompt.
      if (error instanceof DOMException && error.name === 'NotAllowedError') setBlocked(true)
    })
  }, [])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.max(0, Math.min(1, settings.volume / 100))
  }, [settings.volume, track])

  useEffect(() => {
    if (autoplay) wantsPlayRef.current = true
  }, [autoplay])

  useEffect(() => {
    if (track && wantsPlayRef.current) startPlayback()
    // Only a new track (or the autoplay switch) restarts playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, autoplay, startPlayback])

  if (!settings.audioGroupId) return <WallpaperWidgetNote>{t({ ko: '오디오 그룹을 골라줘.', en: 'Pick an audio group.' })}</WallpaperWidgetNote>
  if (query.isError) return <WallpaperWidgetErrorNote error={query.error} notFound={t({ ko: '오디오 그룹을 찾을 수 없어.', en: 'Audio group not found.' })} />
  if (!track) return <WallpaperWidgetNote>{query.isLoading ? t({ ko: '불러오는 중…', en: 'Loading…' }) : t({ ko: '그룹에 오디오가 없어.', en: 'The group has no audio.' })}</WallpaperWidgetNote>

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) {
      wantsPlayRef.current = true
      startPlayback()
    } else {
      wantsPlayRef.current = false
      audio.pause()
    }
  }
  const next = () => setIndex((current) => current + 1)
  const handleEnded = () => {
    // One track: the id never changes, so the track effect would not run again; restart it here.
    if (order.length <= 1) {
      const audio = audioRef.current
      if (audio && wantsPlayRef.current) {
        audio.currentTime = 0
        startPlayback()
      }
      return
    }
    next()
  }
  const ratio = time.duration > 0 ? time.current / time.duration : 0

  return (
    <div className="flex h-full items-center gap-3">
      <audio
        ref={audioRef}
        src={apiUrl(track.fileUrl) ?? undefined}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={handleEnded}
        onTimeUpdate={(event) => setTime({ current: event.currentTarget.currentTime, duration: event.currentTarget.duration || track.duration || 0 })}
      />
      {/* eslint-disable-next-line no-restricted-syntax -- wallpaper player control sized by the widget, styled by the widget frame */}
      <button
        type="button"
        aria-label={playing ? t({ ko: '일시정지', en: 'Pause' }) : t({ ko: '재생', en: 'Play' })}
        onClick={toggle}
        className={cn('flex aspect-square h-[min(60cqh,48px)] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground', blocked && !playing ? 'animate-pulse' : null)}
      >
        {playing ? <Pause className="size-[45%]" /> : <Play className="size-[45%] translate-x-[6%]" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{track.name}</div>
        {blocked && !playing ? (
          <div className="mt-1.5 truncate text-2xs opacity-65">{t({ ko: '눌러서 재생', en: 'Tap to play' })}</div>
        ) : (
          <div className="mt-1.5 flex items-center gap-2 text-2xs tabular-nums opacity-65">
            <span>{formatDuration(time.current)}</span>
            <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: 'color-mix(in srgb,var(--foreground) 14%,transparent)' }}>
              <span className="block h-full rounded-full bg-current" style={{ width: `${ratio * 100}%` }} />
            </span>
            <span>{formatDuration(time.duration || track.duration || 0)}</span>
          </div>
        )}
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
  if (query.isError) return <WallpaperWidgetErrorNote error={query.error} />
  if (query.isLoading) return <WallpaperWidgetNote>{t({ ko: '불러오는 중…', en: 'Loading…' })}</WallpaperWidgetNote>
  const posts = query.data ?? []
  if (posts.length === 0) return <WallpaperWidgetNote>{t({ ko: '아직 글이 없어.', en: 'No posts yet.' })}</WallpaperWidgetNote>
  // Size the rows so the posts fill the height (a row is about 4.3em with a cover, 3.6em without); older ones clip.
  const rowEm = widget.settings.showCover ? 4.3 : 3.6

  return (
    <div
      className="flex h-full flex-col overflow-hidden"
      style={{ fontSize: `clamp(12px, min(${(100 / (posts.length * rowEm)).toFixed(2)}cqh, 3.6cqw), 24px)` }}
    >
      {posts.map((post, index) => {
        const cover = widget.settings.showCover ? apiUrl(post.coverUrl) : null
        return (
          <div key={post.id} className="flex shrink-0 items-center border-b last:border-b-0" style={{ gap: '0.75em', paddingTop: index === 0 ? 0 : '0.5em', paddingBottom: index === posts.length - 1 ? 0 : '0.5em', borderColor: 'color-mix(in srgb,var(--foreground) 10%,transparent)' }}>
            {cover ? <img src={cover} alt="" className="size-[3.2em] shrink-0 object-cover" style={{ borderRadius: '0.4em' }} draggable={false} /> : null}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{post.title || plainText(post.excerpt ?? '')}</div>
              <div className="flex items-center opacity-60" style={{ marginTop: '0.15em', gap: '0.6em', fontSize: '0.75em' }}>
                <span className="truncate">{post.authorName}</span>
                <span className="shrink-0">{formatDateTime(post.publishedAt, { month: 'short', day: 'numeric' })}</span>
                {post.commentCount > 0 ? <span className="flex shrink-0 items-center" style={{ gap: '0.2em' }}><MessageCircle className="size-[1em]" />{post.commentCount}</span> : null}
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
  if (query.isLoading) return <WallpaperWidgetNote>{t({ ko: '불러오는 중…', en: 'Loading…' })}</WallpaperWidgetNote>
  if (query.isError) return <WallpaperWidgetErrorNote error={query.error} />
  const text = query.data?.text ?? ''

  return (
    <div className="flex h-full items-center overflow-hidden">
      <p
        className="line-clamp-6 leading-snug"
        style={{ fontSize: 'max(14px, min(16cqh, 5.5cqw))', fontFamily: widget.settings.typeface === 'serif' ? "'Noto Serif KR',ui-serif,Georgia,serif" : undefined }}
      >
        {text}
      </p>
    </div>
  )
}
