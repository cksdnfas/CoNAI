import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { RefreshCw, Sparkles } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import { getErrorMessage } from '@/lib/error-message'
import { suggestChatReplies } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'

/*
 * Reply suggestions: the sparkle button beside the composer. Nothing is generated until it is pressed; the answer
 * is kept per (thread, last message) so reopening the tray is instant until the chat moves on.
 */

export type ReplySuggestions = {
  open: boolean
  loading: boolean
  items: string[]
  error: string | null
  toggle: () => void
  close: () => void
  refresh: () => void
}

export function useReplySuggestions({ threadId, lastMessageId, enabled }: { threadId: number | null; lastMessageId: number | null; enabled: boolean }): ReplySuggestions {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const cache = useRef(new Map<string, string[]>())
  const inflight = useRef<AbortController | null>(null)
  const key = threadId === null ? null : `${threadId}:${lastMessageId ?? 0}`

  const cancel = useCallback(() => {
    inflight.current?.abort()
    inflight.current = null
    setLoading(false)
  }, [])

  // The chat moved on (or changed): what was suggested no longer fits, so the tray closes and empties.
  useEffect(() => {
    cancel()
    setOpen(false)
    setItems(key ? cache.current.get(key) ?? [] : [])
    setError(null)
  }, [key, cancel])
  useEffect(() => () => inflight.current?.abort(), [])

  const fetchNow = useCallback(() => {
    if (threadId === null || !key) return
    inflight.current?.abort()
    const controller = new AbortController()
    inflight.current = controller
    setLoading(true)
    setError(null)
    suggestChatReplies(threadId, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        cache.current.set(key, data.suggestions)
        setItems(data.suggestions)
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(getErrorMessage(cause, t({ ko: '추천을 받지 못했어.', en: 'Could not get suggestions.' })))
      })
      .finally(() => {
        if (inflight.current === controller) {
          inflight.current = null
          setLoading(false)
        }
      })
  }, [threadId, key, t])

  const toggle = useCallback(() => {
    if (!enabled || !key) return
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (!cache.current.has(key)) fetchNow()
  }, [enabled, key, open, fetchNow])

  const close = useCallback(() => setOpen(false), [])

  return { open: open && enabled, loading, items, error, toggle, close, refresh: fetchNow }
}

export function ChatSuggestButton({ buttonRef, open, loading, disabled, onToggle }: {
  buttonRef: RefObject<HTMLButtonElement | null>
  open: boolean
  loading: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  const { t } = useI18n()
  return (
    <IconButton
      ref={buttonRef}
      variant="ghost"
      size="icon-sm"
      className={cn('rounded-full text-primary hover:text-primary', open && 'bg-primary/15')}
      aria-expanded={open}
      disabled={disabled}
      onClick={onToggle}
      label={t({ ko: '답장 추천', en: 'Suggest replies' })}
    >
      <Sparkles className={cn(loading && 'animate-pulse')} />
    </IconButton>
  )
}

/**
 * The suggestions, popped up above the composer: a tap fills the composer with that line. Closes on Esc or a click
 * elsewhere (not on the sparkle button, which toggles).
 */
export function ChatSuggestTray({ suggestions, buttonRef, onPick }: {
  suggestions: ReplySuggestions
  buttonRef: RefObject<HTMLButtonElement | null>
  onPick: (text: string) => void
}) {
  const { t } = useI18n()
  const trayRef = useRef<HTMLDivElement>(null)
  const { open, loading, items, error, close, refresh } = suggestions

  useEffect(() => {
    if (!open) return
    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (trayRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      if ((target as Element).closest?.('[data-radix-popper-content-wrapper], [role="dialog"], [role="alertdialog"]')) return
      close()
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('pointerdown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [buttonRef, close, open])

  if (!open) return null
  return (
    <div ref={trayRef} role="group" aria-label={t({ ko: '답장 추천', en: 'Reply suggestions' })} className="absolute bottom-full left-0 z-10 mb-1.5 max-h-80 w-[22rem] max-w-full overflow-y-auto animate-in fade-in-0 zoom-in-95 rounded-lg border border-line bg-background/90 shadow-lg backdrop-blur-md motion-reduce:animate-none">
      <div className="flex flex-col divide-y divide-line" aria-busy={loading}>
        {loading && items.length === 0 ? (
          Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="px-3 py-2.5" aria-hidden="true">
              <div className="h-3.5 animate-pulse rounded-sm bg-fill motion-reduce:animate-none" style={{ width: `${72 - index * 14}%` }} />
            </div>
          ))
        ) : error && items.length === 0 ? (
          <p className="px-3 py-2.5 text-xs text-destructive">{error}</p>
        ) : items.map((text) => (
          // eslint-disable-next-line no-restricted-syntax -- a full-width text row; Button's fills and sizes do not fit
          <button
            key={text}
            type="button"
            onClick={() => onPick(text)}
            className={cn('w-full cursor-pointer px-3 py-2.5 text-left text-sm leading-snug text-foreground/85 outline-none transition-colors hover:bg-fill hover:text-foreground focus-visible:bg-fill focus-visible:text-foreground', loading && 'opacity-50')}
          >
            {text}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-end border-t border-line py-1 pr-1">
        <IconButton variant="ghost" size="icon-xs" disabled={loading} onClick={refresh} label={t({ ko: '다시 뽑기', en: 'Suggest again' })}>
          <RefreshCw className={cn(loading && 'animate-spin')} />
        </IconButton>
      </div>
    </div>
  )
}
