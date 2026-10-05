import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { createCodexChatThread, getCodexChatStatus, interruptCodexChatThread, streamCodexChatMessage, streamChatRewrite, type CodexChatMessage, type CodexChatStreamEvent, type CodexChatThreadDetail } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { CHAT_STATUS_QUERY_KEY } from '@/lib/api-codex-chat'
import { summarizeChatError } from './chat-error-chip'
import type { StoredFileEntry } from '@conai/shared'
import { FILES_QUERY_KEY, uploadStoredFiles } from '@/lib/api-files'
import {
  CODEX_CHAT_THREADS_QUERY_KEY,
  CodexChatContext,
  codexChatMediaQueryKey,
  codexChatThreadQueryKey,
  type CodexChatApi,
  type CodexChatLiveReply,
  type CodexChatLiveTurn,
  type CodexChatView,
} from './codex-chat-context'

/**
 * Chat state shared by the side panel and the /chat page, kept above the routes so a reply keeps streaming while the
 * user moves between pages or switches panel ↔ page.
 */
export function CodexChatProvider({ children }: PropsWithChildren) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [view, setView] = useState<CodexChatView>('chat')
  const [selectedThreadId, setSelectedThreadId] = useState<number | null | undefined>(undefined)
  const [draft, setDraft] = useState('')
  const [draftAttachments, setDraftAttachments] = useState<StoredFileEntry[]>([])
  const [attachmentsUploading, setAttachmentsUploading] = useState(false)
  const attachmentsRef = useRef(draftAttachments)
  const uploadBusyRef = useRef(false)
  const attachmentEpoch = useRef(0)
  const [liveTurn, setLiveTurn] = useState<CodexChatLiveTurn | null>(null)
  const [messageFocus, setMessageFocus] = useState<CodexChatApi['messageFocus']>(null)
  const [isStartingChat, setIsStartingChat] = useState(false)
  const draftRef = useRef(draft)
  const streamAbortRef = useRef<AbortController | null>(null)
  /** Settles when the streamed reply has wound down, so a group room message can cut in after it. */
  const activeReplyRef = useRef<Promise<void> | null>(null)

  draftRef.current = draft
  attachmentsRef.current = draftAttachments

  const addAttachments = useCallback((files: StoredFileEntry[]) => {
    const next = [...new Map([...attachmentsRef.current, ...files].map((file) => [file.id, file])).values()]
    if (next.length > 20) {
      showSnackbar({ tone: 'error', message: t({ ko: '첨부파일은 최대 20개까지 가능해.', en: 'Attach up to 20 files.' }) })
      return
    }
    attachmentsRef.current = next
    setDraftAttachments(next)
  }, [showSnackbar, t])
  const removeAttachment = useCallback((id: string) => {
    attachmentsRef.current = attachmentsRef.current.filter((file) => file.id !== id)
    setDraftAttachments(attachmentsRef.current)
  }, [])
  const uploadAttachments = useCallback(async (files: File[]) => {
    if (!files.length || uploadBusyRef.current) return
    if (attachmentsRef.current.length + files.length > 20) {
      showSnackbar({ tone: 'error', message: t({ ko: '첨부파일은 최대 20개까지 가능해.', en: 'Attach up to 20 files.' }) })
      return
    }
    const epoch = attachmentEpoch.current
    uploadBusyRef.current = true
    setAttachmentsUploading(true)
    try {
      const entries = await uploadStoredFiles(null, files)
      if (attachmentEpoch.current === epoch) addAttachments(entries)
      await queryClient.invalidateQueries({ queryKey: FILES_QUERY_KEY })
    } catch (error) {
      showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '업로드 실패', en: 'Upload failed' })) })
    } finally {
      uploadBusyRef.current = false
      setAttachmentsUploading(false)
    }
  }, [addAttachments, queryClient, showSnackbar, t])

  const statusQuery = useQuery({ queryKey: CHAT_STATUS_QUERY_KEY, queryFn: getCodexChatStatus, staleTime: 60_000, retry: false })
  const canUse = statusQuery.data?.canUse === true

  useEffect(() => () => streamAbortRef.current?.abort(), [])

  const selectThread = useCallback((threadId: number | null | undefined) => {
    attachmentEpoch.current += 1
    attachmentsRef.current = []
    setDraftAttachments([])
    setSelectedThreadId(threadId)
    setView('chat')
  }, [])

  const startChat = useCallback(async (profileId: number) => {
    setIsStartingChat(true)
    try {
      const thread = await createCodexChatThread(profileId)
      await queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
      setSelectedThreadId(thread.id)
      attachmentEpoch.current += 1
      attachmentsRef.current = []
      setDraftAttachments([])
      setView('chat')
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '채팅을 만들지 못했어.', en: 'Could not start a chat.' })), tone: 'error' })
    } finally {
      setIsStartingChat(false)
    }
  }, [queryClient, showSnackbar, t])

  const reply = useCallback(async (threadId: number, rewrite?: { messageId: number; content?: string }, literalText?: string) => {
    const text = rewrite ? '' : (literalText ?? draftRef.current).trim()
    const attachments = rewrite ? [] : attachmentsRef.current
    if ((!rewrite && !text && attachments.length === 0) || uploadBusyRef.current) {
      return false
    }
    const isGroup = queryClient.getQueryData<CodexChatThreadDetail>(codexChatThreadQueryKey(threadId))?.thread.kind === 'group'
    if (streamAbortRef.current) {
      // In a group room the user may cut in: the server stops the room's reply when the new message arrives, so stop
      // reading the old stream and let it wind down first.
      if (!isGroup || rewrite) return false
      streamAbortRef.current.abort()
      await activeReplyRef.current
      if (streamAbortRef.current) return false
    }
    let settle: () => void = () => {}
    activeReplyRef.current = new Promise((resolve) => { settle = resolve })

    const sentThreadId = threadId
    const controller = new AbortController()
    streamAbortRef.current = controller
    if (!rewrite) {
      setDraft('')
      setDraftAttachments([])
      attachmentsRef.current = []
    }
    setLiveTurn({ threadId: sentThreadId, userText: text, attachments, text: '', reasoning: '', toolCalls: new Map(), replies: isGroup ? [] : undefined })
    let accepted = false

    /** Group rooms: change one member's streaming reply (added if its first event comes before `speaker`). */
    const updateReply = (profileId: number, change: (reply: CodexChatLiveReply) => CodexChatLiveReply) => setLiveTurn((current) => {
      if (!current) return current
      const replies = current.replies ?? []
      const existing = replies.find((reply) => reply.profileId === profileId)
      return {
        ...current,
        replies: existing
          ? replies.map((reply) => (reply === existing ? change(reply) : reply))
          : [...replies, change({ profileId, text: '', reasoning: '', toolCalls: new Map() })],
      }
    })
    /** Group rooms: keep only the replies of members still answering. */
    const keepSpeakers = (speakers: number[], queue: number[]) => setLiveTurn((current) => current ? {
      ...current,
      replies: (current.replies ?? []).filter((reply) => speakers.includes(reply.profileId)),
      queue,
    } : current)

    /** Group rooms: a stored message joins the transcript right away, since more members keep the stream going. */
    const putMessage = (message: CodexChatMessage) => queryClient.setQueryData<CodexChatThreadDetail>(codexChatThreadQueryKey(sentThreadId), (current) => current ? {
      ...current,
      messages: current.messages.some((entry) => entry.id === message.id)
        ? current.messages.map((entry) => entry.id === message.id ? message : entry)
        : [...current.messages, message],
    } : current)

    try {
      const onEvent = (event: CodexChatStreamEvent) => {
        if (isGroup && event.type === 'user') {
          accepted = true
          putMessage(event.message)
          setLiveTurn((current) => current ? { ...current, userText: '', attachments: [] } : current)
          void queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
        } else if (event.type === 'speaker') {
          updateReply(event.profileId, () => ({ profileId: event.profileId, text: '', reasoning: '', toolCalls: new Map() }))
          keepSpeakers(event.speakers, event.queue)
        } else if (event.type === 'queue') {
          keepSpeakers(event.speakers, event.queue)
        } else if (event.type === 'notice') {
          showSnackbar({ message: event.message })
        } else if (isGroup && event.type === 'done') {
          putMessage(event.message)
          setLiveTurn((current) => current ? {
            ...current,
            replies: (current.replies ?? []).filter((reply) => reply.profileId !== event.message.speaker_profile_id),
            replacingMessageId: undefined,
          } : current)
        } else if ((event.type === 'delta' || event.type === 'reasoning' || event.type === 'tool') && event.profileId !== undefined) {
          const groupEvent = event
          updateReply(event.profileId, (reply) => {
            if (groupEvent.type === 'delta') return { ...reply, text: reply.text + groupEvent.text }
            if (groupEvent.type === 'reasoning') return { ...reply, reasoning: reply.reasoning + groupEvent.text }
            return { ...reply, toolCalls: new Map(reply.toolCalls).set(groupEvent.call.id, groupEvent.call) }
          })
        } else if (event.type === 'delta') {
          setLiveTurn((current) => (current ? { ...current, text: current.text + event.text } : current))
        } else if (event.type === 'reasoning') {
          setLiveTurn((current) => (current ? { ...current, reasoning: current.reasoning + event.text } : current))
        } else if (event.type === 'tool') {
          setLiveTurn((current) => {
            if (!current) return current
            const toolCalls = new Map(current.toolCalls)
            toolCalls.set(event.call.id, event.call)
            return { ...current, toolCalls }
          })
        } else if (event.type === 'user') {
          accepted = true
          // The server titles a new thread from its first message.
          void queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
        } else if (event.type === 'rewind') {
          accepted = true
          queryClient.setQueryData<CodexChatThreadDetail>(codexChatThreadQueryKey(sentThreadId), (current) => current ? {
            ...current,
            messages: event.mode === 'edit'
              ? current.messages.filter((message) => message.id <= event.message.id).map((message) => message.id === event.message.id ? event.message : message)
              : current.messages.filter((message) => message.id !== event.message.id),
          } : current)
          setLiveTurn((current) => current ? { ...current, replacingMessageId: event.mode === 'regenerate' ? event.message.id : undefined } : current)
        } else if (event.type === 'done') {
          setLiveTurn((current) => current ? { ...current, replacingMessageId: event.message.id, userText: '', attachments: [] } : current)
        } else if (event.type === 'error') {
          // The full text stays on the failed message (its error chip); the toast only names the reason.
          showSnackbar({ message: summarizeChatError(event.message, t), tone: 'error' })
        }
      }
      if (rewrite) await streamChatRewrite(sentThreadId, rewrite.messageId, rewrite.content, onEvent, controller.signal)
      else await streamCodexChatMessage(sentThreadId, text, onEvent, controller.signal, attachments.map((file) => file.id))
    } catch (error) {
      if (!controller.signal.aborted) {
        showSnackbar({ message: summarizeChatError(getErrorMessage(error, t({ ko: '응답 실패', en: 'Reply failed' })), t), tone: 'error' })
        if (!accepted && !rewrite) {
          setDraft((current) => current || text)
          setDraftAttachments(attachments)
        }
      }
    } finally {
      streamAbortRef.current = null
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(sentThreadId) }),
        queryClient.invalidateQueries({ queryKey: codexChatMediaQueryKey(sentThreadId) }),
        queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY }),
      ])
      setLiveTurn(null)
      settle()
    }
    return accepted
  }, [queryClient, showSnackbar, t])

  const send = useCallback(async (threadId: number, text?: string) => { await reply(threadId, undefined, text) }, [reply])
  const regenerate = useCallback((threadId: number, messageId: number) => reply(threadId, { messageId }), [reply])
  const editMessage = useCallback((threadId: number, messageId: number, content: string) => reply(threadId, { messageId, content }), [reply])

  const stop = useCallback((threadId: number) => {
    void interruptCodexChatThread(threadId).catch((error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '중단 실패', en: 'Stop failed' })), tone: 'error' }))
  }, [showSnackbar, t])

  const focusMessage = useCallback((messageId: number) => {
    setView('chat')
    setMessageFocus((current) => ({ messageId, nonce: (current?.nonce ?? 0) + 1 }))
  }, [])

  const clearMessageFocus = useCallback(() => setMessageFocus(null), [])
  const openPanel = useCallback(() => setIsPanelOpen(true), [])
  const closePanel = useCallback(() => setIsPanelOpen(false), [])

  const api = useMemo<CodexChatApi>(() => ({
    canUse,
    isPanelOpen,
    openPanel,
    closePanel,
    view,
    setView,
    selectedThreadId,
    selectThread,
    startChat,
    isStartingChat,
    draft,
    setDraft,
    liveTurn,
    draftAttachments,
    attachmentsUploading,
    addAttachments,
    removeAttachment,
    uploadAttachments,
    send,
    regenerate,
    editMessage,
    stop,
    messageFocus,
    focusMessage,
    clearMessageFocus,
  }), [canUse, clearMessageFocus, closePanel, draft, focusMessage, isPanelOpen, isStartingChat, liveTurn, messageFocus, openPanel, selectThread, selectedThreadId, send, regenerate, editMessage, startChat, stop, view, draftAttachments, attachmentsUploading, addAttachments, removeAttachment, uploadAttachments])

  return <CodexChatContext.Provider value={api}>{children}</CodexChatContext.Provider>
}
