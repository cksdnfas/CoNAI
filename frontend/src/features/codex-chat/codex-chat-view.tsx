import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, LayoutGrid, Maximize2, Minimize2, Plus, Square, Trash2, TriangleAlert, X } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { CodexModelSelect } from '@/features/image-generation/components/codex-model-select'
import { CodexReasoningSelect } from '@/features/image-generation/components/codex-reasoning-select'
import { useI18n } from '@/i18n'
import {
  CODEX_CHAT_SETTINGS_QUERY_KEY,
  deleteCodexChatThread,
  getCodexChatSettings,
  getCodexChatThread,
  listCodexChatThreads,
  updateCodexChatSettings,
  type CodexChatMessage,
} from '@/lib/api-codex-chat'
import { getCodexGenerationModels, getCodexGenerationStatus } from '@/lib/api-image-generation-queue'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import {
  CODEX_CHAT_THREADS_QUERY_KEY,
  codexChatMediaQueryKey,
  codexChatThreadQueryKey,
  useCodexChat,
  type CodexChatApi,
} from './codex-chat-context'
import { CodexChatGallery } from './codex-chat-gallery'
import { CodexChatAssistantMessage, CodexChatUserMessage } from './codex-chat-message'

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

/** Admin chat with the server's Codex CLI, as the side panel or the /chat page. Codex acts only through CoNAI MCP tools. */
export function CodexChatView(props: CodexChatViewProps) {
  const chat = useCodexChat()
  return chat ? <CodexChatViewContent chat={chat} {...props} /> : null
}

function CodexChatViewContent({ chat, layout, onClose, onExpand, onCollapse }: CodexChatViewProps & { chat: CodexChatApi }) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const [flashMessageId, setFlashMessageId] = useState<number | null>(null)
  const { liveTurn, selectedThreadId, selectThread, draft, setDraft, view, setView, messageFocus, clearMessageFocus } = chat

  const codexStatusQuery = useQuery({ queryKey: ['codex-generation-status'], queryFn: getCodexGenerationStatus, staleTime: 30_000 })
  const codexStatus = codexStatusQuery.data?.data ?? null
  const settingsQuery = useQuery({ queryKey: CODEX_CHAT_SETTINGS_QUERY_KEY, queryFn: getCodexChatSettings })
  const modelsQuery = useQuery({ queryKey: ['codex-generation-models'], queryFn: getCodexGenerationModels, staleTime: 5 * 60 * 1000 })
  const settingsUpdate = useMutation({
    mutationFn: updateCodexChatSettings,
    onSuccess: (settings) => queryClient.setQueryData(CODEX_CHAT_SETTINGS_QUERY_KEY, settings),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '설정을 저장하지 못했어.', en: 'Could not save settings.' })), tone: 'error' }),
  })
  const settings = settingsQuery.data

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

  const isStreaming = liveTurn !== null
  const serverRunning = Boolean(threadQuery.data?.running) && !isStreaming
  const isBusy = isStreaming || serverRunning
  const messages: CodexChatMessage[] = useMemo(() => threadQuery.data?.messages ?? [], [threadQuery.data?.messages])
  const runningFromServer = serverRunning ? threadQuery.data?.running ?? null : null
  const isGallery = view === 'gallery' && activeThreadId !== null

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
    if (!isGallery) {
      scrollToBottom()
    }
  }, [isGallery, messages.length, liveTurn?.text, liveTurn?.toolCalls.size, threadQuery.data?.running?.text, scrollToBottom])

  // "Go to message" from the gallery: once the transcript is back, centre that message and flash it.
  useEffect(() => {
    if (!messageFocus || isGallery) {
      return
    }
    const node = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${messageFocus.messageId}"]`)
    if (!node) {
      return
    }
    node.scrollIntoView({ block: 'center' })
    setFlashMessageId(messageFocus.messageId)
    clearMessageFocus()
  }, [clearMessageFocus, isGallery, messageFocus, messages])

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
  }, [draft, isGallery])

  const handleSend = () => {
    if (!draft.trim() || isBusy || settingsUpdate.isPending || !codexStatus?.available) {
      return
    }
    void chat.send(activeThreadId)
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

  const newChatLabel = t({ ko: '새 채팅', en: 'New chat' })
  const threadTitle = (title: string | undefined) => title || newChatLabel

  const galleryButton = activeThreadId !== null ? (
    <IconButton variant="ghost" size="icon-sm" active={isGallery} onClick={() => setView(isGallery ? 'chat' : 'gallery')} label={t({ ko: '이미지 모아보기', en: 'Image gallery' })}>
      <LayoutGrid />
    </IconButton>
  ) : null
  const newChatButton = (
    <IconButton variant="ghost" size="icon-sm" onClick={() => selectThread(null)} disabled={isBusy} label={newChatLabel}>
      <Plus />
    </IconButton>
  )
  const deleteButton = (
    <IconButton variant="ghost" size="icon-sm" onClick={() => void handleDelete()} disabled={activeThreadId === null || isBusy || deleteMutation.isPending} label={t({ ko: '채팅 삭제', en: 'Delete chat' })}>
      <Trash2 />
    </IconButton>
  )

  const transcript = (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn('mx-auto flex flex-col gap-6 pb-6', layout === 'page' ? 'max-w-3xl px-4 pt-2 sm:px-6' : 'px-4 pt-2')}>
        {messages.map((message) => (
          <div
            key={message.id}
            data-message-id={message.id}
            className={cn('-mx-2 rounded-md px-2 transition-colors duration-500', flashMessageId === message.id && 'bg-primary/10')}
          >
            {message.role === 'user'
              ? <CodexChatUserMessage content={message.content} />
              : <CodexChatAssistantMessage content={message.content} toolCalls={message.tool_calls} status={message.status} error={message.error} largeThumbnails={layout === 'page'} />}
          </div>
        ))}
        {liveTurn && liveTurn.threadId === activeThreadId ? (
          <>
            <CodexChatUserMessage content={liveTurn.userText} />
            <CodexChatAssistantMessage content={liveTurn.text} toolCalls={[...liveTurn.toolCalls.values()]} streaming largeThumbnails={layout === 'page'} />
          </>
        ) : null}
        {runningFromServer ? <CodexChatAssistantMessage content={runningFromServer.text} toolCalls={runningFromServer.toolCalls} streaming largeThumbnails={layout === 'page'} /> : null}
      </div>
    </div>
  )

  const settingsHint = t({ ko: '서버 공통 설정 · 바꾸면 진행 중인 다른 채팅도 중단돼.', en: 'Server-wide setting · changing it also stops other running chats.' })
  const compactSelectClassName = 'h-7 w-auto max-w-[11rem] border-transparent bg-transparent px-1.5 text-xs text-muted-foreground hover:text-foreground'
  const statusWarning = codexStatusQuery.isPending || codexStatus?.available
    ? null
    : codexStatus?.installed
      ? t({ ko: 'Codex 로그인이 필요해.', en: 'Codex sign-in needed.' })
      : t({ ko: 'Codex가 설치돼 있지 않아.', en: 'Codex is not installed.' })

  const composer = (
    <div className={cn('w-full shrink-0 pb-4 pt-2', layout === 'page' ? 'mx-auto max-w-3xl px-4 sm:px-6' : 'px-3')}>
      {statusWarning ? (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-warning"><TriangleAlert className="size-3.5 shrink-0" />{statusWarning}</p>
      ) : null}
      {settingsQuery.isError ? <p className="mb-2 text-xs text-destructive">{t({ ko: '채팅 설정을 불러오지 못했어.', en: 'Could not load chat settings.' })}</p> : null}
      <div className="rounded-lg border border-line px-3 pb-2 pt-1.5 focus-within:border-primary/55">
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          rows={1}
          placeholder={t({ ko: 'Codex에게 요청하기', en: 'Ask Codex' })}
          aria-label={t({ ko: '메시지', en: 'Message' })}
          className="block min-h-0 w-full resize-none bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="flex items-center gap-1">
          {settings ? (
            <>
              <Tip content={settingsHint} side="top" align="start">
                <span className="min-w-0">
                  <CodexModelSelect
                    value={settings.model}
                    models={modelsQuery.data?.data.models}
                    onChange={(model) => settingsUpdate.mutate({ model })}
                    disabled={isBusy || settingsUpdate.isPending}
                    aria-label={t({ ko: '실행 모델', en: 'Agent model' })}
                    className={compactSelectClassName}
                  />
                </span>
              </Tip>
              <Tip content={settingsHint} side="top" align="start">
                <span className="min-w-0">
                  <CodexReasoningSelect
                    value={settings.reasoningEffort}
                    model={settings.model}
                    models={modelsQuery.data?.data.models}
                    onChange={(reasoningEffort) => settingsUpdate.mutate({ reasoningEffort })}
                    disabled={isBusy || settingsUpdate.isPending}
                    className={compactSelectClassName}
                  />
                </span>
              </Tip>
            </>
          ) : null}
          <span className="flex-1" />
          {isBusy ? (
            <IconButton variant="secondary" size="icon-sm" onClick={() => activeThreadId !== null && chat.stop(activeThreadId)} label={t({ ko: '중단', en: 'Stop' })}>
              <Square />
            </IconButton>
          ) : (
            <IconButton variant="default" size="icon-sm" className="rounded-full" onClick={handleSend} disabled={!draft.trim() || !codexStatus?.available || settingsUpdate.isPending} label={t({ ko: '보내기', en: 'Send' })}>
              <ArrowUp />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  )

  const body: ReactNode = isGallery && activeThreadId !== null
    ? <CodexChatGallery threadId={activeThreadId} columns={layout === 'page' ? 'wide' : 'narrow'} />
    : <>{transcript}{composer}</>

  if (layout === 'page') {
    return (
      <div className="flex min-h-0 flex-1">
        <nav aria-label={t({ ko: '채팅 목록', en: 'Chats' })} className="hidden w-60 shrink-0 flex-col gap-1 border-r border-line py-2 pr-3 md:flex">
          <div className="flex items-center justify-between pb-1 pl-2">
            <span className="text-xs font-semibold text-muted-foreground">{t({ ko: '채팅', en: 'Chats' })}</span>
            {newChatButton}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {threads.map((thread) => (
              <ListRow key={thread.id} asChild interactive size="sm" selected={thread.id === activeThreadId}>
                <button type="button" onClick={() => selectThread(thread.id)} disabled={isBusy && thread.id !== activeThreadId} className="w-full disabled:opacity-50">
                  <span className="truncate">{threadTitle(thread.title)}</span>
                </button>
              </ListRow>
            ))}
          </div>
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex h-12 shrink-0 items-center gap-1 pl-4 sm:pl-6">
            <ThreadSelect
              className="md:hidden"
              threads={threads}
              activeThreadId={activeThreadId}
              disabled={isBusy}
              newChatLabel={newChatLabel}
              onSelect={selectThread}
            />
            <span className="hidden min-w-0 flex-1 truncate text-sm font-semibold md:block">
              {isGallery ? t({ ko: '이미지 모아보기', en: 'Image gallery' }) : activeThread ? threadTitle(activeThread.title) : newChatLabel}
            </span>
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
      <div className="flex h-12 shrink-0 items-center gap-0.5 border-b border-line pl-2 pr-1.5">
        <ThreadSelect threads={threads} activeThreadId={activeThreadId} disabled={isBusy} newChatLabel={newChatLabel} onSelect={selectThread} />
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
      {body}
    </div>
  )
}

function ThreadSelect({ threads, activeThreadId, disabled, newChatLabel, onSelect, className }: {
  threads: Array<{ id: number; title: string }>
  activeThreadId: number | null
  disabled: boolean
  newChatLabel: string
  onSelect: (threadId: number | null) => void
  className?: string
}) {
  const { t } = useI18n()
  return (
    <Select
      value={activeThreadId ?? ''}
      onChange={(event) => onSelect(event.target.value ? Number(event.target.value) : null)}
      disabled={disabled}
      className={cn('min-w-0 flex-1 truncate border-transparent bg-transparent px-2 font-semibold hover:bg-fill', className)}
      aria-label={t({ ko: '채팅 목록', en: 'Chats' })}
    >
      {activeThreadId === null ? <option value="">{newChatLabel}</option> : null}
      {threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title || newChatLabel}</option>)}
    </Select>
  )
}
