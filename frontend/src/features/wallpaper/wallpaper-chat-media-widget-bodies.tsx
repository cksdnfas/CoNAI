import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, MessageCircle, Pause, Play, SendHorizontal, SkipForward, Users } from 'lucide-react'
import { useI18n } from '@/i18n'
import { buildApiUrl } from '@/lib/api-client'
import { ApiRequestError } from '@/lib/api-request'
import { sendWallpaperChatMessage } from '@/lib/api-wallpaper-runtime'
import { cn } from '@/lib/utils'
import type { WallpaperWidgetInstance } from './wallpaper-types'
import type { WallpaperChatMessages, WallpaperChatProfile, WallpaperChatThread } from '@/lib/api-wallpaper-runtime'
import {
  useWallpaperAudioCandidates,
  useWallpaperChatMessages,
  useWallpaperChatProfiles,
  useWallpaperChatThreads,
  useWallpaperDataEnvironment,
  useWallpaperPromptRoll,
  useWallpaperRecentPosts,
  WALLPAPER_QUERY_ROOT,
} from './wallpaper-widget-data'
import { getWallpaperWidgetErrorKind, WallpaperWidgetErrorNote, WallpaperWidgetNote } from './wallpaper-widget-note'

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

  if (profilesQuery.isError || threadsQuery.isError) return <WallpaperWidgetErrorNote error={profilesQuery.error ?? threadsQuery.error} />
  if (profilesQuery.isLoading) return <WallpaperWidgetNote>{t({ ko: '불러오는 중…', en: 'Loading…' })}</WallpaperWidgetNote>
  if (!profile) return <WallpaperWidgetNote>{t({ ko: '캐릭터를 골라줘.', en: 'Pick a character.' })}</WallpaperWidgetNote>

  const avatar = apiUrl(profile.avatarThumbnailUrl)
  const background = settings.showCharacterBackground ? apiUrl(profile.backgroundUrl) : null
  const lineClamp = settings.messageLines === 1 ? 'line-clamp-1' : settings.messageLines === 3 ? 'line-clamp-3' : 'overflow-hidden'

  return (
    // Type follows the box (name plus up to three message lines fit the height); the avatar fills it.
    <div className="relative flex h-full items-center gap-[0.9em] overflow-hidden" style={{ fontSize: 'clamp(12px, min(13cqh, 4.4cqw), 30px)' }}>
      {background ? (
        <>
          <img src={background} alt="" className="absolute inset-0 -z-0 h-full w-full object-cover opacity-45" draggable={false} />
          <div className="absolute inset-0 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--background)_70%,transparent),transparent)]" />
        </>
      ) : null}
      {settings.showAvatar ? (
        <div className="relative aspect-square h-[min(100cqh,40cqw)] shrink-0 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--foreground)_12%,transparent)]">
          {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" draggable={false} /> : null}
        </div>
      ) : null}
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-[0.5em]">
          <span className="truncate text-[1.15em] font-semibold">{profile.name}</span>
          {settings.showTyping && running ? (
            <span className="flex shrink-0 items-center gap-[0.35em] text-[0.8em] text-primary"><TypingDots />{t({ ko: '입력 중', en: 'typing' })}</span>
          ) : null}
          {settings.showUnread && (thread?.unreadCount ?? 0) > 0 ? (
            <span className="ml-auto shrink-0 rounded-full bg-primary px-[0.45em] text-[0.72em] font-semibold text-primary-foreground tabular-nums">{thread?.unreadCount}</span>
          ) : null}
        </div>
        {settings.showLastMessage ? (
          <div className={cn('mt-[0.25em] leading-snug opacity-75', lineClamp)}>
            {lastLine || profile.tagline || ''}
          </div>
        ) : profile.tagline ? (
          <div className="mt-[0.25em] truncate opacity-60">{profile.tagline}</div>
        ) : null}
      </div>
    </div>
  )
}

const QUICK_REPLY_LIMIT = 6

/**
 * Reply row under a chat-recent widget that allows replies: one-tap quick replies and a text field. Sending goes
 * through the saved widget on the server (it picks the chat); the reply shows up through the chat feeds.
 */
function ChatReplyBar({ widgetId, threadId, running, quickReplies }: { widgetId: string; threadId: number; running: boolean; quickReplies: string }) {
  const { t } = useI18n()
  const { mode, presetId } = useWallpaperDataEnvironment()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'info' | 'error'; message: string } | null>(null)
  const chips = useMemo(() => quickReplies.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, QUICK_REPLY_LIMIT), [quickReplies])
  const busy = sending || running

  useEffect(() => {
    if (!notice) return undefined
    const timer = window.setTimeout(() => setNotice(null), 6000)
    return () => window.clearTimeout(timer)
  }, [notice])

  /** Server refusals in plain words. */
  const describeError = (error: unknown) => {
    if (getWallpaperWidgetErrorKind(error) === 'sign-in') return t({ ko: '로그인하거나 키가 든 URL이 필요해.', en: 'Sign in or open a URL with a key.' })
    if (error instanceof ApiRequestError) {
      if (error.code === 'tools_not_allowed') return t({ ko: '도구를 쓰는 캐릭터야. 위젯 설정에서 도구 허용을 켜줘.', en: 'This character can use tools; allow tools in the widget settings.' })
      if (error.code === 'chat_changed') return t({ ko: '대화가 바뀌었어. 확인하고 다시 보내줘.', en: 'The chat changed. Check it and send again.' })
      if (error.code === 'chat_running') return t({ ko: '아직 답하는 중이야.', en: 'Still answering.' })
      if (error.status === 403) return t({ ko: '채팅을 보낼 권한이 없어.', en: 'You may not send chats.' })
      if (error.status === 404) return t({ ko: '저장된 월페이퍼의 답장 허용 위젯에서만 보낼 수 있어.', en: 'Only a saved widget that allows replies can send.' })
      if (error.status === 429) return t({ ko: '방금 보냈어. 잠깐 뒤에 다시 보내줘.', en: 'Just sent. Try again in a moment.' })
    }
    return t({ ko: '보내지 못했어.', en: 'Could not send it.' })
  }

  const send = async (text: string) => {
    const message = text.trim()
    if (!message || busy) return
    if (mode !== 'runtime') {
      setNotice({ tone: 'info', message: t({ ko: '실제 월페이퍼에서만 보내져.', en: 'Sends only on the live wallpaper.' }) })
      return
    }
    if (!presetId) {
      setNotice({ tone: 'error', message: t({ ko: '저장된 월페이퍼에서만 보내져.', en: 'Sends only from a saved wallpaper.' }) })
      return
    }
    setSending(true)
    try {
      await sendWallpaperChatMessage(presetId, widgetId, threadId, message)
      if (message === draft.trim()) setDraft('')
      setNotice(null)
    } catch (error) {
      setNotice({ tone: 'error', message: describeError(error) })
    } finally {
      setSending(false)
      // The sent line and the "typing" state show right away; the reply follows through the chat events.
      void queryClient.invalidateQueries({ queryKey: [WALLPAPER_QUERY_ROOT, 'chat-threads'] })
      void queryClient.invalidateQueries({ queryKey: [WALLPAPER_QUERY_ROOT, 'chat-messages'] })
    }
  }

  return (
    <div className="flex shrink-0 flex-col gap-[0.45em]">
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-[0.35em]">
          {chips.map((chip) => (
            // eslint-disable-next-line no-restricted-syntax -- wallpaper chip sized by the widget's own type scale
            <button
              key={chip}
              type="button"
              disabled={busy}
              onClick={() => void send(chip)}
              className="max-w-full truncate rounded-full bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)] px-[0.75em] py-[0.25em] text-[0.85em] transition-colors hover:bg-[color-mix(in_srgb,var(--primary)_28%,transparent)] disabled:opacity-50"
            >
              {chip}
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="flex items-center gap-[0.4em] rounded-full bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] py-[0.2em] pr-[0.25em] pl-[0.9em] focus-within:bg-[color-mix(in_srgb,var(--foreground)_13%,transparent)]"
        onSubmit={(event) => {
          event.preventDefault()
          void send(draft)
        }}
      >
        <input
          value={draft}
          maxLength={500}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={running ? t({ ko: '답하는 중…', en: 'Answering…' }) : t({ ko: '메시지', en: 'Message' })}
          aria-label={t({ ko: '메시지', en: 'Message' })}
          className="min-w-0 flex-1 bg-transparent py-[0.3em] outline-none placeholder:opacity-50"
        />
        {/* eslint-disable-next-line no-restricted-syntax -- wallpaper action sized by the widget's own type scale */}
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          aria-label={t({ ko: '보내기', en: 'Send' })}
          title={t({ ko: '보내기', en: 'Send' })}
          className="flex size-[1.9em] shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-[filter,opacity] hover:brightness-110 disabled:opacity-40"
        >
          <SendHorizontal className="size-[0.95em]" />
        </button>
      </form>
      {notice ? (
        <div role="status" className={cn('truncate px-[0.6em] text-[0.78em]', notice.tone === 'error' ? 'text-destructive' : 'opacity-70')}>{notice.message}</div>
      ) : null}
    </div>
  )
}

const CHAT_TYPE_SCALE = 'clamp(12px, min(5cqh, 3.6cqw), 22px)'

/** A chat's last messages, bottom-anchored: when the box is short the oldest clip first. */
function ChatMessageList({ messages, running, threadProfileId, profileById }: {
  messages: WallpaperChatMessages['messages']
  running: boolean
  threadProfileId: number | null
  profileById: Map<number, WallpaperChatProfile>
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [messages.length])

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col justify-end gap-[0.65em] overflow-hidden">
      {messages.map((message) => {
        const speaker = message.role === 'assistant'
          ? profileById.get(message.speakerProfileId ?? threadProfileId ?? -1)
          : null
        const avatar = apiUrl(speaker?.avatarThumbnailUrl)
        if (message.role === 'user') {
          return (
            <div key={message.id} className="ml-[18%] shrink-0 self-end rounded-[1em] rounded-br-[0.3em] bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)] px-[0.75em] py-[0.35em]">
              <span className="line-clamp-3">{plainText(message.text)}</span>
            </div>
          )
        }
        return (
          <div key={message.id} className="mr-[12%] flex shrink-0 items-start gap-[0.5em]">
            <span className="size-[1.7em] shrink-0 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--foreground)_12%,transparent)]">
              {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" draggable={false} /> : null}
            </span>
            <div className="min-w-0">
              {speaker ? <div className="text-[0.72em] font-semibold opacity-60">{speaker.name}</div> : null}
              <div className="line-clamp-4">{plainText(message.text)}</div>
            </div>
          </div>
        )
      })}
      {running ? <div className="shrink-0 pl-[2.2em] opacity-70"><TypingDots /></div> : null}
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

  if (threadsQuery.isError) return <WallpaperWidgetErrorNote error={threadsQuery.error} />
  if (threadsQuery.isLoading) return <WallpaperWidgetNote>{t({ ko: '불러오는 중…', en: 'Loading…' })}</WallpaperWidgetNote>
  if (!thread) return <WallpaperWidgetNote>{t({ ko: '아직 대화가 없어.', en: 'No chats yet.' })}</WallpaperWidgetNote>

  const running = messagesQuery.data?.running ?? thread.running

  return (
    <div className="flex h-full flex-col gap-[0.65em]" style={{ fontSize: CHAT_TYPE_SCALE }}>
      <ChatMessageList messages={messagesQuery.data?.messages ?? []} running={running} threadProfileId={thread.profileId} profileById={profileById} />
      {widget.settings.allowReply ? (
        <ChatReplyBar widgetId={widget.id} threadId={thread.id} running={running} quickReplies={widget.settings.quickReplies ?? ''} />
      ) : null}
    </div>
  )
}

/** A chat row's time: the clock today, month/day before (server times are SQLite UTC text). */
function chatRowTime(value: string) {
  const date = new Date(/[zZ]$|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return ''
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: 'numeric', day: 'numeric' })
}

function ChatAvatar({ thread, profile }: { thread: WallpaperChatThread; profile: WallpaperChatProfile | undefined }) {
  const avatar = thread.kind === 'group' ? null : apiUrl(profile?.avatarThumbnailUrl)
  return (
    <span className="flex size-[2.3em] shrink-0 items-center justify-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--foreground)_12%,transparent)]">
      {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" draggable={false} /> : thread.kind === 'group' ? <Users className="size-[1.1em] opacity-70" /> : null}
    </span>
  )
}

/** A small messenger: the account's chats newest first; a row opens that chat, the back arrow returns. */
export function WallpaperChatInboxBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'chat-inbox' }> }) {
  const { t } = useI18n()
  const settings = widget.settings
  const profilesQuery = useWallpaperChatProfiles()
  const threadsQuery = useWallpaperChatThreads(settings.profileId, Math.max(1, Math.min(30, settings.listCount)))
  const [openId, setOpenId] = useState<number | null>(null)
  const threads = threadsQuery.data ?? []
  // A chat that left the list (archived, pushed out by newer ones) closes back to the list.
  const open = openId === null ? null : threads.find((thread) => thread.id === openId) ?? null
  const messagesQuery = useWallpaperChatMessages(open?.id ?? null, Math.max(1, Math.min(12, settings.messageCount)), open?.running === true)
  const profileById = useMemo(() => new Map((profilesQuery.data ?? []).map((profile) => [profile.id, profile])), [profilesQuery.data])
  const nameOf = (thread: WallpaperChatThread) => (thread.kind === 'group' ? thread.title : profileById.get(thread.profileId ?? -1)?.name ?? thread.title)

  if (threadsQuery.isError) return <WallpaperWidgetErrorNote error={threadsQuery.error} />
  if (threadsQuery.isLoading) return <WallpaperWidgetNote>{t({ ko: '불러오는 중…', en: 'Loading…' })}</WallpaperWidgetNote>
  if (threads.length === 0) return <WallpaperWidgetNote>{t({ ko: '아직 대화가 없어.', en: 'No chats yet.' })}</WallpaperWidgetNote>

  if (open) {
    const running = messagesQuery.data?.running ?? open.running
    return (
      <div className="flex h-full flex-col gap-[0.6em]" style={{ fontSize: CHAT_TYPE_SCALE }}>
        <div className="flex shrink-0 items-center gap-[0.5em]">
          {/* eslint-disable-next-line no-restricted-syntax -- wallpaper action sized by the widget's own type scale */}
          <button
            type="button"
            onClick={() => setOpenId(null)}
            aria-label={t({ ko: '목록으로', en: 'Back to list' })}
            title={t({ ko: '목록으로', en: 'Back to list' })}
            className="-ml-[0.3em] flex size-[1.9em] shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)]"
          >
            <ChevronLeft className="size-[1.2em]" />
          </button>
          <ChatAvatar thread={open} profile={profileById.get(open.profileId ?? -1)} />
          <span className="min-w-0 flex-1 truncate font-semibold">{nameOf(open)}</span>
        </div>
        {messagesQuery.isError ? (
          <WallpaperWidgetErrorNote error={messagesQuery.error} />
        ) : (
          <ChatMessageList messages={messagesQuery.data?.messages ?? []} running={running} threadProfileId={open.profileId} profileById={profileById} />
        )}
        {settings.allowReply ? (
          <ChatReplyBar widgetId={widget.id} threadId={open.id} running={running} quickReplies={settings.quickReplies ?? ''} />
        ) : null}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-[0.15em] overflow-hidden" style={{ fontSize: CHAT_TYPE_SCALE }}>
      {threads.map((thread) => (
        // eslint-disable-next-line no-restricted-syntax -- wallpaper list row sized by the widget's own type scale
        <button
          key={thread.id}
          type="button"
          onClick={() => setOpenId(thread.id)}
          className="flex w-full shrink-0 items-center gap-[0.65em] rounded-[0.7em] px-[0.4em] py-[0.4em] text-left transition-colors hover:bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)]"
        >
          <ChatAvatar thread={thread} profile={profileById.get(thread.profileId ?? -1)} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-[0.5em]">
              <span className="min-w-0 truncate font-semibold">{nameOf(thread)}</span>
              <span className="ml-auto shrink-0 text-[0.72em] tabular-nums opacity-55">{chatRowTime(thread.updatedAt)}</span>
            </span>
            <span className="flex items-center gap-[0.5em]">
              <span className="min-w-0 flex-1 truncate text-[0.86em] opacity-70">
                {thread.running ? <TypingDots /> : plainText(thread.preview ?? '')}
              </span>
              {thread.unreadCount > 0 ? (
                <span className="shrink-0 rounded-full bg-primary px-[0.45em] text-[0.7em] font-semibold text-primary-foreground tabular-nums">{thread.unreadCount}</span>
              ) : null}
            </span>
          </span>
        </button>
      ))}
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
            <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--foreground)_14%,transparent)]">
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
      className="flex h-full flex-col divide-y divide-[color-mix(in_srgb,var(--foreground)_10%,transparent)] overflow-hidden"
      style={{ fontSize: `clamp(12px, min(${(100 / (posts.length * rowEm)).toFixed(2)}cqh, 3.6cqw), 24px)` }}
    >
      {posts.map((post) => {
        const cover = widget.settings.showCover ? apiUrl(post.coverUrl) : null
        return (
          <div key={post.id} className="flex shrink-0 items-center gap-[0.75em] py-[0.5em] first:pt-0 last:pb-0">
            {cover ? <img src={cover} alt="" className="size-[3.2em] shrink-0 rounded-[0.4em] object-cover" draggable={false} /> : null}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{post.title || plainText(post.excerpt ?? '')}</div>
              <div className="mt-[0.15em] flex items-center gap-[0.6em] text-[0.75em] opacity-60">
                <span className="truncate">{post.authorName}</span>
                <span className="shrink-0">{formatDateTime(post.publishedAt, { month: 'short', day: 'numeric' })}</span>
                {post.commentCount > 0 ? <span className="flex shrink-0 items-center gap-[0.2em]"><MessageCircle className="size-[1em]" />{post.commentCount}</span> : null}
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
        className={cn('line-clamp-6 leading-snug', widget.settings.typeface === 'serif' ? "[font-family:'Noto_Serif_KR',ui-serif,Georgia,serif]" : null)}
        style={{ fontSize: 'max(14px, min(16cqh, 5.5cqw))' }}
      >
        {text}
      </p>
    </div>
  )
}
