import { Suspense, lazy, useCallback, useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { MessageSquare } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import { useI18n } from '@/i18n'
import { useMinWidth } from '@/lib/use-min-width'
import { cn } from '@/lib/utils'
import { CODEX_CHAT_ROUTE, CODEX_CHAT_THREADS_QUERY_KEY, useCodexChat } from './codex-chat-context'

/** Docked beside the page from this width (Tailwind `lg`); below it the panel covers the screen. */
const DOCK_MIN_WIDTH_PX = 1024
const DOCK_DEFAULT_WIDTH_PX = 420
const DOCK_RESIZE_MIN_PX = 360
const DOCK_RESIZE_MAX_PX = 1100
/** The page beside the panel keeps at least this much. */
const PAGE_MIN_WIDTH_PX = 480
const DOCK_RESIZE_KEY_STEP_PX = 24
const DOCK_WIDTH_STORAGE_KEY = 'conai.chat.dock-width'
/** Set on <html> while the panel is docked: fixed page controls offset themselves by it. */
const CHAT_DOCK_WIDTH_VAR = '--chat-dock-width'

const loadCodexChatView = () => import('./codex-chat-view')
const CodexChatViewLazy = lazy(async () => ({ default: (await loadCodexChatView()).CodexChatView }))

function clampDockWidth(width: number, viewportWidth: number) {
  return Math.round(Math.max(DOCK_RESIZE_MIN_PX, Math.min(width, DOCK_RESIZE_MAX_PX, viewportWidth - PAGE_MIN_WIDTH_PX)))
}

function readDockWidth() {
  try {
    const stored = Number(window.localStorage.getItem(DOCK_WIDTH_STORAGE_KEY))
    return Number.isFinite(stored) && stored > 0 ? stored : DOCK_DEFAULT_WIDTH_PX
  } catch {
    return DOCK_DEFAULT_WIDTH_PX
  }
}

function writeDockWidth(width: number) {
  try {
    window.localStorage.setItem(DOCK_WIDTH_STORAGE_KEY, String(width))
  } catch {
    // Storage blocked: the width lasts for this page only.
  }
}

/** The docked panel's width (per browser), kept within the viewport so the page beside it stays usable. */
function useDockWidth() {
  const [preferred, setPreferred] = useState(readDockWidth)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])
  const width = clampDockWidth(preferred, viewportWidth)
  const setWidth = (next: number, persist: boolean) => {
    const clamped = clampDockWidth(next, window.innerWidth)
    setPreferred(clamped)
    if (persist) writeDockWidth(clamped)
  }
  return { width, setWidth }
}

/** Drag the panel's left edge to resize it; arrow keys step, double-click restores the default. */
function DockResizeHandle({ width, onResize }: { width: number; onResize: (width: number, persist: boolean) => void }) {
  const { t } = useI18n()
  const [dragging, setDragging] = useState(false)

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
    document.body.style.userSelect = 'none'
  }
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging) onResize(window.innerWidth - event.clientX, false)
  }
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setDragging(false)
    document.body.style.userSelect = ''
    onResize(window.innerWidth - event.clientX, true)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      onResize(width + (event.key === 'ArrowLeft' ? DOCK_RESIZE_KEY_STEP_PX : -DOCK_RESIZE_KEY_STEP_PX), true)
    }
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t({ ko: '채팅 패널 폭', en: 'Chat panel width' })}
      aria-valuenow={width}
      aria-valuemin={DOCK_RESIZE_MIN_PX}
      aria-valuemax={DOCK_RESIZE_MAX_PX}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onDoubleClick={() => onResize(DOCK_DEFAULT_WIDTH_PX, true)}
      onKeyDown={handleKeyDown}
      // A wide grab strip over the border; the line lights up on hover / while dragging.
      className="group absolute inset-y-0 -left-1.5 z-10 flex w-3 cursor-col-resize justify-center outline-none"
    >
      <span className={cn('h-full w-0.5 transition-colors group-hover:bg-primary/60 group-focus-visible:bg-primary', dragging && 'bg-primary')} />
    </div>
  )
}

/** Leave /chat the way the user came in, or go home when it was opened directly. */
export function useLeaveCodexChatPage() {
  const navigate = useNavigate()
  return useCallback(() => {
    const historyIndex = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (historyIndex > 0) {
      navigate(-1)
    } else {
      navigate('/', { replace: true })
    }
  }, [navigate])
}

/** Whether the side panel is showing, so the shell can make room for it. */
export function useCodexChatDockVisible() {
  const chat = useCodexChat()
  const location = useLocation()
  return Boolean(chat?.canUse && chat.isPanelOpen && location.pathname !== CODEX_CHAT_ROUTE)
}

/** Header key: toggles the side panel; on the /chat page it folds the page back into the panel. */
export function CodexChatHeaderButton() {
  const { t } = useI18n()
  const chat = useCodexChat()
  const location = useLocation()
  const leaveChatPage = useLeaveCodexChatPage()

  if (!chat?.canUse) {
    return null
  }

  const isChatRoute = location.pathname === CODEX_CHAT_ROUTE
  const isWorking = chat.liveTurn !== null
  const handleClick = () => {
    if (isChatRoute) {
      chat.openPanel()
      leaveChatPage()
    } else if (chat.isPanelOpen) {
      chat.closePanel()
    } else {
      chat.openPanel()
    }
  }

  return (
    <IconButton
      variant="shell"
      label={isWorking ? t({ ko: '채팅 (답변 중)', en: 'Chat (replying)' }) : t({ ko: '채팅', en: 'Chat' })}
      tooltipSide="bottom"
      active={isChatRoute || chat.isPanelOpen}
      onClick={handleClick}
      onPointerEnter={() => void loadCodexChatView()}
      onFocus={() => void loadCodexChatView()}
      className="relative"
    >
      <MessageSquare />
      {/* A reply still running (panel closed or not) shows as a pulsing dot on the key. */}
      {isWorking ? <span aria-hidden="true" className="absolute right-1.5 top-1.5 size-2 animate-pulse rounded-full bg-primary" /> : null}
    </IconButton>
  )
}

/** The chat as a side panel on every page (full screen on narrow viewports). Hidden on /chat, which shows it as a page. */
export function CodexChatDock() {
  const { t } = useI18n()
  const chat = useCodexChat()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isDocked = useMinWidth(DOCK_MIN_WIDTH_PX)
  const visible = useCodexChatDockVisible()
  const closePanel = chat?.closePanel ?? (() => {})
  const coversScreen = visible && !isDocked
  const { width: dockWidth, setWidth: setDockWidth } = useDockWidth()

  // Page-level floating controls (bottom-right buttons, bottom actions) read this to step aside from the docked panel.
  const isDockedOpen = visible && isDocked
  useEffect(() => {
    if (!isDockedOpen) {
      return
    }
    document.documentElement.style.setProperty(CHAT_DOCK_WIDTH_VAR, `${dockWidth}px`)
  }, [dockWidth, isDockedOpen])
  useEffect(() => {
    if (!isDockedOpen) {
      return
    }
    return () => {
      document.documentElement.style.removeProperty(CHAT_DOCK_WIDTH_VAR)
    }
  }, [isDockedOpen])

  // Full screen on a phone: browser back steps out one screen (gallery or context → chat → chat list) and then closes
  // it; a step that keeps the panel open puts the history entry back. The page behind must not scroll.
  const stepBack = () => {
    if (!chat) return
    if (chat.view !== 'chat') chat.setView('chat')
    else if (!chat.listOpen && (queryClient.getQueryData<unknown[]>(CODEX_CHAT_THREADS_QUERY_KEY)?.length ?? 0) > 0) chat.setListOpen(true)
    else if (chat.pendingChat) chat.selectThread(null)
    else chat.closePanel()
  }
  useOverlayBackClose({ open: coversScreen, onClose: stepBack })
  useEffect(() => {
    if (!coversScreen) {
      return
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [coversScreen])

  if (!chat || !visible) {
    return null
  }

  return (
    <aside
      aria-label={t({ ko: '채팅', en: 'Chat' })}
      // Docked under the header's layer: header popups (queue, search, account) must open over the panel.
      className={isDocked
        ? 'fixed bottom-0 right-0 top-(--theme-shell-header-height) z-sticky flex flex-col border-l border-line bg-background'
        // eslint-disable-next-line no-restricted-syntax -- phone-width chat is a full-screen view of its own, not a dialog card
        : 'fixed inset-0 z-drawer-panel flex flex-col bg-background'}
      style={isDocked ? { width: dockWidth } : undefined}
    >
      {isDocked ? <DockResizeHandle width={dockWidth} onResize={setDockWidth} /> : null}
      <Suspense fallback={<LoadingState variant="inline" />}>
        <CodexChatViewLazy
          layout="panel"
          onClose={closePanel}
          onExpand={() => {
            closePanel()
            navigate(CODEX_CHAT_ROUTE)
          }}
        />
      </Suspense>
    </aside>
  )
}
