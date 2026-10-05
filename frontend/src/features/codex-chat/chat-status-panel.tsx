import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react'
import { Activity, Check, ChevronDown, ChevronUp, GripVertical, Minimize2, PanelRight, PanelRightClose, Pencil, PictureInPicture2, RotateCcw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import type { ChatBlockChange, ChatBlocksState, ChatDisplayBlock, CodexChatMessage } from '@/lib/api-codex-chat'
import { cn } from '@/lib/utils'
import { blockSummaryLine, ChatDisplayBlockView, describeBlockChange, type BlockAction } from './chat-display-block'
import { parseServerDate } from './codex-chat-message'

/*
 * The status panel: the profile's display blocks filled with the chat's current state. On a wide chat page it is a
 * column docked to the right or a card floating over the transcript (dragged and resized by the reader); in the side
 * panel and on phones it is a one-line strip under the header that unfolds into a sheet. Everything here reads the
 * state the server folded; edits go back through `onEdit`.
 */

export type ChatStatusPanelMode = 'docked' | 'floating'

export type ChatStatusPanelLayout = {
  mode: ChatStatusPanelMode
  /** Shown at all (wide page only; the strip is always there). */
  open: boolean
  /** Floating card: offset from the top-right corner of the transcript area, and its size (height null: by content). */
  x: number
  y: number
  w: number
  h: number | null
}

const LAYOUT_STORAGE_KEY = 'conai.chat.status-panel.v1'
const DEFAULT_LAYOUT: ChatStatusPanelLayout = { mode: 'docked', open: true, x: 16, y: 12, w: 300, h: null }
const FLOATING_MIN = { w: 240, h: 160 }
const RECENT_CHANGES = 5

function readLayout(): ChatStatusPanelLayout {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) as Partial<ChatStatusPanelLayout> : null
    if (!parsed || typeof parsed !== 'object') return DEFAULT_LAYOUT
    return {
      mode: parsed.mode === 'floating' ? 'floating' : 'docked',
      open: parsed.open !== false,
      x: Number.isFinite(parsed.x) ? Number(parsed.x) : DEFAULT_LAYOUT.x,
      y: Number.isFinite(parsed.y) ? Number(parsed.y) : DEFAULT_LAYOUT.y,
      w: Number.isFinite(parsed.w) ? Math.max(FLOATING_MIN.w, Number(parsed.w)) : DEFAULT_LAYOUT.w,
      h: Number.isFinite(parsed.h) ? Math.max(FLOATING_MIN.h, Number(parsed.h)) : null,
    }
  } catch {
    return DEFAULT_LAYOUT
  }
}

/** Where the reader keeps the panel (this browser). */
export function useStatusPanelLayout(): [ChatStatusPanelLayout, (patch: Partial<ChatStatusPanelLayout>) => void] {
  const [layout, setLayout] = useState<ChatStatusPanelLayout>(readLayout)
  const update = useCallback((patch: Partial<ChatStatusPanelLayout>) => setLayout((current) => {
    const next = { ...current, ...patch }
    try { window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next)) } catch { /* storage blocked */ }
    return next
  }), [])
  return [layout, update]
}

/** A block as the panel lists it; rooms prefix the key with the member (`<profileId>:<key>`) and label the tab. */
export type ChatStatusBlock = ChatDisplayBlock & { label?: string }

export type ChatStatusData = {
  /** Usable blocks of the profile (or of every room member), in order. */
  blocks: ChatStatusBlock[]
  state: ChatBlocksState
  /** The transcript, for the recent-changes list. */
  messages: CodexChatMessage[]
  /** A reply is running: no edits now. */
  busy: boolean
  onEdit: (key: string, data: Record<string, unknown> | null) => Promise<void>
  /** Items picked for the next message (`data-pick` elements), and clicks inside a block. */
  picks: ReadonlySet<string>
  onAction: (key: string, action: BlockAction) => void
}

/** Text tabs inside the panel frame, one per block (none when there is a single block). */
function BlockTabs({ blocks, activeKey, onChange, className }: { blocks: ChatStatusBlock[]; activeKey: string; onChange: (key: string) => void; className?: string }) {
  if (blocks.length <= 1) return <span className={cn('truncate text-sm font-semibold', className)}>{blocks[0]?.label ?? blocks[0]?.key}</span>
  return (
    <div role="tablist" className={cn('flex min-w-0 flex-wrap items-stretch gap-x-3', className)}>
      {blocks.map((block) => (
        <Button
          key={block.id}
          variant="ghost"
          size="sm"
          role="tab"
          aria-selected={block.key === activeKey}
          onClick={() => onChange(block.key)}
          className={cn('h-8 shrink-0 rounded-none border-b-2 px-0.5 hover:bg-transparent', block.key === activeKey ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
        >
          {block.label ?? block.key}
        </Button>
      ))}
    </div>
  )
}

/** The last few replies that changed this block, newest first. */
function RecentChanges({ messages, changes, blockKey }: { messages: CodexChatMessage[]; changes: ChatBlocksState['changes']; blockKey: string }) {
  const { t, formatDateTime } = useI18n()
  const rows = useMemo(() => {
    const result: Array<{ id: number; time: string; text: string }> = []
    for (let index = messages.length - 1; index >= 0 && result.length < RECENT_CHANGES; index -= 1) {
      const message = messages[index]
      const list = changes[message.id]?.[blockKey]
      if (!list?.length) continue
      const date = parseServerDate(message.created_date)
      result.push({ id: message.id, time: Number.isNaN(date.getTime()) ? '' : formatDateTime(date, { hour: '2-digit', minute: '2-digit' }), text: list.flatMap((change: ChatBlockChange) => describeBlockChange(change, t)).join(', ') })
    }
    return result
  }, [blockKey, changes, formatDateTime, messages, t])
  if (rows.length === 0) return null
  return (
    <ul className="space-y-1.5 border-t border-line pt-3 text-xs text-muted-foreground">
      {rows.map((row) => <li key={row.id} className="flex gap-2.5"><span className="shrink-0 tabular-nums">{row.time}</span><span className="min-w-0 break-words">{row.text}</span></li>)}
    </ul>
  )
}

/** Hand editing: the block's values as JSON. */
function BlockEditor({ data, busy, onSave, onCancel }: { data: Record<string, unknown>; busy: boolean; onSave: (data: Record<string, unknown>) => Promise<void>; onCancel: () => void }) {
  const { t } = useI18n()
  const [text, setText] = useState(() => JSON.stringify(data, null, 2))
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    try {
      const parsed: unknown = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object')
      await onSave(parsed as Record<string, unknown>)
    } catch (caught) {
      setError(caught instanceof SyntaxError || (caught instanceof Error && caught.message === 'object') ? t({ ko: 'JSON 객체가 아니야.', en: 'Not a JSON object.' }) : caught instanceof Error ? caught.message : String(caught))
    }
  }
  return (
    <div className="space-y-1.5">
      <Textarea autoFocus value={text} rows={10} disabled={busy} className="font-mono text-xs" aria-label={t({ ko: '상태 값 (JSON)', en: 'Status values (JSON)' })} aria-invalid={error !== null} onChange={(event) => { setText(event.target.value); setError(null) }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() }
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save() }
      }} />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <div className="flex justify-end gap-1">
        <IconButton size="icon-xs" variant="ghost" label={t({ ko: '취소', en: 'Cancel' })} disabled={busy} onClick={onCancel}><X /></IconButton>
        <IconButton size="icon-xs" variant="ghost" label={t({ ko: '저장', en: 'Save' })} disabled={busy} onClick={() => void save()}><Check /></IconButton>
      </div>
    </div>
  )
}

/**
 * The panel's content: tabs and actions on one line, the active block's card, then its recent changes. `actions`
 * are the frame's own buttons (dock, float, hide, fold) placed after the edit and reset ones.
 */
export function ChatStatusContent({ data, activeKey, onActiveKey, actions, headerClassName, bodyClassName }: {
  data: ChatStatusData
  activeKey: string
  onActiveKey: (key: string) => void
  actions?: ReactNode
  headerClassName?: string
  bodyClassName?: string
}) {
  const { t } = useI18n()
  const [editing, setEditing] = useState(false)
  const block = data.blocks.find((entry) => entry.key === activeKey) ?? data.blocks[0]
  useEffect(() => setEditing(false), [activeKey, data.busy])
  if (!block) return null
  const values = data.state.state[block.key] ?? {}
  return (
    <>
      <div className={cn('flex min-h-12 shrink-0 flex-wrap items-center gap-1 border-b border-line py-1 pl-4 pr-1', headerClassName)}>
        <BlockTabs blocks={data.blocks} activeKey={block.key} onChange={onActiveKey} className="min-w-0 flex-1 basis-40" />
        <span className="ml-auto flex items-center gap-1">
          <IconButton variant="ghost" size="icon-sm" active={editing} disabled={data.busy} onClick={() => setEditing((current) => !current)} label={t({ ko: '직접 고치기', en: 'Edit values' })}><Pencil /></IconButton>
          <IconButton variant="ghost" size="icon-sm" disabled={data.busy} onClick={() => void data.onEdit(block.key, null)} label={t({ ko: '처음 값으로', en: 'Reset to starting values' })}><RotateCcw /></IconButton>
          {actions}
        </span>
      </div>
      <div className={cn('min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3', bodyClassName)}>
        {editing
          ? <BlockEditor data={values} busy={data.busy} onSave={async (next) => { await data.onEdit(block.key, next); setEditing(false) }} onCancel={() => setEditing(false)} />
          : <ChatDisplayBlockView block={block} data={values} picked={data.picks} onAction={(action) => data.onAction(block.key, action)} />}
        <RecentChanges messages={data.messages} changes={data.state.changes} blockKey={block.key} />
      </div>
    </>
  )
}

/** Wide page, docked: a column to the right of the transcript. */
export function ChatStatusAside({ data, activeKey, onActiveKey, onFloat, onHide }: { data: ChatStatusData; activeKey: string; onActiveKey: (key: string) => void; onFloat: () => void; onHide: () => void }) {
  const { t } = useI18n()
  return (
    <aside aria-label={t({ ko: '상태창', en: 'Status panel' })} className="flex w-[300px] shrink-0 flex-col border-l border-line">
      <ChatStatusContent data={data} activeKey={activeKey} onActiveKey={onActiveKey} actions={<>
        <IconButton variant="ghost" size="icon-sm" onClick={onFloat} label={t({ ko: '떼어서 띄우기', en: 'Float' })}><PictureInPicture2 /></IconButton>
        <IconButton variant="ghost" size="icon-sm" onClick={onHide} label={t({ ko: '상태창 접기', en: 'Hide status panel' })}><PanelRightClose /></IconButton>
      </>} />
    </aside>
  )
}

type DragState = { kind: 'move' | 'resize'; startX: number; startY: number; x: number; y: number; w: number; h: number }

/**
 * Wide page, floating: a card over the transcript, anchored to its top-right corner. The grip drags it, the corner
 * resizes it; both keep it inside `containerRef`.
 */
export function ChatStatusFloating({ data, activeKey, onActiveKey, layout, onLayout, onDock, onHide, containerRef }: {
  data: ChatStatusData
  activeKey: string
  onActiveKey: (key: string) => void
  layout: ChatStatusPanelLayout
  onLayout: (patch: Partial<ChatStatusPanelLayout>) => void
  onDock: () => void
  onHide: () => void
  containerRef: RefObject<HTMLElement | null>
}) {
  const { t } = useI18n()
  const cardRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number | null } | null>(null)

  const clamp = useCallback((next: { x: number; y: number; w: number; h: number | null }) => {
    const container = containerRef.current
    const card = cardRef.current
    if (!container || !card) return next
    const maxW = Math.max(FLOATING_MIN.w, container.clientWidth - 8)
    const w = Math.min(maxW, Math.max(FLOATING_MIN.w, next.w))
    const h = next.h === null ? null : Math.min(Math.max(FLOATING_MIN.h, container.clientHeight - 8), Math.max(FLOATING_MIN.h, next.h))
    const height = h ?? card.offsetHeight
    return {
      x: Math.min(Math.max(0, next.x), Math.max(0, container.clientWidth - w)),
      y: Math.min(Math.max(0, next.y), Math.max(0, container.clientHeight - height)),
      w,
      h,
    }
  }, [containerRef])

  const start = (kind: DragState['kind']) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const card = cardRef.current
    dragRef.current = { kind, startX: event.clientX, startY: event.clientY, x: layout.x, y: layout.y, w: layout.w, h: layout.h ?? card?.offsetHeight ?? FLOATING_MIN.h }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    // Anchored to the right edge: moving the pointer right brings the card closer to it (smaller x).
    setLive(clamp(drag.kind === 'move'
      ? { x: drag.x - dx, y: drag.y + dy, w: drag.w, h: layout.h }
      : { x: drag.x - dx, y: drag.y, w: drag.w + dx, h: drag.h + dy }))
  }
  const end = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    setLive((current) => {
      if (current) onLayout(current)
      return null
    })
  }

  // Keep the card inside when the window shrinks.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => {
      const next = clamp({ x: layout.x, y: layout.y, w: layout.w, h: layout.h })
      if (next.x !== layout.x || next.y !== layout.y || next.w !== layout.w || next.h !== layout.h) onLayout(next)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [clamp, containerRef, layout.h, layout.w, layout.x, layout.y, onLayout])

  const shown = live ?? layout
  return (
    <section
      ref={cardRef}
      aria-label={t({ ko: '상태창', en: 'Status panel' })}
      className="absolute z-20 flex max-h-[calc(100%-16px)] flex-col overflow-hidden rounded-lg border border-line bg-background/90 shadow-lg backdrop-blur-md"
      style={{ right: shown.x, top: shown.y, width: shown.w, height: shown.h ?? undefined }}
    >
      <ChatStatusContent
        data={data}
        activeKey={activeKey}
        onActiveKey={onActiveKey}
        headerClassName="min-h-10 pl-9"
        actions={<>
          <IconButton variant="ghost" size="icon-sm" onClick={onDock} label={t({ ko: '오른쪽에 붙이기', en: 'Dock to the right' })}><PanelRight /></IconButton>
          <IconButton variant="ghost" size="icon-sm" onClick={onHide} label={t({ ko: '상태창 접기', en: 'Hide status panel' })}><Minimize2 /></IconButton>
        </>}
      />
      <span
        role="presentation"
        aria-label={t({ ko: '끌어서 옮기기', en: 'Drag to move' })}
        onPointerDown={start('move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="absolute left-1 top-0 flex h-10 w-7 cursor-grab touch-none items-center justify-center text-muted-foreground active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </span>
      <span
        role="presentation"
        aria-label={t({ ko: '크기 조절', en: 'Resize' })}
        onPointerDown={start('resize')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        className="absolute bottom-0 right-0 size-4 cursor-nwse-resize touch-none"
      >
        <svg viewBox="0 0 16 16" className="size-4 text-muted-foreground" aria-hidden="true"><path d="M15 3 3 15M15 9l-6 6M15 14l-1 1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      </span>
    </section>
  )
}

/** Side panel and phones: a one-line strip under the header; tapping it unfolds the panel as a sheet over the transcript. */
export function ChatStatusStrip({ data, activeKey, onActiveKey, open, onOpenChange }: { data: ChatStatusData; activeKey: string; onActiveKey: (key: string) => void; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useI18n()
  const block = data.blocks.find((entry) => entry.key === activeKey) ?? data.blocks[0]
  const summary = block ? blockSummaryLine(block, data.state.state[block.key] ?? {}) : ''
  if (!block) return null
  const stripLabel = block.label && data.blocks.length > 1 ? `${block.label.split(' · ')[0]} · ` : ''
  return (
    <>
      <Button
        variant="ghost"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className="h-10 w-full shrink-0 justify-start gap-2 rounded-none border-b border-line pl-3.5 pr-1 text-sm font-normal text-foreground/85"
      >
        <Activity className="size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-left">{stripLabel}{summary || block.key}</span>
        <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">{open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</span>
      </Button>
      {open ? (
        <div className="absolute inset-x-0 bottom-0 top-10 z-20 flex flex-col">
          <section aria-label={t({ ko: '상태창', en: 'Status panel' })} className="flex max-h-[70%] flex-col border-b border-line bg-background shadow-xl">
            <ChatStatusContent data={data} activeKey={block.key} onActiveKey={onActiveKey} headerClassName="min-h-11" />
            <Button variant="ghost" onClick={() => onOpenChange(false)} aria-label={t({ ko: '상태창 접기', en: 'Fold status panel' })} className="h-10 shrink-0 rounded-none border-t border-line text-muted-foreground"><ChevronUp className="size-4" /></Button>
          </section>
          <Button variant="ghost" aria-label={t({ ko: '상태창 접기', en: 'Fold status panel' })} onClick={() => onOpenChange(false)} className="h-auto flex-1 rounded-none bg-background/55 hover:bg-background/55" />
        </div>
      ) : null}
    </>
  )
}
