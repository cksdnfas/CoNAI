import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type UIEvent } from 'react'
import type { CodexChatMessage } from '@/lib/api-codex-chat'
import type { CodexChatApi, CodexChatLiveTurn } from './codex-chat-context'

const MESSAGE_PAGE_SIZE = 80
const MESSAGE_FLASH_MS = 1600
/** Chats left part-way up remember their position while switching between the list and transcript. */
const readingPositions = new Map<number, number>()

/** Message window, prepending, streaming follow, focus and scroll restoration belong to one lifecycle. */
export function useChatTranscriptWindow({ activeThreadId, messages, isTranscript, messageFocus, clearMessageFocus, liveTurn, runningText, serverReplyLength }: {
  activeThreadId: number | null
  messages: CodexChatMessage[]
  isTranscript: boolean
  messageFocus: CodexChatApi['messageFocus']
  clearMessageFocus: CodexChatApi['clearMessageFocus']
  liveTurn: CodexChatLiveTurn | null
  runningText?: string
  serverReplyLength: number
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const prependHeightRef = useRef<number | null>(null)
  const followBottomRef = useRef(true)
  const [flashMessageId, setFlashMessageId] = useState<number | null>(null)
  const [historyWindow, setHistoryWindow] = useState<{ threadId: number | null; firstId: number | null }>({ threadId: null, firstId: null })
  const firstIndex = historyWindow.threadId === activeThreadId ? messages.findIndex((message) => message.id === historyWindow.firstId) : -1
  const visibleCount = firstIndex >= 0 ? messages.length - firstIndex : MESSAGE_PAGE_SIZE
  const focusIndex = messageFocus ? messages.findIndex((message) => message.id === messageFocus.messageId) : -1
  const windowCount = focusIndex >= 0 ? Math.max(visibleCount, messages.length - focusIndex) : visibleCount
  const visibleMessages = useMemo(() => messages.slice(-windowCount), [messages, windowCount])
  const liveReplyLength = (liveTurn?.replies ?? []).reduce((total, reply) => total + reply.text.length + reply.toolCalls.size, 0) + serverReplyLength
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
    if (isTranscript && followBottomRef.current && !messageFocus) scrollToBottom()
  }, [isTranscript, messages.length, liveTurn?.text, liveTurn?.toolCalls.size, liveReplyLength, runningText, messageFocus, scrollToBottom])
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
      else readingPositions.set(activeThreadId, node.scrollTop)
    }
    if (node.scrollTop < 80) showEarlierMessages()
  }
  return { scrollRef, visibleMessages, flashMessageId, observeTranscript, showEarlierMessages, onTranscriptScroll, followLatest }
}
