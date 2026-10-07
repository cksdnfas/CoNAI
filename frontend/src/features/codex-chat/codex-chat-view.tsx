import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useIsMutating, useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { Activity, ArrowLeft, ArrowUp, Download, Eraser, Flag, FoldVertical, LayoutGrid, Maximize2, Minimize2, MoreHorizontal, Plus, SlidersHorizontal, Square, Target, Trash2, TriangleAlert, UserPlus, UserRound, X } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { Spinner } from '@/components/ui/loading-state'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import { ChatPageConnectButton, ChatPageConnectionNotice } from './chat-page-context'
import {
  CHAT_APPEARANCE_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  chatProfileBackgroundUrl,
  chatProfileEmoticonsQueryKey,
  listChatProfileEmoticons,
  deleteCodexChatThread,
  bulkChatAction,
  CHAT_BACKUP_FOLDER,
  getThreadLorebooks,
  LoreDecisionsNeededError,
  threadLorebooksQueryKey,
  getCodexChatThread,
  mergeThreadTail,
  editChatReplyText,
  branchCodexChatThread,
  importCodexChatThread,
  importChatFromFiles,
  getCodexChatRunning,
  listChatProfiles,
  listCodexChatThreads,
  selectChatAlternative,
  clearCodexChatThread,
  createGroupChat,
  editChatBlock,
  summarizeCodexChatThread,
  updateCodexChatThreadContext,
  readThreadFlagIds,
  setChatThreadFlags,
  updateChatListState,
  type ChatEmoticon,
  type ChatSearchResult,
  type ChatProfileSummary,
  type CodexChatMessage,
  type ChatBlocksState,
  type ChatDisplayBlock,
  type CodexChatThread,
  type CodexChatThreadDetail,
  type LoreMergePreview,
  type OwnedChatLorebook,
  type ThreadLorebookAction,
} from '@/lib/api-codex-chat'
import { getCodexGenerationStatus } from '@/lib/api-image-generation-queue'
import { getErrorMessage } from '@/lib/error-message'
import { useMinWidth } from '@/lib/use-min-width'
import { cn } from '@/lib/utils'
import { CHAT_APPEARANCE_ICON as AppearanceIcon, CHAT_MESSAGE_GAP_PX, CHAT_WIDTH_CLASS, ChatAppearancePopover, chatBackgroundLook, chatTranscriptStyle, useChatAppearance, type ChatBackgroundFit } from './chat-appearance'
import { ChatBlockChangesContext, type BlockAction } from './chat-display-block'
import { ChatProfileAvatar } from './chat-profile-avatar'
import { ChatStatusAside, ChatStatusFloating, ChatStatusStrip, useStatusPanelLayout, type ChatStatusBlock, type ChatStatusData } from './chat-status-panel'
import { ChatProfilePicker } from './chat-profile-picker'
import { ChatThreadList, type ChatListPatch } from './chat-thread-list'
import { ChatAttachButton, ChatDraftAttachments } from './chat-attachments'
import { ChatFlagButton, ChatFlagManagerModal, ChatFlagTray, useChatFlags } from './chat-flags'
import { ChatSuggestButton, ChatSuggestTray, useReplySuggestions } from './chat-suggestions'
import { ChatUserProfileManagerModal, ChatUserProfilePickModal, newChatUserProfile, useChatUserProfiles, userSpeakerOf } from './chat-user-profiles'
import {
  CODEX_CHAT_THREADS_QUERY_KEY,
  codexChatCompactMutationKey,
  codexChatMediaQueryKey,
  codexChatThreadQueryKey,
  defaultThreadId,
  PENDING_DRAFT_KEY,
  useCodexChat,
  type CodexChatApi,
} from './codex-chat-context'
import { CodexChatAssistantMessage, type ChatSpeaker } from './codex-chat-message'
import { ChatLiveMessage, ChatSavedMessages } from './chat-transcript'
import { Button } from '@/components/ui/button'
import { CHAT_COMMANDS, ChatCommandList, type ChatCommand } from './chat-commands'
import { ChatExportDialog, ChatSearchInput, ChatSearchResults } from './chat-search-export'
import { GROUP_MEMBER_MAX, GroupAvatarStack, GroupInviteDialog, GroupMembersPopover, GroupTurnStatus, MentionList, mentionOptions, type GroupInviteMode, type MentionOption } from './chat-group'
import { mentionQueryAt } from './chat-mentions'
import { parseMentions, type StoredFileEntry } from '@conai/shared'
import { ChatReplyPreview } from './chat-reply'
import { ChatDeleteDialog } from './chat-delete-dialog'
import { LorebookMergeDialog } from './lorebook-merge-dialog'
import type { ChatEmoticonMap } from './chat-markdown'

const CodexChatContextView = lazy(async () => ({ default: (await import('./codex-chat-context-view')).CodexChatContextView }))
const CodexEngineContextView = lazy(async () => ({ default: (await import('./codex-chat-context-view')).CodexEngineContextView }))
const GroupContextView = lazy(async () => ({ default: (await import('./codex-chat-context-view')).GroupContextView }))
const CodexChatGallery = lazy(async () => ({ default: (await import('./codex-chat-gallery')).CodexChatGallery }))

const RUNNING_POLL_MS = 2000
const PENDING_JOB_POLL_MS = 3000
const COMPOSER_MAX_HEIGHT_PX = 220
const MESSAGE_FLASH_MS = 1600
const MESSAGE_PAGE_SIZE = 80
/** Messages a poll fetches; the rest come from the copy already loaded. */
const POLL_TAIL_MESSAGES = 40

/** Where each chat was left when read part-way up (absent: at the latest message), for coming back to it. */
const readingPositions = new Map<number, number>()
/** The chat list screen's scroll, kept while a chat covers it. */
let chatListScrollTop = 0
const restoreChatListScroll = (node: HTMLDivElement | null) => { if (node) node.scrollTop = chatListScrollTop }

/** Stable, so useQueries keeps the combined result until a query changes. */
const pickEmoticonData = (results: UseQueryResult<ChatEmoticon[]>[]) => results.map((result) => result.data)

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

/** How the picture fills the frame: covering it, fitting inside, or repeated at a fixed width. */
const BACKGROUND_FIT_CLASS: Record<ChatBackgroundFit, string> = { cover: 'bg-cover bg-no-repeat', contain: 'bg-contain bg-no-repeat', tile: 'bg-repeat bg-[length:320px_auto]' }

/** The profile's picture behind the transcript, dimmed (and optionally blurred) so the text stays readable. */
function ChatBackground({ url, dim, blur, fit }: { url: string; dim: number; blur: number; fit: ChatBackgroundFit }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className={cn('absolute inset-0 bg-center', BACKGROUND_FIT_CLASS[fit])}
        // Scaled a little when blurred, so the soft edge stays outside the frame.
        style={{ backgroundImage: `url("${url}")`, filter: blur > 0 ? `blur(${blur}px)` : undefined, transform: blur > 0 ? 'scale(1.06)' : undefined }}
      />
      <div className="absolute inset-0 bg-background" style={{ opacity: dim / 100 }} />
    </div>
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
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null)
  const [commandPending, setCommandPending] = useState(false)
  const [commandIndex, setCommandIndex] = useState(0)
  const [dismissedCommand, setDismissedCommand] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [flagTrayOpen, setFlagTrayOpen] = useState(false)
  const [flagManagerOpen, setFlagManagerOpen] = useState(false)
  const [userProfileManagerOpen, setUserProfileManagerOpen] = useState(false)
  /** A new chat (one profile) or room (several, the first representing it) waiting for the user to say who they are in it. */
  const [pendingStart, setPendingStart] = useState<number[] | null>(null)
  const flagButtonRef = useRef<HTMLButtonElement | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [invite, setInvite] = useState<GroupInviteMode | null>(null)
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  /** The menu hands focus back to its button as it closes; skip that when the appearance popover takes over. */
  const appearanceOpenRef = useRef(false)
  const [caret, setCaret] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [dismissedMention, setDismissedMention] = useState<string | null>(null)
  const mentionListId = useId()
  const commandListId = useId()
  const [historyWindow, setHistoryWindow] = useState<{ threadId: number | null; firstId: number | null }>({ threadId: null, firstId: null })
  // Status panel: docked / floating on a wide page (kept per browser), a fold-out strip elsewhere.
  const [statusLayout, setStatusLayout] = useStatusPanelLayout()
  const [statusKey, setStatusKey] = useState<string | null>(null)
  const [stripOpen, setStripOpen] = useState(false)
  const statusAreaRef = useRef<HTMLDivElement | null>(null)
  const isWide = useMinWidth(1024)
  const hasSideList = useMinWidth(768)
  const prependHeightRef = useRef<number | null>(null)
  const followBottomRef = useRef(true)
  const { liveTurn, selectedThreadId, selectThread, listOpen, setListOpen, view, setView, messageFocus, clearMessageFocus, prepareChat, isStartingChat, editMessage, regenerate, continueReply } = chat

  const profilesQuery = useQuery({ queryKey: CHAT_PROFILES_QUERY_KEY, queryFn: listChatProfiles, staleTime: 30_000 })
  const profiles = useMemo(() => profilesQuery.data ?? [], [profilesQuery.data])
  const profilesById = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles])
  const userProfilesQuery = useChatUserProfiles()
  const userProfiles = useMemo(() => userProfilesQuery.data ?? [], [userProfilesQuery.data])
  // A room picked straight from the profile list: named after its members, represented by the first one picked.
  const createGroupMutation = useMutation({
    mutationFn: ({ profileIds, userProfileId }: { profileIds: number[]; userProfileId?: number | null }) => createGroupChat({
      profileIds,
      representativeId: profileIds[0],
      title: profileIds.flatMap((id) => profilesById.get(id)?.name ?? []).join(', ').slice(0, 60).trim() || undefined,
      userProfileId: userProfileId ?? null,
    }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: CHAT_APPEARANCE_QUERY_KEY })
      selectThread(created.id)
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '그룹을 만들지 못했어.', en: 'Could not create the group.' })), tone: 'error' }),
  })
  // A 1:1 chat opens unsaved and is saved with its first message; a room is saved at once (its dialog is the commitment).
  const startWith = useCallback(async (profileIds: number[], userProfileId?: number | null) => {
    if (profileIds.length === 1) prepareChat(profileIds[0], userProfileId)
    else if (profileIds.length > 1) await createGroupMutation.mutateAsync({ profileIds, userProfileId })
  }, [createGroupMutation, prepareChat])
  /** Start a chat or room, asking who the user is first when that is not settled by the user profiles. */
  const beginChat = useCallback(async (profileIds: number[]) => {
    if (newChatUserProfile(userProfiles).kind === 'pick') setPendingStart(profileIds)
    else await startWith(profileIds)
  }, [startWith, userProfiles])

  const threadsQuery = useQuery({
    queryKey: CODEX_CHAT_THREADS_QUERY_KEY,
    queryFn: listCodexChatThreads,
    // A reply this tab is not streaming (another tab, or started before a reload): watch for it to end.
    refetchInterval: (query) => (query.state.data?.some((entry) => entry.running && entry.id !== liveTurn?.threadId) ? RUNNING_POLL_MS * 2 : false),
  })
  const threads = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data])
  const activeThreadId = selectedThreadId === undefined ? defaultThreadId(threads) : selectedThreadId
  const { keepDrafts, settleSelection } = chat
  useEffect(() => {
    if (selectedThreadId === undefined && activeThreadId !== null) settleSelection(activeThreadId)
  }, [activeThreadId, selectedThreadId, settleSelection])
  useEffect(() => {
    if (threadsQuery.data) keepDrafts(threadsQuery.data.map((entry) => entry.id))
  }, [keepDrafts, threadsQuery.data])
  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? null
  // The new chat being prepared (not saved yet) stands in for a chat until its first message saves it.
  const pendingChat = activeThreadId === null ? chat.pendingChat : null
  const pendingProfile = pendingChat ? profilesById.get(pendingChat.profileId) ?? null : null
  const draftKey = activeThreadId ?? (pendingProfile ? PENDING_DRAFT_KEY : null)
  const draft = draftKey !== null ? chat.drafts[draftKey] ?? '' : ''
  const setChatDraft = chat.setDraft
  const setDraft = useCallback((next: string | ((current: string) => string)) => {
    if (draftKey !== null) setChatDraft(draftKey, next)
  }, [draftKey, setChatDraft])

  const threadQuery = useQuery({
    queryKey: codexChatThreadQueryKey(activeThreadId),
    queryFn: async () => {
      const id = activeThreadId as number
      const cached = queryClient.getQueryData<CodexChatThreadDetail>(codexChatThreadQueryKey(id))
      if (cached?.running && !cached.pendingJobs) {
        const status = await getCodexChatRunning(id)
        if (status.running && status.latestMessageId === (cached.messages.at(-1)?.id ?? null)) {
          return { ...cached, running: status.running }
        }
      }
      // While a reply or a generation job is still landing, only the end of the transcript can change.
      if (cached && (cached.running || cached.pendingJobs)) {
        const merged = mergeThreadTail(cached, await getCodexChatThread(id, POLL_TAIL_MESSAGES))
        if (merged) return merged
      }
      return getCodexChatThread(id)
    },
    enabled: activeThreadId !== null,
    // A turn started before a reload keeps running on the server, and generation jobs finish after the reply that
    // started them: poll until the turn is stored and every job has landed.
    refetchInterval: (query) => (query.state.data?.running && liveTurn?.threadId !== activeThreadId ? RUNNING_POLL_MS : query.state.data?.pendingJobs ? PENDING_JOB_POLL_MS : false),
  })
  const thread = threadQuery.data?.thread ?? activeThread
  const pendingUserProfileId = pendingChat?.userProfileId ?? null
  const userSpeaker = useMemo(() => userSpeakerOf(thread ?? { user_profile_id: pendingUserProfileId }, userProfiles), [thread, pendingUserProfileId, userProfiles])
  const profile = thread?.profile_id ? profilesById.get(thread.profile_id) ?? null : pendingProfile
  const isCodexThread = (thread?.engine ?? pendingProfile?.engine) !== 'llm'
  const { appearance } = useChatAppearance(activeThreadId, chat.canUse)
  // Chat flags: the account's own; which are on is kept per chat (on the thread).
  const flagsQuery = useChatFlags(chat.canUse)
  const flags = useMemo(() => flagsQuery.data ?? [], [flagsQuery.data])
  const activeFlagIds = useMemo(() => readThreadFlagIds(thread).filter((id) => flags.some((flag) => flag.id === id)), [flags, thread])
  const toggleFlag = useCallback((flagId: number) => {
    if (activeThreadId === null) return
    const on = new Set(activeFlagIds)
    if (on.has(flagId)) on.delete(flagId)
    else on.add(flagId)
    const next = flags.filter((flag) => on.has(flag.id)).map((flag) => flag.id)
    queryClient.setQueryData<CodexChatThreadDetail>(codexChatThreadQueryKey(activeThreadId), (current) => current ? { ...current, thread: { ...current.thread, flag_ids: next.length ? JSON.stringify(next) : null } } : current)
    setChatThreadFlags(activeThreadId, next).catch((error: unknown) => {
      void queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(activeThreadId) })
      showSnackbar({ message: getErrorMessage(error, t({ ko: '플래그를 바꾸지 못했어.', en: 'Could not change the flag.' })), tone: 'error' })
    })
  }, [activeFlagIds, activeThreadId, flags, queryClient, showSnackbar, t])
  const closeFlagTray = useCallback(() => setFlagTrayOpen(false), [])
  useEffect(() => setFlagTrayOpen(false), [activeThreadId])
  // Group rooms: `profile` is the representative (the room's look); every member speaks with its own face and emoticons.
  const isGroup = thread?.kind === 'group'
  const group = isGroup ? threadQuery.data?.group ?? null : null
  const memberIdsKey = (isGroup ? group?.memberIds ?? activeThread?.member_profile_ids ?? [] : []).join(',')
  const memberProfiles = useMemo(() => memberIdsKey ? memberIdsKey.split(',').flatMap((id) => profilesById.get(Number(id)) ?? []) : [], [memberIdsKey, profilesById])
  const memberNames = useMemo(() => memberProfiles.map((member) => member.name), [memberProfiles])
  const speakerProfiles = useMemo(() => isGroup ? memberProfiles : profile ? [profile] : [], [isGroup, memberProfiles, profile])
  const emoticonData = useQueries({
    queries: speakerProfiles.map((entry) => ({
      queryKey: chatProfileEmoticonsQueryKey(entry.id),
      queryFn: () => listChatProfileEmoticons(entry.id),
      enabled: Boolean(entry.style?.emoticonGroupIds?.length),
      staleTime: 60_000,
    })),
    combine: pickEmoticonData,
  })
  const emoticonsById = useMemo(() => {
    const result = new Map<number, ChatEmoticonMap>()
    speakerProfiles.forEach((entry, index) => {
      const data = emoticonData[index]
      if (!data?.length) return
      const byKeyword = new Map<string, string>()
      for (const emoticon of data) for (const keyword of emoticon.keywords) byKeyword.set(keyword.toLowerCase(), emoticon.compositeHash)
      result.set(entry.id, { profileId: entry.id, byKeyword })
    })
    return result
  }, [emoticonData, speakerProfiles])
  const toSpeaker = useCallback((entry: ChatProfileSummary): ChatSpeaker => ({
    name: entry.name, avatar: entry.avatar, engine: entry.engine, roleplay: entry.style?.roleplay ?? false, blocks: entry.style?.blocks, cast: entry.style?.cast,
    emoticons: emoticonsById.get(entry.id) ?? null, mentions: isGroup ? memberNames : undefined,
  }), [emoticonsById, isGroup, memberNames])
  const speaker = useMemo<ChatSpeaker | null>(() => profile ? toSpeaker(profile) : null, [profile, toSpeaker])
  const speakerOf = useCallback((profileId: number | null) => {
    const entry = profileId === null ? undefined : profilesById.get(profileId)
    return entry ? toSpeaker(entry) : null
  }, [profilesById, toSpeaker])
  const backgroundUrl = appearance.showBackground && profile?.backgroundVersion ? chatProfileBackgroundUrl(profile.id, profile.backgroundVersion) : null

  const codexStatusQuery = useQuery({ queryKey: ['codex-generation-status'], queryFn: getCodexGenerationStatus, staleTime: 30_000, enabled: isCodexThread && (thread !== null || pendingProfile !== null) })
  const codexStatus = codexStatusQuery.data?.data ?? null

  // One reply streams at a time. A stream in another chat still blocks sending and rewriting here (isBusy), but only
  // this chat's own reply makes it "replying" (the stop button, its server state).
  const isStreaming = liveTurn !== null
  const streamingHere = liveTurn?.threadId === activeThreadId
  // Compacting this chat (here or from the context view) holds it like a reply; a Codex compaction also reads as
  // "running" on the server, which is not a reply to show or stop.
  const compactMutation = useMutation({
    mutationKey: codexChatCompactMutationKey(activeThreadId),
    mutationFn: async ({ threadId, enableSummary }: { threadId: number; enableSummary: boolean }) => {
      await summarizeCodexChatThread(threadId)
      if (enableSummary) await updateCodexChatThreadContext(threadId, { summaryEnabled: true })
      await queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(threadId) })
    },
  })
  const isCompacting = useIsMutating({ mutationKey: codexChatCompactMutationKey(activeThreadId) }) > 0
  const serverRunning = Boolean(threadQuery.data?.running) && !streamingHere && !isCompacting
  const alternativeMutation = useMutation({
    mutationFn: ({ id, index }: { id: number; index: number }) => selectChatAlternative(activeThreadId as number, id, index),
    onSuccess: async (detail) => {
      queryClient.setQueryData(codexChatThreadQueryKey(detail.thread.id), detail)
      await queryClient.invalidateQueries({ queryKey: codexChatMediaQueryKey(detail.thread.id) })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '답변 전환 실패', en: 'Could not switch answer' })), tone: 'error' }),
  })
  const isBusy = isStreaming || serverRunning || alternativeMutation.isPending || commandPending || isCompacting
  const replacingMessageId = liveTurn?.threadId === activeThreadId ? liveTurn.replacingMessageId : threadQuery.data?.running?.replacingMessageId
  const messages: CodexChatMessage[] = useMemo(() => (threadQuery.data?.messages ?? []).filter((message) => message.id !== replacingMessageId), [threadQuery.data?.messages, replacingMessageId])
  // Reply suggestions: made on request only, kept until the chat moves on (the last message changes).
  const suggestButtonRef = useRef<HTMLButtonElement | null>(null)
  const suggestions = useReplySuggestions({ threadId: activeThreadId, lastMessageId: messages.at(-1)?.id ?? null, enabled: Boolean(profile?.suggestEnabled) && !isBusy })
  const pickSuggestion = useCallback((text: string) => {
    setDraft(text)
    setCaret(text.length)
    suggestions.close()
    composerRef.current?.focus()
  }, [suggestions, setDraft])
  const firstIndex = historyWindow.threadId === activeThreadId ? messages.findIndex((message) => message.id === historyWindow.firstId) : -1
  const visibleCount = firstIndex >= 0 ? messages.length - firstIndex : MESSAGE_PAGE_SIZE
  const focusIndex = messageFocus ? messages.findIndex((message) => message.id === messageFocus.messageId) : -1
  const windowCount = focusIndex >= 0 ? Math.max(visibleCount, messages.length - focusIndex) : visibleCount
  const visibleMessages = useMemo(() => messages.slice(-windowCount), [messages, windowCount])
  const media = threadQuery.data?.media
  const runningFromServer = serverRunning ? threadQuery.data?.running ?? null : null
  // Group rooms: every member answering on the server (an older server sends only the first one).
  const serverReplies = useMemo(() => {
    if (!isGroup || !runningFromServer) return []
    if (runningFromServer.replies) return runningFromServer.replies
    return runningFromServer.speakerProfileId != null ? [{ profileId: runningFromServer.speakerProfileId, text: runningFromServer.text, toolCalls: runningFromServer.toolCalls }] : []
  }, [isGroup, runningFromServer])
  const liveReplyLength = (liveTurn?.replies ?? []).reduce((total, reply) => total + reply.text.length + reply.toolCalls.size, 0)
    + serverReplies.reduce((total, reply) => total + reply.text.length + reply.toolCalls.length, 0)
  const activeView = activeThreadId === null ? 'chat' : view
  // The panel and a phone-width page have no room for the chat list beside a chat: the list is a screen of its own,
  // and a chat (or the picker) goes back to it. With no chat saved yet the picker is all there is.
  const canOpenList = threads.length > 0 && (layout === 'panel' || !hasSideList)
  const showList = canOpenList && listOpen
  // Off while the list covers the chat: coming back remounts the transcript, which scrolls down again.
  const isTranscript = activeView === 'chat' && !showList

  const handleEdit = useCallback(async (id: number, content: string) => {
    if (activeThreadId === null || isBusy) return false
    if (messages.some((message) => message.role === 'user' && message.id > id)) {
      if (!await confirm({ title: t({ ko: '메시지 수정', en: 'Edit message' }), description: t({ ko: '이 메시지 뒤의 대화를 지우고 다시 답할까? 지금까지의 대화는 분기로 남겨둘게.', en: 'Remove the following conversation and answer again? The chat as it is now is kept as a branch.' }), confirmLabel: t({ ko: '수정', en: 'Edit' }), tone: 'destructive' })) return false
      const last = messages[messages.length - 1]
      try {
        if (last) await branchCodexChatThread(activeThreadId, last.id, 'preserve')
        void queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
      } catch (error) {
        showSnackbar({ message: getErrorMessage(error, t({ ko: '분기를 남기지 못해서 수정하지 않았어.', en: 'Could not keep a branch, so nothing was edited.' })), tone: 'error' })
        return false
      }
    }
    return editMessage(activeThreadId, id, content)
  }, [activeThreadId, editMessage, confirm, isBusy, messages, t, queryClient, showSnackbar])
  const handleRegenerate = useCallback((id: number) => {
    if (activeThreadId !== null && !isBusy) void regenerate(activeThreadId, id)
  }, [activeThreadId, regenerate, isBusy])
  const chooseAlternative = alternativeMutation.mutate
  const handleAlternative = useCallback((id: number, index: number) => { if (!isBusy) chooseAlternative({ id, index }) }, [chooseAlternative, isBusy])
  const setDraftReply = chat.setDraftReply
  const handleReply = useCallback((message: CodexChatMessage) => {
    const name = message.role === 'user' ? userSpeaker?.name ?? t({ ko: '사용자', en: 'User' }) : (message.speaker_profile_id ? profilesById.get(message.speaker_profile_id)?.name : profile?.name) ?? t({ ko: '나간 참가자', en: 'Former member' })
    const hash = message.tool_calls.flatMap((call) => call.compositeHashes)[0]
    const media = message.mediaAttachments?.[0] ?? (hash ? { compositeHash: hash, name: t({ ko: '이미지', en: 'Image' }), mimeType: null } : undefined)
    setDraftReply({ threadId: message.thread_id, quote: { messageId: message.id, role: message.role, speakerProfileId: message.speaker_profile_id ?? (message.role === 'assistant' ? profile?.id ?? null : null), speakerName: name, excerpt: message.content.trim().slice(0, 400) || message.attachments?.map((file) => file.name).join(', ') || t({ ko: '이미지·도구 결과', en: 'Image / tool result' }), alternative: message.active_alternative, media } })
    composerRef.current?.focus()
  }, [setDraftReply, userSpeaker, profilesById, profile, t])
  const lastMessage = messages[messages.length - 1]
  // Group rooms: only API LLM members' replies can be regenerated.
  const lastReplyByCodex = isGroup && lastMessage?.speaker_profile_id != null && profilesById.get(lastMessage.speaker_profile_id)?.engine !== 'llm'
  const lastReplyId = lastMessage?.role === 'assistant' && messages.some((message) => message.role === 'user') && !lastReplyByCodex ? lastMessage.id : null
  // Hand edits of replies (API LLM: the chat's own, or an API LLM member's in a room) and continuing a cut reply
  // (API LLM direct chats); any chat can branch.
  const directLlm = !isCodexThread && !isGroup
  const canEditReply = useCallback((message: CodexChatMessage) => {
    if (!isGroup) return directLlm
    const speaker = message.speaker_profile_id != null ? profilesById.get(message.speaker_profile_id) : undefined
    return speaker?.engine === 'llm'
  }, [isGroup, directLlm, profilesById])
  const handleEditReply = useCallback(async (id: number, content: string) => {
    if (activeThreadId === null || isBusy) return false
    try {
      queryClient.setQueryData(codexChatThreadQueryKey(activeThreadId), await editChatReplyText(activeThreadId, id, content))
      return true
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '답변을 고치지 못했어.', en: 'Could not edit the reply.' })), tone: 'error' })
      return false
    }
  }, [activeThreadId, isBusy, queryClient, showSnackbar, t])
  const handleContinue = useCallback((id: number) => {
    if (activeThreadId !== null && !isBusy) void continueReply(activeThreadId, id)
  }, [activeThreadId, continueReply, isBusy])
  const handleBranch = useCallback(async (id: number) => {
    if (activeThreadId === null || isBusy) return
    try {
      const branch = await branchCodexChatThread(activeThreadId, id)
      await queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
      selectThread(branch.id)
      showSnackbar({ message: t({ ko: '여기까지로 새 채팅을 만들었어.', en: 'Branched into a new chat.' }) })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '분기하지 못했어.', en: 'Could not branch.' })), tone: 'error' })
    }
  }, [activeThreadId, isBusy, queryClient, selectThread, showSnackbar, t])
  const handleImport = useCallback(async (file: File) => {
    try {
      const { thread: imported, notes } = await importCodexChatThread(file)
      await queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
      selectThread(imported.id)
      showSnackbar({ message: [t({ ko: '대화를 가져왔어.', en: 'Chat imported.' }), ...notes].join(' ') })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '대화를 가져오지 못했어.', en: 'Could not import the chat.' })), tone: 'error' })
    }
  }, [queryClient, selectThread, showSnackbar, t])
  // Several files may come back at once: open the chat when there is just one, and say what failed.
  const handleImportFiles = async (entries: StoredFileEntry[]) => {
    try {
      const { results } = await importChatFromFiles(entries.map((entry) => entry.id))
      const imported = results.filter((result) => result.threadId !== undefined)
      const failed = results.filter((result) => result.error)
      await queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
      if (imported.length === 1) selectThread(imported[0].threadId)
      else if (imported.length > 1) setListOpen(true)
      const parts = imported.length ? [t({ ko: '대화 {count}개를 가져왔어.', en: 'Imported {count} chats.' }, { count: imported.length }), ...(imported.length === 1 ? imported[0].notes ?? [] : [])] : []
      if (failed.length) parts.push(t({ ko: '{name}: {error}', en: '{name}: {error}' }, { name: failed[0].name || failed[0].fileId, error: failed[0].error ?? '' }) + (failed.length > 1 ? t({ ko: ' 외 {count}개 실패', en: ' and {count} more failed' }, { count: failed.length - 1 }) : ''))
      showSnackbar({ message: parts.join(' '), tone: failed.length ? 'error' : undefined })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '대화를 가져오지 못했어.', en: 'Could not import the chat.' })), tone: 'error' })
    }
  }
  const messageActions = useMemo(() => ({
    busy: isBusy, canRewrite: !isCodexThread, lastReplyId, editingId: editingMessageId, onEditingChange: setEditingMessageId, onEdit: handleEdit, onRegenerate: handleRegenerate, onAlternative: handleAlternative, onReply: handleReply,
    canEditReply, onEditReply: handleEditReply, canContinue: directLlm, onContinue: handleContinue, canBranch: true, onBranch: (id: number) => { void handleBranch(id) },
  }), [isBusy, isCodexThread, lastReplyId, editingMessageId, handleEdit, handleRegenerate, handleAlternative, handleReply, canEditReply, directLlm, handleEditReply, handleContinue, handleBranch])

  // Display block state: the panel's data and the chips in replies. A room lists every member's blocks, keyed
  // `<profileId>:<key>` so two members' `status` blocks stay apart; chips keep the plain key (a message has one speaker).
  const blocksState = threadQuery.data?.blocks ?? null
  const memberBlocks = threadQuery.data?.memberBlocks ?? null
  // A block without a template still shows, as a plain field list.
  const usableBlock = (block: ChatDisplayBlock) => block.enabled && block.key
  const statusBlocks = useMemo<ChatStatusBlock[]>(() => {
    if (isGroup) return memberProfiles.flatMap((member) => (member.style?.blocks ?? []).filter(usableBlock).map((block) => ({ ...block, key: `${member.id}:${block.key}`, label: memberProfiles.length > 1 ? `${member.name} · ${block.key}` : block.key })))
    return (profile?.style?.blocks ?? []).filter(usableBlock)
  }, [isGroup, memberProfiles, profile?.style?.blocks])
  const panelState = useMemo<ChatBlocksState | null>(() => {
    if (!isGroup) return blocksState
    if (!memberBlocks) return null
    const merged: ChatBlocksState = { state: {}, changes: {}, edits: {} }
    for (const [profileId, folded] of Object.entries(memberBlocks)) {
      const prefix = (key: string) => `${profileId}:${key}`
      for (const [key, data] of Object.entries(folded.state)) merged.state[prefix(key)] = data
      for (const [messageId, byKey] of Object.entries(folded.changes)) merged.changes[Number(messageId)] = { ...(merged.changes[Number(messageId)] ?? {}), ...Object.fromEntries(Object.entries(byKey).map(([key, list]) => [prefix(key), list])) }
      for (const [editId, byKey] of Object.entries(folded.edits)) merged.edits[editId] = Object.fromEntries(Object.entries(byKey).map(([key, list]) => [prefix(key), list]))
    }
    return merged
  }, [blocksState, isGroup, memberBlocks])
  const chipChanges = useMemo<ChatBlocksState['changes'] | null>(() => {
    if (!isGroup) return blocksState?.changes ?? null
    if (!memberBlocks) return null
    return Object.assign({}, ...Object.values(memberBlocks).map((folded) => folded.changes)) as ChatBlocksState['changes']
  }, [blocksState, isGroup, memberBlocks])
  const hasStatus = panelState !== null && statusBlocks.length > 0 && isTranscript && thread !== null
  const wideStatus = layout === 'page' && isWide
  const activeStatusKey = statusBlocks.some((block) => block.key === statusKey) ? statusKey as string : statusBlocks[0]?.key ?? ''
  useEffect(() => setStripOpen(false), [activeThreadId, isTranscript])
  const handleBlockEdit = useCallback(async (key: string, data: Record<string, unknown> | null) => {
    if (activeThreadId === null) return
    try {
      const separator = isGroup ? key.indexOf(':') : -1
      const detail = separator > 0
        ? await editChatBlock(activeThreadId, key.slice(separator + 1), data, Number(key.slice(0, separator)))
        : await editChatBlock(activeThreadId, key, data)
      queryClient.setQueryData(codexChatThreadQueryKey(activeThreadId), detail)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '상태를 바꾸지 못했어.', en: 'Could not change the status.' })), tone: 'error' })
      throw error
    }
  }, [activeThreadId, isGroup, queryClient, showSnackbar, t])
  const { picks, togglePick, removePick } = chat
  const pickSet = useMemo(() => new Set(picks), [picks])
  const handleBlockAction = useCallback((key: string, action: BlockAction) => {
    if (action.kind === 'pick') togglePick(action.label)
    else if (panelState && !isBusy) void handleBlockEdit(key, { ...(panelState.state[key] ?? {}), [action.field]: action.value }).catch(() => undefined)
  }, [panelState, handleBlockEdit, isBusy, togglePick])
  const statusData = useMemo<ChatStatusData | null>(() => panelState ? { blocks: statusBlocks, state: panelState, messages, busy: isBusy, onEdit: handleBlockEdit, picks: pickSet, onAction: handleBlockAction } : null, [panelState, statusBlocks, messages, isBusy, handleBlockEdit, pickSet, handleBlockAction])
  const openStatus = useCallback((key: string, messageId: number | null) => {
    // In a room the chip's message tells whose block it is; a streaming reply falls back to the first member with it.
    const speakerId = isGroup ? messages.find((message) => message.id === messageId)?.speaker_profile_id ?? null : null
    const target = isGroup ? (speakerId !== null ? `${speakerId}:${key}` : statusBlocks.find((block) => block.key.endsWith(`:${key}`))?.key ?? key) : key
    setStatusKey(target)
    if (wideStatus) setStatusLayout({ open: true })
    else setStripOpen(true)
  }, [isGroup, messages, setStatusLayout, statusBlocks, wideStatus])
  const blockChanges = useMemo(() => chipChanges ? { changes: chipChanges, open: openStatus } : null, [chipChanges, openStatus])

  // Deleting a chat asks whether to back it up first, and what becomes of its own lorebook when that has entries (C);
  // a merge with duplicates goes through the merge dialog (D) and is retried with its decisions (and the backup).
  const [deleteTarget, setDeleteTarget] = useState<{ threadId: number; book: OwnedChatLorebook | null } | null>(null)
  const [deleteMerge, setDeleteMerge] = useState<{ threadId: number; targetId: number; preview: LoreMergePreview; backupDate?: string } | null>(null)
  /** A deleted chat: stop and drop its queries and take it out of the cached list, so nothing asks for its id again. */
  const dropThread = (threadId: number) => {
    void queryClient.cancelQueries({ queryKey: codexChatThreadQueryKey(threadId) })
    queryClient.setQueryData<Array<{ id: number }>>(CODEX_CHAT_THREADS_QUERY_KEY, (current) => current?.filter((entry) => entry.id !== threadId))
    queryClient.removeQueries({ queryKey: codexChatThreadQueryKey(threadId) })
    queryClient.removeQueries({ queryKey: codexChatMediaQueryKey(threadId) })
    queryClient.removeQueries({ queryKey: threadLorebooksQueryKey(threadId) })
  }
  // The open chat is gone: drop it before selecting, so the chat that becomes active is the next one.
  const forgetThread = (threadId: number) => {
    dropThread(threadId)
    selectThread(undefined)
    setListOpen(true)
  }
  const backedUpMessage = (date: string) => t({ ko: '백업하고 지웠어 · 파일 보관함/{folder}/{date}', en: 'Backed up and deleted · Files/{folder}/{date}' }, { folder: CHAT_BACKUP_FOLDER, date })
  const afterDelete = async (threadId: number, backupDate?: string) => {
    setDeleteTarget(null)
    setDeleteMerge(null)
    forgetThread(threadId)
    if (backupDate) showSnackbar({ message: backedUpMessage(backupDate) })
    await queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
  }
  const deleteMutation = useMutation({
    mutationFn: ({ threadId, lorebook, backupDate }: { threadId: number; lorebook?: ThreadLorebookAction; backupDate?: string }) => deleteCodexChatThread(threadId, lorebook, backupDate),
    onSuccess: (_result, { threadId, backupDate }) => afterDelete(threadId, backupDate),
    onError: (error, { threadId, lorebook, backupDate }) => {
      if (error instanceof LoreDecisionsNeededError && lorebook?.action === 'merge') {
        setDeleteTarget(null)
        setDeleteMerge({ threadId, targetId: lorebook.targetId, preview: error.preview, backupDate })
        return
      }
      showSnackbar({ message: getErrorMessage(error, t({ ko: '삭제 실패', en: 'Delete failed' })), tone: 'error' })
    },
  })
  // The chat list's selection: one request, then a line on how it went (skipped and failed chats named by count).
  const runBulk = async (threadIds: number[], action: 'archive' | 'unarchive' | 'delete', backupDate?: string) => {
    try {
      const { results } = await bulkChatAction(threadIds, action, backupDate)
      const done = results.filter((result) => result.status === 'done').map((result) => result.threadId)
      const skipped = results.filter((result) => result.status === 'skipped').length
      const failed = results.filter((result) => result.status === 'failed')
      if (action === 'delete') {
        for (const threadId of done) dropThread(threadId)
        if (activeThreadId !== null && done.includes(activeThreadId)) {
          selectThread(undefined)
          setListOpen(true)
        }
      }
      await queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
      const verb = action === 'delete' ? (backupDate ? t({ ko: '백업하고 지웠어', en: 'backed up and deleted' }) : t({ ko: '지웠어', en: 'deleted' })) : action === 'archive' ? t({ ko: '보관했어', en: 'archived' }) : t({ ko: '보관 해제했어', en: 'unarchived' })
      const parts = [t({ ko: '{count}개 {verb}', en: '{count} {verb}' }, { count: done.length, verb })]
      if (skipped) parts.push(t({ ko: '답변 중 {count}개 건너뜀', en: '{count} replying, skipped' }, { count: skipped }))
      if (failed.length) parts.push(t({ ko: '{count}개 실패: {reason}', en: '{count} failed: {reason}' }, { count: failed.length, reason: failed[0].reason ?? '' }))
      if (backupDate && done.length) parts.push(`${t({ ko: '파일 보관함', en: 'Files' })}/${CHAT_BACKUP_FOLDER}/${backupDate}`)
      showSnackbar({ message: parts.join(' · '), tone: failed.length ? 'error' : undefined })
      return failed.length === 0
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '정리하지 못했어.', en: 'Could not update the chats.' })), tone: 'error' })
      return false
    }
  }

  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current
    if (node) {
      node.scrollTop = node.scrollHeight
    }
  }, [])

  // What grows the transcript after it renders (a reply's quote card, a late translation, an image loading) or shrinks
  // its frame (the composer growing) keeps a reader who was at the bottom there.
  const transcriptObserverRef = useRef<ResizeObserver | null>(null)
  const observeTranscript = useCallback((node: HTMLDivElement | null) => {
    transcriptObserverRef.current?.disconnect()
    transcriptObserverRef.current = null
    if (!node) return
    const observer = new ResizeObserver(() => {
      if (followBottomRef.current && prependHeightRef.current === null) scrollToBottom()
    })
    observer.observe(node)
    if (node.parentElement) observer.observe(node.parentElement)
    transcriptObserverRef.current = observer
  }, [scrollToBottom])

  useLayoutEffect(() => {
    setEditingMessageId(null)
    prependHeightRef.current = null
    // Back in a chat left part-way up: where the reader was; otherwise the latest message.
    const saved = activeThreadId !== null ? readingPositions.get(activeThreadId) : undefined
    if (saved !== undefined && scrollRef.current) {
      followBottomRef.current = false
      scrollRef.current.scrollTop = saved
    } else {
      followBottomRef.current = true
      scrollToBottom()
    }
  }, [activeThreadId, isTranscript, scrollToBottom])

  const showEarlierMessages = () => {
    if (visibleCount >= messages.length || prependHeightRef.current !== null) return
    prependHeightRef.current = scrollRef.current?.scrollHeight ?? null
    followBottomRef.current = false
    setHistoryWindow({ threadId: activeThreadId, firstId: messages[Math.max(0, messages.length - visibleCount - MESSAGE_PAGE_SIZE)]?.id ?? null })
  }

  useLayoutEffect(() => {
    const node = scrollRef.current
    if (node && prependHeightRef.current !== null) {
      node.scrollTop += node.scrollHeight - prependHeightRef.current
      prependHeightRef.current = null
    }
  }, [visibleMessages])

  useEffect(() => {
    if (isTranscript && followBottomRef.current && !messageFocus) {
      scrollToBottom()
    }
  }, [isTranscript, messages.length, liveTurn?.text, liveTurn?.toolCalls.size, liveReplyLength, threadQuery.data?.running?.text, messageFocus, scrollToBottom])

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
    followBottomRef.current = false
    setHistoryWindow({ threadId: activeThreadId, firstId: messages[Math.max(0, messages.length - windowCount)]?.id ?? null })
    setFlashMessageId(messageFocus.messageId)
    clearMessageFocus()
  }, [activeThreadId, clearMessageFocus, isTranscript, messageFocus, messages, windowCount])

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

  const profileMissing = thread !== null ? (isGroup ? !memberProfiles.some((member) => member.isEnabled) : !profile || !profile.isEnabled) : pendingProfile !== null && !pendingProfile.usable
  const codexUnavailable = isCodexThread && !codexStatus?.available
  const isCommand = draft.startsWith('/') && !draft.startsWith('//')
  const matchingCommands = CHAT_COMMANDS.filter((command) => command.name.startsWith(draft.slice(1).toLowerCase()))
  const showCommands = isCommand && !/\s/.test(draft) && dismissedCommand !== draft && matchingCommands.length > 0
  const selectedCommand = Math.min(commandIndex, matchingCommands.length - 1)
  // Group rooms: the user may cut in while members are still answering.
  const sendBlocked = isGroup ? alternativeMutation.isPending || commandPending || isCompacting || (isCommand && isBusy) || (isStreaming && !streamingHere) : isBusy
  const canSend = (activeThreadId !== null || (pendingChat?.greeting != null && !isStartingChat)) && (Boolean(draft.trim()) || chat.draftAttachments.length > 0 || chat.draftMediaAttachments.length > 0 || picks.length > 0) && !chat.attachmentsUploading && !sendBlocked && (isCommand || (!profileMissing && !codexUnavailable))
  const mentionQuery = isGroup && !isCommand ? mentionQueryAt(draft, caret) : null
  const mentionMatches = mentionQuery ? mentionOptions(mentionQuery.query, memberProfiles, group?.representativeId ?? null) : []
  const showMentions = mentionMatches.length > 0 && dismissedMention !== draft
  const selectedMention = Math.min(mentionIndex, mentionMatches.length - 1)
  const pickMention = (option: MentionOption) => {
    if (!mentionQuery) return
    const next = `${draft.slice(0, mentionQuery.start)}@${option.name} ${draft.slice(caret)}`
    const position = mentionQuery.start + option.name.length + 2
    setDraft(next)
    setCaret(position)
    setMentionIndex(0)
    window.requestAnimationFrame(() => {
      composerRef.current?.focus()
      composerRef.current?.setSelectionRange(position, position)
    })
  }

  const runCommand = async (text: string) => {
    if (isBusy) return
    const match = /^\/(\S+)\s*(.*)$/s.exec(text.trim())
    const name = match?.[1].toLowerCase()
    const argument = match?.[2].trim() ?? ''
    if (!CHAT_COMMANDS.some((command) => command.name === name)) {
      showSnackbar({ message: t({ ko: '없는 커맨드야. /help로 목록을 열어봐.', en: 'Unknown command. Use /help.' }), tone: 'error' })
      return
    }
    setDraft('')
    setCommandPending(true)
    try {
      if (name === 'help') { setDraft('/'); setDismissedCommand(null); setCommandIndex(0); return }
      if (name === 'new') {
        const chosen = argument ? profiles.find((entry) => entry.usable && entry.name.toLowerCase() === argument.toLowerCase()) : profile
        if (!chosen?.usable) throw new Error(t({ ko: '쓸 수 있는 프로필 이름을 입력해줘.', en: 'Enter a usable profile name.' }))
        await beginChat([chosen.id])
      } else if (name === 'search') { setSearchText(argument); setSearchOpen(true) }
      else if (name === 'export') setExportOpen(true)
      else if (activeThreadId !== null) {
        if (name === 'clear') {
          if (!await confirm({ title: t({ ko: '대화 비우기', en: 'Clear chat' }), description: isCodexThread ? t({ ko: '대화와 Codex 기억을 비울까? 원본 파일과 생성 이미지는 남아.', en: 'Clear the conversation and Codex memory? Original files and generated images stay.' }) : t({ ko: '대화를 비울까? 원본 파일과 생성 이미지는 남아.', en: 'Clear the conversation? Original files and generated images stay.' }), confirmLabel: t({ ko: '비우기', en: 'Clear' }), tone: 'destructive' })) return
          const detail = await clearCodexChatThread(activeThreadId)
          queryClient.setQueryData(codexChatThreadQueryKey(activeThreadId), detail)
          setEditingMessageId(null)
          await queryClient.invalidateQueries({ queryKey: codexChatMediaQueryKey(activeThreadId) })
          await queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
        } else if (name === 'note') {
          await updateCodexChatThreadContext(activeThreadId, { authorNote: argument || null })
          await queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(activeThreadId) })
          showSnackbar({ message: argument ? t({ ko: '작가 노트를 바꿨어.', en: "Author's note updated." }) : t({ ko: '작가 노트를 지웠어.', en: "Author's note cleared." }) })
        } else {
          if (isCodexThread && name !== 'compact') throw new Error(t({ ko: 'API LLM 채팅에서만 쓸 수 있어.', en: 'Available in API LLM chats only.' }))
          if (isGroup && name === 'compact') throw new Error(t({ ko: '그룹 방에서는 쓸 수 없어.', en: 'Not available in group rooms.' }))
          if (name === 'compact') {
            // Codex folds its own memory; an LLM chat folds into its summary, which must then be on.
            await compactMutation.mutateAsync({ threadId: activeThreadId, enableSummary: !isCodexThread })
            showSnackbar({ message: t({ ko: '대화를 압축했어.', en: 'Chat compacted.' }) })
          } else if (name === 'retry') {
            if (lastReplyId === null) throw new Error(t({ ko: '다시 생성할 답변이 없어.', en: 'No answer to regenerate.' }))
            await regenerate(activeThreadId, lastReplyId)
          } else if (name === 'edit') {
            const lastUser = [...messages].reverse().find((message) => message.role === 'user')
            if (!lastUser) throw new Error(t({ ko: '수정할 메시지가 없어.', en: 'No message to edit.' }))
            setEditingMessageId(lastUser.id)
            chat.focusMessage(lastUser.id)
          }
        }
      }
    } catch (error) { showSnackbar({ message: getErrorMessage(error, t({ ko: '커맨드 실행 실패', en: 'Command failed' })), tone: 'error' }) }
    finally { setCommandPending(false) }
  }

  const pickCommand = (command: ChatCommand) => {
    if ('argument' in command) { setDraft(`/${command.name} `); composerRef.current?.focus() }
    else void runCommand(`/${command.name}`)
  }

  const pickSearchResult = (result: ChatSearchResult) => {
    selectThread(result.threadId)
    chat.focusMessage(result.messageId)
    setSearchOpen(false)
  }

  const handleSend = () => {
    if (!canSend) return
    const literal = draft.startsWith('//') ? draft.slice(1) : undefined
    // A message sent from part-way up the chat still shows its answer.
    if (!isCommand) {
      followBottomRef.current = true
      scrollToBottom()
    }
    if (isCommand) void runCommand(draft)
    else if (activeThreadId !== null) void chat.send(activeThreadId, literal)
    else if (pendingChat) void chat.sendPending(literal ?? draft)
  }

  const handleDelete = async () => {
    if (activeThreadId === null) {
      return
    }
    const threadId = activeThreadId
    const books = await queryClient.fetchQuery({ queryKey: threadLorebooksQueryKey(threadId), queryFn: () => getThreadLorebooks(threadId), staleTime: 0 }).catch(() => null)
    setDeleteTarget({ threadId, book: books?.chatBook && books.chatBook.entries.length > 0 ? books.chatBook : null })
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!event.nativeEvent.isComposing && showMentions) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissedMention(draft); return }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setMentionIndex((selectedMention + (event.key === 'ArrowDown' ? 1 : -1) + mentionMatches.length) % mentionMatches.length)
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        pickMention(mentionMatches[selectedMention])
        return
      }
    }
    if (!event.nativeEvent.isComposing && showCommands) {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setDismissedCommand(draft); return }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setCommandIndex((selectedCommand + (event.key === 'ArrowDown' ? 1 : -1) + matchingCommands.length) % matchingCommands.length)
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        const selected = matchingCommands[selectedCommand]
        if (event.key === 'Tab') { setDraft(`/${selected.name} `); setDismissedCommand(null) }
        else void runCommand(`/${selected.name}`)
        return
      }
    }
    // Enter sends; Shift+Enter breaks the line. Ignore Enter that commits an IME (Korean) composition.
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      handleSend()
    }
  }

  const untitled = t({ ko: '새 채팅', en: 'New chat' })
  const pickProfile = (profileId: number) => void beginChat([profileId])
  const pickGroup = (profileIds: number[]) => void beginChat(profileIds)

  // "+" opens the profile picker, which lists the most recently used profiles first.
  const newChatButton = <IconButton variant="ghost" size="icon-sm" disabled={isStartingChat} onClick={() => selectThread(null)} label={t({ ko: '새 채팅', en: 'New chat' })}><Plus /></IconButton>
  const backButton = canOpenList
    ? <IconButton variant="ghost" size="icon-sm" onClick={() => setListOpen(true)} label={t({ ko: '채팅 목록', en: 'Chats' })}><ArrowLeft /></IconButton>
    : pendingProfile && (layout === 'panel' || !hasSideList)
      ? <IconButton variant="ghost" size="icon-sm" onClick={() => selectThread(null)} label={t({ ko: '새 채팅', en: 'New chat' })}><ArrowLeft /></IconButton>
      : null
  const openThread = (threadId: number) => (threadId === activeThreadId ? setListOpen(false) : selectThread(threadId))
  const runningThreadIds = new Set<number>([
    ...threads.filter((entry) => entry.running).map((entry) => entry.id),
    ...(liveTurn ? [liveTurn.threadId] : []),
    ...(serverRunning && activeThreadId !== null ? [activeThreadId] : []),
  ])
  // Pin, archive and rename show at once; the server's answer (or a refetch on failure) settles it.
  const updateListEntry = (threadId: number, patch: ChatListPatch) => {
    const apply = (entry: CodexChatThread) => entry.id !== threadId ? entry : {
      ...entry,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned ? 1 as const : 0 as const } : {}),
      ...(patch.archived !== undefined ? { archived: patch.archived ? 1 as const : 0 as const } : {}),
    }
    queryClient.setQueryData<CodexChatThread[]>(CODEX_CHAT_THREADS_QUERY_KEY, (current) => current?.map(apply))
    queryClient.setQueryData<CodexChatThreadDetail>(codexChatThreadQueryKey(threadId), (current) => current ? { ...current, thread: apply(current.thread) } : current)
    updateChatListState(threadId, patch).catch((error: unknown) => {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '채팅을 바꾸지 못했어.', en: 'Could not change the chat.' })), tone: 'error' })
    }).finally(() => {
      void queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(threadId) })
    })
  }
  const threadList = (dense: boolean) => <>
    <div className={dense ? 'px-2 pb-2' : 'px-3 pb-2 pt-3'}><ChatSearchInput value={searchText} onChange={setSearchText} /></div>
    <div ref={dense ? undefined : restoreChatListScroll} onScroll={dense ? undefined : (event) => { chatListScrollTop = event.currentTarget.scrollTop }} className={cn('min-h-0 flex-1 overflow-y-auto', !dense && 'px-1')}>
      {searchText.trim()
        ? <ChatSearchResults query={searchText} disabled={false} onPick={pickSearchResult} />
        : <ChatThreadList threads={threads} profilesById={profilesById} activeThreadId={activeThreadId} runningThreadIds={runningThreadIds} drafts={chat.drafts} dense={dense} onSelect={openThread} onUpdate={updateListEntry} onBulk={runBulk} />}
    </div>
  </>
  const chatMenu = <ChatAppearancePopover threadId={activeThreadId} style={profile?.style} layout={layout} open={appearanceOpen} onOpenChange={setAppearanceOpen}><span className="inline-flex"><DropdownMenu>
    <Tip content={t({ ko: '채팅 메뉴', en: 'Chat menu' })}><DropdownMenuTrigger asChild>
      <IconButton variant="ghost" size="icon-sm" disabled={activeThreadId === null} label={t({ ko: '채팅 메뉴', en: 'Chat menu' })} tooltip={false}><MoreHorizontal /></IconButton>
    </DropdownMenuTrigger></Tip>
    <DropdownMenuContent align="end" className="min-w-48" onCloseAutoFocus={(event) => { if (appearanceOpenRef.current) { event.preventDefault(); appearanceOpenRef.current = false } }}>
      <DropdownMenuItem onSelect={() => { appearanceOpenRef.current = true; setAppearanceOpen(true) }}><AppearanceIcon />{t({ ko: '채팅 모양', en: 'Chat appearance' })}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setFlagManagerOpen(true)}><Flag />{t({ ko: '플래그 관리', en: 'Manage flags' })}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => setUserProfileManagerOpen(true)}><UserRound />{t({ ko: '사용자 프로필', en: 'User profiles' })}</DropdownMenuItem>
      <DropdownMenuSeparator />
      {isGroup ? null : <DropdownMenuItem disabled={isBusy} onSelect={() => void runCommand('/compact')}><FoldVertical />{t({ ko: '압축', en: 'Compact' })}</DropdownMenuItem>}
      <DropdownMenuItem onSelect={() => setExportOpen(true)}><Download />{t({ ko: '내보내기', en: 'Export' })}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={isBusy || deleteMutation.isPending} onSelect={() => void handleDelete()} className="text-destructive"><Trash2 />{t({ ko: '삭제', en: 'Delete' })}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu></span></ChatAppearancePopover>
  // The menu items used most sit in the header; a second press on a view returns to the chat.
  const toggleView = (next: 'context' | 'gallery') => setView(activeView === next ? 'chat' : next)
  const headerActions = thread ? <>
    <IconButton variant="ghost" size="icon-sm" active={activeView === 'gallery'} onClick={() => toggleView('gallery')} label={t({ ko: '이미지 모아보기', en: 'Image gallery' })}><LayoutGrid /></IconButton>
    <IconButton variant="ghost" size="icon-sm" disabled={isBusy} onClick={() => void runCommand('/clear')} label={t({ ko: '대화 비우기', en: 'Clear chat' })}><Eraser /></IconButton>
    <IconButton variant="ghost" size="icon-sm" active={activeView === 'context'} onClick={() => toggleView('context')} label={t({ ko: '컨텍스트', en: 'Context' })}><SlidersHorizontal /></IconButton>
  </> : null
  const headerAvatar = isGroup
    ? group && activeThreadId !== null
      ? (
        <GroupMembersPopover threadId={activeThreadId} group={group} profilesById={profilesById} disabled={isBusy} onInvite={() => setInvite({ kind: 'add', threadId: activeThreadId, memberIds: group.memberIds })}>
          <Button variant="ghost" size="sm" className="h-8 shrink-0 px-1" aria-label={t({ ko: '참가자', en: 'Members' })}><GroupAvatarStack profiles={memberProfiles} /></Button>
        </GroupMembersPopover>
      )
      : <GroupAvatarStack profiles={memberProfiles} />
    : speaker ? <ChatProfileAvatar name={speaker.name} avatar={speaker.avatar} engine={speaker.engine} size="sm" /> : null
  const inviteButton = activeThreadId === null || !thread || profileMissing
    ? null
    : isGroup
      ? group ? <IconButton variant="ghost" size="icon-sm" disabled={isBusy || group.memberIds.length >= GROUP_MEMBER_MAX} onClick={() => setInvite({ kind: 'add', threadId: activeThreadId, memberIds: group.memberIds })} label={t({ ko: '참가자 초대', en: 'Invite members' })}><UserPlus /></IconButton> : null
      : profile?.usable ? <IconButton variant="ghost" size="icon-sm" onClick={() => setInvite({ kind: 'create', baseProfileId: profile.id })} label={t({ ko: '참가자 초대', en: 'Invite members' })}><UserPlus /></IconButton> : null
  const liveGroupTurn = isGroup && liveTurn?.threadId === activeThreadId ? liveTurn : null
  const turnStatus = isCompacting ? (
    <div role="status" className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
      <Spinner size="sm" />{t({ ko: '대화 압축 중…', en: 'Compacting…' })}
    </div>
  ) : isGroup && (liveGroupTurn || runningFromServer) ? (
    <GroupTurnStatus
      speakers={(liveGroupTurn ? (liveGroupTurn.replies ?? []).map((reply) => reply.profileId) : serverReplies.map((reply) => reply.profileId)).flatMap((id) => profilesById.get(id) ?? [])}
      queue={((liveGroupTurn ? liveGroupTurn.queue : runningFromServer?.queue) ?? []).flatMap((id) => profilesById.get(id) ?? [])}
    />
  ) : null

  const transcript = (
    <ChatBlockChangesContext.Provider value={blockChanges}><div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto" onScroll={(event) => {
      const node = event.currentTarget
      followBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100
      if (activeThreadId !== null) {
        if (followBottomRef.current) readingPositions.delete(activeThreadId)
        else readingPositions.set(activeThreadId, node.scrollTop)
      }
      if (node.scrollTop < 80) showEarlierMessages()
    }}>
      <div ref={observeTranscript} className={cn('mx-auto flex flex-col pb-6', layout === 'page' ? cn(CHAT_WIDTH_CLASS[appearance.width], 'px-4 pt-2 sm:px-6') : 'px-4 pt-3')} style={{ ...chatTranscriptStyle(appearance, profile?.style), gap: `${CHAT_MESSAGE_GAP_PX[appearance.messageGap]}px` }}>
        {visibleMessages.length < messages.length ? <Button variant="ghost" size="sm" onClick={showEarlierMessages}>{t({ ko: '이전 메시지', en: 'Earlier messages' })}</Button> : null}
        {pendingChat?.greeting?.text ? <CodexChatAssistantMessage content={pendingChat.greeting.text} toolCalls={[]} appearance={appearance} speaker={speaker} /> : null}
        <ChatSavedMessages messages={visibleMessages} flashMessageId={flashMessageId} summaryUntilId={isGroup ? null : thread?.summary_until_message_id ?? null} media={media} actions={messageActions} appearance={appearance} speaker={speaker} userSpeaker={userSpeaker} speakerOf={isGroup ? speakerOf : undefined} mentions={isGroup ? memberNames : undefined} />
        {liveTurn && liveTurn.threadId === activeThreadId ? (
          <ChatLiveMessage turn={liveTurn} appearance={appearance} speaker={speaker} userSpeaker={userSpeaker} speakerOf={isGroup ? speakerOf : undefined} mentions={isGroup ? memberNames : undefined} />
        ) : null}
        {runningFromServer && !isGroup && speaker ? <CodexChatAssistantMessage content={runningFromServer.text} routing={runningFromServer.routing} toolCalls={runningFromServer.toolCalls} streaming appearance={appearance} speaker={speaker} /> : null}
        {serverReplies.map((reply) => {
          const replySpeaker = speakerOf(reply.profileId)
          return replySpeaker ? <CodexChatAssistantMessage key={reply.routing?.replyId ?? reply.profileId} content={reply.text} routing={reply.routing} toolCalls={reply.toolCalls} streaming appearance={appearance} speaker={replySpeaker} /> : null
        })}
      </div>
    </div></ChatBlockChangesContext.Provider>
  )

  const statusButton = hasStatus && wideStatus ? (
    <IconButton variant="ghost" size="icon-sm" active={statusLayout.open} onClick={() => setStatusLayout({ open: !statusLayout.open })} label={t({ ko: '상태창', en: 'Status panel' })}><Activity /></IconButton>
  ) : null
  const statusStrip = hasStatus && statusData && !wideStatus ? <ChatStatusStrip data={statusData} activeKey={activeStatusKey} onActiveKey={setStatusKey} open={stripOpen} onOpenChange={setStripOpen} /> : null
  const statusAside = hasStatus && statusData && wideStatus && statusLayout.open && statusLayout.mode === 'docked'
    ? <ChatStatusAside data={statusData} activeKey={activeStatusKey} onActiveKey={setStatusKey} onFloat={() => setStatusLayout({ mode: 'floating' })} onHide={() => setStatusLayout({ open: false })} />
    : null
  const statusFloating = hasStatus && statusData && wideStatus && statusLayout.open && statusLayout.mode === 'floating'
    ? <ChatStatusFloating data={statusData} activeKey={activeStatusKey} onActiveKey={setStatusKey} layout={statusLayout} onLayout={setStatusLayout} onDock={() => setStatusLayout({ mode: 'docked' })} onHide={() => setStatusLayout({ open: false })} containerRef={statusAreaRef} />
    : null

  // A direct LLM chat whose background summary failed: older turns may have left the request unsummarized.
  // A room's summary is its own switch; a direct chat's follows the profile unless set.
  const summaryFailed = Boolean(thread?.summary_error) && !isCodexThread
    && (isGroup ? thread?.summary_enabled === 1 : thread?.summary_enabled === null || thread?.summary_enabled === undefined ? profile?.summaryEnabled === true : thread.summary_enabled === 1)
  const warning = profileMissing
    ? t({ ko: '이 채팅의 프로필이 지워졌거나 꺼져 있어.', en: 'This chat’s profile was deleted or turned off.' })
    : codexUnavailable && !codexStatusQuery.isPending
      ? codexStatus?.installed
        ? t({ ko: 'Codex 로그인이 필요해.', en: 'Codex sign-in needed.' })
        : t({ ko: 'Codex가 설치돼 있지 않아.', en: 'Codex is not installed.' })
      : null

  const draftQuote = chat.draftReply?.threadId === activeThreadId ? chat.draftReply.quote : null
  const draftMembers = speakerProfiles.filter((entry) => threadQuery.data?.group?.memberIds.includes(entry.id))
  const draftMentioned = isGroup ? parseMentions(draft, draftMembers) : []
  const draftTarget = draftQuote ? messages.find((message) => message.id === draftQuote.messageId) : null
  const draftRecipients = draftMentioned.length ? draftMentioned : draftTarget?.role === 'user' ? draftTarget.routing?.recipients ?? [] : draftQuote?.speakerProfileId ? [draftQuote.speakerProfileId] : []
  const draftRecipientLabel = isGroup ? draftRecipients.map((id) => typeof id === 'number' ? profilesById.get(id)?.name : null).filter(Boolean).join(', ') || profile?.name : profile?.name
  const composer = (
    <div className={cn('relative w-full shrink-0 pb-4 pt-2', layout === 'page' ? cn('mx-auto px-4 sm:px-6', CHAT_WIDTH_CLASS[appearance.width]) : 'px-3')}>
      {showCommands ? <ChatCommandList id={commandListId} commands={matchingCommands} selected={selectedCommand} onSelect={pickCommand} /> : null}
      {showMentions ? <MentionList id={mentionListId} options={mentionMatches} selected={selectedMention} onSelect={pickMention} /> : null}
      {turnStatus}
      {draftQuote ? <div className="flex items-start gap-1" role="region" aria-label={t({ ko: '답장 대상', en: 'Reply target' })}>
        <ChatReplyPreview quote={draftQuote} recipientLabel={draftRecipientLabel} className="flex-1" />
        <IconButton variant="ghost" size="icon-xs" label={t({ ko: '답장 취소', en: 'Cancel reply' })} onClick={() => setDraftReply(null)}><X /></IconButton>
      </div> : null}
      {warning ? <p className="mb-2 flex items-center gap-1.5 text-xs text-warning"><TriangleAlert className="size-3.5 shrink-0" />{warning}</p> : null}
      {summaryFailed ? (
        <Tip content={thread?.summary_error} side="top">
          <Button variant="ghost" size="xs" onClick={() => setView('context')} className="mb-2 h-auto gap-1.5 px-0 py-0 text-xs font-normal text-warning hover:bg-transparent hover:underline">
            <TriangleAlert className="size-3.5 shrink-0" />{t({ ko: '요약하지 못했어. 오래된 대화가 빠질 수 있어.', en: 'Summary failed; older turns may be left out.' })}
          </Button>
        </Tip>
      ) : null}
      <ChatDraftAttachments chat={chat} disabled={isBusy} canReadText={profile?.canReadFileText === true} />
      <ChatPageConnectionNotice allowed={!isGroup && profile?.canUsePageContext === true} />
      {picks.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {picks.map((label) => (
            <Button key={label} variant="ghost" size="xs" disabled={isBusy} onClick={() => removePick(label)} className="h-6 gap-1 rounded-full border border-line pl-2 pr-1.5 font-normal text-foreground/85" aria-label={t({ ko: '선택 해제: {label}', en: 'Unpick {label}' }, { label })}>
              <Target className="size-3 text-primary" />
              <span className="max-w-48 truncate">{label}</span>
              <X className="size-3 text-muted-foreground" />
            </Button>
          ))}
        </div>
      ) : null}
      <div className="relative">
      {profile?.suggestEnabled ? <ChatSuggestTray suggestions={suggestions} buttonRef={suggestButtonRef} onPick={pickSuggestion} /> : null}
      {flags.length > 0 ? (
        <ChatFlagTray
          flags={flags}
          activeIds={activeFlagIds}
          open={flagTrayOpen && activeThreadId !== null}
          flagStyle={appearance.flagStyle}
          buttonRef={flagButtonRef}
          onToggle={toggleFlag}
          onManage={() => setFlagManagerOpen(true)}
          onClose={closeFlagTray}
        />
      ) : null}
      <div className={cn('flex items-end gap-2 rounded-lg border border-line px-3 py-2 focus-within:border-primary/55', backgroundUrl && 'bg-background/85 backdrop-blur-sm')}>
        <ChatAttachButton chat={chat} disabled={isBusy || activeThreadId === null} />
        <ChatPageConnectButton disabled={isBusy || isGroup} allowed={!isGroup && profile?.canUsePageContext === true} />
        {flags.length > 0 ? <ChatFlagButton buttonRef={flagButtonRef} count={activeFlagIds.length} open={flagTrayOpen} disabled={activeThreadId === null} onToggle={() => setFlagTrayOpen((open) => !open)} /> : null}
        {profile?.suggestEnabled ? <ChatSuggestButton buttonRef={suggestButtonRef} open={suggestions.open} loading={suggestions.loading} disabled={isBusy || activeThreadId === null} onToggle={suggestions.toggle} /> : null}
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setCaret(event.target.selectionStart); setCommandIndex(0); setMentionIndex(0) }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={handleComposerKeyDown}
          rows={1}
          placeholder={isGroup ? t({ ko: '{name}에 메시지', en: 'Message {name}' }, { name: thread?.title || t({ ko: '그룹', en: 'group' }) }) : profile ? t({ ko: '{name}에게 메시지', en: 'Message {name}' }, { name: profile.name }) : t({ ko: '메시지', en: 'Message' })}
          aria-label={t({ ko: '메시지', en: 'Message' })}
          aria-autocomplete="list"
          aria-controls={showCommands ? commandListId : showMentions ? mentionListId : undefined}
          aria-activedescendant={showCommands ? `${commandListId}-${selectedCommand}` : showMentions ? `${mentionListId}-${selectedMention}` : undefined}
          className="block min-h-0 flex-1 resize-none bg-transparent py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        {(streamingHere || serverRunning) && !(isGroup && canSend) ? (
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
    </div>
  )

  const chatBody = backgroundUrl && profile ? (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ChatBackground url={backgroundUrl} {...chatBackgroundLook(appearance, profile.style)} />
      {transcript}
      {composer}
    </div>
  ) : <>{transcript}{composer}</>
  let body: ReactNode
  if (activeThreadId === null || !thread) {
    // The unsaved new chat shows its greeting and the composer; otherwise there is no chat yet: the picker.
    body = pendingProfile
      ? chatBody
      : threadsQuery.isPending ? null : <ChatProfilePicker profiles={profiles} threads={threads} layout={layout} disabled={isStartingChat || createGroupMutation.isPending || isBusy} onPick={pickProfile} onPickGroup={pickGroup} onImport={(file) => void handleImport(file)} onImportFiles={(entries) => void handleImportFiles(entries)} />
  } else if (activeView === 'gallery') {
    body = <Suspense fallback={null}><CodexChatGallery threadId={activeThreadId} columns={layout === 'page' ? 'wide' : 'narrow'} /></Suspense>
  } else if (activeView === 'context') {
    const noteDefaults = { note: profile?.authorNote ?? '', depth: profile?.loreDepth ?? null }
    const loreProfiles = profile ? [{ id: profile.id, name: profile.name }] : []
    body = <Suspense fallback={null}>{isGroup
      ? <GroupContextView thread={thread} group={group} profilesById={profilesById} segments={threadQuery.data?.summarySegments ?? []} />
      : isCodexThread
        ? <CodexEngineContextView thread={thread} profiles={loreProfiles} compactTokens={threadQuery.data?.codexCompactTokens ?? null} noteDefaults={noteDefaults} />
        : <CodexChatContextView thread={thread} profiles={loreProfiles} segments={threadQuery.data?.summarySegments ?? []} profileTurns={profile?.contextTurns ?? null} profileMaxTokens={profile?.maxTokens ?? null} profileReasoningBudget={profile?.reasoningBudgetTokens ?? null} profileSummaryEnabled={profile?.summaryEnabled ?? null} noteDefaults={noteDefaults} />}</Suspense>
  } else {
    body = chatBody
  }

  const viewTitle = activeView === 'gallery'
    ? t({ ko: '이미지 모아보기', en: 'Image gallery' })
    : activeView === 'context'
      ? t({ ko: '컨텍스트', en: 'Context' })
      : thread ? thread.title || untitled : pendingProfile?.name ?? untitled

  const dialogs = <>
    <ChatExportDialog threadId={activeThreadId} open={exportOpen} onClose={() => setExportOpen(false)} />
    <ChatFlagManagerModal open={flagManagerOpen} onClose={() => setFlagManagerOpen(false)} />
    <ChatUserProfileManagerModal open={userProfileManagerOpen} onClose={() => setUserProfileManagerOpen(false)} />
    <ChatUserProfilePickModal open={pendingStart !== null} profiles={userProfiles} onClose={() => setPendingStart(null)} onPick={(userProfileId) => { const profileIds = pendingStart; setPendingStart(null); if (profileIds !== null) void startWith(profileIds, userProfileId) }} />
    <ChatDeleteDialog open={deleteTarget !== null} book={deleteTarget?.book ?? null} pending={deleteMutation.isPending} onClose={() => setDeleteTarget(null)} onConfirm={(choice) => deleteTarget && deleteMutation.mutate({ threadId: deleteTarget.threadId, ...choice })} />
    {deleteMerge ? (
      <LorebookMergeDialog
        open
        sourceId={deleteMerge.preview.source.id}
        targetId={deleteMerge.targetId}
        initialPreview={deleteMerge.preview}
        profiles={isGroup ? memberProfiles.map(({ id, name }) => ({ id, name })) : profile ? [{ id: profile.id, name: profile.name }] : []}
        defaultProfileId={profile?.id ?? null}
        onSubmit={async (decisions) => {
          await deleteCodexChatThread(deleteMerge.threadId, { action: 'merge', targetId: deleteMerge.targetId, decisions }, deleteMerge.backupDate)
          // Before the dialog refreshes the books: the deleted chat's queries must not refetch meanwhile.
          forgetThread(deleteMerge.threadId)
        }}
        onMerged={() => void afterDelete(deleteMerge.threadId, deleteMerge.backupDate)}
        onClose={() => setDeleteMerge(null)}
      />
    ) : null}
    <GroupInviteDialog open={invite !== null} mode={invite} profiles={profiles} userProfiles={userProfiles} onClose={() => setInvite(null)} onCreated={(threadId) => selectThread(threadId)} />
    <Modal open={searchOpen} onClose={() => setSearchOpen(false)} title={t({ ko: '채팅 검색', en: 'Search chats' })} widthClassName="max-w-lg">
      <ModalBody><ChatSearchInput value={searchText} onChange={setSearchText} /><ChatSearchResults query={searchText} disabled={false} onPick={pickSearchResult} /></ModalBody>
    </Modal>
  </>

  const listTitle = <span className="min-w-0 flex-1 truncate pl-1.5 text-sm font-semibold">{t({ ko: '채팅', en: 'Chats' })}</span>

  if (layout === 'page') {
    return (
      <div className="flex min-h-0 flex-1">
        {dialogs}
        <nav aria-label={t({ ko: '채팅 목록', en: 'Chats' })} className="hidden w-60 shrink-0 flex-col gap-1 border-r border-line py-2 pr-3 md:flex">
          <div className="flex items-center justify-between pb-1 pl-2">
            <span className="text-xs font-semibold text-muted-foreground">{t({ ko: '채팅', en: 'Chats' })}</span>
            {newChatButton}
          </div>
          {threadList(true)}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className={cn('flex h-12 shrink-0 items-center gap-1', backButton ? 'pl-1.5' : 'pl-4 sm:pl-6')}>
            {showList ? <>{listTitle}{newChatButton}</> : <>
              {backButton}
              {headerAvatar}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{viewTitle}</span>
              {statusButton}
              {headerActions}
              {inviteButton}
              {chatMenu}
            </>}
            {onCollapse ? (
              <IconButton variant="ghost" size="icon-sm" className="hidden lg:inline-flex" onClick={onCollapse} label={t({ ko: '패널로 접기', en: 'Fold into panel' })}>
                <Minimize2 />
              </IconButton>
            ) : null}
          </div>
          <div ref={statusAreaRef} className="relative flex min-h-0 flex-1 flex-col">
            {showList ? threadList(false) : <>
              {statusStrip}
              {body}
              {statusFloating}
            </>}
          </div>
        </div>
        {showList ? null : statusAside}
      </div>
    )
  }

  const expandButton = onExpand ? (
    <IconButton variant="ghost" size="icon-sm" className="hidden lg:inline-flex" onClick={onExpand} label={t({ ko: '전체 페이지로 열기', en: 'Open full page' })}>
      <Maximize2 />
    </IconButton>
  ) : null
  const closeButton = onClose ? (
    <IconButton variant="ghost" size="icon-sm" onClick={onClose} label={t({ ko: '닫기', en: 'Close' })}>
      <X />
    </IconButton>
  ) : null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {dialogs}
      <div className="flex h-12 shrink-0 items-center gap-0.5 border-b border-line px-1.5">
        {showList ? <>
          {listTitle}
          {newChatButton}
          {expandButton}
        </> : <>
          {backButton ?? <span className="w-1" />}
          {headerAvatar}
          <span className="min-w-0 flex-1 truncate px-1.5 text-sm font-semibold">{thread ? thread.title || untitled : pendingProfile?.name ?? untitled}</span>
          {expandButton}
          {inviteButton}
          {headerActions}
          {thread ? chatMenu : null}
        </>}
        {closeButton}
      </div>
      {showList ? threadList(false) : <>
        {activeView !== 'chat' && thread ? (
          <div className="flex h-10 shrink-0 items-center gap-1 px-1.5">
            <IconButton variant="ghost" size="icon-sm" onClick={() => setView('chat')} label={t({ ko: '채팅으로 돌아가기', en: 'Back to chat' })}>
              <ArrowLeft />
            </IconButton>
            <span className="truncate text-sm font-semibold">{viewTitle}</span>
          </div>
        ) : null}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {statusStrip}
          {body}
        </div>
      </>}
    </div>
  )
}
