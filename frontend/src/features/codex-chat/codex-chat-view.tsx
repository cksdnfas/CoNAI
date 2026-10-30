import { useChatThreadData } from './use-chat-thread-data'
import { applyChatThreadUpdate, refetchActiveChatQuery, runChatThreadDetailMutation } from './chat-query-refresh'
import { useChatTranscriptWindow } from './use-chat-transcript-window'
import { resolveChatPortrait } from '@conai/shared'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useIsMutating, useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { ArrowLeft, ArrowUp, ChevronLeft, ChevronRight, Cpu, Eraser, FoldVertical, Image as ImageIcon, ListChecks, Maximize2, Minimize2, MoreHorizontal, PanelRight, Plus, RotateCw, Square, Target, Trash2, TriangleAlert, UserPlus, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Chip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Sheet } from '@/components/ui/sheet'
import { IconButton } from '@/components/ui/icon-button'
import { pageGutterStyle, SidebarColumn } from '@/components/common/sidebar-layout'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { ErrorState } from '@/components/ui/error-state'
import { LoadingState, Spinner } from '@/components/ui/loading-state'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { ChatPageConnectButton, ChatPageConnectionNotice } from './chat-page-context'
import { ChatTaskStrip } from './chat-task-ui'
import { chatHealthLine, useChatHealth, useChatHealthRecheck } from './chat-health'
import { ChatChoiceDock, ChatChoiceStatesContext, chatChoiceStates, findOpenChoice } from './chat-choice'
import {
  CHAT_APPEARANCE_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  chatProfileAssetUrl,
  chatProfileEmoticonsQueryKey,
  listChatProfileEmoticons,
  deleteCodexChatThread,
  bulkChatAction,
  CHAT_BACKUP_FOLDER,
  getThreadLorebooks,
  LoreDecisionsNeededError,
  threadLorebooksQueryKey,
  editChatReplyText,
  branchCodexChatThread,
  importCodexChatThread,
  importChatFromFiles,
  listChatProfiles,
  selectChatAlternative,
  clearCodexChatThread,
  createGroupChat,
  editChatBlock,
  summarizeCodexChatThread,
  updateCodexChatThreadContext,
  readThreadFlagIds,
  setChatThreadFlags,
  runChatOrder,
  type ChatEmoticon,
  type ChatOpeningMessage,
  type ChatSearchResult,
  type ChatProfileSummary,
  type CodexChatMessage,
  type ChatBlocksState,
  type ChatDisplayBlock,
  type ChatOrderKind,
  type CodexChatThreadDetail,
  type LoreMergePreview,
  type OwnedChatLorebook,
  type ThreadLorebookAction,
  markCodexChatThreadRead,
} from '@/lib/api-codex-chat'
import { getCodexGenerationStatus } from '@/lib/api-image-generation-queue'
import { getErrorMessage } from '@/lib/error-message'
import { useMinWidth } from '@/lib/use-min-width'
import { cn } from '@/lib/utils'
import { ChatComposerNarrationBackdrop, ChatUserMessage, caretOnNarration, narrationColorStyle } from './chat-narration'
import { ChatComposer } from './chat-composer'
import { CHAT_MESSAGE_GAP_PX, CHAT_WIDTH_CLASS, chatBackgroundLook, chatTranscriptStyle, useChatAppearance, type ChatBackgroundFit } from './chat-appearance'
import { ChatInfoPanelBody } from './chat-info-panel'
import { ChatBlockChangesContext, type BlockAction } from './chat-display-block'
import { ChatProfileAvatar } from './chat-profile-avatar'
import { ChatStatusAside, ChatStatusFloating, ChatStatusStrip, useStatusPanelLayout, type ChatStatusBlock, type ChatStatusData } from './chat-status-panel'
import { ChatStreamingMessage, ChatStreamingPortrait } from './chat-streaming-surfaces'
import { ChatProfilePicker } from './chat-profile-picker'
import { ChatThreadList, type ChatListPatch } from './chat-thread-list'
import { applyChatReadReceipt, useChatRoomSummaries, usePagedChatDraftRetention } from './use-chat-room-directory'
import { useChatThreadActions } from './use-chat-thread-actions'
import { ChatAttachButton, ChatDraftAttachments, useChatFileDrop } from './chat-attachments'
import { ChatFlagButton, ChatFlagManagerModal, ChatFlagTray, useChatFlags } from './chat-flags'
import { useRoutineThreadIds } from './chat-routines'
import { ChatSuggestButton, ChatSuggestTray } from './chat-suggestions'
import { ChatUserProfilePickModal, newChatUserProfile, useChatUserProfiles, userSpeakerOf } from './chat-user-profiles'
import {
  CODEX_CHAT_THREADS_QUERY_KEY,
  codexChatCompactMutationKey,
  codexChatOrderMutationKey,
  codexChatMediaQueryKey,
  codexChatThreadQueryKey,
  PENDING_DRAFT_KEY,
  useCodexChat,
  useCodexChatLiveState,
  type CodexChatApi,
} from './codex-chat-context'
import { CodexChatAssistantMessage, type ChatSpeaker } from './codex-chat-message'
import { ChatSavedMessages } from './chat-transcript'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { CHAT_COMMANDS, ChatCommandList } from './chat-commands'
import { ChatExportDialog, ChatSearchInput, ChatSearchResults } from './chat-search-export'
import { GROUP_MEMBER_MAX, GroupAvatarStack, GroupInviteDialog, GroupMembersPopover, GroupTurnStatus, MentionList, type GroupInviteMode } from './chat-group'
import { parseMentions, type ChatReplyQuote, type StoredFileEntry } from '@conai/shared'
import { ChatReplyPreview } from './chat-reply'
import { ChatDeleteDialog } from './chat-delete-dialog'
import { LorebookMergeDialog } from './lorebook-merge-dialog'
import type { ChatEmoticonMap } from './chat-markdown'

const CodexChatContextView = lazy(async () => ({ default: (await import('./codex-chat-context-view')).CodexChatContextView }))
const CodexEngineContextView = lazy(async () => ({ default: (await import('./codex-chat-context-view')).CodexEngineContextView }))
const GroupContextView = lazy(async () => ({ default: (await import('./codex-chat-context-view')).GroupContextView }))
const CodexChatGallery = lazy(async () => ({ default: (await import('./codex-chat-gallery')).CodexChatGallery }))

/** Longer names leave the composer hint generic, so it stays on one line in narrow panels without cutting the name. */
const COMPOSER_HINT_NAME_MAX = 10
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

/** A picked choice over the composer: icon, label and an X; pressing it unpicks. */
function ComposerPickChip({ icon, label, disabled, onRemove }: { icon: ReactNode; label: string; disabled: boolean; onRemove: () => void }) {
  const { t } = useI18n()
  return (
    <Button variant="subtle" size="xs" disabled={disabled} onClick={onRemove} aria-label={t({ ko: '선택 해제: {label}', en: 'Unpick {label}' }, { label })}>
      {icon}
      <span className="max-w-48 truncate">{label}</span>
      <X className="size-3 text-muted-foreground" />
    </Button>
  )
}

function CodexChatViewContent({ chat, layout, onClose, onExpand, onCollapse }: CodexChatViewProps & { chat: CodexChatApi }) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null)
  const [commandPending, setCommandPending] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [flagManagerOpen, setFlagManagerOpen] = useState(false)
  const routineThreadIds = useRoutineThreadIds()
  const isAdmin = useAuthStatusQuery().data?.isAdmin === true
  /** A new chat (one profile) or room (several, the first representing it) waiting for the user to say who they are in it. */
  const [pendingStart, setPendingStart] = useState<number[] | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [invite, setInvite] = useState<GroupInviteMode | null>(null)
  /** The chat's info panel: docked beside the transcript on a wide page, a sheet elsewhere. */
  const [infoOpen, setInfoOpen] = useState(false)
  // Status panel: docked / floating on a wide page (kept per browser), a fold-out strip elsewhere.
  const [statusLayout, setStatusLayout] = useStatusPanelLayout()
  const [statusKey, setStatusKey] = useState<string | null>(null)
  const [stripOpen, setStripOpen] = useState(false)
  const statusAreaRef = useRef<HTMLDivElement | null>(null)
  const isWide = useMinWidth(1024)
  const hasSideList = useMinWidth(768)
  const { selectThread, listOpen, setListOpen, view, setView, messageFocus, clearMessageFocus, prepareChat, isStartingChat, editMessage, regenerate, continueReply } = chat
  const { dropThread, forgetThread, updateListEntry: updateEntry } = useChatThreadActions(chat)
  const liveTurn = useCodexChatLiveState()

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

  const keepPagedDrafts = usePagedChatDraftRetention(chat.currentDrafts, chat.keepDrafts)
  const { threadsQuery, threads, activeThreadId, activeThread, threadQuery, thread, displayThread, loadEarlier, preserveHistory, loadingEarlier, earlierError, hasMoreBefore } = useChatThreadData({ ...chat, keepDrafts: keepPagedDrafts }, liveTurn?.threadId ?? null)
  const selectedRoomQuery = useChatRoomSummaries(activeThreadId === null ? [] : [activeThreadId], activeThread === null)
  // The new chat being prepared (not saved yet) stands in for a chat until its first message saves it.
  const pendingChat = activeThreadId === null ? chat.pendingChat : null
  const pendingProfile = pendingChat ? profilesById.get(pendingChat.profileId) ?? null : null
  const draftKey = activeThreadId ?? (pendingProfile ? PENDING_DRAFT_KEY : null)
  const setChatDraft = chat.setDraft
  const setDraft = useCallback((next: string | ((current: string) => string)) => {
    if (draftKey !== null) setChatDraft(draftKey, next)
  }, [draftKey, setChatDraft])

  const pendingUserProfileId = pendingChat?.userProfileId ?? null
  const userSpeaker = useMemo(() => userSpeakerOf(activeThreadId === null ? { user_profile_id: pendingUserProfileId } : thread, userProfiles), [activeThreadId, thread, pendingUserProfileId, userProfiles])
  const profile = displayThread?.profile_id ? profilesById.get(displayThread.profile_id) ?? null : pendingProfile
  const isCodexThread = (displayThread?.engine ?? pendingProfile?.engine) === 'codex'
  const { appearance, update: updateAppearance } = useChatAppearance(activeThreadId, chat.canUse)
  // Chat flags stay in the pending chat until its first send, then on the saved thread.
  const flagsQuery = useChatFlags(chat.canUse)
  const flags = useMemo(() => flagsQuery.data ?? [], [flagsQuery.data])
  const activeFlagIds = useMemo(() => (pendingChat?.flagIds ?? readThreadFlagIds(thread)).filter((id) => flags.some((flag) => flag.id === id)), [flags, pendingChat, thread])
  const canToggleFlags = !isStartingChat && (activeThreadId !== null || pendingChat?.greeting != null)
  const togglePendingFlag = chat.togglePendingFlag
  const toggleFlag = useCallback((flagId: number) => {
    if (!canToggleFlags) return
    if (activeThreadId === null) { togglePendingFlag(flagId); return }
    const on = new Set(activeFlagIds)
    if (on.has(flagId)) on.delete(flagId)
    else on.add(flagId)
    const next = flags.filter((flag) => on.has(flag.id)).map((flag) => flag.id)
    queryClient.setQueryData<CodexChatThreadDetail>(codexChatThreadQueryKey(activeThreadId), (current) => current ? { ...current, thread: { ...current.thread, flag_ids: next.length ? JSON.stringify(next) : null } } : current)
    setChatThreadFlags(activeThreadId, next).catch((error: unknown) => {
      void queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(activeThreadId) })
      showSnackbar({ message: getErrorMessage(error, t({ ko: '플래그를 바꾸지 못했어.', en: 'Could not change the flag.' })), tone: 'error' })
    })
  }, [activeFlagIds, activeThreadId, canToggleFlags, flags, queryClient, showSnackbar, t, togglePendingFlag])
  // Group rooms: `profile` is the representative (the room's look); every member speaks with its own face and emoticons.
  const isGroup = displayThread?.kind === 'group'
  const group = isGroup ? threadQuery.data?.group ?? null : null
  const memberIdsKey = (isGroup ? group?.memberIds ?? activeThread?.member_profile_ids ?? [] : []).join(',')
  const memberProfiles = useMemo(() => memberIdsKey ? memberIdsKey.split(',').flatMap((id) => profilesById.get(Number(id)) ?? []) : [], [memberIdsKey, profilesById])
  const memberNames = useMemo(() => memberProfiles.map((member) => member.name), [memberProfiles])
  const speakerProfiles = useMemo(() => isGroup ? memberProfiles : profile ? [profile] : [], [isGroup, memberProfiles, profile])
  const { canViewImages } = useImagePermissions()
  const emoticonData = useQueries({
    queries: speakerProfiles.map((entry) => ({
      queryKey: chatProfileEmoticonsQueryKey(entry.id),
      queryFn: () => listChatProfileEmoticons(entry.id),
      enabled: canViewImages && Boolean(entry.style?.emoticonGroupIds?.length),
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
      const groupByKeyword = new Map<string, number>()
      for (const emoticon of data) for (const keyword of emoticon.keywords) {
        byKeyword.set(keyword.toLowerCase(), emoticon.compositeHash)
        groupByKeyword.set(keyword.toLowerCase(), emoticon.groupId)
      }
      result.set(entry.id, { profileId: entry.id, byKeyword, groupByKeyword })
    })
    return result
  }, [emoticonData, speakerProfiles])
  const backgroundUrl = canViewImages && appearance.showBackground && profile?.backgroundVersion ? chatProfileAssetUrl(profile.id, 'background', profile.assetVersion ?? profile.backgroundVersion) : null

  const codexStatusQuery = useQuery({ queryKey: ['codex-generation-status'], queryFn: getCodexGenerationStatus, staleTime: 30_000, enabled: isCodexThread && (thread !== null || pendingProfile !== null) })
  const codexStatus = codexStatusQuery.data?.data ?? null
  const healthOf = useChatHealth()
  const healthRecheck = useChatHealthRecheck()

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
      await refetchActiveChatQuery(queryClient, codexChatThreadQueryKey(threadId))
    },
  })
  const isCompacting = useIsMutating({ mutationKey: codexChatCompactMutationKey(activeThreadId) }) > 0
  const serverRunning = Boolean(threadQuery.data?.running) && !streamingHere && !isCompacting
  const alternativeMutation = useMutation({
    mutationFn: ({ id, index }: { id: number; index: number }) => runChatThreadDetailMutation(queryClient, activeThreadId as number, () => selectChatAlternative(activeThreadId as number, id, index)),
    onSuccess: async (detail) => {
      await queryClient.invalidateQueries({ queryKey: codexChatMediaQueryKey(detail.thread.id) })
      await queryClient.invalidateQueries({ queryKey: threadLorebooksQueryKey(detail.thread.id) })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '답변 전환 실패', en: 'Could not switch answer' })), tone: 'error' }),
  })
  // An order works on one reply and adds no message; it holds the chat until its job went through.
  const orderMutation = useMutation({
    mutationKey: codexChatOrderMutationKey(activeThreadId),
    mutationFn: ({ threadId, messageId, kind }: { threadId: number; messageId: number; kind: ChatOrderKind }) => runChatOrder(threadId, messageId, kind),
    onSettled: async (_data, _error, { threadId }) => {
      await queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(threadId) })
      await queryClient.invalidateQueries({ queryKey: codexChatMediaQueryKey(threadId) })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '지시를 처리하지 못했어.', en: 'Could not carry out the order.' })), tone: 'error' }),
  })
  const isOrdering = useIsMutating({ mutationKey: codexChatOrderMutationKey(activeThreadId) }) > 0
  const ordering = isOrdering && orderMutation.variables?.threadId === activeThreadId ? orderMutation.variables : null
  const orderingMessageId = ordering?.messageId ?? null
  const orderingKind = ordering?.kind ?? null
  const isBusy = isStreaming || serverRunning || alternativeMutation.isPending || commandPending || isCompacting || isOrdering
  const fileDrop = useChatFileDrop(chat, isBusy || activeThreadId === null)
  const replacingMessageId = liveTurn?.threadId === activeThreadId ? liveTurn.replacingMessageId : threadQuery.data?.running?.replacingMessageId
  const messages: CodexChatMessage[] = useMemo(() => (threadQuery.data?.messages ?? []).filter((message) => message.id !== replacingMessageId), [threadQuery.data?.messages, replacingMessageId])
  const media = threadQuery.data?.media
  const runningFromServer = serverRunning ? threadQuery.data?.running ?? null : null
  // Group rooms: every member answering on the server (an older server sends only the first one).
  const serverReplies = useMemo(() => {
    if (!isGroup || !runningFromServer) return []
    if (runningFromServer.replies) return runningFromServer.replies
    return runningFromServer.speakerProfileId != null ? [{ profileId: runningFromServer.speakerProfileId, text: runningFromServer.text, toolCalls: runningFromServer.toolCalls }] : []
  }, [isGroup, runningFromServer])
  const activeView = activeThreadId === null ? 'chat' : view
  // The panel and a phone-width page have no room for the chat list beside a chat: the list is a screen of its own,
  // and a chat (or the picker) goes back to it. With no chat saved yet the picker is all there is.
  const canOpenList = threads.length > 0 && (layout === 'panel' || !hasSideList)
  const showList = canOpenList && listOpen
  // Off while the list covers the chat: coming back remounts the transcript, which scrolls down again.
  const isTranscript = activeView === 'chat' && !showList
  const { scrollRef, visibleMessages, flashMessageId, observeTranscript, showEarlierMessages, onTranscriptScroll, followLatest } = useChatTranscriptWindow({
    activeThreadId, messages, isTranscript, messageFocus, clearMessageFocus, runningText: threadQuery.data?.running?.text,
    loadEarlier, preserveHistory, loadingEarlier, earlierError, hasMoreBefore,
    serverReplyLength: serverReplies.reduce((total, reply) => total + reply.text.length + reply.toolCalls.length, 0),
  })
  useLayoutEffect(() => setEditingMessageId(null), [activeThreadId, isTranscript])

  // An open chat on screen is read: its replies stop counting as unread (not while the tab is in the background).
  const latestMessageId = threadQuery.data?.messages.at(-1)?.id ?? null
  const activeUnreadCount = activeThread?.unread_count ?? selectedRoomQuery.data?.[0]?.unread_count ?? 0
  useEffect(() => {
    if (showList || activeThreadId === null || latestMessageId === null || activeUnreadCount === 0) return
    const threadId = activeThreadId
    const markRead = () => {
      if (document.visibilityState !== 'visible') return
      void markCodexChatThreadRead(threadId, latestMessageId)
        .then(() => applyChatReadReceipt(queryClient, threadId, latestMessageId))
        .catch(() => {})
    }
    markRead()
    document.addEventListener('visibilitychange', markRead)
    return () => document.removeEventListener('visibilitychange', markRead)
  }, [activeThreadId, activeUnreadCount, latestMessageId, queryClient, showList])

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
  const quoteOf = useCallback((message: CodexChatMessage): ChatReplyQuote => {
    const name = message.role === 'user' ? userSpeaker?.name ?? t({ ko: '사용자', en: 'User' }) : (message.routing?.agent?.name ?? (message.speaker_profile_id ? profilesById.get(message.speaker_profile_id)?.name : profile?.name)) ?? t({ ko: '나간 참가자', en: 'Former member' })
    const hash = message.tool_calls.flatMap((call) => call.compositeHashes)[0]
    const media = message.mediaAttachments?.[0] ?? (hash ? { compositeHash: hash, name: t({ ko: '이미지', en: 'Image' }), mimeType: null } : undefined)
    return { messageId: message.id, role: message.role, speakerProfileId: message.speaker_profile_id ?? (message.role === 'assistant' ? profile?.id ?? null : null), speakerName: name, excerpt: message.content.trim().slice(0, 400) || message.attachments?.map((file) => file.name).join(', ') || t({ ko: '이미지·도구 결과', en: 'Image / tool result' }), alternative: message.active_alternative, media }
  }, [userSpeaker, profilesById, profile, t])
  const handleReply = useCallback((message: CodexChatMessage) => {
    setDraftReply({ threadId: message.thread_id, quote: quoteOf(message) })
    composerRef.current?.focus()
  }, [setDraftReply, quoteOf])
  // Orders a character's reply offers: what its speaker can do; drawing again needs a picture in the reply, and a
  // choice card (answered by the next message) only comes from the latest reply.
  const ordersFor = useCallback((message: CodexChatMessage): ChatOrderKind[] => {
    if (message.role !== 'assistant' || message.status !== 'completed') return []
    const speaker = isGroup ? (message.speaker_profile_id != null ? profilesById.get(message.speaker_profile_id) : undefined) : profile
    const drawn = message.tool_calls.some((call) => call.compositeHashes.length > 0 || call.historyIds.length > 0) || Boolean(message.mediaAttachments?.length)
    return (speaker?.orders ?? []).filter((kind) => (kind !== 'choices' || (!isGroup && message.id === latestMessageId)) && (kind !== 'redraw' || drawn))
  }, [isGroup, profilesById, profile, latestMessageId])
  const startOrder = orderMutation.mutate
  const handleOrder = useCallback((message: CodexChatMessage, kind: ChatOrderKind) => {
    if (!isBusy) startOrder({ threadId: message.thread_id, messageId: message.id, kind })
  }, [isBusy, startOrder])
  const lastMessage = messages[messages.length - 1]
  // Group rooms: only API LLM members' replies can be regenerated.
  const lastReplyByCodex = isGroup && lastMessage?.speaker_profile_id != null && profilesById.get(lastMessage.speaker_profile_id)?.engine === 'codex'
  // A delegated agent's result is the agent's, not the room's: it is never regenerated or hand-edited here.
  const lastReplyId = lastMessage?.role === 'assistant' && !lastMessage.routing?.agent && messages.some((message) => message.role === 'user') && !lastReplyByCodex ? lastMessage.id : null
  // Hand edits of replies (API LLM: the chat's own, or an API LLM member's in a room) and continuing a cut reply
  // (API LLM direct chats); any chat can branch.
  const directLlm = !isCodexThread && !isGroup
  const canEditReply = useCallback((message: CodexChatMessage) => {
    if (message.routing?.agent) return false
    if (!isGroup) return directLlm
    const speaker = message.speaker_profile_id != null ? profilesById.get(message.speaker_profile_id) : undefined
    return speaker?.engine === 'llm' || speaker?.engine === 'claude'
  }, [isGroup, directLlm, profilesById])
  const handleEditReply = useCallback(async (id: number, content: string) => {
    if (activeThreadId === null || isBusy) return false
    try {
      await runChatThreadDetailMutation(queryClient, activeThreadId, () => editChatReplyText(activeThreadId, id, content))
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
    ordersFor, onOrder: handleOrder, ordering: orderingMessageId !== null && orderingKind ? { messageId: orderingMessageId, kind: orderingKind } : null,
  }), [isBusy, isCodexThread, lastReplyId, editingMessageId, handleEdit, handleRegenerate, handleAlternative, handleReply, canEditReply, directLlm, handleEditReply, handleContinue, handleBranch, ordersFor, handleOrder, orderingMessageId, orderingKind])

  // Display block state: the panel's data and the chips in replies. A room lists every member's blocks, keyed
  // `<profileId>:<key>` so two members' `status` blocks stay apart; chips keep the plain key (a message has one speaker).
  const blocksState = threadQuery.data?.blocks ?? null
  const memberBlocks = threadQuery.data?.memberBlocks ?? null
  // A block without a template still shows, as a plain field list.
  const usableBlock = (block: ChatDisplayBlock) => block.enabled && block.key
  const statusBlocks = useMemo<ChatStatusBlock[]>(() => {
    const blockName = (block: ChatDisplayBlock) => block.name || block.key
    if (isGroup) return memberProfiles.flatMap((member) => (member.style?.blocks ?? []).filter(usableBlock).map((block) => ({ ...block, key: `${member.id}:${block.key}`, label: memberProfiles.length > 1 ? `${member.name} · ${blockName(block)}` : blockName(block) })))
    return (profile?.style?.blocks ?? []).filter(usableBlock).map((block) => ({ ...block, label: blockName(block) }))
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
  const portraitProfiles = useMemo(() => speakerProfiles.map((entry) => {
    const emoticons = emoticonsById.get(entry.id)
    const expressions = new Map<string, string>()
    for (const [keyword, hash] of emoticons?.byKeyword ?? []) {
      if (emoticons?.groupByKeyword?.get(keyword) === entry.expressionGroupId) expressions.set(keyword, hash)
    }
    const state = isGroup ? memberBlocks?.[entry.id]?.state : blocksState?.state
    let emotion: string | null = null
    for (const block of entry.style?.blocks ?? []) {
      if (!block.enabled) continue
      const field = block.fields.find((field) => field.name === '감정' && field.values.length > 0)
      const value = field ? state?.[block.key]?.[field.name] : null
      if (field && typeof value === 'string' && field.values.includes(value)) { emotion = value; break }
    }
    return { id: entry.id, expressionGroupId: entry.expressionGroupId, referenceHash: entry.referenceHash, avatarHash: entry.avatarHash, expressions, emotion }
  }), [speakerProfiles, emoticonsById, isGroup, memberBlocks, blocksState])
  const portraitMessages = useMemo(() => {
    const live = liveTurn?.threadId === activeThreadId ? liveTurn : null
    if (live && (isGroup ? live.portraitProfileId !== null : live.hasText)) {
      return [{ role: 'assistant', content: ' ', speaker_profile_id: isGroup ? live.portraitProfileId : profile?.id }]
    }
    const replies = isGroup ? serverReplies : null
    const current = replies
      ? replies.filter((reply) => reply.text).map((reply) => ({ role: 'assistant', content: reply.text, speaker_profile_id: reply.profileId }))
      : runningFromServer?.text ? [{ role: 'assistant', content: runningFromServer.text, speaker_profile_id: profile?.id }] : []
    return current
  }, [activeThreadId, isGroup, liveTurn, profile?.id, runningFromServer, serverReplies])
  const portraitSignal = useMemo(() => resolveChatPortrait(portraitMessages.length ? [...messages, ...portraitMessages] : messages, portraitProfiles, profile?.id ?? null), [messages, portraitMessages, portraitProfiles, profile?.id])
  const portraitProfile = portraitSignal ? profilesById.get(portraitSignal.profileId) : null
  const hasPortrait = canViewImages && portraitSignal !== null && !!portraitProfile && isTranscript && thread !== null
  const hasPanel = hasStatus || hasPortrait
  const panelOpen = hasPortrait ? appearance.portrait : statusLayout.open
  const portraitShown = hasPortrait && appearance.portrait && (wideStatus || stripOpen)
  const portrait = hasPortrait && appearance.portrait && portraitSignal && portraitProfile ? <ChatStreamingPortrait threadId={activeThreadId} messages={messages} fallback={portraitMessages} profiles={portraitProfiles} profilesById={profilesById} defaultProfileId={profile?.id ?? null} /> : undefined
  const toSpeaker = useCallback((entry: ChatProfileSummary): ChatSpeaker => ({
    id: entry.id, avatarHash: entry.avatarHash, avatarCrop: entry.avatarCrop, assetVersion: entry.assetVersion, hasAvatar: entry.hasAvatar, avatarThumbnailUrl: entry.avatarThumbnailUrl,
    name: entry.name, avatar: entry.avatar, engine: entry.engine, roleplay: entry.style?.roleplay ?? false, blocks: entry.style?.blocks, cast: entry.style?.cast,
    emoticons: emoticonsById.get(entry.id) ?? null,
    hiddenEmoticonGroupIds: portraitShown && entry.expressionGroupId ? new Set([entry.expressionGroupId]) : undefined, mentions: isGroup ? memberNames : undefined,
  }), [emoticonsById, isGroup, memberNames, portraitShown])
  const speaker = useMemo<ChatSpeaker | null>(() => profile ? toSpeaker(profile) : null, [profile, toSpeaker])
  const speakerOf = useCallback((profileId: number | null) => {
    const entry = profileId === null ? undefined : profilesById.get(profileId)
    return entry ? toSpeaker(entry) : null
  }, [profilesById, toSpeaker])

  const activeStatusKey = statusBlocks.some((block) => block.key === statusKey) ? statusKey as string : statusBlocks[0]?.key ?? ''
  useEffect(() => setStripOpen(false), [activeThreadId, isTranscript])
  const handleBlockEdit = useCallback(async (key: string, data: Record<string, unknown> | null) => {
    if (activeThreadId === null) return
    try {
      const separator = isGroup ? key.indexOf(':') : -1
      await runChatThreadDetailMutation(queryClient, activeThreadId, () => separator > 0
        ? editChatBlock(activeThreadId, key.slice(separator + 1), data, Number(key.slice(0, separator)))
        : editChatBlock(activeThreadId, key, data))
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '상태를 바꾸지 못했어.', en: 'Could not change the status.' })), tone: 'error' })
      throw error
    }
  }, [activeThreadId, isGroup, queryClient, showSnackbar, t])
  const { picks, togglePick, removePick } = chat
  const pickSet = useMemo(() => new Set(picks), [picks])
  // The question card the newest reply asks; it waits above the composer until the next message answers or passes it.
  const choiceStates = useMemo(() => chatChoiceStates(messages), [messages])
  const openChoice = useMemo(() => (!isGroup && !isBusy ? findOpenChoice(messages) : null), [isBusy, isGroup, messages])
  const [closedChoiceId, setClosedChoiceId] = useState<number | null>(null)
  const choiceDraft = chat.choice && chat.choice.threadId === activeThreadId && chat.choice.proposalId === openChoice?.id ? chat.choice : null
  const { choice: heldChoice, clearChoice } = chat
  useEffect(() => {
    // Answers held for a card that is no longer open (the reply was redone, another chat's card) go.
    if (heldChoice && heldChoice.threadId === activeThreadId && !isBusy && heldChoice.proposalId !== openChoice?.id) clearChoice()
  }, [activeThreadId, clearChoice, heldChoice, isBusy, openChoice?.id])
  const handleBlockAction = useCallback((key: string, action: BlockAction) => {
    if (action.kind === 'pick') togglePick(action.label)
    else if (panelState && !isBusy) void handleBlockEdit(key, { ...(panelState.state[key] ?? {}), [action.field]: action.value }).catch(() => undefined)
  }, [panelState, handleBlockEdit, isBusy, togglePick])
  const statusData: ChatStatusData | null = panelState || hasPortrait ? { blocks: statusBlocks, state: panelState ?? { state: {}, changes: {}, edits: {} }, messages, busy: isBusy, onEdit: handleBlockEdit, picks: pickSet, onAction: handleBlockAction, portrait, portraitLabel: portraitProfile?.name } : null
  const openStatus = useCallback((key: string, messageId: number | null) => {
    // In a room the chip's message tells whose block it is; a streaming reply falls back to the first member with it.
    const speakerId = isGroup ? messages.find((message) => message.id === messageId)?.speaker_profile_id ?? null : null
    const target = isGroup ? (speakerId !== null ? `${speakerId}:${key}` : statusBlocks.find((block) => block.key.endsWith(`:${key}`))?.key ?? key) : key
    setStatusKey(target)
    if (hasPortrait) updateAppearance({ portrait: true })
    if (wideStatus) setStatusLayout({ open: true })
    else setStripOpen(true)
  }, [hasPortrait, updateAppearance, isGroup, messages, setStatusLayout, statusBlocks, wideStatus])
  const blockChanges = useMemo(() => chipChanges ? { changes: chipChanges, open: openStatus } : null, [chipChanges, openStatus])

  // Deleting a chat asks whether to back it up first, and what becomes of its own lorebook when that has entries (C);
  // a merge with duplicates goes through the merge dialog (D) and is retried with its decisions (and the backup).
  const [deleteTarget, setDeleteTarget] = useState<{ threadId: number; book: OwnedChatLorebook | null } | null>(null)
  const [deleteMerge, setDeleteMerge] = useState<{ threadId: number; targetId: number; preview: LoreMergePreview; backupDate?: string } | null>(null)
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

  // The chat's connection is down (Codex keeps its own sign-in warning): a room only when no member can answer.
  const connectionDown = isCodexThread ? null
    : isGroup ? memberProfiles.length > 0 && memberProfiles.every((member) => healthOf(member.id)) ? healthOf(memberProfiles[0].id) : null
    : healthOf(profile?.id)
  // The room title is already in the header; the hint only has to fit beside the composer buttons.
  const composerPlaceholder = connectionDown
    ? t({ ko: '채팅 불가 · {line}', en: 'Cannot chat · {line}' }, { line: chatHealthLine(connectionDown, t) })
    : isGroup
    ? t({ ko: '그룹에 메시지', en: 'Message the group' })
    : profile && profile.name.length <= COMPOSER_HINT_NAME_MAX ? t({ ko: '{name}에게 메시지', en: 'Message {name}' }, { name: profile.name }) : t({ ko: '메시지 입력', en: 'Type a message' })

  const profileMissing = thread !== null ? (isGroup ? !memberProfiles.some((member) => member.isEnabled) : !profile || !profile.isEnabled) : pendingProfile !== null && !pendingProfile.usable
  const codexUnavailable = isCodexThread && !codexStatus?.available
  // Group rooms: the user may cut in while members are still answering.
  const sendBlocked = isGroup ? alternativeMutation.isPending || commandPending || isCompacting || (isStreaming && !streamingHere) : isBusy

  const runCommand = async (text: string) => {
    if (isBusy) return
    const match = /^\/(\S+)\s*(.*)$/s.exec(text.trim())
    const name = match?.[1].toLowerCase()
    const argument = match?.[2].trim() ?? ''
    if (!CHAT_COMMANDS.some((command) => command.name === name)) {
      showSnackbar({ message: t({ ko: '없는 커맨드야. /help로 목록을 열어봐.', en: 'Unknown command. Use /help.' }), tone: 'error' })
      return
    }
    // What was typed stays until the command went through: a failed or declined one can be fixed and run again.
    const typed = draftKey !== null ? chat.currentDrafts()[draftKey] ?? '' : ''
    setCommandPending(true)
    try {
      if (name === 'help') { setDraft('/'); return }
      if (name === 'new') {
        const chosen = argument ? profiles.find((entry) => entry.usable && entry.name.toLowerCase() === argument.toLowerCase()) : profile
        if (!chosen?.usable) throw new Error(t({ ko: '쓸 수 있는 프로필 이름을 입력해줘.', en: 'Enter a usable profile name.' }))
        await beginChat([chosen.id])
      } else if (name === 'search') { setSearchText(argument); setSearchOpen(true) }
      else if (name === 'export') setExportOpen(true)
      else if (activeThreadId !== null) {
        if (name === 'clear') {
          if (!await confirm({ title: t({ ko: '대화 비우기', en: 'Clear chat' }), description: isCodexThread ? t({ ko: '대화와 Codex 기억을 비울까? 원본 파일과 생성 이미지는 남아.', en: 'Clear the conversation and Codex memory? Original files and generated images stay.' }) : t({ ko: '대화를 비울까? 원본 파일과 생성 이미지는 남아.', en: 'Clear the conversation? Original files and generated images stay.' }), confirmLabel: t({ ko: '비우기', en: 'Clear' }), tone: 'destructive' })) return
          await runChatThreadDetailMutation(queryClient, activeThreadId, () => clearCodexChatThread(activeThreadId))
          setEditingMessageId(null)
          await queryClient.invalidateQueries({ queryKey: codexChatMediaQueryKey(activeThreadId) })
          await queryClient.invalidateQueries({ queryKey: CODEX_CHAT_THREADS_QUERY_KEY })
        } else if (name === 'note') {
          await applyChatThreadUpdate(queryClient, await updateCodexChatThreadContext(activeThreadId, { authorNote: argument || null }))
          showSnackbar({ message: argument ? t({ ko: '작가 노트를 바꿨어.', en: "Author's note updated." }) : t({ ko: '작가 노트를 지웠어.', en: "Author's note cleared." }) })
        } else {
          if (isCodexThread && name !== 'compact') throw new Error(t({ ko: 'API LLM 채팅에서만 쓸 수 있어.', en: 'Available in API LLM chats only.' }))
          if (isGroup && name === 'compact') throw new Error(t({ ko: '그룹 방에서는 쓸 수 없어.', en: 'Not available in group rooms.' }))
          if (name === 'compact') {
            // Codex folds its own memory; an LLM chat folds into its summary, which must then be on.
            const summaryOff = !isCodexThread && (thread?.summary_enabled === null || thread?.summary_enabled === undefined ? profile?.summaryEnabled !== true : thread.summary_enabled !== 1)
            if (summaryOff && !await confirm({ title: t({ ko: '지금 요약', en: 'Summarize now' }), description: t({ ko: '이 채팅의 대화 요약이 켜져. 계속할까?', en: 'This turns the chat’s conversation summary on. Continue?' }), confirmLabel: t({ ko: '요약', en: 'Summarize' }) })) return
            await compactMutation.mutateAsync({ threadId: activeThreadId, enableSummary: !isCodexThread })
            showSnackbar({ message: isCodexThread ? t({ ko: '대화를 압축했어.', en: 'Chat compacted.' }) : t({ ko: '대화를 요약했어.', en: 'Chat summarized.' }) })
          } else if (name === 'retry') {
            if (lastReplyId === null) throw new Error(t({ ko: '다시 생성할 답변이 없어.', en: 'No answer to regenerate.' }))
            // A regeneration that did not go through (already reported) keeps what was typed.
            if (!await regenerate(activeThreadId, lastReplyId)) return
          } else if (name === 'edit') {
            const lastUser = [...messages].reverse().find((message) => message.role === 'user')
            if (!lastUser) throw new Error(t({ ko: '수정할 메시지가 없어.', en: 'No message to edit.' }))
            setEditingMessageId(lastUser.id)
            chat.focusMessage(lastUser.id)
          }
        }
      }
      // Typing done while it ran is kept.
      setDraft((current) => (current === typed ? '' : current))
    } catch (error) { showSnackbar({ message: getErrorMessage(error, t({ ko: '커맨드 실행 실패', en: 'Command failed' })), tone: 'error' }) }
    finally { setCommandPending(false) }
  }

  const pickSearchResult = (result: ChatSearchResult) => {
    selectThread(result.threadId)
    chat.focusMessage(result.messageId)
    setSearchOpen(false)
  }

  const handleSend = (draft: string) => {
    const literal = draft.startsWith('//') ? draft.slice(1) : undefined
    // A message sent from part-way up the chat still shows its answer.
    followLatest()
    if (activeThreadId !== null) void chat.send(activeThreadId, literal)
    else if (pendingChat) void chat.sendPending(literal ?? draft)
  }

  /** An option of the open card: a single-answer card sends at once (with any typed text); several answers wait for send. */
  const pickChoice = (label: string) => {
    if (!openChoice || activeThreadId === null) return
    chat.toggleChoice(activeThreadId, openChoice, label)
    if (openChoice.multiple) return
    followLatest()
    void chat.send(activeThreadId)
  }

  const handleDelete = async () => {
    if (activeThreadId === null) {
      return
    }
    const threadId = activeThreadId
    const books = await queryClient.fetchQuery({ queryKey: threadLorebooksQueryKey(threadId), queryFn: () => getThreadLorebooks(threadId), staleTime: 0 }).catch(() => null)
    setDeleteTarget({ threadId, book: books?.chatBook && books.chatBook.entries.length > 0 ? books.chatBook : null })
  }

  const untitled = t({ ko: '새 채팅', en: 'New chat' })
  const pickProfile = (profileId: number) => void beginChat([profileId])
  const pickGroup = (profileIds: number[]) => void beginChat(profileIds)

  // 새 채팅 opens the profile picker, which lists the most recently used profiles first.
  const newChatButton = <Button variant="subtle" size="xs" disabled={isStartingChat} onClick={() => selectThread(null)}><Plus />{t({ ko: '새 채팅', en: 'New chat' })}</Button>
  const backButton = canOpenList
    ? <IconButton variant="ghost" size="icon-sm" onClick={() => setListOpen(true)} label={t({ ko: '채팅 목록', en: 'Chats' })}><ArrowLeft /></IconButton>
    : pendingProfile && (layout === 'panel' || !hasSideList)
      ? <IconButton variant="ghost" size="icon-sm" onClick={() => selectThread(null)} label={t({ ko: '새 채팅', en: 'New chat' })}><ArrowLeft /></IconButton>
      : null
  const openThread = (threadId: number) => (threadId === activeThreadId ? setListOpen(false) : selectThread(threadId))
  const liveThreadId = liveTurn?.threadId
  const runningThreadIds = new Set<number>([
    ...threads.filter((entry) => entry.running).map((entry) => entry.id),
    ...(liveThreadId !== undefined ? [liveThreadId] : []),
    ...(serverRunning && activeThreadId !== null ? [activeThreadId] : []),
  ])
  // Pin, archive and rename show at once; the server's answer (or a refetch on failure) settles it.
  const updateListEntry = (threadId: number, patch: ChatListPatch) => {
    void updateEntry(threadId, patch).catch((error: unknown) => {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '채팅을 바꾸지 못했어.', en: 'Could not change the chat.' })), tone: 'error' })
    })
  }
  const threadList = (dense: boolean) => <>
    {/* The page layout's list screen already sits on --page-gutter; only the panel adds its own inset. */}
    <div className={dense ? 'pb-2' : cn('pb-2 pt-3', layout === 'panel' && 'px-3')}><ChatSearchInput value={searchText} onChange={setSearchText} /></div>
    <div ref={dense ? undefined : restoreChatListScroll} onScroll={dense ? undefined : (event) => { chatListScrollTop = event.currentTarget.scrollTop }} className={cn('min-h-0 flex-1 overflow-y-auto', !dense && layout === 'panel' && 'px-1')}>
      <ChatThreadList query={searchText} profilesById={profilesById} activeThreadId={activeThreadId} runningThreadIds={runningThreadIds} routineThreadIds={routineThreadIds} dense={dense} onSelect={openThread} onUpdate={updateListEntry} onBulk={runBulk} />
      {searchText.trim() ? <ChatSearchResults query={searchText} disabled={false} onPick={pickSearchResult} /> : null}
    </div>
    {/* What the chats draw on (lorebooks, presets, blocks) and the routines that wake them, for administrators. */}
    {isAdmin ? (
      <div className={cn('flex shrink-0 gap-1 border-t border-line pt-1.5', !dense && layout === 'panel' && 'px-3 pb-1.5')}>
        <Button asChild variant="ghost" size="xs"><Link to="/chat/resources">{t({ ko: '채팅 자원', en: 'Chat resources' })}</Link></Button>
        <Button asChild variant="ghost" size="xs"><Link to="/chat/resources?tab=routines">{t({ ko: '루틴', en: 'Routines' })}</Link></Button>
      </div>
    ) : null}
  </>
  // The chat's details and views open from the info panel; ⋯ keeps only what is done to the chat itself.
  const dockInfo = layout === 'page' && isWide
  const infoShown = infoOpen && displayThread !== null && !showList
  // A view picked in the sheet shows at once; the docked panel stays beside it.
  const openView = (next: 'context' | 'gallery') => { setView(next); if (!dockInfo) setInfoOpen(false) }
  const infoButton = displayThread ? (
    <Button variant="ghost" size="sm" aria-pressed={infoShown} data-pressed={infoShown ? 'true' : undefined} onClick={() => setInfoOpen(!infoShown)}><PanelRight />{t({ ko: '정보', en: 'Info' })}</Button>
  ) : null
  // A 1:1 chat's model and library look beside its name on the page (the side panel has no room for them).
  const roomChips = layout === 'page' && displayThread && !isGroup && profile && activeView === 'chat' ? (
    <span className="hidden min-w-0 items-center gap-1.5 lg:flex">
      {profile.modelLabel ? <Chip size="sm" tone="muted" className="min-w-0 shrink" title={profile.modelLabel}><Cpu /><span className="truncate">{profile.modelLabel}</span></Chip> : null}
      {profile.characterLink ? <Chip size="sm" tone="muted" className="min-w-0 shrink" title={[...profile.characterLink.path, profile.characterLink.settingName].join(' › ')}><ImageIcon /><span className="truncate">{t({ ko: '외형: {name}', en: 'Look: {name}' }, { name: profile.characterLink.settingName })}</span></Chip> : null}
    </span>
  ) : null
  const headerAvatar = isGroup
    ? group && activeThreadId !== null
      ? (
        <GroupMembersPopover threadId={activeThreadId} group={group} profilesById={profilesById} disabled={isBusy} onInvite={() => setInvite({ kind: 'add', threadId: activeThreadId, memberIds: group.memberIds })}>
          <Button variant="ghost" size="sm" className="shrink-0" aria-label={t({ ko: '참가자', en: 'Members' })}><GroupAvatarStack profiles={memberProfiles} /></Button>
        </GroupMembersPopover>
      )
      : <GroupAvatarStack profiles={memberProfiles} />
    : speaker ? <ChatProfileAvatar name={speaker.name} avatar={speaker.avatar} profile={speaker} engine={speaker.engine} size="sm" /> : null
  const inviteItem = activeThreadId === null || !thread || profileMissing
    ? null
    : isGroup
      ? group ? <DropdownMenuItem disabled={isBusy || group.memberIds.length >= GROUP_MEMBER_MAX} onSelect={() => setInvite({ kind: 'add', threadId: activeThreadId, memberIds: group.memberIds })}><UserPlus />{t({ ko: '참가자 초대', en: 'Invite members' })}</DropdownMenuItem> : null
      : profile?.usable ? <DropdownMenuItem onSelect={() => setInvite({ kind: 'create', baseProfileId: profile.id })}><UserPlus />{t({ ko: '그룹방으로 만들기', en: 'Make a group room' })}</DropdownMenuItem> : null
  const liveGroupTurn = isGroup && liveTurn?.threadId === activeThreadId ? liveTurn : null
  const turnStatus = isCompacting ? (
    <div role="status" className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
      <Spinner size="sm" />{t({ ko: '대화 압축 중…', en: 'Compacting…' })}
    </div>
  ) : isGroup && (liveGroupTurn || runningFromServer) ? (
    <GroupTurnStatus
      speakers={(liveGroupTurn ? liveGroupTurn.speakerIds.split(',').filter(Boolean).map(Number) : serverReplies.map((reply) => reply.profileId)).flatMap((id) => profilesById.get(id) ?? [])}
      queue={(liveGroupTurn ? liveGroupTurn.queueIds.split(',').filter(Boolean).map(Number) : runningFromServer?.queue ?? []).flatMap((id) => profilesById.get(id) ?? [])}
    />
  ) : null

  /** The opening history of the new chat being prepared, shown as the saved messages it becomes. */
  const pendingOpening = (messages: ChatOpeningMessage[], side: string) => messages.map((message, index) => (message.role === 'user'
    ? <ChatUserMessage key={`${side}-${index}`} content={message.content} appearance={appearance} speaker={userSpeaker} />
    : <CodexChatAssistantMessage key={`${side}-${index}`} content={message.content} toolCalls={[]} appearance={appearance} speaker={speaker} />))

  const transcript = (
    <ChatBlockChangesContext.Provider value={blockChanges}><ChatChoiceStatesContext.Provider value={choiceStates}><div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto" onScroll={onTranscriptScroll}>
      <div ref={observeTranscript} className={cn('mx-auto flex flex-col pb-6', layout === 'page' ? cn(CHAT_WIDTH_CLASS[appearance.width], 'px-(--page-gutter) pt-2') : 'px-4 pt-3')} style={{ ...chatTranscriptStyle(appearance, profile?.style), gap: `${CHAT_MESSAGE_GAP_PX[appearance.messageGap]}px` }}>
        {visibleMessages.length < messages.length || hasMoreBefore ? <Button variant="ghost" size="sm" disabled={loadingEarlier} onClick={() => void showEarlierMessages()}>{earlierError ? t({ ko: '이전 메시지 다시 불러오기', en: 'Retry earlier messages' }) : t({ ko: '이전 메시지', en: 'Earlier messages' })}</Button> : null}
        {pendingChat?.greeting ? <>
          {pendingOpening(pendingChat.greeting.before, 'before')}
          {pendingChat.greeting.text ? <div>
            <CodexChatAssistantMessage content={pendingChat.greeting.text} toolCalls={[]} appearance={appearance} speaker={speaker} />
            {pendingChat.greeting.greetings.length > 1 ? <div className="mt-1 flex items-center gap-1">
              <IconButton size="icon-xs" variant="ghost" disabled={isStartingChat || (pendingChat.greeting.index ?? 0) <= 0} label={t({ ko: '이전 인사', en: 'Previous greeting' })} onClick={() => chat.selectPendingGreeting((pendingChat.greeting!.index ?? 0) - 1)}><ChevronLeft /></IconButton>
              <span className="text-xs tabular-nums text-muted-foreground">{(pendingChat.greeting.index ?? 0) + 1}/{pendingChat.greeting.greetings.length}</span>
              <IconButton size="icon-xs" variant="ghost" disabled={isStartingChat || (pendingChat.greeting.index ?? 0) >= pendingChat.greeting.greetings.length - 1} label={t({ ko: '다음 인사', en: 'Next greeting' })} onClick={() => chat.selectPendingGreeting((pendingChat.greeting!.index ?? 0) + 1)}><ChevronRight /></IconButton>
            </div> : null}
          </div> : null}
          {pendingOpening(pendingChat.greeting.after, 'after')}
        </> : null}
        <ChatSavedMessages messages={visibleMessages} contextMessages={messages} segments={threadQuery.data?.summarySegments} flashMessageId={flashMessageId} summaryUntilId={isGroup ? null : thread?.summary_until_message_id ?? null} media={media} actions={messageActions} appearance={appearance} speaker={speaker} userSpeaker={userSpeaker} speakerOf={isGroup ? speakerOf : undefined} agentSpeakerOf={speakerOf} mentions={isGroup ? memberNames : undefined} />
        <ChatStreamingMessage threadId={activeThreadId} appearance={appearance} speaker={speaker} userSpeaker={userSpeaker} speakerOf={isGroup ? speakerOf : undefined} mentions={isGroup ? memberNames : undefined} />
        {runningFromServer && !isGroup && speaker ? <CodexChatAssistantMessage content={runningFromServer.text} routing={runningFromServer.routing} toolCalls={runningFromServer.toolCalls} streaming appearance={appearance} speaker={speaker} /> : null}
        {serverReplies.map((reply) => {
          const replySpeaker = speakerOf(reply.profileId)
          return replySpeaker ? <CodexChatAssistantMessage key={reply.routing?.replyId ?? reply.profileId} content={reply.text} routing={reply.routing} toolCalls={reply.toolCalls} streaming appearance={appearance} speaker={replySpeaker} /> : null
        })}
      </div>
    </div></ChatChoiceStatesContext.Provider></ChatBlockChangesContext.Provider>
  )

  const hidePanel = () => { if (hasPortrait) updateAppearance({ portrait: false }); setStatusLayout({ open: false }); setStripOpen(false) }
  const togglePanel = () => {
    const open = !(wideStatus ? panelOpen : stripOpen)
    if (hasPortrait) updateAppearance({ portrait: open })
    setStatusLayout({ open })
    setStripOpen(open)
  }
  const setStripPanelOpen = (open: boolean) => { setStripOpen(open); if (hasPortrait) updateAppearance({ portrait: open }) }
  // Only what is done to this chat; its details and views (status panel, look, images, export) are in the info panel,
  // the account's flags and user profiles under Settings › Mine, chat resources and routines under the chat list.
  const chatMenu = <DropdownMenu>
    <Tip content={t({ ko: '채팅 메뉴', en: 'Chat menu' })}><DropdownMenuTrigger asChild>
      <IconButton variant="ghost" size="icon-sm" disabled={activeThreadId === null} label={t({ ko: '채팅 메뉴', en: 'Chat menu' })} tooltip={false}><MoreHorizontal /></IconButton>
    </DropdownMenuTrigger></Tip>
    <DropdownMenuContent align="end" className="min-w-48">
      {isGroup ? null : <DropdownMenuItem disabled={!thread || isBusy} onSelect={() => void runCommand('/compact')}><FoldVertical />{isCodexThread ? t({ ko: '압축', en: 'Compact' }) : t({ ko: '지금 요약', en: 'Summarize now' })}</DropdownMenuItem>}
      {inviteItem}
      {!isGroup || inviteItem ? <DropdownMenuSeparator /> : null}
      {displayThread ? <DropdownMenuItem disabled={!thread || isBusy} onSelect={() => void runCommand('/clear')}><Eraser />{t({ ko: '대화 비우기', en: 'Clear chat' })}</DropdownMenuItem> : null}
      <DropdownMenuItem variant="destructive" disabled={isBusy || deleteMutation.isPending} onSelect={() => void handleDelete()}><Trash2 />{t({ ko: '삭제', en: 'Delete' })}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
  const statusStrip = hasPanel && statusData && !wideStatus ? <ChatStatusStrip data={statusData} activeKey={activeStatusKey} onActiveKey={setStatusKey} open={stripOpen} onOpenChange={setStripPanelOpen} /> : null
  const statusAside = hasPanel && statusData && wideStatus && panelOpen && statusLayout.mode === 'docked'
    ? <ChatStatusAside data={statusData} activeKey={activeStatusKey} onActiveKey={setStatusKey} onFloat={() => setStatusLayout({ mode: 'floating' })} onHide={hidePanel} />
    : null
  const statusFloating = hasPanel && statusData && wideStatus && panelOpen && statusLayout.mode === 'floating'
    ? <ChatStatusFloating data={statusData} activeKey={activeStatusKey} onActiveKey={setStatusKey} layout={statusLayout} onLayout={setStatusLayout} onDock={() => setStatusLayout({ mode: 'docked' })} onHide={hidePanel} containerRef={statusAreaRef} />
    : null
  const infoTitle = t({ ko: '이 채팅', en: 'This chat' })
  const infoBody = thread && activeThreadId !== null ? (
    <ChatInfoPanelBody
      threadId={activeThreadId}
      profile={profile}
      members={isGroup ? memberProfiles : []}
      summaryCount={isCodexThread ? null : threadQuery.data?.summarySegments?.length ?? 0}
      canEditProfiles={isAdmin}
      // The page's status panel opens from here; the side panel's strip folds out over the transcript by itself.
      statusOpen={layout === 'page' && hasPanel && (wideStatus || hasPortrait) ? (wideStatus ? panelOpen : stripOpen) : null}
      onToggleStatus={togglePanel}
      onContext={() => openView('context')}
      onGallery={() => openView('gallery')}
      onExport={() => setExportOpen(true)}
      layout={layout}
    />
  ) : null
  // Docked, the info panel takes the status panel's column while it is open.
  const infoAside = dockInfo && infoShown && infoBody ? (
    <aside aria-label={infoTitle} className="flex w-[300px] shrink-0 flex-col border-l border-line">
      <div className="flex h-12 shrink-0 items-center gap-1 pl-4 pr-2">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold">{infoTitle}</span>
        <IconButton variant="ghost" size="icon-sm" onClick={() => setInfoOpen(false)} label={t({ ko: '정보 닫기', en: 'Close info' })}><X /></IconButton>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{infoBody}</div>
    </aside>
  ) : null
  const infoSheet = !dockInfo && infoBody ? <Sheet open={infoShown} onClose={() => setInfoOpen(false)} title={infoTitle}><ModalBody>{infoBody}</ModalBody></Sheet> : null

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
  const draftTarget = draftQuote ? messages.find((message) => message.id === draftQuote.messageId) : null
  const composer = (
    <ChatComposer chat={chat} draftKey={draftKey} activeThreadId={activeThreadId} composerRef={composerRef}
      isTranscript={isTranscript} placeholder={composerPlaceholder} isGroup={isGroup} isCodexThread={isCodexThread}
      memberProfiles={memberProfiles} representativeId={group?.representativeId ?? null} isBusy={isBusy} sendBlocked={sendBlocked}
      ready={activeThreadId !== null || (pendingChat?.greeting != null && !isStartingChat)} profileBlocked={profileMissing || codexUnavailable || Boolean(connectionDown)}
      hasChoice={Boolean(choiceDraft?.labels.length)} suggestEnabled={Boolean(profile?.suggestEnabled)} lastMessageId={messages.at(-1)?.id ?? null}
      onCommand={runCommand} onSend={handleSend}>
    {({ draft, setDraft, caret, setCaret, setCommandIndex, setMentionIndex, flagTrayOpen, setFlagTrayOpen, flagButtonRef, closeFlagTray, suggestButtonRef, suggestions, pickSuggestion, narrating, isCommand, sendBlocked, canSend, commandListId, matchingCommands, selectedCommand, showCommands, pickCommand, mentionListId, mentionMatches, selectedMention, showMentions, pickMention, handleSend, handleComposerKeyDown }) => {
      const draftMentioned = isGroup ? parseMentions(draft, draftMembers) : []
      const draftRecipients = draftMentioned.length ? draftMentioned : draftTarget?.role === 'user' ? draftTarget.routing?.recipients ?? [] : draftQuote?.speakerProfileId ? [draftQuote.speakerProfileId] : []
      const draftRecipientLabel = isGroup ? draftRecipients.map((id) => typeof id === 'number' ? profilesById.get(id)?.name : null).filter(Boolean).join(', ') || profile?.name : profile?.name
      return (
    <div className={cn('relative w-full shrink-0 pb-4 pt-2', layout === 'page' ? cn('mx-auto px-(--page-gutter)', CHAT_WIDTH_CLASS[appearance.width]) : 'px-3')}>
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
          <Button variant="ghost" size="content" onClick={() => setView('context')} className="mb-2">
            <TriangleAlert className="size-3.5 shrink-0 text-warning" /><Text as="span" variant="caption" tone="warning">{t({ ko: '요약하지 못했어. 오래된 대화가 빠질 수 있어.', en: 'Summary failed; older turns may be left out.' })}</Text>
          </Button>
        </Tip>
      ) : null}
      <ChatDraftAttachments chat={chat} canReadText={profile?.canReadFileText === true} />
      {activeThreadId !== null ? <ChatTaskStrip threadId={activeThreadId} /> : null}
      {!isGroup && profile?.pageAssist ? <ChatPageConnectionNotice /> : null}
      {openChoice && closedChoiceId !== openChoice.id && activeThreadId !== null ? (
        <ChatChoiceDock card={openChoice} selected={choiceDraft?.labels ?? []} disabled={sendBlocked || profileMissing || codexUnavailable || Boolean(connectionDown)} onPick={pickChoice} onClose={() => setClosedChoiceId(openChoice.id)} />
      ) : null}
      {picks.length > 0 || (choiceDraft && openChoice?.multiple) ? (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {picks.map((label) => (
            <ComposerPickChip key={label} icon={<Target className="size-3 text-primary" />} label={label} disabled={isBusy} onRemove={() => removePick(label)} />
          ))}
          {openChoice?.multiple && activeThreadId !== null ? choiceDraft?.labels.map((label) => (
            <ComposerPickChip key={`choice-${label}`} icon={<ListChecks className="size-3 text-primary" />} label={label} disabled={isBusy} onRemove={() => chat.toggleChoice(activeThreadId, openChoice, label)} />
          )) : null}
        </div>
      ) : null}
      <div className="relative">
      {profile?.suggestEnabled ? <ChatSuggestTray suggestions={suggestions} buttonRef={suggestButtonRef} onPick={pickSuggestion} /> : null}
      {flags.length > 0 ? (
        <ChatFlagTray
          flags={flags}
          activeIds={activeFlagIds}
          open={flagTrayOpen && canToggleFlags}
          flagStyle={appearance.flagStyle}
          buttonRef={flagButtonRef}
          onToggle={toggleFlag}
          onManage={() => setFlagManagerOpen(true)}
          onClose={closeFlagTray}
        />
      ) : null}
      <div {...fileDrop.dropHandlers} style={narrationColorStyle(profile?.style.roleplay ? profile.style.colors.narration : null)} className={cn('rounded-lg border border-line px-3 pb-2 pt-1.5 focus-within:border-primary/55', narrating && caretOnNarration(draft, caret) && 'focus-within:border-narration-edge', backgroundUrl && 'bg-background/85 backdrop-blur-sm', fileDrop.dragging && 'border-primary focus-within:border-primary')}>
        <div className="relative min-w-0">
        {narrating ? <ChatComposerNarrationBackdrop textareaRef={composerRef} text={draft} /> : null}
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(event) => { setDraft(event.target.value); setCaret(event.target.selectionStart); setCommandIndex(0); setMentionIndex(0) }}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={handleComposerKeyDown}
          onPaste={fileDrop.onPaste}
          rows={1}
          placeholder={composerPlaceholder}
          aria-label={t({ ko: '메시지', en: 'Message' })}
          aria-autocomplete="list"
          aria-controls={showCommands ? commandListId : showMentions ? mentionListId : undefined}
          aria-activedescendant={showCommands ? `${commandListId}-${selectedCommand}` : showMentions ? `${mentionListId}-${selectedMention}` : undefined}
          className={cn('relative block min-h-0 w-full resize-none bg-transparent py-1.5 text-sm text-foreground caret-foreground outline-none placeholder:text-muted-foreground', connectionDown && 'placeholder:text-destructive', narrating && 'text-transparent')}
        />
        </div>
        {/* The tools under the text, worded so whether each is on reads at a glance; send stays at the end. */}
        <div className="mt-1 flex items-end gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <ChatAttachButton chat={chat} disabled={isBusy || activeThreadId === null} />
          {!isGroup && profile?.pageAssist ? <ChatPageConnectButton disabled={isBusy} /> : null}
          {flags.length > 0 ? <ChatFlagButton buttonRef={flagButtonRef} count={activeFlagIds.length} open={flagTrayOpen} disabled={!canToggleFlags} onToggle={() => setFlagTrayOpen((open) => !open)} /> : null}
          {profile?.suggestEnabled ? <ChatSuggestButton buttonRef={suggestButtonRef} open={suggestions.open} loading={suggestions.loading} disabled={isBusy || activeThreadId === null} onToggle={suggestions.toggle} /> : null}
        </div>
        {(streamingHere || serverRunning) && !(isGroup && canSend) ? (
          <IconButton variant="secondary" size="icon-sm" onClick={() => activeThreadId !== null && chat.stop(activeThreadId)} label={t({ ko: '중단', en: 'Stop' })}>
            <Square />
          </IconButton>
        ) : connectionDown && !isCommand ? (
          // Down: the send button checks again instead; it comes back once the connection answers.
          <IconButton variant="destructive" size="icon-sm" onClick={() => healthRecheck.mutate()} disabled={healthRecheck.isPending} label={t({ ko: '다시 확인', en: 'Check again' })}>
            <RotateCw className={cn(healthRecheck.isPending && 'animate-spin')} />
          </IconButton>
        ) : (
          // eslint-disable-next-line no-restricted-syntax -- the composer's send arrow is the one icon-only primary key (DESIGN_PRESET).
          <IconButton variant="default" size="icon-sm" onClick={handleSend} disabled={!canSend} label={t({ ko: '보내기', en: 'Send' })}>
            <ArrowUp />
          </IconButton>
        )}
        </div>
      </div>
      </div>
    </div>
    ) }}
    </ChatComposer>
  )

  const chatBody = backgroundUrl && profile ? (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ChatBackground url={backgroundUrl} {...chatBackgroundLook(appearance, profile.style)} />
      {transcript}
      {composer}
    </div>
  ) : <>{transcript}{composer}</>
  let body: ReactNode
  if (activeThreadId === null) {
    // The unsaved new chat shows its greeting and the composer; otherwise there is no chat yet: the picker.
    body = pendingProfile
      ? chatBody
      : threadsQuery.isPending ? null : <ChatProfilePicker profiles={profiles} layout={layout} disabled={isStartingChat || createGroupMutation.isPending || isBusy} onPick={pickProfile} onPickGroup={pickGroup} onImport={(file) => void handleImport(file)} onImportFiles={(entries) => void handleImportFiles(entries)} />
  } else if (!thread) {
    // An opened chat that is still loading or could not be read is never the new-chat picker.
    body = threadQuery.isError ? (
      <div className={cn('py-4', layout === 'page' ? 'px-(--page-gutter)' : 'px-3')}>
        <ErrorState title={t({ ko: '채팅을 불러오지 못했어.', en: 'Could not load the chat.' })} error={threadQuery.error} onRetry={() => void threadQuery.refetch()} isRetrying={threadQuery.isFetching} />
      </div>
    ) : <LoadingState />
  } else if (activeView === 'gallery') {
    body = <Suspense fallback={null}><CodexChatGallery threadId={activeThreadId} columns={layout === 'page' ? 'wide' : 'narrow'} pendingJobs={threadQuery.data?.pendingJobs ?? 0} /></Suspense>
  } else if (activeView === 'context') {
    const noteDefaults = { note: profile?.authorNote ?? '', depth: profile?.loreDepth ?? null }
    const loreProfiles = profile ? [{ id: profile.id, name: profile.name }] : []
    body = <Suspense fallback={null}>{isGroup
      ? <GroupContextView thread={thread} group={group} profilesById={profilesById} segments={threadQuery.data?.summarySegments ?? []} />
      : isCodexThread
        ? <CodexEngineContextView thread={thread} profiles={loreProfiles} noteDefaults={noteDefaults} />
        : <CodexChatContextView thread={thread} profiles={loreProfiles} segments={threadQuery.data?.summarySegments ?? []} profileTurns={profile?.contextTurns ?? null} profileMaxTokens={profile?.maxTokens ?? null} profileReasoningBudget={profile?.reasoningBudgetTokens ?? null} profileSummaryEnabled={profile?.summaryEnabled ?? null} noteDefaults={noteDefaults} />}</Suspense>
  } else {
    body = chatBody
  }

  const viewTitle = activeView === 'gallery'
    ? t({ ko: '이미지 모아보기', en: 'Image gallery' })
    : activeView === 'context'
      ? t({ ko: '컨텍스트', en: 'Context' })
      : displayThread ? displayThread.title || untitled : pendingProfile?.name ?? untitled

  const dialogs = <>
    <ChatExportDialog threadId={activeThreadId} open={exportOpen} onClose={() => setExportOpen(false)} />
    <ChatFlagManagerModal open={flagManagerOpen} onClose={() => setFlagManagerOpen(false)} />
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
    <Modal open={searchOpen} onClose={() => setSearchOpen(false)} title={t({ ko: '채팅 검색', en: 'Search chats' })} size="md" height="medium">
      <ModalBody><ChatSearchInput value={searchText} onChange={setSearchText} /><ChatSearchResults query={searchText} disabled={false} onPick={pickSearchResult} /></ModalBody>
    </Modal>
  </>

  const listTitle = <span className="min-w-0 flex-1 truncate pl-1.5 text-sm font-semibold">{t({ ko: '채팅', en: 'Chats' })}</span>
  const backToChat = <IconButton variant="ghost" size="icon-sm" onClick={() => setView('chat')} label={t({ ko: '채팅으로 돌아가기', en: 'Back to chat' })}><ArrowLeft /></IconButton>

  if (layout === 'page') {
    return (
      <div className="flex min-h-0 flex-1">
        {dialogs}
        {infoSheet}
        {/* The PageWithSidebar column spec; the page root (CodexChatPage) bleeds to the shell edges like PageWithSidebar. */}
        {hasSideList ? (
          <SidebarColumn as="nav" label={t({ ko: '채팅 목록', en: 'Chats' })} bodyClassName="flex flex-col gap-1">
            <div className="flex items-center justify-between pb-1 pl-2">
              <span className="text-xs font-semibold text-muted-foreground">{t({ ko: '채팅', en: 'Chats' })}</span>
              {newChatButton}
            </div>
            {threadList(true)}
          </SidebarColumn>
        ) : null}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col pb-(--theme-shell-main-padding-bottom)" style={pageGutterStyle(hasSideList)}>
          <div className="flex h-12 shrink-0 items-center gap-1 px-(--page-gutter)">
            {showList ? <>{listTitle}{newChatButton}</> : <>
              {/* A view opened from the info panel (context, images) goes back to the chat from here. */}
              {activeView !== 'chat' && thread ? backToChat : backButton}
              {headerAvatar}
              <span className="min-w-0 truncate text-sm font-semibold">{viewTitle}</span>
              {roomChips}
              <span className="flex-1" />
              {infoButton}
              {chatMenu}
            </>}
            {onCollapse ? (
              <IconButton variant="ghost" size="icon-sm" className="hidden lg:inline-flex" onClick={onCollapse} label={t({ ko: '패널로 접기', en: 'Fold into panel' })}>
                <Minimize2 />
              </IconButton>
            ) : null}
          </div>
          <div ref={statusAreaRef} className="relative flex min-h-0 flex-1 flex-col">
            {showList ? <div className="flex min-h-0 flex-1 flex-col px-(--page-gutter)">{threadList(false)}</div> : <>
              {statusStrip}
              {body}
              {statusFloating}
            </>}
          </div>
        </div>
        {showList ? null : infoAside ?? statusAside}
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
      {infoSheet}
      <div className="flex h-12 shrink-0 items-center gap-0.5 border-b border-line px-1.5">
        {showList ? <>
          {listTitle}
          {newChatButton}
          {expandButton}
        </> : <>
          {backButton ?? <span className="w-1" />}
          {headerAvatar}
          <span className="min-w-0 flex-1 truncate px-1.5 text-sm font-semibold">{displayThread ? displayThread.title || untitled : pendingProfile?.name ?? untitled}</span>
          {expandButton}
          {infoButton}
          {displayThread ? chatMenu : null}
        </>}
        {closeButton}
      </div>
      {showList ? threadList(false) : <>
        {activeView !== 'chat' && thread ? (
          <div className="flex h-10 shrink-0 items-center gap-1 px-1.5">
            {backToChat}
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
