import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Flag, Monitor, Paperclip, Pin, Plus, Sparkles, Wrench, type LucideIcon } from 'lucide-react'
import type { ChatToolDirectiveSnapshot } from '@conai/shared'
import { IconButton } from '@/components/ui/icon-button'
import { ListRow } from '@/components/ui/list-row'
import { Tip } from '@/components/ui/tooltip'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { ChatAttachButton, ChatAttachDialogs, ChatAttachMenu, useChatAttach } from './chat-attachments'
import { ChatFlagButton } from './chat-flags'
import { ChatPageConnectButton, useChatPage } from './chat-page-context'
import { ChatSuggestButton, type ReplySuggestions } from './chat-suggestions'
import { ChatToolsButton, ChatToolsChip, ChatToolsTray, chatToolPickLabel, useChatComposerTools } from './chat-composer-tools'
import { useTrayDismiss } from './chat-tray'
import type { ChatComposerToolsTarget } from '@/lib/api-codex-chat'
import type { ChatToolSelection, CodexChatApi } from './codex-chat-context'

/*
 * The composer's action keys. With two or more on offer they fold behind one + key: its stack lists them (each with
 * a pin that keeps it in the row), and whatever is switched on shows in the row on its own. With one it shows alone.
 */

type ItemId = 'attach' | 'page' | 'flags' | 'suggest' | 'tools'
const ITEM_IDS: readonly ItemId[] = ['attach', 'page', 'flags', 'suggest', 'tools']
const ITEM_ICON: Record<ItemId, LucideIcon> = { attach: Paperclip, page: Monitor, flags: Flag, suggest: Sparkles, tools: Wrench }

const PINS_STORAGE_PREFIX = 'conai.chat.composer-pins.'
const NO_SELECTION: ChatToolSelection = { pick: null, keep: false }

function readPins(key: string): ItemId[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? '[]') as unknown
    return Array.isArray(parsed) ? ITEM_IDS.filter((id) => parsed.includes(id)) : []
  } catch {
    return []
  }
}

/** The items kept in the row, saved in this browser for the account (not per chat, not per look). */
function useComposerPins() {
  const authStatus = useAuthStatusQuery().data
  const key = authStatus ? `${PINS_STORAGE_PREFIX}${authStatus.accountId ?? 'local'}` : null
  const [loaded, setLoaded] = useState<{ key: string | null; pins: ItemId[] }>({ key: null, pins: [] })
  if (loaded.key !== key) setLoaded({ key, pins: key ? readPins(key) : [] })
  const togglePin = (id: ItemId) => {
    if (!key) return
    const pins = loaded.pins.includes(id) ? loaded.pins.filter((pin) => pin !== id) : ITEM_IDS.filter((pin) => pin === id || loaded.pins.includes(pin))
    setLoaded({ key, pins })
    try {
      if (pins.length === 0) window.localStorage.removeItem(key)
      else window.localStorage.setItem(key, JSON.stringify(pins))
    } catch {
      // Storage blocked or full: the pins last for this page only.
    }
  }
  return { pins: loaded.pins, togglePin }
}

/** A tray the composer hosts for one of its items; it renders against whichever key (or the + key) it hangs from. */
type ItemTray = (anchorRef: RefObject<HTMLButtonElement | null>) => ReactNode

export function ChatComposerActions({ chat, selectionKey, toolsTarget, trayHost, composerRef, attachDisabled, allowPrivateUploads, pageAvailable, pageDisabled, toolsDisabled, flags, suggest }: {
  chat: CodexChatApi
  /** The chat (or PENDING_DRAFT_KEY) whose picked tool this composer holds. */
  selectionKey: number | null
  toolsTarget: ChatComposerToolsTarget | null
  /**
   * Where the trays rise from: beside the composer panel, not inside it, so the panel's focus ring does not light up
   * for a tray and its backdrop blur does not stop the trays' own from reaching the transcript.
   */
  trayHost: HTMLElement | null
  composerRef: RefObject<HTMLTextAreaElement | null>
  attachDisabled: boolean
  allowPrivateUploads: boolean
  pageAvailable: boolean
  pageDisabled: boolean
  toolsDisabled: boolean
  flags: { available: boolean; count: number; open: boolean; disabled: boolean; setOpen: (open: boolean) => void; buttonRef: RefObject<HTMLButtonElement | null>; tray: ItemTray }
  suggest: { available: boolean; disabled: boolean; state: ReplySuggestions; buttonRef: RefObject<HTMLButtonElement | null>; tray: ItemTray }
}) {
  const { t } = useI18n()
  const page = useChatPage()
  const attach = useChatAttach(allowPrivateUploads)
  const toolsOffer = useChatComposerTools(toolsTarget)
  const { pins, togglePin } = useComposerPins()
  const [stackOpen, setStackOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const plusRef = useRef<HTMLButtonElement | null>(null)
  const attachKeyRef = useRef<HTMLButtonElement | null>(null)
  const toolsKeyRef = useRef<HTMLButtonElement | null>(null)
  const stackRef = useRef<HTMLDivElement | null>(null)
  const stackId = useId()

  const selection = selectionKey === null ? NO_SELECTION : chat.toolSelections[selectionKey] ?? NO_SELECTION
  const offered: Record<ItemId, boolean> = { attach: attach.available, page: pageAvailable, flags: flags.available, suggest: suggest.available, tools: selectionKey !== null && toolsOffer.available }
  const available = ITEM_IDS.filter((id) => offered[id])
  const collapsed = available.length >= 2
  // Anything switched on stays in the row; the tools item shows as the chip of its pick instead.
  const on: Record<ItemId, boolean> = { attach: false, page: page?.enabled === true, flags: flags.count > 0, suggest: false, tools: selection.pick !== null }
  const inRow = (id: ItemId) => !collapsed || pins.includes(id) || (id !== 'tools' && on[id])
  const anchorFor = (id: ItemId, keyRef: RefObject<HTMLButtonElement | null>) => (inRow(id) ? keyRef : plusRef)

  const closeTrays = () => {
    setStackOpen(false)
    setToolsOpen(false)
    flags.setOpen(false)
    suggest.state.close()
  }
  useEffect(() => {
    setStackOpen(false)
    setToolsOpen(false)
  }, [selectionKey])

  const stackShown = stackOpen && collapsed
  useTrayDismiss({ open: stackShown, trayRef: stackRef, buttonRef: plusRef, onClose: () => setStackOpen(false) })
  // Opened from the keyboard, the stack takes focus on its first key: it sits before the composer in the tab order, not after +.
  const focusStackOnOpen = useRef(false)
  useEffect(() => {
    if (!stackShown) focusStackOnOpen.current = false
    const first = stackRef.current?.querySelector<HTMLElement>('button:not(:disabled)')
    if (!focusStackOnOpen.current || !first) return
    focusStackOnOpen.current = false
    first.focus()
  }, [stackShown])

  const label: Record<ItemId, string> = {
    attach: t({ ko: '첨부', en: 'Attach' }),
    page: t({ ko: '페이지 연결', en: 'Link page' }),
    flags: t({ ko: '플래그', en: 'Flags' }),
    suggest: t({ ko: '추천 답변', en: 'Suggestions' }),
    tools: t({ ko: '도구', en: 'Tools' }),
  }
  const state: Record<ItemId, string> = {
    attach: '',
    page: page?.enabled ? [t({ ko: '켜짐', en: 'On' }), page.snapshot?.title].filter(Boolean).join(' · ') : t({ ko: '꺼짐', en: 'Off' }),
    flags: flags.count > 0 ? t({ ko: '{count}개 켜짐', en: '{count} on' }, { count: flags.count }) : '',
    suggest: '',
    tools: selection.pick === null ? '' : chatToolPickLabel(selection.pick, t),
  }
  const disabled: Record<ItemId, boolean> = {
    attach: attachDisabled || chat.attachmentsUploading,
    page: pageDisabled || !page?.available,
    flags: flags.disabled,
    suggest: suggest.disabled,
    tools: toolsDisabled,
  }

  const openTool = (id: 'flags' | 'suggest' | 'tools') => {
    closeTrays()
    if (id === 'flags') flags.setOpen(true)
    else if (id === 'suggest') suggest.state.toggle()
    else setToolsOpen(true)
  }
  const pressChip = (id: ItemId) => {
    if (id === 'page') page?.toggle()
    else if (id === 'flags' || id === 'suggest') {
      openTool(id)
      anchorFor(id, id === 'flags' ? flags.buttonRef : suggest.buttonRef).current?.focus()
    } else if (id === 'tools') openTool('tools')
  }

  const renderKey = (id: ItemId) => {
    switch (id) {
      case 'attach': return <ChatAttachButton key={id} buttonRef={attachKeyRef} attach={attach} disabled={disabled.attach} />
      // Turned off, the page link's key leaves the row unless pinned: focus moves to + before it goes.
      case 'page': return <ChatPageConnectButton key={id} disabled={pageDisabled} onPress={() => { if (page?.enabled && collapsed && !pins.includes('page')) plusRef.current?.focus() }} />
      case 'flags': return <ChatFlagButton key={id} buttonRef={flags.buttonRef} count={flags.count} open={flags.open} disabled={disabled.flags} onToggle={() => { const next = !flags.open; closeTrays(); flags.setOpen(next) }} />
      case 'suggest': return <ChatSuggestButton key={id} buttonRef={suggest.buttonRef} open={suggest.state.open} loading={suggest.state.loading} disabled={disabled.suggest} onToggle={() => { const wasOpen = suggest.state.open; closeTrays(); if (!wasOpen) suggest.state.toggle() }} />
      case 'tools': return <ChatToolsButton key={id} buttonRef={toolsKeyRef} open={toolsOpen} disabled={disabled.tools} onToggle={() => { const next = !toolsOpen; closeTrays(); setToolsOpen(next) }} />
    }
  }

  const pickTool = (pick: ChatToolDirectiveSnapshot | null) => {
    if (selectionKey === null) return
    chat.setToolPick(selectionKey, pick)
    setToolsOpen(false)
    composerRef.current?.focus()
  }

  return (
    <>
      {attach.available ? <ChatAttachDialogs chat={chat} attach={attach} /> : null}
      {collapsed ? (
        <IconButton
          ref={plusRef}
          variant="ghost"
          size="icon-sm"
          aria-expanded={stackShown}
          aria-controls={stackShown ? stackId : undefined}
          onClick={(event) => { const next = !stackOpen; closeTrays(); focusStackOnOpen.current = next && event.detail === 0; setStackOpen(next) }}
          label={stackShown ? t({ ko: '입력 도구 닫기', en: 'Hide composer tools' }) : t({ ko: '입력 도구 열기', en: 'Show composer tools' })}
        >
          <Plus className={cn('transition-transform duration-200 ease-out motion-reduce:transition-none', stackShown && 'rotate-45')} />
        </IconButton>
      ) : null}
      {trayHost ? createPortal(<>
      {stackShown ? (
        // One solid panel like the tools and suggestions trays: loose chips could not be read over the transcript's text.
        <div ref={stackRef} id={stackId} role="group" aria-label={t({ ko: '입력 도구', en: 'Composer tools' })} className="absolute bottom-full left-0 z-10 mb-1.5 flex w-72 max-w-full animate-in flex-col-reverse fade-in-0 zoom-in-95 rounded-lg border border-line bg-background/90 p-1 shadow-lg backdrop-blur-md motion-reduce:animate-none">
          {available.map((id) => {
            const Icon = ITEM_ICON[id]
            const pinned = pins.includes(id)
            const row = (
              <ListRow asChild interactive size="sm" selected={on[id]} leading={<Icon className="size-4" aria-hidden />}>
                <button type="button" disabled={disabled[id]} aria-pressed={id === 'page' ? on.page : undefined} onClick={id === 'attach' ? undefined : () => pressChip(id)}>
                  <span className="shrink-0 font-semibold">{label[id]}</span>
                  {state[id] ? <span className="min-w-0 truncate text-xs text-muted-foreground">{state[id]}</span> : null}
                </button>
              </ListRow>
            )
            return (
              <div key={id} className="flex items-center gap-1">
                {/* Alone in its cell, the row is a last row: no hairline that would stop short of the pin. */}
                <div className="min-w-0 flex-1">
                  {id === 'attach' ? <ChatAttachMenu attach={attach} side="right" returnFocusRef={anchorFor('attach', attachKeyRef)} onPick={closeTrays}>{row}</ChatAttachMenu> : row}
                </div>
                <Tip content={pinned ? t({ ko: '고정 해제', en: 'Unpin' }) : t({ ko: '입력줄에 고정', en: 'Pin to the row' })} side="right">
                  <IconButton variant="ghost" size="icon-sm" tooltip={false} active={pinned} label={t({ ko: '{item} 고정', en: 'Pin {item}' }, { item: label[id] })} onClick={() => togglePin(id)}>
                    <Pin className={pinned ? 'fill-current' : undefined} />
                  </IconButton>
                </Tip>
              </div>
            )
          })}
        </div>
      ) : null}
      {offered.tools ? (
        <ChatToolsTray
          open={toolsOpen}
          presets={toolsOffer.presets}
          groups={toolsOffer.groups}
          pick={selection.pick}
          keep={selection.keep}
          buttonRef={anchorFor('tools', toolsKeyRef)}
          onPick={pickTool}
          onKeep={(keep) => { if (selectionKey !== null) chat.setToolKeep(selectionKey, keep) }}
          onClose={() => setToolsOpen(false)}
        />
      ) : null}
      {flags.available ? flags.tray(anchorFor('flags', flags.buttonRef)) : null}
      {suggest.available ? suggest.tray(anchorFor('suggest', suggest.buttonRef)) : null}
      </>, trayHost) : null}
      {ITEM_IDS.filter((id) => offered[id] && inRow(id)).map(renderKey)}
      {selection.pick !== null ? <ChatToolsChip pick={selection.pick} keep={selection.keep} onClear={() => pickTool(null)} /> : null}
    </>
  )
}
