import { useEffect, useRef } from 'react'
import { useCodexChat } from '@/features/codex-chat/codex-chat-context'
import { CodexChatProvider } from '@/features/codex-chat/codex-chat-provider'
import { CodexChatView } from '@/features/codex-chat/codex-chat-view'
import { ImageViewModalProvider } from '@/features/images/components/detail/image-view-modal-provider'
import type { WallpaperWidgetInstance } from './wallpaper-types'
import { useWallpaperChatThreads } from './wallpaper-widget-data'

/** Opens the panel where the widget says once: the chat list, or one character's latest chat. */
function ChatPanelStart({ start, profileId }: { start: 'list' | 'chat'; profileId: number | null }) {
  const chat = useCodexChat()
  const threadsQuery = useWallpaperChatThreads(start === 'chat' ? profileId : null)
  const followedId = profileId === null ? null : threadsQuery.data?.[0]?.id ?? null
  const startedRef = useRef(false)

  useEffect(() => {
    if (!chat || startedRef.current) return
    if (start === 'list') {
      startedRef.current = true
      chat.setListOpen(true)
      return
    }
    // No character: the panel opens the latest chat on its own, as in the app.
    if (profileId === null) {
      startedRef.current = true
      return
    }
    if (followedId !== null) {
      startedRef.current = true
      chat.selectThread(followedId)
    }
  }, [chat, start, profileId, followedId])

  return null
}

/**
 * The app's own chat panel inside a widget: the same list, transcript, composer, menus and cards as the app, so the
 * wallpaper never drifts from the chat. The wallpaper key logs its browser in as the key's account.
 */
function WallpaperChatPanel({ start, profileId }: { start: 'list' | 'chat'; profileId: number | null }) {
  return (
    <CodexChatProvider>
      <ImageViewModalProvider>
        <ChatPanelStart start={start} profileId={profileId} />
        <div className="flex h-full min-h-0 flex-col">
          <CodexChatView layout="panel" />
        </div>
      </ImageViewModalProvider>
    </CodexChatProvider>
  )
}

export function WallpaperChatRecentBody({ widget }: { widget: Extract<WallpaperWidgetInstance, { type: 'chat-recent' }> }) {
  return <WallpaperChatPanel start="chat" profileId={widget.settings.profileId} />
}

export function WallpaperChatInboxBody() {
  return <WallpaperChatPanel start="list" profileId={null} />
}
