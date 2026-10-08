import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { AlertTriangle, ArrowRight, Ban, ImageOff } from 'lucide-react'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip, TooltipProvider } from '@/components/ui/tooltip'
import { hasAuthPermission } from '@/features/auth/auth-permissions'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { CODEX_CHAT_ROUTE, CODEX_CHAT_THREADS_QUERY_KEY, codexChatThreadQueryKey, defaultThreadId, useCodexChat } from '@/features/codex-chat/codex-chat-context'
import { useI18n } from '@/i18n'
import { buildApiUrl } from '@/lib/api-client'
import type { CodexChatThread } from '@/lib/api-codex-chat'
import { createRuntimeEventStream } from '@/lib/runtime-event-stream'
import type { ChatGenerationFinishedEventPayload, ChatMessageCreatedEventPayload, ChatReactionCreatedEventPayload, RuntimeEventEnvelope } from '@/lib/runtime-events-types'

/** A short retry covers the gap between queue completion and thumbnail post-processing. */
function GenerationThumbnail({ historyId }: { historyId: number }) {
  const [attempt, setAttempt] = useState(0)
  const [failed, setFailed] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  if (failed) return <ImageOff className="size-[18px] text-muted-foreground" />
  return <img
    src={buildApiUrl(`/api/generation-history/${historyId}/thumbnail${attempt ? `?retry=${attempt}` : ''}`)}
    className="h-full w-full object-cover"
    alt=""
    onError={() => {
      if (attempt >= 3) { setFailed(true); return }
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setAttempt((current) => current + 1), 1000 * (attempt + 1))
    }}
  />
}

function ChatGenerationSnackbar({ payload, accountId, message, onOpen }: { payload: ChatGenerationFinishedEventPayload; accountId: number | null; message: string; onOpen: () => void }) {
  const { t } = useI18n()
  const auth = useAuthStatusQuery().data
  // Rich content renders in the global snackbar provider, outside the router and chat contexts.
  if (!auth || (auth.accountId ?? null) !== accountId || (auth.hasCredentials && !auth.authenticated)) return null
  const cancelled = payload.status === 'cancelled'
  const failed = payload.status === 'failed' || payload.failureCode === 'no_image'
  const canViewImages = hasAuthPermission(auth.permissionKeys, 'images.view')
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-[52px] w-10 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-surface-low">
        {cancelled ? <Ban className="size-[18px] text-muted-foreground" /> : failed ? <AlertTriangle className="size-[18px] text-destructive" /> : payload.thumbnailHistoryId !== null && canViewImages
          ? <GenerationThumbnail key={payload.thumbnailHistoryId} historyId={payload.thumbnailHistoryId} />
          : <ImageOff className="size-[18px] text-muted-foreground" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{message}</div>
        <div className="truncate text-xs text-muted-foreground">{payload.chat.threadTitle}</div>
      </div>
      <TooltipProvider>
        <Tip content={t({ ko: '채팅으로 가기', en: 'Go to chat' })}>
          <a href={`#${CODEX_CHAT_ROUTE}`} onClick={(event) => { event.preventDefault(); onOpen() }} aria-label={t({ ko: '채팅으로 가기', en: 'Go to chat' })} className="shrink-0 rounded-sm p-1 text-muted-foreground transition hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/35">
            <ArrowRight className="size-4" />
          </a>
        </Tip>
      </TooltipProvider>
    </div>
  )
}

/** Subscribe beside the query bridge, using the same tab-wide SSE connection. */
export function useChatGenerationNotifications() {
  const chat = useCodexChat()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const auth = useAuthStatusQuery().data
  const accountId = auth?.accountId ?? null
  const canUse = chat?.canUse === true

  const handleEnvelope = useCallback((envelope: RuntimeEventEnvelope) => {
    if (envelope.name === 'chat.reaction.created') {
      const payload = envelope.payload as ChatReactionCreatedEventPayload
      if (!chat?.canUse || !auth || (auth.hasCredentials && !auth.authenticated) || payload.requestedByAccountId !== accountId) return
      void queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(payload.threadId) })
      void queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
      return
    }
    if (envelope.name === 'chat.message.created') {
      const payload = envelope.payload as ChatMessageCreatedEventPayload
      if (!chat?.canUse || !auth || (auth.hasCredentials && !auth.authenticated) || payload.requestedByAccountId !== accountId) return
      // The unread counts live in the chat list. A turn this tab is streaming refetches its chat when it ends; a
      // group room saves members one by one meanwhile, so its transcript is left to that.
      if (chat.liveTurn?.threadId !== payload.threadId) void queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(payload.threadId) })
      void queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
      return
    }
    if (envelope.name !== 'chat.generation.finished' || !chat?.canUse || !auth || (auth.hasCredentials && !auth.authenticated)) return
    const payload = envelope.payload as ChatGenerationFinishedEventPayload
    if (payload.requestedByAccountId !== accountId) return
    const threads = queryClient.getQueryData<CodexChatThread[]>(CODEX_CHAT_THREADS_QUERY_KEY) ?? []
    const selectedThreadId = chat.selectedThreadId === undefined ? defaultThreadId(threads) : chat.selectedThreadId
    const onChatPage = location.pathname === CODEX_CHAT_ROUTE
    const listCoversChat = chat.listOpen && (!onChatPage || window.innerWidth < 768)
    const viewingThread = (onChatPage || (chat.isPanelOpen && location.pathname !== '/wallpaper/runtime')) && !listCoversChat && selectedThreadId === payload.chat.threadId
    if (viewingThread) return

    const characterName = payload.chat.characterName || t({ ko: '캐릭터', en: 'Character' })
    const failed = payload.status === 'failed' || payload.failureCode === 'no_image'
    const outcome = payload.status === 'cancelled' ? t({ ko: '생성 취소됨', en: 'Generation cancelled' })
      : failed ? t({ ko: '생성 실패', en: 'Generation failed' })
        : t({ ko: `이미지 ${payload.imageCount}장 완성`, en: `${payload.imageCount} images ready` })
    const message = `${characterName} · ${outcome}`
    const onOpen = () => {
      chat.selectThread(payload.chat.threadId)
      chat.setView('chat')
      chat.closePanel()
      navigate(CODEX_CHAT_ROUTE)
    }
    showSnackbar({
      key: `chat-generation:${accountId ?? 'local'}:${payload.chat.threadId}:${payload.chat.replyId}`,
      message,
      content: <ChatGenerationSnackbar payload={payload} accountId={accountId} message={message} onOpen={onOpen} />,
      tone: failed ? 'error' : 'info',
      durationMs: 8000,
    })
  }, [accountId, auth, chat, location.pathname, navigate, queryClient, showSnackbar, t])
  const handlerRef = useRef(handleEnvelope)
  handlerRef.current = handleEnvelope

  useEffect(() => {
    if (!canUse) return
    return createRuntimeEventStream({
      onEnvelope: (envelope) => handlerRef.current(envelope),
      onStatusChange: () => {},
      // Replies saved while the stream was down still count as unread.
      onResync: () => { void queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY }) },
      onSessionExpired: () => {},
    })
  }, [accountId, canUse, queryClient])
}
