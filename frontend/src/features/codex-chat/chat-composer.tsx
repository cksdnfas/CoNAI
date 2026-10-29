import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import type { ChatProfileSummary } from '@/lib/api-codex-chat'
import { CHAT_COMMANDS, type ChatCommand } from './chat-commands'
import { mentionOptions, type MentionOption } from './chat-group'
import { mentionQueryAt } from './chat-mentions'
import { draftHasNarration } from './chat-narration'
import { useReplySuggestions } from './chat-suggestions'
import { useCodexChatDrafts, type CodexChatApi } from './codex-chat-context'

type ComposerProps = {
  chat: CodexChatApi; draftKey: number | null; activeThreadId: number | null
  composerRef: RefObject<HTMLTextAreaElement | null>
  isTranscript: boolean; placeholder: string; isGroup: boolean; isCodexThread: boolean
  memberProfiles: ChatProfileSummary[]; representativeId: number | null
  isBusy: boolean; sendBlocked: boolean; ready: boolean; profileBlocked: boolean; hasChoice: boolean
  suggestEnabled: boolean; lastMessageId: number | null
  onCommand: (text: string) => Promise<void>; onSend: (draft: string) => void
}

/** Grow the composer with its content, up to the cap. */
function resizeComposer(node: HTMLTextAreaElement | null) {
  if (!node) return
  node.style.height = 'auto'
  node.style.height = `${Math.min(node.scrollHeight, 220)}px`
}

/** Own the high-frequency draft, caret, command, mention, suggestion and flag-tray state, not the chat view. */
export function ChatComposer({ children, ...props }: ComposerProps & { children: (state: ReturnType<typeof useComposer>) => ReactNode }) {
  return children(useComposer(props))
}

function useComposer({ chat, draftKey, activeThreadId, composerRef, isTranscript, placeholder, isGroup, isCodexThread, memberProfiles, representativeId, isBusy, sendBlocked: blocked, ready, profileBlocked, hasChoice, suggestEnabled, lastMessageId, onCommand, onSend }: ComposerProps) {
  const drafts = useCodexChatDrafts()
  const draft = draftKey !== null ? drafts[draftKey] ?? '' : ''
  const setDraft = (next: string) => { if (draftKey !== null) chat.setDraft(draftKey, next) }
  const [caret, setCaret] = useState(0)
  const [commandIndex, setCommandIndex] = useState(0)
  const [dismissedCommand, setDismissedCommand] = useState<string | null>(null)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [dismissedMention, setDismissedMention] = useState<string | null>(null)
  const [flagTrayOpen, setFlagTrayOpen] = useState(false)
  const flagButtonRef = useRef<HTMLButtonElement | null>(null)
  const suggestButtonRef = useRef<HTMLButtonElement | null>(null)
  const mentionListId = useId()
  const commandListId = useId()
  const closeFlagTray = () => setFlagTrayOpen(false)
  useEffect(() => setFlagTrayOpen(false), [activeThreadId])
  const suggestions = useReplySuggestions({ threadId: activeThreadId, lastMessageId, enabled: suggestEnabled && !isBusy })
  const pickSuggestion = (text: string) => {
    setDraft(text)
    setCaret(text.length)
    suggestions.close()
    composerRef.current?.focus()
  }
  useLayoutEffect(() => resizeComposer(composerRef.current), [draft, isTranscript, placeholder, composerRef])
  useEffect(() => {
    const node = composerRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    let width = node.clientWidth
    const observer = new ResizeObserver(() => {
      if (node.clientWidth !== width) { width = node.clientWidth; resizeComposer(node) }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [isTranscript, activeThreadId, composerRef])

  const isCommand = draft.startsWith('/') && !draft.startsWith('//')
  const narrating = !isCommand && draftHasNarration(draft)
  const commandFits = (name: ChatCommand['name']) => activeThreadId === null
    ? !['clear', 'compact', 'note', 'retry', 'edit'].includes(name)
    : !(isGroup && name === 'compact') && !(isCodexThread && (name === 'retry' || name === 'edit'))
  const matchingCommands = CHAT_COMMANDS.filter((command) => commandFits(command.name) && command.name.startsWith(draft.slice(1).toLowerCase()))
  const showCommands = isCommand && !/\s/.test(draft) && dismissedCommand !== draft && matchingCommands.length > 0
  const selectedCommand = Math.min(commandIndex, matchingCommands.length - 1)
  const sendBlocked = blocked || (isCommand && isBusy)
  const canSend = ready && (Boolean(draft.trim()) || chat.draftAttachments.length > 0 || chat.draftMediaAttachments.length > 0 || chat.draftPostRefs.length > 0 || chat.picks.length > 0 || hasChoice) && !chat.attachmentsUploading && !sendBlocked && (isCommand || !profileBlocked)
  const mentionQuery = isGroup && !isCommand ? mentionQueryAt(draft, caret) : null
  const mentionMatches = mentionQuery ? mentionOptions(mentionQuery.query, memberProfiles, representativeId) : []
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
  const runCommand = (text: string) => {
    setDismissedCommand(null)
    setCommandIndex(0)
    return onCommand(text)
  }
  const pickCommand = (command: ChatCommand) => {
    if ('argument' in command) { setDraft(`/${command.name} `); composerRef.current?.focus() }
    else void runCommand(`/${command.name}`)
  }
  const handleSend = () => {
    if (!canSend) return
    if (isCommand) void runCommand(draft)
    else onSend(draft)
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
        event.preventDefault(); pickMention(mentionMatches[selectedMention]); return
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
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); handleSend() }
  }
  return { draft, setDraft, caret, setCaret, setCommandIndex, setMentionIndex, flagTrayOpen, setFlagTrayOpen, flagButtonRef, closeFlagTray, suggestButtonRef, suggestions, pickSuggestion, narrating, isCommand, sendBlocked, canSend, commandListId, matchingCommands, selectedCommand, showCommands, pickCommand, mentionListId, mentionMatches, selectedMention, showMentions, pickMention, handleSend, handleComposerKeyDown }
}
