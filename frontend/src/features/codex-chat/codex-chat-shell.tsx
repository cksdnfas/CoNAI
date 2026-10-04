import { Suspense, lazy, useCallback, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { MessageSquare } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { LoadingState } from '@/components/ui/loading-state'
import { useOverlayBackClose } from '@/components/ui/use-overlay-back-close'
import { useI18n } from '@/i18n'
import { useMinWidth } from '@/lib/use-min-width'
import { CODEX_CHAT_ROUTE, useCodexChat } from './codex-chat-context'

/** Docked beside the page from this width (Tailwind `lg`); below it the panel covers the screen. */
const DOCK_MIN_WIDTH_PX = 1024
const DOCK_WIDTH_PX = 420
/** Set on <html> while the panel is docked: fixed page controls offset themselves by it. */
const CHAT_DOCK_WIDTH_VAR = '--chat-dock-width'

const loadCodexChatView = () => import('./codex-chat-view')
const CodexChatViewLazy = lazy(async () => ({ default: (await loadCodexChatView()).CodexChatView }))

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
  const isDocked = useMinWidth(DOCK_MIN_WIDTH_PX)
  const visible = useCodexChatDockVisible()
  const closePanel = chat?.closePanel ?? (() => {})
  const coversScreen = visible && !isDocked

  // Page-level floating controls (bottom-right buttons, bottom actions) read this to step aside from the docked panel.
  const isDockedOpen = visible && isDocked
  useEffect(() => {
    if (!isDockedOpen) {
      return
    }
    document.documentElement.style.setProperty(CHAT_DOCK_WIDTH_VAR, `${DOCK_WIDTH_PX}px`)
    return () => {
      document.documentElement.style.removeProperty(CHAT_DOCK_WIDTH_VAR)
    }
  }, [isDockedOpen])

  // Full screen on a phone: browser back closes it, and the page behind must not scroll.
  useOverlayBackClose({ open: coversScreen, onClose: closePanel })
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
        ? 'fixed bottom-0 right-0 top-(--theme-shell-header-height) z-sticky flex w-[420px] flex-col border-l border-line bg-background'
        // eslint-disable-next-line no-restricted-syntax -- phone-width chat is a full-screen view of its own, not a dialog card
        : 'fixed inset-0 z-drawer-panel flex flex-col bg-background'}
    >
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
