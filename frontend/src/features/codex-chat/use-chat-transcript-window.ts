import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import type { CodexChatMessage } from '@/lib/api-codex-chat'
import type { CodexChatApi } from './codex-chat-context'

const MESSAGE_PAGE_SIZE = 80
const MESSAGE_FLASH_MS = 1600
/** Chats left part-way up remember their position while switching between the list and transcript. */
const readingPositions = new Map<number, { top: number; firstId: number | null }>()

/** Message window, prepending, streaming follow, focus and scroll restoration belong to one lifecycle. */
export function useChatTranscriptWindow({ activeThreadId, messages, isTranscript, messageFocus, clearMessageFocus, runningText, serverReplyLength, hasMoreBefore, loadEarlier, loadingEarlier, earlierError, preserveHistory }: {
  activeThreadId: number | null
  messages: CodexChatMessage[]
  isTranscript: boolean
  messageFocus: CodexChatApi['messageFocus']
  clearMessageFocus: CodexChatApi['clearMessageFocus']
  runningText?: string
  serverReplyLength: number
  hasMoreBefore: boolean
  loadEarlier: () => Promise<number | null>
  loadingEarlier: boolean
  earlierError: unknown
  preserveHistory?: () => void
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const prependHeightRef = useRef<number | null>(null)
  const prependFirstRef = useRef<number | null>(null)
  const followBottomRef = useRef(true)
  const currentThreadRef = useRef(activeThreadId)
  useLayoutEffect(() => { currentThreadRef.current = activeThreadId }, [activeThreadId])
  const [flashMessageId, setFlashMessageId] = useState<number | null>(null)
  const [historyWindow, setHistoryWindow] = useState<{ threadId: number | null; firstId: number | null }>({ threadId: null, firstId: null })
  const firstId = historyWindow.threadId === activeThreadId ? historyWindow.firstId : activeThreadId === null ? null : readingPositions.get(activeThreadId)?.firstId
  const firstIndex = messages.findIndex((message) => message.id === firstId)
  const visibleCount = firstIndex >= 0 ? messages.length - firstIndex : MESSAGE_PAGE_SIZE
  const focusIndex = messageFocus ? messages.findIndex((message) => message.id === messageFocus.messageId) : -1
  const windowCount = focusIndex >= 0 ? Math.max(visibleCount, messages.length - focusIndex) : visibleCount
  const visibleMessages = useMemo(() => messages.slice(-windowCount), [messages, windowCount])
  const scrollToBottom = useCallback(() => {
    const node = scrollRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [])
  const followLatest = () => { followBottomRef.current = true; scrollToBottom() }
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
    prependHeightRef.current = null
    const saved = activeThreadId !== null ? readingPositions.get(activeThreadId) : undefined
    if (saved !== undefined && scrollRef.current) {
      followBottomRef.current = false
      scrollRef.current.scrollTop = saved.top
    } else {
      followBottomRef.current = true
      scrollToBottom()
    }
  }, [activeThreadId, isTranscript, scrollToBottom])
  const showEarlierMessages = async () => {
    if (prependHeightRef.current !== null || loadingEarlier) return
    if (visibleCount >= messages.length && !hasMoreBefore) return
    prependHeightRef.current = scrollRef.current?.scrollHeight ?? null
    prependFirstRef.current = visibleMessages[0]?.id ?? null
    followBottomRef.current = false
    if (visibleCount < messages.length) {
      setHistoryWindow({ threadId: activeThreadId, firstId: messages[Math.max(0, messages.length - visibleCount - MESSAGE_PAGE_SIZE)]?.id ?? null })
      return
    }
    try {
      const firstId = await loadEarlier()
      if (currentThreadRef.current !== activeThreadId) return
      if (firstId !== null) setHistoryWindow({ threadId: activeThreadId, firstId })
      else prependHeightRef.current = null
    } catch {
      // The data hook exposes the error and the existing button retries without losing the reading position.
      if (currentThreadRef.current === activeThreadId) prependHeightRef.current = null
    }
  }
  useLayoutEffect(() => {
    const node = scrollRef.current
    if (node && prependHeightRef.current !== null && visibleMessages[0] && prependFirstRef.current !== null && visibleMessages[0].id < prependFirstRef.current) {
      node.scrollTop += node.scrollHeight - prependHeightRef.current
      prependHeightRef.current = null
    }
  }, [visibleMessages])
  useEffect(() => {
    if (!messageFocus || !isTranscript || focusIndex >= 0 || loadingEarlier || earlierError) return
    if (hasMoreBefore && messages[0] && messageFocus.messageId < messages[0].id) {
      void loadEarlier().catch(() => undefined)
    } else if (messages.length > 0) clearMessageFocus()
  }, [messageFocus, isTranscript, focusIndex, loadingEarlier, earlierError, hasMoreBefore, messages, loadEarlier, clearMessageFocus])
  useEffect(() => {
    if (isTranscript && followBottomRef.current && !messageFocus) scrollToBottom()
  }, [isTranscript, messages.length, serverReplyLength, runningText, messageFocus, scrollToBottom])
  useEffect(() => {
    if (!messageFocus || !isTranscript) return
    const node = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${messageFocus.messageId}"]`)
    if (!node) return
    node.scrollIntoView({ block: 'center' })
    followBottomRef.current = false
    setHistoryWindow({ threadId: activeThreadId, firstId: messages[Math.max(0, messages.length - windowCount)]?.id ?? null })
    setFlashMessageId(messageFocus.messageId)
    clearMessageFocus()
  }, [activeThreadId, clearMessageFocus, isTranscript, messageFocus, messages, windowCount])
  useEffect(() => {
    if (flashMessageId === null) return
    const timer = window.setTimeout(() => setFlashMessageId(null), MESSAGE_FLASH_MS)
    return () => window.clearTimeout(timer)
  }, [flashMessageId])
  const onTranscriptScroll = (event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget
    followBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100
    if (activeThreadId !== null) {
      if (followBottomRef.current) readingPositions.delete(activeThreadId)
      else {
        preserveHistory?.()
        readingPositions.set(activeThreadId, { top: node.scrollTop, firstId: visibleMessages[0]?.id ?? null })
      }
    }
    if (node.scrollTop < 80 && !earlierError) void showEarlierMessages()
  }
  return { scrollRef, visibleMessages, flashMessageId, observeTranscript, showEarlierMessages, onTranscriptScroll, followLatest }
}
