import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUp, LayoutGrid, Maximize2, Minimize2, Plus, SlidersHorizontal, Square, Trash2, TriangleAlert, X } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import {
  CHAT_PROFILES_QUERY_KEY,
  deleteCodexChatThread,
  getCodexChatThread,
  listChatProfiles,
  listCodexChatThreads,
  type ChatProfileSummary,
  type CodexChatMessage,
  type CodexChatThread,
} from '@/lib/api-codex-chat'
import { getCodexGenerationStatus } from '@/lib/api-image-generation-queue'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { ChatProfileAvatar } from './chat-profile-avatar'
import {
  CODEX_CHAT_THREADS_QUERY_KEY,
  codexChatMediaQueryKey,
  codexChatThreadQueryKey,
  useCodexChat,
  type CodexChatApi,
} from './codex-chat-context'
import { CodexChatContextView } from './codex-chat-context-view'
import { CodexChatGallery } from './codex-chat-gallery'
import { CodexChatAssistantMessage, CodexChatUserMessage, type ChatSpeaker } from './codex-chat-message'

const RUNNING_POLL_MS = 2000
const COMPOSER_MAX_HEIGHT_PX = 220
const MESSAGE_FLASH_MS = 1600

type CodexChatLayout = 'panel' | 'page'

interface CodexChatViewProps {
  layout: CodexChatLayout
  /** Panel: close it. */
  onClose?: () => void
  /** Panel: open the full /chat page. */
  onExpand?: () => void
  /** Page: fold back into the side panel. */
  onCollapse?: () => void
}

/** Chat with a profile (server Codex or an API LLM), as the side panel or the /chat page. Agents act only through CoNAI MCP tools. */
export function CodexChatView(props: CodexChatViewProps) {
  const chat = useCodexChat()
  return chat ? <CodexChatViewContent chat={chat} {...props} /> : null
}

/** "+": pick the profile of a new chat. */
function NewChatMenu({ profiles, disabled, onPick }: { profiles: ChatProfileSummary[]; disabled: boolean; onPick: (profileId: number) => void }) {
  const { t } = useI18n()
  const usable = profiles.filter((profile) => profile.usable)
  return (
    <DropdownMenu>
      <Tip content={t({ ko: '새 채팅', en: 'New chat' })}>
        <DropdownMenuTrigger asChild>
          <IconButton variant="ghost" size="icon-sm" disabled={disabled || usable.length === 0} label={t({ ko: '새 채팅', en: 'New chat' })} tooltip={false}>
            <Plus />
          </IconButton>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuLabel>{t({ ko: '새 채팅', en: 'New chat' })}</DropdownMenuLabel>
        {usable.map((profile) => (
          <DropdownMenuItem key={profile.id} onSelect={() => onPick(profile.id)}>
            <ChatProfileAvatar name={profile.name} avatar={profile.avatar} engine={profile.engine} size="sm" />
            <span className="truncate">{profile.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** No chat yet: the usable profiles as big choices. */
function ProfilePicker({ profiles, disabled, onPick }: { profiles: ChatProfileSummary[]; disabled: boolean; onPick: (profileId: number) => void }) {
  const { t } = useI18n()
  const usable = profiles.filter((profile) => profile.usable)
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-6">
      <p className="text-sm text-muted-foreground">
        {usable.length > 0 ? t({ ko: '누구랑 이야기할까?', en: 'Who do you want to talk to?' }) : t({ ko: '쓸 수 있는 채팅 프로필이 없어.', en: 'No chat profile you can use.' })}
      </p>
      <div className="flex w-full max-w-sm flex-col gap-1">
        {usable.map((profile) => (
          <ListRow key={profile.id} asChild interactive>
            <button type="button" disabled={disabled} onClick={() => onPick(profile.id)} className="w-full gap-3 disabled:opacity-50">
              <ChatProfileAvatar name={profile.name} avatar={profile.avatar} engine={profile.engine} size="md" />
              <span className="truncate font-medium">{profile.name}</span>
            </button>
          </ListRow>
        ))}
      </div>
    </div>
  )
}

function ThreadSelect({ threads, activeThreadId, disabled, onSelect, className }: {
  threads: CodexChatThread[]
  activeThreadId: number | null
  disabled: boolean
  onSelect: (threadId: number) => void
  className?: string
}) {
  const { t } = useI18n()
  const untitled = t({ ko: '새 채팅', en: 'New chat' })
  return (
    <Select
      value={activeThreadId ?? ''}
      onChange={(event) => event.target.value && onSelect(Number(event.target.value))}
      disabled={disabled}
      className={cn('min-w-0 flex-1 truncate border-transparent bg-transparent px-2 font-semibold hover:bg-fill', className)}
      aria-label={t({ ko: '채팅 목록', en: 'Chats' })}
    >
      {activeThreadId === null ? <option value="">{untitled}</option> : null}
      {threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title || untitled}</option>)}
    </Select>
  )
}

function CodexChatViewContent({ chat, layout, onClose, onExpand, onCollapse }: CodexChatViewProps & { chat: CodexChatApi }) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const [flashMessageId, setFlashMessageId] = useState<number | null>(null)
  const { liveTurn, selectedThreadId, selectThread, draft, setDraft, view, setView, messageFocus, clearMessageFocus, startChat, isStartingChat } = chat

  const profilesQuery = useQuery({ queryKey: CHAT_PROFILES_QUERY_KEY, queryFn: listChatProfiles, staleTime: 30_000 })
  const profiles = useMemo(() => profilesQuery.data ?? [], [profilesQuery.data])
  const profilesById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles])

  const threadsQuery = useQuery({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY, queryFn: listCodexChatThreads })
  const threads = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data])
  const activeThreadId = selectedThreadId === undefined ? threads[0]?.id ?? null : selectedThreadId
  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? null

  const threadQuery = useQuery({
    queryKey: codexChatThreadQueryKey(activeThreadId),
    queryFn: () => getCodexChatThread(activeThreadId as number),
    enabled: activeThreadId !== null,
    // A turn started before a reload keeps running on the server; poll until it is stored.
    refetchInterval: (query) => (query.state.data?.running && !liveTurn ? RUNNING_POLL_MS : false),
  })
  const thread = threadQuery.data?.thread ?? activeThread
  const profile = thread?.profile_id ? profilesById.get(thread.profile_id) ?? null : null
  const isCodexThread = thread?.engine !== 'llm'
  const speaker: ChatSpeaker | null = profile ? { name: profile.name, avatar: profile.avatar, engine: profile.engine } : null

  const codexStatusQuery = useQuery({ queryKey: ['codex-generation-status'], queryFn: getCodexGenerationStatus, staleTime: 30_000, enabled: isCodexThread && thread !== null })
  const codexStatus = codexStatusQuery.data?.data ?? null

  const isStreaming = liveTurn !== null
  const serverRunning = Boolean(threadQuery.data?.running) && !isStreaming
  const isBusy = isStreaming || serverRunning
  const messages: CodexChatMessage[] = useMemo(() => threadQuery.data?.messages ?? [], [threadQuery.data?.messages])
  const media = threadQuery.data?.media
  const runningFromServer = serverRunning ? threadQuery.data?.running ?? null : null
  const activeView = activeThreadId === null ? 'chat' : view === 'context' && isCodexThread ? 'chat' : view
  const isTranscript = activeView === 'chat'

  const deleteMutation = useMutation({
    mutationFn: deleteCodexChatThread,
    onSuccess: async (_result, threadId) => {
      queryClient.removeQueries({ queryKey: codexChatThreadQueryKey(threadId) })
      queryClient.removeQueries({ queryKey: codexChatMediaQueryKey(threadId) })
      selectThread(undefined)
      await queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '삭제 실패', en: 'Delete failed' })), tone: 'error' }),
  })

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current
    if (node) {
      node.scrollTop = node.scrollHeight
    }
  }, [])

  useEffect(() => {
    if (isTranscript) {
      scrollToBottom()
    }
  }, [isTranscript, messages.length, liveTurn?.text, liveTurn?.toolCalls.size, threadQuery.data?.running?.text, scrollToBottom])

  // "Go to message" from the gallery: once the transcript is back, centre that message and flash it.
  useEffect(() => {
    if (!messageFocus || !isTranscript) {
      return
    }
    const node = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${messageFocus.messageId}"]`)
    if (!node) {
      return
    }
    node.scrollIntoView({ block: 'center' })
    setFlashMessageId(messageFocus.messageId)
    clearMessageFocus()
  }, [clearMessageFocus, isTranscript, messageFocus, messages])

  useEffect(() => {
    if (flashMessageId === null) {
      return
    }
    const timer = window.setTimeout(() => setFlashMessageId(null), MESSAGE_FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flashMessageId])

  useLayoutEffect(() => {
    const node = composerRef.current
    if (!node) {
      return
    }
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`
  }, [draft, isTranscript])

  const profileMissing = thread !== null && (!profile || !profile.isEnabled)
  const codexUnavailable = isCodexThread && !codexStatus?.available
  const canSend = activeThreadId !== null && Boolean(draft.trim()) && !isBusy && !profileMissing && !codexUnavailable

  const handleSend = () => {
    if (canSend && activeThreadId !== null) {
      void chat.send(activeThreadId)
    }
  }

  const handleDelete = async () => {
    if (activeThreadId === null) {
      return
    }
    const confirmed = await confirm({
      title: t({ ko: '채팅 삭제', en: 'Delete chat' }),
      description: t({ ko: '이 채팅 기록을 지울까? 생성된 이미지는 남아.', en: 'Delete this chat? Generated images stay.' }),
      confirmLabel: t({ ko: '삭제', en: 'Delete' }),
      tone: 'destructive',
    })
    if (confirmed) {
      deleteMutation.mutate(activeThreadId)
    }
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter breaks the line. Ignore Enter that commits an IME (Korean) composition.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      handleSend()
    }
  }

  const untitled = t({ ko: '새 채팅', en: 'New chat' })
  const pickProfile = (profileId: number) => void startChat(profileId)

  const contextButton = thread && !isCodexThread ? (
    <IconButton variant="ghost" size="icon-sm" active={activeView === 'context'} onClick={() => setView(activeView === 'context' ? 'chat' : 'context')} label={t({ ko: '컨텍스트', en: 'Context' })}>
      <SlidersHorizontal />
    </IconButton>
  ) : null
  const galleryButton = activeThreadId !== null ? (
    <IconButton variant="ghost" size="icon-sm" active={activeView === 'gallery'} onClick={() => setView(activeView === 'gallery' ? 'chat' : 'gallery')} label={t({ ko: '이미지 모아보기', en: 'Image gallery' })}>
      <LayoutGrid />
    </IconButton>
  ) : null
  const newChatButton = <NewChatMenu profiles={profiles} disabled={isBusy || isStartingChat} onPick={pickProfile} />
  const deleteButton = (
    <IconButton variant="ghost" size="icon-sm" onClick={() => void handleDelete()} disabled={activeThreadId === null || isBusy || deleteMutation.isPending} label={t({ ko: '채팅 삭제', en: 'Delete chat' })}>
      <Trash2 />
    </IconButton>
  )
  const headerAvatar = speaker ? <ChatProfileAvatar name={speaker.name} avatar={speaker.avatar} engine={speaker.engine} size="sm" /> : null

  const transcript = (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn('mx-auto flex flex-col gap-6 pb-6', layout === 'page' ? 'max-w-3xl px-4 pt-2 sm:px-6' : 'px-4 pt-3')}>
        {messages.map((message) => (
          <div
            key={message.id}
            data-message-id={message.id}
            className={cn('-mx-2 rounded-md px-2 transition-colors duration-500', flashMessageId === message.id && 'bg-primary/10')}
          >
            {message.role === 'user'
              ? <CodexChatUserMessage content={message.content} />
              : <CodexChatAssistantMessage content={message.content} toolCalls={message.tool_calls} status={message.status} error={message.error} largeThumbnails={layout === 'page'} speaker={speaker} media={media} />}
          </div>
        ))}
        {liveTurn && liveTurn.threadId === activeThreadId ? (
          <>
            <CodexChatUserMessage content={liveTurn.userText} />
            <CodexChatAssistantMessage content={liveTurn.text} toolCalls={[...liveTurn.toolCalls.values()]} reasoning={liveTurn.reasoning} streaming largeThumbnails={layout === 'page'} speaker={speaker} />
          </>
        ) : null}
        {runningFromServer ? <CodexChatAssistantMessage content={runningFromServer.text} toolCalls={runningFromServer.toolCalls} streaming largeThumbnails={layout === 'page'} speaker={speaker} /> : null}
      </div>
    </div>
  )

  const warning = profileMissing
    ? t({ ko: '이 채팅의 프로필이 지워졌거나 꺼져 있어.', en: 'This chat’s profile was deleted or turned off.' })
    : codexUnavailable && !codexStatusQuery.isPending
      ? codexStatus?.installed
        ? t({ ko: 'Codex 로그인이 필요해.', en: 'Codex sign-in needed.' })
        : t({ ko: 'Codex가 설치돼 있지 않아.', en: 'Codex is not installed.' })
      : null

  const composer = (
    <div className={cn('w-full shrink-0 pb-4 pt-2', layout === 'page' ? 'mx-auto max-w-3xl px-4 sm:px-6' : 'px-3')}>
      {warning ? <p className="mb-2 flex items-center gap-1.5 text-xs text-warning"><TriangleAlert className="size-3.5 shrink-0" />{warning}</p> : null}
      <div className="flex items-end gap-2 rounded-lg border border-line px-3 py-2 focus-within:border-primary/55">
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          rows={1}
          placeholder={profile ? t({ ko: '{name}에게 메시지', en: 'Message {name}' }, { name: profile.name }) : t({ ko: '메시지', en: 'Message' })}
          aria-label={t({ ko: '메시지', en: 'Message' })}
          className="block min-h-0 flex-1 resize-none bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {isBusy ? (
          <IconButton variant="secondary" size="icon-sm" className="rounded-full" onClick={() => activeThreadId !== null && chat.stop(activeThreadId)} label={t({ ko: '중단', en: 'Stop' })}>
            <Square />
          </IconButton>
        ) : (
          <IconButton variant="default" size="icon-sm" className="rounded-full" onClick={handleSend} disabled={!canSend} label={t({ ko: '보내기', en: 'Send' })}>
            <ArrowUp />
          </IconButton>
        )}
      </div>
    </div>
  )

  let body: ReactNode
  if (activeThreadId === null || !thread) {
    body = threadsQuery.isPending ? null : <ProfilePicker profiles={profiles} disabled={isStartingChat} onPick={pickProfile} />
  } else if (activeView === 'gallery') {
    body = <CodexChatGallery threadId={activeThreadId} columns={layout === 'page' ? 'wide' : 'narrow'} />
  } else if (activeView === 'context') {
    body = <CodexChatContextView thread={thread} profileTurns={profile?.contextTurns ?? null} profileSummaryEnabled={profile?.summaryEnabled ?? null} />
  } else {
    body = <>{transcript}{composer}</>
  }

  const viewTitle = activeView === 'gallery'
    ? t({ ko: '이미지 모아보기', en: 'Image gallery' })
    : activeView === 'context'
      ? t({ ko: '컨텍스트', en: 'Context' })
      : thread ? thread.title || untitled : untitled

  if (layout === 'page') {
    return (
      <div className="flex min-h-0 flex-1">
        <nav aria-label={t({ ko: '채팅 목록', en: 'Chats' })} className="hidden w-60 shrink-0 flex-col gap-1 border-r border-line py-2 pr-3 md:flex">
          <div className="flex items-center justify-between pb-1 pl-2">
            <span className="text-xs font-semibold text-muted-foreground">{t({ ko: '채팅', en: 'Chats' })}</span>
            {newChatButton}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {threads.map((entry) => {
              const entryProfile = entry.profile_id ? profilesById.get(entry.profile_id) : undefined
              return (
                <ListRow key={entry.id} asChild interactive size="sm" selected={entry.id === activeThreadId}>
                  <button type="button" onClick={() => selectThread(entry.id)} disabled={isBusy && entry.id !== activeThreadId} className="w-full gap-2 disabled:opacity-50">
                    {entryProfile ? <ChatProfileAvatar name={entryProfile.name} avatar={entryProfile.avatar} engine={entryProfile.engine} size="xs" /> : null}
                    <span className="truncate">{entry.title || untitled}</span>
                  </button>
                </ListRow>
              )
            })}
          </div>
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-1 pl-4 sm:pl-6">
            <span className="md:hidden">{headerAvatar}</span>
            <ThreadSelect className="md:hidden" threads={threads} activeThreadId={activeThreadId} disabled={isBusy} onSelect={selectThread} />
            <span className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
              {headerAvatar}
              <span className="truncate text-sm font-semibold">{viewTitle}</span>
            </span>
            {contextButton}
            {galleryButton}
            <span className="md:hidden">{newChatButton}</span>
            {onCollapse ? (
              <IconButton variant="ghost" size="icon-sm" className="hidden lg:inline-flex" onClick={onCollapse} label={t({ ko: '패널로 접기', en: 'Fold into panel' })}>
                <Minimize2 />
              </IconButton>
            ) : null}
            {deleteButton}
          </div>
          {body}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-0.5 border-b border-line pl-2.5 pr-1.5">
        {headerAvatar}
        <ThreadSelect threads={threads} activeThreadId={activeThreadId} disabled={isBusy} onSelect={selectThread} />
        {contextButton}
        {galleryButton}
        {newChatButton}
        {deleteButton}
        {onExpand ? (
          <IconButton variant="ghost" size="icon-sm" className="hidden lg:inline-flex" onClick={onExpand} label={t({ ko: '전체 페이지로 열기', en: 'Open full page' })}>
            <Maximize2 />
          </IconButton>
        ) : null}
        {onClose ? (
          <IconButton variant="ghost" size="icon-sm" onClick={onClose} label={t({ ko: '닫기', en: 'Close' })}>
            <X />
          </IconButton>
        ) : null}
      </div>
      {activeView !== 'chat' && thread ? (
        <div className="flex h-10 shrink-0 items-center gap-1 px-1.5">
          <IconButton variant="ghost" size="icon-sm" onClick={() => setView('chat')} label={t({ ko: '채팅으로 돌아가기', en: 'Back to chat' })}>
            <ArrowLeft />
          </IconButton>
          <span className="truncate text-sm font-semibold">{viewTitle}</span>
        </div>
      ) : null}
      {body}
    </div>
  )
}
