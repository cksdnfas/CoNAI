import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUp, Plus, Square, Trash2 } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import {
  createCodexChatThread,
  CODEX_CHAT_SETTINGS_QUERY_KEY,
  deleteCodexChatThread,
  getCodexChatSettings,
  getCodexChatThread,
  interruptCodexChatThread,
  listCodexChatThreads,
  streamCodexChatMessage,
  updateCodexChatSettings,
  type CodexChatMessage,
  type CodexChatToolCall,
} from '@/lib/api-codex-chat'
import { getCodexGenerationModels, getCodexGenerationStatus } from '@/lib/api-image-generation-queue'
import { cn } from '@/lib/utils'
import { getErrorMessage } from '../image-generation-shared'
import { CodexChatAssistantMessage, CodexChatUserMessage } from './codex-chat-message'
import { CodexModelSelect } from './codex-model-select'
import { CodexReasoningSelect } from './codex-reasoning-select'
import { GenerationToolbarStatus, usePortalTargetById } from './generation-toolbar-status'

const THREADS_QUERY_KEY = ['codex-chat-threads'] as const
const RUNNING_POLL_MS = 2000
const COMPOSER_MAX_HEIGHT_PX = 220

type LiveTurn = {
  threadId: number
  userText: string
  text: string
  toolCalls: Map<string, CodexChatToolCall>
}

function threadQueryKey(threadId: number | null) {
  return ['codex-chat-thread', threadId] as const
}

/** Admin chat with the server's Codex CLI; Codex acts on the app only through CoNAI MCP tools. */
export function CodexChatPanel({ statusPortalTargetId, isWideLayout }: { statusPortalTargetId?: string; isWideLayout: boolean }) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [selectedThreadId, setSelectedThreadId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [liveTurn, setLiveTurn] = useState<LiveTurn | null>(null)
  const streamAbortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)

  const codexStatusQuery = useQuery({ queryKey: ['codex-generation-status'], queryFn: getCodexGenerationStatus, staleTime: 30_000 })
  const codexStatus = codexStatusQuery.data?.data ?? null
  const statusPortalTarget = usePortalTargetById(statusPortalTargetId)
  const settingsQuery = useQuery({ queryKey: CODEX_CHAT_SETTINGS_QUERY_KEY, queryFn: getCodexChatSettings })
  const modelsQuery = useQuery({ queryKey: ['codex-generation-models'], queryFn: getCodexGenerationModels, staleTime: 5 * 60 * 1000 })
  const settingsUpdate = useMutation({
    mutationFn: updateCodexChatSettings,
    onSuccess: (settings) => queryClient.setQueryData(CODEX_CHAT_SETTINGS_QUERY_KEY, settings),
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '설정을 저장하지 못했어.', en: 'Could not save settings.' })), tone: 'error' }),
  })
  const settings = settingsQuery.data

  const threadsQuery = useQuery({ queryKey: THREADS_QUERY_KEY, queryFn: listCodexChatThreads })
  const threads = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data])
  const activeThreadId = selectedThreadId ?? threads[0]?.id ?? null

  const threadQuery = useQuery({
    queryKey: threadQueryKey(activeThreadId),
    queryFn: () => getCodexChatThread(activeThreadId as number),
    enabled: activeThreadId !== null,
    // A turn started before a reload keeps running on the server; poll until it is stored.
    refetchInterval: (query) => (query.state.data?.running && !liveTurn ? RUNNING_POLL_MS : false),
  })

  const isStreaming = liveTurn !== null
  const serverRunning = Boolean(threadQuery.data?.running) && !isStreaming
  const isBusy = isStreaming || serverRunning
  const messages: CodexChatMessage[] = threadQuery.data?.messages ?? []

  const deleteMutation = useMutation({
    mutationFn: deleteCodexChatThread,
    onSuccess: async (_result, threadId) => {
      queryClient.removeQueries({ queryKey: threadQueryKey(threadId) })
      setSelectedThreadId(null)
      await queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY })
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
    scrollToBottom()
  }, [messages.length, liveTurn?.text, liveTurn?.toolCalls.size, threadQuery.data?.running?.text, scrollToBottom])

  useLayoutEffect(() => {
    const node = composerRef.current
    if (!node) {
      return
    }
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, COMPOSER_MAX_HEIGHT_PX)}px`
  }, [draft])

  useEffect(() => () => streamAbortRef.current?.abort(), [])

  const handleSend = async () => {
    const text = draft.trim()
    if (!text || isBusy || settingsUpdate.isPending || !codexStatus?.available) {
      return
    }

    let threadId = activeThreadId
    try {
      if (threadId === null) {
        const thread = await createCodexChatThread()
        threadId = thread.id
        setSelectedThreadId(thread.id)
        await queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY })
      }
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '채팅을 만들지 못했어.', en: 'Could not start a chat.' })), tone: 'error' })
      return
    }

    const targetThreadId = threadId
    setDraft('')
    setLiveTurn({ threadId: targetThreadId, userText: text, text: '', toolCalls: new Map() })
    const controller = new AbortController()
    streamAbortRef.current = controller

    try {
      await streamCodexChatMessage(targetThreadId, text, (event) => {
        if (event.type === 'delta') {
          setLiveTurn((current) => (current ? { ...current, text: current.text + event.text } : current))
        } else if (event.type === 'tool') {
          setLiveTurn((current) => {
            if (!current) return current
            const toolCalls = new Map(current.toolCalls)
            toolCalls.set(event.call.id, event.call)
            return { ...current, toolCalls }
          })
        } else if (event.type === 'user') {
          // The server titles a new thread from its first message.
          void queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY })
        } else if (event.type === 'error') {
          showSnackbar({ message: event.message, tone: 'error' })
        }
      }, controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) {
        showSnackbar({ message: getErrorMessage(error, t({ ko: 'Codex 응답 실패', en: 'Codex reply failed' })), tone: 'error' })
        setDraft((current) => current || text)
      }
    } finally {
      streamAbortRef.current = null
      await queryClient.invalidateQueries({ queryKey: threadQueryKey(targetThreadId) })
      await queryClient.invalidateQueries({ queryKey: THREADS_QUERY_KEY })
      setLiveTurn(null)
    }
  }

  const handleStop = () => {
    if (activeThreadId !== null) {
      void interruptCodexChatThread(activeThreadId).catch((error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '중단 실패', en: 'Stop failed' })), tone: 'error' }))
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
      void handleSend()
    }
  }

  const statusContent = (
    <GenerationToolbarStatus
      tone={codexStatusQuery.isPending ? 'pending' : codexStatus?.available ? 'ready' : 'warning'}
      label={codexStatusQuery.isPending
        ? t({ ko: '상태 확인 중…', en: 'Checking status…' })
        : codexStatus?.available
          ? t({ ko: '사용 가능', en: 'Ready' })
          : codexStatus?.installed
            ? t({ ko: '로그인 필요', en: 'Sign-in needed' })
            : t({ ko: 'Codex 없음', en: 'Codex missing' })}
    />
  )

  const threadActions = (
    <div className="flex shrink-0 items-center gap-0.5">
      <IconButton variant="ghost" size="icon-sm" onClick={() => setSelectedThreadId(null)} disabled={isBusy} label={t({ ko: '새 채팅', en: 'New chat' })}>
        <Plus />
      </IconButton>
      <IconButton variant="ghost" size="icon-sm" onClick={() => void handleDelete()} disabled={activeThreadId === null || isBusy || deleteMutation.isPending} label={t({ ko: '채팅 삭제', en: 'Delete chat' })}>
        <Trash2 />
      </IconButton>
    </div>
  )

  const threadList = isWideLayout ? (
    <nav className="flex w-56 shrink-0 flex-col gap-2 border-r border-line pr-3">
      <div className="flex justify-end">{threadActions}</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {threads.map((thread) => (
          <ListRow key={thread.id} asChild interactive size="sm" selected={thread.id === activeThreadId}>
            <button
              type="button"
              onClick={() => setSelectedThreadId(thread.id)}
              disabled={isBusy && thread.id !== activeThreadId}
              className="disabled:opacity-50"
            >
              <span className="truncate">{thread.title || t({ ko: '새 채팅', en: 'New chat' })}</span>
            </button>
          </ListRow>
        ))}
      </div>
    </nav>
  ) : (
    <div className="flex items-center gap-2">
      <Select
        value={activeThreadId ?? ''}
        onChange={(event) => setSelectedThreadId(event.target.value ? Number(event.target.value) : null)}
        disabled={isBusy}
        className="min-w-0 flex-1"
        aria-label={t({ ko: '채팅 목록', en: 'Chats' })}
      >
        {activeThreadId === null ? <option value="">{t({ ko: '새 채팅', en: 'New chat' })}</option> : null}
        {threads.map((thread) => <option key={thread.id} value={thread.id}>{thread.title || t({ ko: '새 채팅', en: 'New chat' })}</option>)}
      </Select>
      {threadActions}
    </div>
  )

  const runningFromServer = serverRunning ? threadQuery.data?.running ?? null : null

  return (
    <div className={cn('flex min-h-0 flex-1 gap-4', isWideLayout ? 'flex-row' : 'flex-col')}>
      {statusPortalTarget ? createPortal(statusContent, statusPortalTarget) : null}
      {threadList}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-3xl flex-col gap-6 px-1 pb-6">
            {messages.map((message) => (
              message.role === 'user'
                ? <CodexChatUserMessage key={message.id} content={message.content} />
                : <CodexChatAssistantMessage key={message.id} content={message.content} toolCalls={message.tool_calls} status={message.status} error={message.error} />
            ))}
            {liveTurn && liveTurn.threadId === activeThreadId ? (
              <>
                {/* The thread refetches only after the turn ends, so the sent message is shown from local state until then. */}
                <CodexChatUserMessage content={liveTurn.userText} />
                <CodexChatAssistantMessage content={liveTurn.text} toolCalls={[...liveTurn.toolCalls.values()]} streaming />
              </>
            ) : null}
            {runningFromServer ? <CodexChatAssistantMessage content={runningFromServer.text} toolCalls={runningFromServer.toolCalls} streaming /> : null}
          </div>
        </div>

        <div className="mx-auto w-full max-w-3xl shrink-0 pt-2">
          {settings ? (
            <div className="mb-2 grid grid-cols-2 items-end gap-2">
              <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                <span>{t({ ko: '실행 모델', en: 'Agent model' })}</span>
                <CodexModelSelect
                  value={settings.model}
                  models={modelsQuery.data?.data.models}
                  onChange={(model) => settingsUpdate.mutate({ model })}
                  disabled={isBusy || settingsUpdate.isPending}
                  aria-label={t({ ko: '실행 모델', en: 'Agent model' })}
                  className="min-w-0"
                />
              </label>
              <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
                <span>{t({ ko: '추론 강도', en: 'Reasoning effort' })}</span>
                <CodexReasoningSelect
                  value={settings.reasoningEffort}
                  model={settings.model}
                  models={modelsQuery.data?.data.models}
                  onChange={(reasoningEffort) => settingsUpdate.mutate({ reasoningEffort })}
                  disabled={isBusy || settingsUpdate.isPending}
                  className="min-w-0"
                />
              </label>
              <span className="col-span-2 text-xs text-muted-foreground">{t({ ko: '서버 공통 설정 · 변경하면 진행 중인 다른 채팅도 중단돼.', en: 'Server-wide settings · changes also stop other running chats.' })}</span>
            </div>
          ) : null}
          {settingsQuery.isError ? <p className="mb-2 text-xs text-destructive">{t({ ko: '채팅 설정을 불러오지 못했어.', en: 'Could not load chat settings.' })}</p> : null}
          <div className="flex items-end gap-2 rounded-lg border border-line px-3 py-2 focus-within:border-primary/55">
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              rows={1}
              placeholder={t({ ko: 'Codex에게 요청하기', en: 'Ask Codex' })}
              aria-label={t({ ko: '메시지', en: 'Message' })}
              className="min-h-0 flex-1 resize-none bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {isBusy ? (
              <IconButton variant="secondary" size="icon-sm" onClick={handleStop} label={t({ ko: '중단', en: 'Stop' })}>
                <Square />
              </IconButton>
            ) : (
              <IconButton variant="default" size="icon-sm" onClick={() => void handleSend()} disabled={!draft.trim() || !codexStatus?.available || settingsUpdate.isPending} label={t({ ko: '보내기', en: 'Send' })}>
                <ArrowUp />
              </IconButton>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
