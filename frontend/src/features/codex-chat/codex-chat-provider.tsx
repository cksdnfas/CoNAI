import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { CHAT_APPEARANCE_QUERY_KEY, CHAT_FLAGS_QUERY_KEY, createCodexChatThread, type CodexChatThread, getCodexChatStatus, getCodexChatThread, previewChatGreeting, interruptCodexChatThread, pickSnapshot, choiceSnapshot, readThreadFlagIds, streamCodexChatMessage, streamChatContinue, streamChatRewrite, type ChatFlag, type ChatMediaAttachment, type CodexChatMessage, type CodexChatStreamEvent, type CodexChatThreadDetail } from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { CHAT_PROFILES_QUERY_KEY, CHAT_STATUS_QUERY_KEY, threadLorebooksQueryKey, type ChatProfileSummary } from '@/lib/api-codex-chat'
import { summarizeChatError } from './chat-error-chip'
import { postLink, type StoredFileEntry } from '@conai/shared'
import { getCodexChatThreadMedia } from '@/lib/api-codex-chat'
import { FILES_QUERY_KEY, uploadStoredFiles } from '@/lib/api-files'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useChatPage } from './chat-page-context'
import {
  CODEX_CHAT_THREADS_QUERY_KEY,
  CodexChatContext,
  CodexChatLiveContext,
  CodexChatReferenceContext,
  codexChatMediaQueryKey,
  codexChatThreadQueryKey,
  defaultThreadId,
  PENDING_DRAFT_KEY,
  type ChatChoiceCard,
  type ChatChoiceDraft,
  type ChatPostReference,
  type CodexChatApi,
  type CodexChatPendingChat,
  type CodexChatLiveReply,
  type CodexChatLiveTurn,
  type CodexChatReferenceApi,
  type CodexChatView,
} from './codex-chat-context'

/** What a chat's composer holds besides its text, kept while another chat is open. */
type ComposerStash = { attachments: StoredFileEntry[]; media: ChatMediaAttachment[]; posts: ChatPostReference[]; reply: CodexChatApi['draftReply']; picks: string[] }

const samePostRef = (a: ChatPostReference, b: ChatPostReference) => a.postId === b.postId && a.commentId === b.commentId

/** A referenced post as the message carries it: `[label](post:12#comment-45)` on its own line. */
function postRefLine(item: ChatPostReference) {
  return `[${item.label.replace(/[[\]\n]/g, ' ').trim()}](${postLink(item.postId, item.commentId)})`
}

const DRAFTS_STORAGE_PREFIX = 'conai.chat.drafts.'

/** The composer texts saved in this browser for one account (text only: attached files are not kept over a reload). */
function readStoredDrafts(key: string): Record<number, string> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(Object.entries(parsed).filter(([id, text]) => Number.isSafeInteger(Number(id)) && typeof text === 'string' && text).map(([id, text]) => [Number(id), text as string]))
  } catch {
    return {}
  }
}

function writeStoredDrafts(key: string, drafts: Record<number, string>) {
  try {
    if (Object.keys(drafts).length === 0) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, JSON.stringify(drafts))
  } catch {
    // Storage blocked or full: the drafts last for this page only.
  }
}

/**
 * Chat state shared by the side panel and the /chat page, kept above the routes so a reply keeps streaming while the
 * user moves between pages or switches panel ↔ page.
 */
export function CodexChatProvider({ children }: PropsWithChildren) {
  const pageBridge = useChatPage()
  const capturePage = pageBridge?.capture
  const disconnectPage = pageBridge?.disconnect
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const [view, setView] = useState<CodexChatView>('chat')
  const [selectedThreadId, setSelectedThreadId] = useState<number | null | undefined>(undefined)
  const selectedRef = useRef(selectedThreadId)
  const [listOpen, setListOpen] = useState(false)
  // What the user is typing, per chat: moving through the list must not carry one chat's text into another.
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const draftsRef = useRef(drafts)
  const setDraft = useCallback((threadId: number, next: string | ((current: string) => string)) => {
    const current = draftsRef.current[threadId] ?? ''
    const value = typeof next === 'function' ? next(current) : next
    if (value === current) return
    const rest = { ...draftsRef.current }
    delete rest[threadId]
    draftsRef.current = value ? { ...rest, [threadId]: value } : rest
    setDrafts(draftsRef.current)
  }, [])
  // Kept in this browser per account, so a reload does not lose them and another account never sees them.
  const authStatus = useAuthStatusQuery().data
  const draftsKey = authStatus ? `${DRAFTS_STORAGE_PREFIX}${authStatus.accountId ?? 'local'}` : null
  const [loadedDraftsKey, setLoadedDraftsKey] = useState<string | null>(null)
  if (draftsKey !== loadedDraftsKey) {
    setLoadedDraftsKey(draftsKey)
    draftsRef.current = draftsKey ? readStoredDrafts(draftsKey) : {}
    setDrafts(draftsRef.current)
  }
  useEffect(() => {
    if (!loadedDraftsKey) return
    const timer = window.setTimeout(() => writeStoredDrafts(loadedDraftsKey, drafts), 400)
    return () => window.clearTimeout(timer)
  }, [drafts, loadedDraftsKey])
  /** Drop the texts of chats that are gone. */
  const keepDrafts = useCallback((threadIds: number[]) => {
    const live = new Set([...threadIds, PENDING_DRAFT_KEY])
    const kept = Object.fromEntries(Object.entries(draftsRef.current).filter(([id]) => live.has(Number(id))))
    if (Object.keys(kept).length === Object.keys(draftsRef.current).length) return
    draftsRef.current = kept
    setDrafts(kept)
  }, [])
  const [draftReply, updateDraftReply] = useState<CodexChatApi['draftReply']>(null)
  const draftReplyRef = useRef(draftReply)
  const setDraftReply = useCallback((reply: CodexChatApi['draftReply']) => {
    draftReplyRef.current = reply
    updateDraftReply(reply)
    if (reply && !reply.quote.media) {
      void queryClient.fetchQuery({ queryKey: codexChatMediaQueryKey(reply.threadId), queryFn: () => getCodexChatThreadMedia(reply.threadId), staleTime: 3000 }).then((items) => {
        const media = items.find((item) => item.messageId === reply.quote.messageId)
        if (media && draftReplyRef.current === reply) {
          const next = { ...reply, quote: { ...reply.quote, media: { compositeHash: media.compositeHash, name: '이미지', mimeType: media.mimeType } } }
          draftReplyRef.current = next
          updateDraftReply(next)
        }
      }).catch(() => undefined)
    }
  }, [queryClient])
  const [picks, setPicks] = useState<string[]>([])
  const picksRef = useRef(picks)
  const [draftAttachments, setDraftAttachments] = useState<StoredFileEntry[]>([])
  const [draftMediaAttachments, setDraftMediaAttachments] = useState<ChatMediaAttachment[]>([])
  const mediaAttachmentsRef = useRef(draftMediaAttachments)
  const [draftPostRefs, setDraftPostRefs] = useState<ChatPostReference[]>([])
  const postRefsRef = useRef(draftPostRefs)
  const [attachmentsUploading, setAttachmentsUploading] = useState(false)
  const attachmentsRef = useRef(draftAttachments)
  const uploadBusyRef = useRef(false)
  const attachmentEpoch = useRef(0)
  /** Attachments, reply and picks of the chats not open now (see switchComposer). */
  const stashRef = useRef(new Map<number, ComposerStash>())
  const [liveTurn, setLiveTurn] = useState<CodexChatLiveTurn | null>(null)
  const liveTurnRef = useRef<CodexChatLiveTurn | null>(null)
  liveTurnRef.current = liveTurn
  const currentLiveTurn = useCallback(() => liveTurnRef.current, [])
  const [messageFocus, setMessageFocus] = useState<CodexChatApi['messageFocus']>(null)
  const [isStartingChat, setIsStartingChat] = useState(false)
  const [pendingChat, setPendingChat] = useState<CodexChatPendingChat | null>(null)
  const pendingRef = useRef(pendingChat)
  const streamAbortRef = useRef<AbortController | null>(null)
  /** A new chat is being saved (a double click must not save two). */
  const startingRef = useRef(false)
  /** The chat the stream belongs to: only a message in that same room may cut in. */
  const streamThreadRef = useRef<number | null>(null)
  /** Settles when the streamed reply has wound down, so a group room message can cut in after it. */
  const activeReplyRef = useRef<Promise<void> | null>(null)

  attachmentsRef.current = draftAttachments
  mediaAttachmentsRef.current = draftMediaAttachments
  postRefsRef.current = draftPostRefs
  picksRef.current = picks
  selectedRef.current = selectedThreadId

  /** The chat the composer belongs to: the selection, `undefined` being the list's first chat (as the view reads it). */
  const resolveThread = useCallback((selection: number | null | undefined) => (
    selection === undefined ? defaultThreadId(queryClient.getQueryData<CodexChatThread[]>(CODEX_CHAT_THREADS_QUERY_KEY) ?? []) : selection
  ), [queryClient])

  const togglePick = useCallback((label: string) => setPicks((current) => (current.includes(label) ? current.filter((entry) => entry !== label) : [...current, label].slice(-12))), [])
  const removePick = useCallback((label: string) => setPicks((current) => current.filter((entry) => entry !== label)), [])
  const [choice, setChoiceState] = useState<ChatChoiceDraft | null>(null)
  const choiceRef = useRef(choice)
  const setChoice = useCallback((next: ChatChoiceDraft | null) => {
    choiceRef.current = next
    setChoiceState(next)
  }, [])
  const toggleChoice = useCallback((threadId: number, proposal: ChatChoiceCard, label: string) => {
    const current = choiceRef.current?.threadId === threadId && choiceRef.current.proposalId === proposal.id ? choiceRef.current.labels : []
    const labels = !proposal.multiple ? [label] : current.includes(label) ? current.filter((entry) => entry !== label) : [...current, label]
    setChoice(labels.length ? { threadId, proposalId: proposal.id, question: proposal.question, labels, withoutPage: proposal.options.some((option) => option.withoutPage && labels.includes(option.label)) } : null)
  }, [setChoice])
  const clearChoice = useCallback(() => setChoice(null), [setChoice])

  const addAttachments = useCallback((files: StoredFileEntry[]) => {
    const next = [...new Map([...attachmentsRef.current, ...files].map((file) => [file.id, file])).values()]
    if (next.length + mediaAttachmentsRef.current.length > 20) {
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
  const setMediaAttachments = useCallback((items: ChatMediaAttachment[]) => {
    const next = [...new Map(items.map((item) => [item.compositeHash, item])).values()]
    if (next.length + attachmentsRef.current.length > 20) {
      showSnackbar({ tone: 'error', message: t({ ko: '첨부파일은 최대 20개까지 가능해.', en: 'Attach up to 20 files.' }) })
      return false
    }
    mediaAttachmentsRef.current = next
    setDraftMediaAttachments(next)
    return true
  }, [showSnackbar, t])
  const removeMediaAttachment = useCallback((hash: string) => {
    mediaAttachmentsRef.current = mediaAttachmentsRef.current.filter((item) => item.compositeHash !== hash)
    setDraftMediaAttachments(mediaAttachmentsRef.current)
  }, [])
  const toggleMediaAttachment = useCallback((item: ChatMediaAttachment) => {
    if (mediaAttachmentsRef.current.some((existing) => existing.compositeHash === item.compositeHash)) removeMediaAttachment(item.compositeHash)
    else setMediaAttachments([...mediaAttachmentsRef.current, item])
  }, [removeMediaAttachment, setMediaAttachments])
  const togglePostReference = useCallback((item: ChatPostReference) => {
    const current = postRefsRef.current
    postRefsRef.current = current.some((existing) => samePostRef(existing, item)) ? current.filter((existing) => !samePostRef(existing, item)) : [...current, item].slice(-10)
    setDraftPostRefs(postRefsRef.current)
  }, [])
  const uploadAttachments = useCallback(async (files: File[]) => {
    if (!files.length || uploadBusyRef.current) return
    if (attachmentsRef.current.length + mediaAttachmentsRef.current.length + files.length > 20) {
      showSnackbar({ tone: 'error', message: t({ ko: '첨부파일은 최대 20개까지 가능해.', en: 'Attach up to 20 files.' }) })
      return
    }
    const startedIn = resolveThread(selectedRef.current)
    uploadBusyRef.current = true
    setAttachmentsUploading(true)
    try {
      const entries = await uploadStoredFiles(null, files)
      // Another chat opened meanwhile: the files wait in the chat they were picked for.
      if (resolveThread(selectedRef.current) === startedIn) addAttachments(entries)
      else if (startedIn !== null) {
        const stash = stashRef.current.get(startedIn) ?? { attachments: [], media: [], posts: [], reply: null, picks: [] }
        stashRef.current.set(startedIn, { ...stash, attachments: [...new Map([...stash.attachments, ...entries].map((file) => [file.id, file])).values()] })
      }
      await queryClient.invalidateQueries({ queryKey: FILES_QUERY_KEY })
    } catch (error) {
      showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '업로드 실패', en: 'Upload failed' })) })
    } finally {
      uploadBusyRef.current = false
      setAttachmentsUploading(false)
    }
  }, [addAttachments, queryClient, resolveThread, showSnackbar, t])

  const statusQuery = useQuery({ queryKey: CHAT_STATUS_QUERY_KEY, queryFn: getCodexChatStatus, staleTime: 60_000, retry: false })
  const canUse = statusQuery.data?.canUse === true

  useEffect(() => () => streamAbortRef.current?.abort(), [])

  /**
   * Moving to another chat puts the composer's attachments, reply and picks aside for the chat being left and brings
   * back what the next one had (its text is kept per chat already). Staying in the same chat keeps them as they are.
   */
  const switchComposer = useCallback((next: number | null | undefined) => {
    const from = resolveThread(selectedRef.current)
    const to = resolveThread(next)
    selectedRef.current = next
    setSelectedThreadId(next)
    if (from === to) return
    if (from !== null) {
      const stash = { attachments: attachmentsRef.current, media: mediaAttachmentsRef.current, posts: postRefsRef.current, reply: draftReplyRef.current, picks: picksRef.current }
      if (stash.attachments.length || stash.media.length || stash.posts.length || stash.reply || stash.picks.length) stashRef.current.set(from, stash)
      else stashRef.current.delete(from)
    }
    const restored = to !== null ? stashRef.current.get(to) : undefined
    if (to !== null) stashRef.current.delete(to)
    attachmentEpoch.current += 1
    attachmentsRef.current = restored?.attachments ?? []
    setDraftAttachments(attachmentsRef.current)
    mediaAttachmentsRef.current = restored?.media ?? []
    setDraftMediaAttachments(mediaAttachmentsRef.current)
    postRefsRef.current = restored?.posts ?? []
    setDraftPostRefs(postRefsRef.current)
    setDraftReply(restored?.reply ?? null)
    picksRef.current = restored?.picks ?? []
    setPicks(picksRef.current)
  }, [resolveThread, setDraftReply])

  /** "The latest chat" becomes that chat once the list is known, so later list changes never swap the open chat. */
  const settleSelection = useCallback((threadId: number) => {
    if (selectedRef.current !== undefined) return
    selectedRef.current = threadId
    setSelectedThreadId(threadId)
  }, [])

  /** Leave the new chat being prepared: nothing was saved, so only its text goes. */
  const dropPending = useCallback(() => {
    if (!pendingRef.current) return
    pendingRef.current = null
    setPendingChat(null)
    setDraft(PENDING_DRAFT_KEY, '')
  }, [setDraft])

  const selectThread = useCallback((threadId: number | null | undefined) => {
    if (selectedRef.current !== threadId) disconnectPage?.()
    dropPending()
    switchComposer(threadId)
    setListOpen(false)
    setView('chat')
  }, [disconnectPage, dropPending, switchComposer])

  const showList = useCallback((open: boolean) => {
    if (open) dropPending()
    setListOpen(open)
    setView('chat')
  }, [dropPending])

  const prepareChat = useCallback((profileId: number, userProfileId?: number | null) => {
    disconnectPage?.()
    switchComposer(null)
    setDraft(PENDING_DRAFT_KEY, '')
    const pending: CodexChatPendingChat = { profileId, userProfileId, greeting: null }
    pendingRef.current = pending
    setPendingChat(pending)
    setListOpen(false)
    setView('chat')
    previewChatGreeting(profileId, userProfileId).then((preview) => {
      if (pendingRef.current !== pending) return
      pendingRef.current = { ...pending, userProfileId: preview.userProfileId, greeting: { index: preview.index, text: preview.text, greetings: preview.greetings } }
      setPendingChat(pendingRef.current)
    }).catch((error: unknown) => {
      if (pendingRef.current !== pending) return
      pendingRef.current = null
      setPendingChat(null)
      showSnackbar({ message: getErrorMessage(error, t({ ko: '채팅을 시작하지 못했어.', en: 'Could not start a chat.' })), tone: 'error' })
    })
  }, [disconnectPage, setDraft, showSnackbar, switchComposer, t])

  const reply = useCallback(async (threadId: number, rewrite?: { messageId: number; content?: string; continue?: boolean }, literalText?: string) => {
    const replyingTo = !rewrite && draftReplyRef.current?.threadId === threadId ? draftReplyRef.current : null
    const picked = rewrite ? [] : picksRef.current
    const chosen = !rewrite && choiceRef.current?.threadId === threadId ? choiceRef.current : null
    // Picks and answers alone make a message of their own labels, so a click can be sent as is.
    const typed = rewrite ? '' : (literalText ?? draftsRef.current[threadId] ?? '').trim() || [...picked, ...(chosen?.labels ?? [])].join(', ')
    // Referenced posts ride as link lines above the text (the model reads them with posts_read).
    const postRefs = rewrite ? [] : postRefsRef.current
    const text = postRefs.length ? [postRefs.map(postRefLine).join('\n'), typed].filter(Boolean).join('\n\n') : typed
    const attachments = rewrite ? [] : attachmentsRef.current
    const mediaAttachments = rewrite ? [] : mediaAttachmentsRef.current
    const sentAttachmentEpoch = attachmentEpoch.current
    if ((!rewrite && !text && attachments.length === 0 && mediaAttachments.length === 0) || uploadBusyRef.current) {
      return false
    }
    const cachedThread = queryClient.getQueryData<CodexChatThreadDetail>(codexChatThreadQueryKey(threadId))?.thread
    const isGroup = cachedThread?.kind === 'group'
    // Only a direct chat whose profile has the page assistant on sends the connected page.
    const pageAllowed = cachedThread?.kind === 'direct' && queryClient.getQueryData<ChatProfileSummary[]>(CHAT_PROFILES_QUERY_KEY)?.find((profile) => profile.id === cachedThread?.profile_id)?.pageAssist === true
    // The chat's switched-on flags go with a new message (a rewrite replays the ones stored on the message).
    const flags = rewrite ? [] : (queryClient.getQueryData<ChatFlag[]>(CHAT_FLAGS_QUERY_KEY) ?? []).filter((flag) => readThreadFlagIds(cachedThread).includes(flag.id))
    const shownFlags = [...flags, ...picked.map(pickSnapshot), ...(chosen ? chosen.labels.map((label) => choiceSnapshot(label, { id: chosen.proposalId, question: chosen.question })) : [])]
    if (streamAbortRef.current) {
      // In a group room the user may cut in: the server stops the room's reply when the new message arrives, so stop
      // reading the old stream and let it wind down first.
      if (!isGroup || rewrite || streamThreadRef.current !== threadId) return false
      streamAbortRef.current.abort()
      await activeReplyRef.current
      if (streamAbortRef.current) return false
    }
    let settle: () => void = () => {}
    activeReplyRef.current = new Promise((resolve) => { settle = resolve })

    const sentThreadId = threadId
    const controller = new AbortController()
    streamAbortRef.current = controller
    streamThreadRef.current = sentThreadId
    if (!rewrite) {
      setDraftReply(null)
      setDraft(sentThreadId, '')
      setDraftAttachments([])
      mediaAttachmentsRef.current = []
      setDraftMediaAttachments([])
      postRefsRef.current = []
      setDraftPostRefs([])
      attachmentsRef.current = []
      setPicks([])
      picksRef.current = []
      // Any message answers or sets aside the open card.
      setChoice(null)
    }
    setLiveTurn({ threadId: sentThreadId, userText: text, userRouting: replyingTo ? { replyTo: replyingTo.quote, recipients: [] } : undefined, flags: shownFlags, attachments, mediaAttachments, text: '', reasoning: '', toolCalls: new Map(), replies: isGroup ? [] : undefined })
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
      running: null,
      messages: current.messages.some((entry) => entry.id === message.id)
        ? current.messages.map((entry) => entry.id === message.id ? message : entry)
        : [...current.messages, message],
    } : current)

    try {
      const onEvent = (event: CodexChatStreamEvent) => {
        if (streamAbortRef.current !== controller || controller.signal.aborted) return
        if (isGroup && event.type === 'user') {
          accepted = true
          putMessage(event.message)
          setLiveTurn((current) => current ? { ...current, userText: '', userRouting: undefined, flags: [], attachments: [], mediaAttachments: [] } : current)
          void queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
        } else if (event.type === 'speaker') {
          updateReply(event.profileId, () => ({ profileId: event.profileId, text: '', reasoning: '', toolCalls: new Map() }))
          keepSpeakers(event.speakers, event.queue)
        } else if (event.type === 'queue') {
          keepSpeakers(event.speakers, event.queue)
        } else if (event.type === 'notice') {
          showSnackbar({ message: event.message })
        } else if (event.type === 'routing') {
          if (event.profileId !== undefined) updateReply(event.profileId, (reply) => ({ ...reply, routing: event.routing }))
          else setLiveTurn((current) => current ? { ...current, routing: event.routing } : current)
        } else if (event.type === 'translating') {
          if (event.profileId !== undefined) updateReply(event.profileId, (reply) => ({ ...reply, translating: true }))
          else setLiveTurn((current) => current ? { ...current, translating: true } : current)
        } else if (isGroup && event.type === 'done') {
          putMessage(event.message)
          // New jobs can finish while other members are still answering.
          void queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(sentThreadId) })
          setLiveTurn((current) => current ? {
            ...current,
            replies: (current.replies ?? []).filter((reply) => reply.profileId !== event.message.speaker_profile_id),
            replacingMessageId: undefined,
          } : current)
        } else if ((event.type === 'delta' || event.type === 'text' || event.type === 'reasoning' || event.type === 'tool') && event.profileId !== undefined) {
          const groupEvent = event
          updateReply(event.profileId, (reply) => {
            if (groupEvent.type === 'delta') return { ...reply, text: reply.text + groupEvent.text }
            if (groupEvent.type === 'text') return { ...reply, text: groupEvent.text }
            if (groupEvent.type === 'reasoning') return { ...reply, reasoning: reply.reasoning + groupEvent.text }
            return { ...reply, toolCalls: new Map(reply.toolCalls).set(groupEvent.call.id, groupEvent.call) }
          })
        } else if (event.type === 'delta') {
          setLiveTurn((current) => (current ? { ...current, text: current.text + event.text } : current))
        } else if (event.type === 'text') {
          setLiveTurn((current) => (current ? { ...current, text: event.text } : current))
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
          // Proposals are attached when the thread is read, so a reply that proposed something reloads it now.
          if (event.message.tool_calls.some((call) => call.tool.startsWith('propose_') || call.tool === 'offer_choices')) void queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(sentThreadId) })
          setLiveTurn((current) => current ? { ...current, replacingMessageId: event.message.id, userText: '', userRouting: undefined, flags: [], attachments: [], mediaAttachments: [] } : current)
        } else if (event.type === 'error') {
          // The full text stays on the failed message (its error chip); the toast only names the reason.
          showSnackbar({ message: summarizeChatError(event.message, t), tone: 'error' })
        }
      }
      if (rewrite?.continue) await streamChatContinue(sentThreadId, rewrite.messageId, onEvent, controller.signal)
      else if (rewrite) await streamChatRewrite(sentThreadId, rewrite.messageId, rewrite.content, onEvent, controller.signal)
      else await streamCodexChatMessage(sentThreadId, text, onEvent, controller.signal, attachments.map((file) => file.id), flags.map((flag) => flag.id), picked, mediaAttachments.map((item) => item.compositeHash), replyingTo?.quote.messageId, pageAllowed && !chosen?.withoutPage ? capturePage?.() : undefined, chosen ? { proposalId: chosen.proposalId, answers: chosen.labels } : undefined)
    } catch (error) {
      if (!controller.signal.aborted) {
        showSnackbar({ message: summarizeChatError(getErrorMessage(error, t({ ko: '응답 실패', en: 'Reply failed' })), t), tone: 'error' })
        if (!accepted && !rewrite && attachmentEpoch.current === sentAttachmentEpoch) {
          if (!draftReplyRef.current) setDraftReply(replyingTo)
          setDraft(sentThreadId, (current) => current || (picked.length ? '' : typed))
          setDraftAttachments(attachments)
          attachmentsRef.current = attachments
          setDraftMediaAttachments(mediaAttachments)
          mediaAttachmentsRef.current = mediaAttachments
          setDraftPostRefs(postRefs)
          postRefsRef.current = postRefs
          setPicks(picked)
          if (chosen && !choiceRef.current) setChoice(chosen)
        }
      }
    } finally {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(sentThreadId) }),
        queryClient.invalidateQueries({ queryKey: codexChatMediaQueryKey(sentThreadId) }),
        queryClient.invalidateQueries({ queryKey: threadLorebooksQueryKey(sentThreadId) }),
        queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY }),
      ])
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null
        streamThreadRef.current = null
        setLiveTurn(null)
      }
      settle()
    }
    return accepted
  }, [capturePage, queryClient, showSnackbar, t, setDraftReply, setDraft, setChoice])

  const send = useCallback(async (threadId: number, text?: string) => { await reply(threadId, undefined, text) }, [reply])

  const selectPendingGreeting = useCallback((index: number) => {
    const pending = pendingRef.current
    if (!pending?.greeting || startingRef.current || index < 0 || index >= pending.greeting.greetings.length) return
    pendingRef.current = { ...pending, greeting: { ...pending.greeting, index, text: pending.greeting.greetings[index] } }
    setPendingChat(pendingRef.current)
  }, [])

  const sendPending = useCallback(async (text: string) => {
    const pending = pendingRef.current
    if (!pending?.greeting || startingRef.current) return
    startingRef.current = true
    setIsStartingChat(true)
    let threadId: number
    try {
      threadId = (await createCodexChatThread(pending.profileId, pending.userProfileId, pending.greeting.index)).id
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '채팅을 만들지 못했어.', en: 'Could not start a chat.' })), tone: 'error' })
      return
    } finally {
      startingRef.current = false
      setIsStartingChat(false)
    }
    // Saved: from here it is an ordinary chat. A first message that fails comes back as that chat's draft.
    pendingRef.current = null
    setPendingChat(null)
    setDraft(PENDING_DRAFT_KEY, '')
    // Loaded before the first message goes out (greeting only), as an opened chat would be: the stored message must
    // not show next to the streamed one.
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY }),
      queryClient.fetchQuery({ queryKey: codexChatThreadQueryKey(threadId), queryFn: () => getCodexChatThread(threadId) }).catch(() => undefined),
    ])
    // The new chat starts from the default appearance slot, copied on the server.
    void queryClient.invalidateQueries({ queryKey: CHAT_APPEARANCE_QUERY_KEY })
    switchComposer(threadId)
    setListOpen(false)
    setView('chat')
    await reply(threadId, undefined, text)
  }, [queryClient, reply, setDraft, showSnackbar, switchComposer, t])
  const regenerate = useCallback((threadId: number, messageId: number) => reply(threadId, { messageId }), [reply])
  const continueReply = useCallback((threadId: number, messageId: number) => reply(threadId, { messageId, continue: true }), [reply])
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
    draftReply,
    setDraftReply,
    canUse,
    isPanelOpen,
    openPanel,
    closePanel,
    view,
    setView,
    selectedThreadId,
    selectThread,
    settleSelection,
    listOpen,
    setListOpen: showList,
    pendingChat,
    prepareChat,
    selectPendingGreeting,
    sendPending,
    isStartingChat,
    drafts,
    setDraft,
    keepDrafts,
    picks,
    togglePick,
    removePick,
    choice,
    toggleChoice,
    clearChoice,
    currentLiveTurn,
    draftAttachments,
    draftMediaAttachments,
    setMediaAttachments,
    removeMediaAttachment,
    toggleMediaAttachment,
    draftPostRefs,
    togglePostReference,
    attachmentsUploading,
    addAttachments,
    removeAttachment,
    uploadAttachments,
    send,
    regenerate,
    continueReply,
    editMessage,
    stop,
    messageFocus,
    focusMessage,
    clearMessageFocus,
  }), [draftReply, setDraftReply, canUse, clearMessageFocus, closePanel, drafts, setDraft, keepDrafts, focusMessage, isPanelOpen, isStartingChat, currentLiveTurn, messageFocus, openPanel, picks, togglePick, removePick, choice, toggleChoice, clearChoice, selectThread, settleSelection, selectedThreadId, listOpen, showList, send, regenerate, continueReply, editMessage, pendingChat, prepareChat, selectPendingGreeting, sendPending, stop, view, draftAttachments, draftMediaAttachments, setMediaAttachments, removeMediaAttachment, toggleMediaAttachment, draftPostRefs, togglePostReference, attachmentsUploading, addAttachments, removeAttachment, uploadAttachments])

  const referencePanelOpen = canUse && isPanelOpen
  const referenceApi = useMemo<CodexChatReferenceApi>(() => ({ panelOpen: referencePanelOpen, draftMediaAttachments, toggleMediaAttachment, draftPostRefs, togglePostReference, focusMessage }), [referencePanelOpen, draftMediaAttachments, toggleMediaAttachment, draftPostRefs, togglePostReference, focusMessage])

  return (
    <CodexChatContext.Provider value={api}>
      <CodexChatReferenceContext.Provider value={referenceApi}>
        <CodexChatLiveContext.Provider value={liveTurn}>{children}</CodexChatLiveContext.Provider>
      </CodexChatReferenceContext.Provider>
    </CodexChatContext.Provider>
  )
}
