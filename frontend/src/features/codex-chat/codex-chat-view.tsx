import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { ArrowLeft, ArrowUp, Archive, ChevronDown, Download, Eraser, LayoutGrid, Maximize2, Minimize2, MoreHorizontal, Plus, SlidersHorizontal, Square, Trash2, TriangleAlert, UserPlus, X } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { Modal, ModalBody } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import {
  CHAT_PROFILES_QUERY_KEY,
  chatProfileBackgroundUrl,
  chatProfileEmoticonsQueryKey,
  listChatProfileEmoticons,
  deleteCodexChatThread,
  getCodexChatThread,
  listChatProfiles,
  listCodexChatThreads,
  selectChatAlternative,
  clearCodexChatThread,
  summarizeCodexChatThread,
  updateCodexChatThreadContext,
  type ChatEmoticon,
  type ChatSearchResult,
  type ChatProfileSummary,
  type CodexChatMessage,
  type CodexChatThread,
} from '@/lib/api-codex-chat'
import { getCodexGenerationStatus } from '@/lib/api-image-generation-queue'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { CHAT_APPEARANCE_ICON as AppearanceIcon, ChatAppearancePopover, chatTranscriptStyle, useChatAppearance } from './chat-appearance'
import { ChatProfileAvatar } from './chat-profile-avatar'
import { ChatProfilePicker } from './chat-profile-picker'
import { ChatAttachButton, ChatDraftAttachments } from './chat-attachments'
import {
  CODEX_CHAT_THREADS_QUERY_KEY,
  codexChatMediaQueryKey,
  codexChatThreadQueryKey,
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
import type { ChatEmoticonMap } from './chat-markdown'

const CodexChatContextView = lazy(async () => ({ default: (await import('./codex-chat-context-view')).CodexChatContextView }))
const CodexEngineContextView = lazy(async () => ({ default: (await import('./codex-chat-context-view')).CodexEngineContextView }))
const CodexChatGallery = lazy(async () => ({ default: (await import('./codex-chat-gallery')).CodexChatGallery }))

const RUNNING_POLL_MS = 2000
const PENDING_JOB_POLL_MS = 3000
const COMPOSER_MAX_HEIGHT_PX = 220
const MESSAGE_FLASH_MS = 1600
const MESSAGE_PAGE_SIZE = 80

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

/** The profile's picture behind the transcript, dimmed (and optionally blurred) so the text stays readable. */
function ChatBackground({ url, dim, blur }: { url: string; dim: number; blur: number }) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center"
        // Scaled a little when blurred, so the soft edge stays outside the frame.
        style={{ backgroundImage: `url("${url}")`, filter: blur > 0 ? `blur(${blur}px)` : undefined, transform: blur > 0 ? 'scale(1.06)' : undefined }}
      />
      <div className="absolute inset-0 bg-background" style={{ opacity: dim / 100 }} />
    </div>
  )
}

/** The chat switcher of the panel header: each chat with the face of the profile it talks to. */
function ThreadSelect({ threads, profilesById, activeThreadId, disabled, onSelect, className }: {
  threads: CodexChatThread[]
  profilesById: Map<number, ChatProfileSummary>
  activeThreadId: number | null
  disabled: boolean
  onSelect: (threadId: number) => void
  className?: string
}) {
  const { t } = useI18n()
  const untitled = t({ ko: '새 채팅', en: 'New chat' })
  const activeTitle = threads.find((thread) => thread.id === activeThreadId)?.title || untitled
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          disabled={disabled}
          className={cn('h-9 min-w-0 flex-1 shrink justify-start gap-1 px-2 font-semibold text-foreground', className)}
          aria-label={t({ ko: '채팅 목록', en: 'Chats' })}
        >
          <span className="min-w-0 flex-1 truncate text-left">{activeTitle}</span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56 overflow-y-auto">
        {threads.map((thread) => {
          const profile = thread.profile_id ? profilesById.get(thread.profile_id) : undefined
          return (
            <DropdownMenuItem key={thread.id} onSelect={() => onSelect(thread.id)} className={cn(thread.id === activeThreadId && 'bg-fill font-semibold')}>
              {thread.kind === 'group'
                ? <GroupAvatarStack profiles={(thread.member_profile_ids ?? []).flatMap((id) => profilesById.get(id) ?? [])} size="xs" ringClassName="ring-surface-high" />
                : profile ? <ChatProfileAvatar name={profile.name} avatar={profile.avatar} engine={profile.engine} size="sm" /> : null}
              <span className="truncate">{thread.title || untitled}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
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
  const prependHeightRef = useRef<number | null>(null)
  const followBottomRef = useRef(true)
  const { liveTurn, selectedThreadId, selectThread, draft, setDraft, view, setView, messageFocus, clearMessageFocus, startChat, isStartingChat, editMessage, regenerate } = chat

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
    // A turn started before a reload keeps running on the server, and generation jobs finish after the reply that
    // started them: poll until the turn is stored and every job has landed.
    refetchInterval: (query) => (query.state.data?.running && !liveTurn ? RUNNING_POLL_MS : query.state.data?.pendingJobs ? PENDING_JOB_POLL_MS : false),
  })
  const thread = threadQuery.data?.thread ?? activeThread
  const profile = thread?.profile_id ? profilesById.get(thread.profile_id) ?? null : null
  const isCodexThread = thread?.engine !== 'llm'
  const { appearance } = useChatAppearance()
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

  const codexStatusQuery = useQuery({ queryKey: ['codex-generation-status'], queryFn: getCodexGenerationStatus, staleTime: 30_000, enabled: isCodexThread && thread !== null })
  const codexStatus = codexStatusQuery.data?.data ?? null

  const isStreaming = liveTurn !== null
  const serverRunning = Boolean(threadQuery.data?.running) && !isStreaming
  const alternativeMutation = useMutation({
    mutationFn: ({ id, index }: { id: number; index: number }) => selectChatAlternative(activeThreadId as number, id, index),
    onSuccess: async (detail) => {
      queryClient.setQueryData(codexChatThreadQueryKey(detail.thread.id), detail)
      await queryClient.invalidateQueries({ queryKey: codexChatMediaQueryKey(detail.thread.id) })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '답변 전환 실패', en: 'Could not switch answer' })), tone: 'error' }),
  })
  const isBusy = isStreaming || serverRunning || alternativeMutation.isPending || commandPending
  const replacingMessageId = liveTurn?.threadId === activeThreadId ? liveTurn.replacingMessageId : threadQuery.data?.running?.replacingMessageId
  const messages: CodexChatMessage[] = useMemo(() => (threadQuery.data?.messages ?? []).filter((message) => message.id !== replacingMessageId), [threadQuery.data?.messages, replacingMessageId])
  const firstIndex = historyWindow.threadId === activeThreadId ? messages.findIndex((message) => message.id === historyWindow.firstId) : -1
  const visibleCount = firstIndex >= 0 ? messages.length - firstIndex : MESSAGE_PAGE_SIZE
  const focusIndex = messageFocus ? messages.findIndex((message) => message.id === messageFocus.messageId) : -1
  const windowCount = focusIndex >= 0 ? Math.max(visibleCount, messages.length - focusIndex) : visibleCount
  const visibleMessages = useMemo(() => messages.slice(-windowCount), [messages, windowCount])
  const media = threadQuery.data?.media
  const runningFromServer = serverRunning ? threadQuery.data?.running ?? null : null
  const activeView = activeThreadId === null ? 'chat' : view
  const isTranscript = activeView === 'chat'

  const handleEdit = useCallback(async (id: number, content: string) => {
    if (activeThreadId === null || isBusy) return false
    if (messages.some((message) => message.role === 'user' && message.id > id)) {
      if (!await confirm({ title: t({ ko: '메시지 수정', en: 'Edit message' }), description: t({ ko: '이 메시지 뒤의 대화를 지우고 다시 답할까?', en: 'Remove the following conversation and answer again?' }), confirmLabel: t({ ko: '수정', en: 'Edit' }), tone: 'destructive' })) return false
    }
    return editMessage(activeThreadId, id, content)
  }, [activeThreadId, editMessage, confirm, isBusy, messages, t])
  const handleRegenerate = useCallback((id: number) => {
    if (activeThreadId !== null && !isBusy) void regenerate(activeThreadId, id)
  }, [activeThreadId, regenerate, isBusy])
  const chooseAlternative = alternativeMutation.mutate
  const handleAlternative = useCallback((id: number, index: number) => { if (!isBusy) chooseAlternative({ id, index }) }, [chooseAlternative, isBusy])
  const lastMessage = messages[messages.length - 1]
  // Group rooms: only API LLM members' replies can be regenerated.
  const lastReplyByCodex = isGroup && lastMessage?.speaker_profile_id != null && profilesById.get(lastMessage.speaker_profile_id)?.engine !== 'llm'
  const lastReplyId = lastMessage?.role === 'assistant' && messages.some((message) => message.role === 'user') && !lastReplyByCodex ? lastMessage.id : null
  const messageActions = useMemo(() => ({ busy: isBusy, canRewrite: !isCodexThread, lastReplyId, editingId: editingMessageId, onEditingChange: setEditingMessageId, onEdit: handleEdit, onRegenerate: handleRegenerate, onAlternative: handleAlternative }), [isBusy, isCodexThread, lastReplyId, editingMessageId, handleEdit, handleRegenerate, handleAlternative])

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

  useLayoutEffect(() => {
    followBottomRef.current = true
    setEditingMessageId(null)
    prependHeightRef.current = null
    scrollToBottom()
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
  }, [isTranscript, messages.length, liveTurn?.text, liveTurn?.toolCalls.size, threadQuery.data?.running?.text, messageFocus, scrollToBottom])

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

  const profileMissing = thread !== null && (isGroup ? !memberProfiles.some((member) => member.isEnabled) : !profile || !profile.isEnabled)
  const codexUnavailable = isCodexThread && !codexStatus?.available
  const isCommand = draft.startsWith('/') && !draft.startsWith('//')
  const matchingCommands = CHAT_COMMANDS.filter((command) => command.name.startsWith(draft.slice(1).toLowerCase()))
  const showCommands = isCommand && !/\s/.test(draft) && dismissedCommand !== draft && matchingCommands.length > 0
  const selectedCommand = Math.min(commandIndex, matchingCommands.length - 1)
  // Group rooms: the user may cut in while members are still answering.
  const sendBlocked = isGroup ? alternativeMutation.isPending || commandPending || (isCommand && isBusy) : isBusy
  const canSend = activeThreadId !== null && (Boolean(draft.trim()) || chat.draftAttachments.length > 0) && !chat.attachmentsUploading && !sendBlocked && (isCommand || (!profileMissing && !codexUnavailable))
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
        await startChat(chosen.id)
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
        } else {
          if (isCodexThread && name !== 'compact') throw new Error(t({ ko: 'API LLM 채팅에서만 쓸 수 있어.', en: 'Available in API LLM chats only.' }))
          if (isGroup && name === 'compact') throw new Error(t({ ko: '그룹 방에서는 쓸 수 없어.', en: 'Not available in group rooms.' }))
          if (name === 'compact') {
            // Codex folds its own memory; an LLM chat folds into its summary, which must then be on.
            await summarizeCodexChatThread(activeThreadId)
            if (!isCodexThread) await updateCodexChatThreadContext(activeThreadId, { summaryEnabled: true })
            await queryClient.invalidateQueries({ queryKey: codexChatThreadQueryKey(activeThreadId) })
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
    if (canSend && activeThreadId !== null) {
      if (isCommand) void runCommand(draft)
      else void chat.send(activeThreadId, draft.startsWith('//') ? draft.slice(1) : undefined)
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
  const pickProfile = (profileId: number) => void startChat(profileId)

  // "+" opens the profile picker, which lists the most recently used profiles first.
  const newChatButton = <IconButton variant="ghost" size="icon-sm" disabled={isBusy || isStartingChat} onClick={() => selectThread(null)} label={t({ ko: '새 채팅', en: 'New chat' })}><Plus /></IconButton>
  const chatMenu = <ChatAppearancePopover open={appearanceOpen} onOpenChange={setAppearanceOpen}><span className="inline-flex"><DropdownMenu>
    <Tip content={t({ ko: '채팅 메뉴', en: 'Chat menu' })}><DropdownMenuTrigger asChild>
      <IconButton variant="ghost" size="icon-sm" disabled={activeThreadId === null} label={t({ ko: '채팅 메뉴', en: 'Chat menu' })} tooltip={false}><MoreHorizontal /></IconButton>
    </DropdownMenuTrigger></Tip>
    <DropdownMenuContent align="end" className="min-w-48" onCloseAutoFocus={(event) => { if (appearanceOpenRef.current) { event.preventDefault(); appearanceOpenRef.current = false } }}>
      {isGroup ? null : <DropdownMenuItem onSelect={() => setView('context')}><SlidersHorizontal />{t({ ko: '컨텍스트', en: 'Context' })}</DropdownMenuItem>}
      <DropdownMenuItem onSelect={() => setView('gallery')}><LayoutGrid />{t({ ko: '이미지 모아보기', en: 'Image gallery' })}</DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { appearanceOpenRef.current = true; setAppearanceOpen(true) }}><AppearanceIcon />{t({ ko: '채팅 모양', en: 'Chat appearance' })}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={isBusy} onSelect={() => void runCommand('/clear')}><Eraser />{t({ ko: '대화 비우기', en: 'Clear chat' })}</DropdownMenuItem>
      {isGroup ? null : <DropdownMenuItem disabled={isBusy} onSelect={() => void runCommand('/compact')}><Archive />{t({ ko: '압축', en: 'Compact' })}</DropdownMenuItem>}
      <DropdownMenuItem onSelect={() => setExportOpen(true)}><Download />{t({ ko: '내보내기', en: 'Export' })}</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={isBusy || deleteMutation.isPending} onSelect={() => void handleDelete()} className="text-destructive"><Trash2 />{t({ ko: '삭제', en: 'Delete' })}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu></span></ChatAppearancePopover>
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
  const turnStatus = isGroup && (liveGroupTurn || runningFromServer) ? (
    <GroupTurnStatus
      speaker={(liveGroupTurn ? liveGroupTurn.speakerProfileId : runningFromServer?.speakerProfileId) != null ? profilesById.get((liveGroupTurn ? liveGroupTurn.speakerProfileId : runningFromServer?.speakerProfileId) as number) ?? null : null}
      queue={((liveGroupTurn ? liveGroupTurn.queue : runningFromServer?.queue) ?? []).flatMap((id) => profilesById.get(id) ?? [])}
    />
  ) : null
  const runningSpeaker = isGroup ? speakerOf(runningFromServer?.speakerProfileId ?? null) : speaker

  const transcript = (
    <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto" onScroll={(event) => {
      const node = event.currentTarget
      followBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100
      if (node.scrollTop < 80) showEarlierMessages()
    }}>
      <div className={cn('mx-auto flex flex-col gap-6 pb-6', layout === 'page' ? 'max-w-3xl px-4 pt-2 sm:px-6' : 'px-4 pt-3')} style={chatTranscriptStyle(appearance, profile?.style)}>
        {visibleMessages.length < messages.length ? <Button variant="ghost" size="sm" onClick={showEarlierMessages}>{t({ ko: '이전 메시지', en: 'Earlier messages' })}</Button> : null}
        <ChatSavedMessages messages={visibleMessages} flashMessageId={flashMessageId} summaryUntilId={isGroup ? null : thread?.summary_until_message_id ?? null} media={media} actions={messageActions} imageSize={appearance.imageSize} speaker={speaker} avatarSize={appearance.avatarSize} speakerOf={isGroup ? speakerOf : undefined} mentions={isGroup ? memberNames : undefined} />
        {liveTurn && liveTurn.threadId === activeThreadId ? (
          <ChatLiveMessage turn={liveTurn} imageSize={appearance.imageSize} speaker={speaker} avatarSize={appearance.avatarSize} speakerOf={isGroup ? speakerOf : undefined} mentions={isGroup ? memberNames : undefined} />
        ) : null}
        {runningFromServer && runningSpeaker ? <CodexChatAssistantMessage content={runningFromServer.text} toolCalls={runningFromServer.toolCalls} streaming imageSize={appearance.imageSize} speaker={runningSpeaker} avatarSize={appearance.avatarSize} /> : null}
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
    <div className={cn('relative w-full shrink-0 pb-4 pt-2', layout === 'page' ? 'mx-auto max-w-3xl px-4 sm:px-6' : 'px-3')}>
      {showCommands ? <ChatCommandList id={commandListId} commands={matchingCommands} selected={selectedCommand} onSelect={pickCommand} /> : null}
      {showMentions ? <MentionList id={mentionListId} options={mentionMatches} selected={selectedMention} onSelect={pickMention} /> : null}
      {turnStatus}
      {warning ? <p className="mb-2 flex items-center gap-1.5 text-xs text-warning"><TriangleAlert className="size-3.5 shrink-0" />{warning}</p> : null}
      <ChatDraftAttachments chat={chat} disabled={isBusy} canReadText={profile?.canReadFileText === true} />
      <div className={cn('flex items-end gap-2 rounded-lg border border-line px-3 py-2 focus-within:border-primary/55', backgroundUrl && 'bg-background/85 backdrop-blur-sm')}>
        <ChatAttachButton chat={chat} disabled={isBusy || activeThreadId === null} />
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
        {isBusy && !(isGroup && canSend) ? (
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
    body = threadsQuery.isPending ? null : <ChatProfilePicker profiles={profiles} threads={threads} layout={layout} disabled={isStartingChat || isBusy} onPick={pickProfile} onRecent={selectThread} />
  } else if (activeView === 'gallery') {
    body = <Suspense fallback={null}><CodexChatGallery threadId={activeThreadId} columns={layout === 'page' ? 'wide' : 'narrow'} /></Suspense>
  } else if (activeView === 'context') {
    body = <Suspense fallback={null}>{isCodexThread
      ? <CodexEngineContextView thread={thread} compactTokens={threadQuery.data?.codexCompactTokens ?? null} />
      : <CodexChatContextView thread={thread} profileTurns={profile?.contextTurns ?? null} profileSummaryEnabled={profile?.summaryEnabled ?? null} />}</Suspense>
  } else {
    body = backgroundUrl && profile ? (
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ChatBackground url={backgroundUrl} dim={profile.style.backgroundDim} blur={profile.style.backgroundBlur} />
        {transcript}
        {composer}
      </div>
    ) : <>{transcript}{composer}</>
  }

  const viewTitle = activeView === 'gallery'
    ? t({ ko: '이미지 모아보기', en: 'Image gallery' })
    : activeView === 'context'
      ? t({ ko: '컨텍스트', en: 'Context' })
      : thread ? thread.title || untitled : untitled

  const dialogs = <>
    <ChatExportDialog threadId={activeThreadId} open={exportOpen} onClose={() => setExportOpen(false)} />
    <GroupInviteDialog open={invite !== null} mode={invite} profiles={profiles} onClose={() => setInvite(null)} onCreated={(threadId) => selectThread(threadId)} />
    <Modal open={searchOpen} onClose={() => setSearchOpen(false)} title={t({ ko: '채팅 검색', en: 'Search chats' })} widthClassName="max-w-lg">
      <ModalBody><ChatSearchInput value={searchText} onChange={setSearchText} /><ChatSearchResults query={searchText} disabled={isBusy} onPick={pickSearchResult} /></ModalBody>
    </Modal>
  </>

  if (layout === 'page') {
    return (
      <div className="flex min-h-0 flex-1">
        {dialogs}
        <nav aria-label={t({ ko: '채팅 목록', en: 'Chats' })} className="hidden w-60 shrink-0 flex-col gap-1 border-r border-line py-2 pr-3 md:flex">
          <div className="flex items-center justify-between pb-1 pl-2">
            <span className="text-xs font-semibold text-muted-foreground">{t({ ko: '채팅', en: 'Chats' })}</span>
            {newChatButton}
          </div>
          <div className="px-2 pb-2"><ChatSearchInput value={searchText} onChange={setSearchText} /></div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {searchText.trim() ? <ChatSearchResults query={searchText} disabled={isBusy} onPick={pickSearchResult} /> : threads.map((entry) => {
              const entryProfile = entry.profile_id ? profilesById.get(entry.profile_id) : undefined
              return (
                <ListRow key={entry.id} asChild interactive size="sm" selected={entry.id === activeThreadId}>
                  <button type="button" onClick={() => selectThread(entry.id)} disabled={isBusy && entry.id !== activeThreadId} className="w-full gap-2 disabled:opacity-50">
                    {entry.kind === 'group'
                      ? <GroupAvatarStack profiles={(entry.member_profile_ids ?? []).flatMap((id) => profilesById.get(id) ?? [])} size="xs" ringClassName="ring-background" />
                      : entryProfile ? <ChatProfileAvatar name={entryProfile.name} avatar={entryProfile.avatar} engine={entryProfile.engine} size="xs" /> : null}
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
            <ThreadSelect className="md:hidden" threads={threads} profilesById={profilesById} activeThreadId={activeThreadId} disabled={isBusy} onSelect={selectThread} />
            <span className="hidden min-w-0 flex-1 items-center gap-2 md:flex">
              {headerAvatar}
              <span className="truncate text-sm font-semibold">{viewTitle}</span>
            </span>
            {inviteButton}
            {newChatButton}
            {chatMenu}
            {onCollapse ? (
              <IconButton variant="ghost" size="icon-sm" className="hidden lg:inline-flex" onClick={onCollapse} label={t({ ko: '패널로 접기', en: 'Fold into panel' })}>
                <Minimize2 />
              </IconButton>
            ) : null}
          </div>
          {body}
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {dialogs}
      <div className="flex h-12 shrink-0 items-center gap-0.5 border-b border-line pl-2.5 pr-1.5">
        {headerAvatar}
        <ThreadSelect threads={threads} profilesById={profilesById} activeThreadId={activeThreadId} disabled={isBusy} onSelect={selectThread} />
        {inviteButton}
        {newChatButton}
        {chatMenu}
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
