import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ALargeSmall, Check, Layers, Pencil, Plus, RotateCcw, Star, Trash2 } from 'lucide-react'
import { TextTabs } from '@/components/common/text-tabs'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { RowGroup } from '@/components/ui/row-group'
import { Slider } from '@/components/ui/slider'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import {
  CHAT_APPEARANCE_LIMITS,
  CHAT_APPEARANCE_QUERY_KEY,
  getChatAppearance,
  saveChatAppearanceSlots,
  setChatThreadAppearance,
  type ChatAppearanceFile,
  type ChatAppearanceSlot,
  type ChatAppearanceValue,
  type ChatStyle,
  type ChatTypeface,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { cn } from '@/lib/utils'
import { ChatMarkdown } from './chat-markdown'
import { popChipAddClassName, popChipClassName } from './chat-pop-chip'

export type ChatAvatarSize = 'none' | 'sm' | 'md' | 'lg'
export type ChatSpacing = 'tight' | 'normal' | 'relaxed'
export type ChatLineHeight = ChatSpacing
export type ChatLetterSpacing = 'tight' | 'normal' | 'wide'
/** The profile's typeface, or one the reader picks over it. */
export type ChatFontFamily = 'profile' | ChatTypeface
export type ChatReplyShape = 'flat' | 'bubble'
/** The reader's own messages: a bubble on the right (messenger), on the left, or plain text like the replies. */
export type ChatUserPlacement = 'right' | 'left' | 'flat'
/** The transcript's width on the full page (the side panel is as wide as it is). */
export type ChatWidth = 'narrow' | 'normal' | 'wide' | 'full'
export type ChatTimeStamps = 'off' | 'hover' | 'always'
/** Several generated images of one reply: `grid` (stored name) is the masonry; `column` stacks them at full size. */
export type ChatImageLayout = 'grid' | 'column'
export type ChatBackgroundFit = 'cover' | 'contain' | 'tile'
export type ChatFlagStyle = 'icon' | 'label'
export type ChatImageSize = 'sm' | 'md' | 'full'
export type ChatEmoticonSize = 'sm' | 'md' | 'lg' | 'xl'
export type ChatStickerSize = 'sm' | 'md' | 'lg'

/**
 * What a reader may adjust, per chat, on top of the profile's look (typeface, colours, background). Kept on the
 * server, one file per account, with named slots to apply quickly; `slotId` remembers which slot this chat took
 * (null: the built-in defaults).
 */
export type ChatAppearance = {
  fontFamily: ChatFontFamily
  /** Pixels. */
  fontSize: number
  lineHeight: ChatLineHeight
  paragraphGap: ChatSpacing
  letterSpacing: ChatLetterSpacing
  replyShape: ChatReplyShape
  userPlacement: ChatUserPlacement
  width: ChatWidth
  messageGap: ChatSpacing
  showNames: boolean
  timeStamps: ChatTimeStamps
  showToolChips: boolean
  showReasoning: boolean
  showDiagnostics: boolean
  portrait: boolean
  avatarSize: ChatAvatarSize
  /** Emoticons inside a sentence; larger ones open up their line, by choice. */
  emoticonSize: ChatEmoticonSize
  /** Emoticons on a line of their own. */
  stickerSize: ChatStickerSize
  /** Images and videos replies bring: small / medium thumbnails, or the chat's width at their own ratio. */
  imageSize: ChatImageSize
  /** Several images in one reply: a masonry, or one under another. */
  imageLayout: ChatImageLayout
  showBackground: boolean
  /** Over the profile's dim / blur; null keeps the profile's value. */
  backgroundDim: number | null
  backgroundBlur: number | null
  backgroundFit: ChatBackgroundFit
  /** Chat flags in the composer's tray: round icons (name on hover) or icon and name. */
  flagStyle: ChatFlagStyle
  slotId: number | null
}

export const CHAT_FONT_SIZE_RANGE = { min: 12, max: 22 }
const EMOTICON_SIZE_EM: Record<ChatEmoticonSize, number> = { sm: 1.3, md: 1.6, lg: 2.2, xl: 3 }
const STICKER_SIZE_PX: Record<ChatStickerSize, number> = { sm: 96, md: 128, lg: 192 }
const LINE_HEIGHT: Record<ChatLineHeight, number> = { tight: 1.5, normal: 1.7, relaxed: 1.9 }
const PARAGRAPH_GAP: Record<ChatSpacing, string> = { tight: '0.25rem', normal: '0.5rem', relaxed: '0.9rem' }
const LETTER_SPACING: Record<ChatLetterSpacing, string | undefined> = { tight: '-0.02em', normal: undefined, wide: '0.04em' }
/** Space between messages, as the transcript column's gap. */
export const CHAT_MESSAGE_GAP_PX: Record<ChatSpacing, number> = { tight: 12, normal: 24, relaxed: 40 }
/** The transcript and composer column on the full page. */
export const CHAT_WIDTH_CLASS: Record<ChatWidth, string> = { narrow: 'max-w-xl', normal: 'max-w-3xl', wide: 'max-w-5xl', full: 'max-w-none' }
/** Text sizes from before the slider, so saved values keep their size. */
const LEGACY_FONT_SIZE_PX: Record<string, number> = { sm: 13, md: 14, lg: 16, xl: 18 }

/** Where the one-per-browser setting lived before slots; read once and moved into the account's first slot. */
const LEGACY_STORAGE_KEY = 'conai.chat.appearance'
const WRITE_DELAY_MS = 400
const POP_STAGGER_MS = 45

export const DEFAULT_CHAT_APPEARANCE: ChatAppearance = {
  fontFamily: 'profile', fontSize: 14, lineHeight: 'normal', paragraphGap: 'normal', letterSpacing: 'normal',
  replyShape: 'flat', userPlacement: 'right', width: 'normal', messageGap: 'normal', showNames: true, timeStamps: 'off', showToolChips: true, showReasoning: true, showDiagnostics: true,
  portrait: true, avatarSize: 'md', emoticonSize: 'md', stickerSize: 'md', imageSize: 'full', imageLayout: 'grid',
  showBackground: true, backgroundDim: null, backgroundBlur: null, backgroundFit: 'cover',
  flagStyle: 'icon', slotId: null,
}
const EMPTY_FILE: ChatAppearanceFile = { defaultSlotId: null, slots: [], threads: {} }

export const CHAT_TYPEFACE_FAMILY: Record<ChatTypeface, string | undefined> = {
  sans: undefined,
  serif: 'ui-serif, Georgia, "Noto Serif KR", "Nanum Myeongjo", Batang, serif',
  mono: 'ui-monospace, "Cascadia Code", "D2Coding", Consolas, monospace',
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function pickNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback
}

function pickNullableNumber(value: unknown, min: number, max: number): number | null {
  return value === null || value === undefined || value === '' ? null : pickNumber(value, min, max, min)
}

const SPACING = ['tight', 'normal', 'relaxed'] as const

export function normalizeChatAppearance(value: unknown): ChatAppearance {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof ChatAppearance, unknown>>
  const slotId = Number(raw.slotId)
  const D = DEFAULT_CHAT_APPEARANCE
  return {
    fontFamily: pick(raw.fontFamily, ['profile', 'sans', 'serif', 'mono'], D.fontFamily),
    fontSize: typeof raw.fontSize === 'string' && raw.fontSize in LEGACY_FONT_SIZE_PX ? LEGACY_FONT_SIZE_PX[raw.fontSize] : pickNumber(raw.fontSize, CHAT_FONT_SIZE_RANGE.min, CHAT_FONT_SIZE_RANGE.max, D.fontSize),
    lineHeight: pick(raw.lineHeight, SPACING, D.lineHeight),
    paragraphGap: pick(raw.paragraphGap, SPACING, D.paragraphGap),
    letterSpacing: pick(raw.letterSpacing, ['tight', 'normal', 'wide'], D.letterSpacing),
    replyShape: pick(raw.replyShape, ['flat', 'bubble'], D.replyShape),
    userPlacement: pick(raw.userPlacement, ['right', 'left', 'flat'], D.userPlacement),
    width: pick(raw.width, ['narrow', 'normal', 'wide', 'full'], D.width),
    messageGap: pick(raw.messageGap, SPACING, D.messageGap),
    showNames: raw.showNames !== false,
    timeStamps: pick(raw.timeStamps, ['off', 'hover', 'always'], D.timeStamps),
    showToolChips: raw.showToolChips !== false,
    showReasoning: raw.showReasoning !== false,
    showDiagnostics: raw.showDiagnostics !== false,
    portrait: raw.portrait !== false,
    avatarSize: pick(raw.avatarSize, ['none', 'sm', 'md', 'lg'], D.avatarSize),
    emoticonSize: pick(raw.emoticonSize, ['sm', 'md', 'lg', 'xl'], D.emoticonSize),
    stickerSize: pick(raw.stickerSize, ['sm', 'md', 'lg'], D.stickerSize),
    imageSize: pick(raw.imageSize, ['sm', 'md', 'full'], D.imageSize),
    imageLayout: pick(raw.imageLayout, ['grid', 'column'], D.imageLayout),
    showBackground: raw.showBackground !== false,
    backgroundDim: pickNullableNumber(raw.backgroundDim, 0, 90),
    backgroundBlur: pickNullableNumber(raw.backgroundBlur, 0, 20),
    backgroundFit: pick(raw.backgroundFit, ['cover', 'contain', 'tile'], D.backgroundFit),
    flagStyle: pick(raw.flagStyle, ['icon', 'label'], D.flagStyle),
    slotId: Number.isSafeInteger(slotId) && slotId > 0 ? slotId : null,
  }
}
const normalize = normalizeChatAppearance

/** The same look, whichever slot it came from. */
function sameLook(a: ChatAppearance, b: ChatAppearance) {
  return JSON.stringify({ ...a, slotId: null }) === JSON.stringify({ ...b, slotId: null })
}

/** A chat's values: its own; else the default slot's (chats from before slots existed); else the built-in defaults. */
function resolve(file: ChatAppearanceFile, threadId: number | null): ChatAppearance {
  const own = threadId === null ? undefined : file.threads[String(threadId)]
  if (own) return normalize(own)
  const slot = file.slots.find((entry) => entry.id === file.defaultSlotId)
  return slot ? normalize({ ...slot.appearance, slotId: slot.id }) : DEFAULT_CHAT_APPEARANCE
}

function readLegacy(): ChatAppearanceValue | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as ChatAppearanceValue) : null
  } catch {
    return null
  }
}

/** A chat's values reach the server a moment after the last change; each chat keeps its own timer. */
const pendingWrites = new Map<number, number>()
function scheduleThreadWrite(threadId: number, value: ChatAppearance, onError: (error: unknown) => void) {
  const pending = pendingWrites.get(threadId)
  if (pending !== undefined) window.clearTimeout(pending)
  pendingWrites.set(threadId, window.setTimeout(() => {
    pendingWrites.delete(threadId)
    setChatThreadAppearance(threadId, value).catch(onError)
  }, WRITE_DELAY_MS))
}

let legacyMoved = false

/** The account's appearance file; the panel and the /chat page read the same cache, so a change applies to both. */
export function useChatAppearance(threadId: number | null, enabled = true) {
  const queryClient = useQueryClient()
  const fileQuery = useQuery({ queryKey: CHAT_APPEARANCE_QUERY_KEY, queryFn: getChatAppearance, enabled, staleTime: 60_000 })
  const file = fileQuery.data ?? EMPTY_FILE
  const appearance = useMemo(() => resolve(file, threadId), [file, threadId])

  const setFile = (next: ChatAppearanceFile) => queryClient.setQueryData(CHAT_APPEARANCE_QUERY_KEY, next)
  const resync = () => void queryClient.invalidateQueries({ queryKey: CHAT_APPEARANCE_QUERY_KEY })

  const saveSlots = async (next: { defaultSlotId: number | null; slots: ChatAppearanceSlot[] }) => {
    const before = fileQuery.data
    setFile({ ...file, ...next })
    try {
      const saved = await saveChatAppearanceSlots(next)
      setFile({ ...(queryClient.getQueryData<ChatAppearanceFile>(CHAT_APPEARANCE_QUERY_KEY) ?? file), ...saved })
      return saved
    } catch (error) {
      if (before) setFile(before)
      throw error
    }
  }

  // An account without slots yet, whose browser kept the old one-per-browser setting: that becomes its first slot
  // and what new chats start from, so nothing looks different after the move.
  useEffect(() => {
    if (legacyMoved || !fileQuery.data) return
    legacyMoved = true
    const legacy = readLegacy()
    if (!legacy) return
    try { window.localStorage.removeItem(LEGACY_STORAGE_KEY) } catch { /* storage blocked */ }
    if (fileQuery.data.slots.length > 0 || Object.keys(fileQuery.data.threads).length > 0) return
    const slot: ChatAppearanceSlot = { id: 1, name: '저장1', appearance: { ...normalize(legacy), slotId: 1 } }
    void saveSlots({ defaultSlotId: 1, slots: [slot] }).catch(resync)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, when the file first arrives
  }, [fileQuery.data])

  const setThread = (next: ChatAppearance) => {
    if (threadId === null) return
    const current = queryClient.getQueryData<ChatAppearanceFile>(CHAT_APPEARANCE_QUERY_KEY) ?? file
    setFile({ ...current, threads: { ...current.threads, [String(threadId)]: next } })
    scheduleThreadWrite(threadId, next, resync)
  }
  const update = (patch: Partial<ChatAppearance>) => setThread(normalize({ ...appearance, ...patch }))

  return { appearance, file, update, setThread, saveSlots }
}

/**
 * Inherited by every message: the reader's text size, spacing and typeface (the profile's unless overridden), and
 * the profile's roleplay colours (as variables the Markdown renderer uses). Small labels (names, tool chips) keep
 * their own size.
 */
export function chatTranscriptStyle(appearance: ChatAppearance, style: ChatStyle | null | undefined): CSSProperties {
  const colors = style?.roleplay ? style.colors : null
  const typeface: ChatTypeface | null = appearance.fontFamily === 'profile' ? style?.typeface ?? null : appearance.fontFamily
  return {
    fontSize: `${appearance.fontSize}px`,
    lineHeight: LINE_HEIGHT[appearance.lineHeight],
    letterSpacing: LETTER_SPACING[appearance.letterSpacing],
    fontFamily: typeface ? CHAT_TYPEFACE_FAMILY[typeface] : undefined,
    '--chat-paragraph-gap': PARAGRAPH_GAP[appearance.paragraphGap],
    '--chat-emoticon-size': `${EMOTICON_SIZE_EM[appearance.emoticonSize]}em`,
    '--chat-sticker-size': `${STICKER_SIZE_PX[appearance.stickerSize]}px`,
    ...(colors?.dialogue ? { '--chat-rp-dialogue': colors.dialogue } : {}),
    ...(colors?.narration ? { '--chat-rp-narration': colors.narration } : {}),
    ...(colors?.thought ? { '--chat-rp-thought': colors.thought } : {}),
  } as CSSProperties
}

/** The background as this reader sees it: the profile's dim and blur unless overridden, and how the picture fills. */
export function chatBackgroundLook(appearance: ChatAppearance, style: ChatStyle) {
  return { dim: appearance.backgroundDim ?? style.backgroundDim, blur: appearance.backgroundBlur ?? style.backgroundBlur, fit: appearance.backgroundFit }
}

type Choice<T extends string> = { value: T; label: ReactNode }

/**
 * A small set of choices at the end of a row (radio group): the picked one is a light pill. Arrow keys move between
 * them, as in a native radio group.
 */
function CompactChoice<T extends string>({ label, value, choices, onChange }: { label: string; value: T; choices: Choice<T>[]; onChange: (value: T) => void }) {
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const index = choices.findIndex((choice) => choice.value === value)
    const next = choices[(index + step + choices.length) % choices.length]
    onChange(next.value)
    const group = event.currentTarget
    window.requestAnimationFrame(() => group.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus())
  }
  return (
    // The same tray and raised key as SegmentedControl, with radio semantics.
    <div role="radiogroup" aria-label={label} onKeyDown={move} className="flex shrink-0 gap-0.5 rounded-md bg-fill p-0.75">
      {choices.map((choice) => {
        const checked = choice.value === value
        return (
          // eslint-disable-next-line no-restricted-syntax -- a radio key; Button's segment variant keys its look on aria-pressed, which a radio cannot carry
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-value={choice.value}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(choice.value)}
            className={cn(
              'h-6 cursor-pointer whitespace-nowrap rounded-sm px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/40',
              checked ? 'bg-background text-foreground shadow-key' : 'text-muted-foreground hover:bg-fill hover:text-foreground',
            )}
          >
            {choice.label}
          </button>
        )
      })}
    </div>
  )
}

function AppearanceRow({ label, htmlFor, children }: { label: ReactNode; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3">
      {htmlFor ? <label htmlFor={htmlFor} className="min-w-0 flex-1 cursor-pointer text-sm">{label}</label> : <span className="min-w-0 text-sm">{label}</span>}
      {children}
    </div>
  )
}

/** A label with its value, the slider underneath; `onReset` (when given) returns to the inherited value. */
function SliderRow({ label, value, unit, min, max, step, inherited, onChange, onReset }: {
  label: string; value: number; unit: string; min: number; max: number; step: number
  /** True while the value is the profile's own (no override). */
  inherited?: boolean
  onChange: (value: number) => void
  onReset?: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="flex flex-col gap-2 pb-3 pt-2">
      <div className="flex h-6 items-center justify-between gap-3">
        <span className="text-sm">{label}</span>
        <span className="flex items-center gap-1">
          {onReset && !inherited ? <IconButton size="icon-xs" variant="ghost" label={t({ ko: '프로필 값으로', en: 'Profile value' })} onClick={onReset}><RotateCcw /></IconButton> : null}
          <span className={cn('min-w-10 text-right font-mono text-xs tabular-nums', inherited ? 'text-muted-foreground' : 'text-foreground')}>{value}{unit}</span>
        </span>
      </div>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([next]) => onChange(next)} aria-label={label} />
    </div>
  )
}

const SLOT_CHIP_CLASS = 'h-9 gap-1.5 px-3.5 text-sm font-semibold animate-chat-flag-pop motion-reduce:animate-chat-flag-fade'

/**
 * Over the settings, blurred beneath: the slots as chips that spring in one after another. A chip applies that slot
 * to this chat; the row under them acts on the slot this chat took (new-chat default, rename, delete).
 */
function SlotOverlay({ file, appearance, onApply, onNew, onSaveSlots, onClose }: {
  file: ChatAppearanceFile
  appearance: ChatAppearance
  onApply: (slot: ChatAppearanceSlot | null) => void
  onNew: () => void
  onSaveSlots: (next: { defaultSlotId: number | null; slots: ChatAppearanceSlot[] }) => Promise<unknown>
  onClose: () => void
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const [renaming, setRenaming] = useState<string | null>(null)
  const active = file.slots.find((slot) => slot.id === appearance.slotId) ?? null
  const delay = (index: number): CSSProperties => ({ animationDelay: `${index * POP_STAGGER_MS}ms` })

  const commitRename = () => {
    const name = renaming?.trim() ?? ''
    setRenaming(null)
    if (!active || !name || name === active.name || name.length > CHAT_APPEARANCE_LIMITS.name) return
    void onSaveSlots({ defaultSlotId: file.defaultSlotId, slots: file.slots.map((slot) => (slot.id === active.id ? { ...slot, name } : slot)) })
  }

  return (
    <div
      role="group"
      aria-label={t({ ko: '슬롯', en: 'Slots' })}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
      className="absolute inset-x-0 bottom-0 top-12 z-10 flex flex-col items-center gap-4 rounded-b-md bg-surface-high/75 px-4 pt-7 backdrop-blur-sm animate-in fade-in-0 motion-reduce:animate-none"
    >
      <div className="flex flex-wrap justify-center gap-2" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
        {/* eslint-disable-next-line no-restricted-syntax -- chips that spring in, as the composer's flags do */}
        <button type="button" style={delay(0)} onClick={() => onApply(null)} className={popChipClassName(appearance.slotId === null, cn(SLOT_CHIP_CLASS, 'pl-3'))}>
          <RotateCcw className="size-3.5" />{t({ ko: '기본값', en: 'Defaults' })}
        </button>
        {file.slots.map((slot, index) => (
          // eslint-disable-next-line no-restricted-syntax -- see above
          <button key={slot.id} type="button" style={delay(index + 1)} onClick={() => onApply(slot)} className={popChipClassName(slot.id === appearance.slotId, SLOT_CHIP_CLASS)}>
            {slot.name}
            {slot.id === file.defaultSlotId ? <Star aria-label={t({ ko: '새 채팅 기본', en: 'New-chat default' })} className="size-3 fill-primary text-primary" /> : null}
          </button>
        ))}
        {file.slots.length < CHAT_APPEARANCE_LIMITS.slots ? (
          // eslint-disable-next-line no-restricted-syntax -- see above
          <button type="button" style={delay(file.slots.length + 1)} onClick={onNew} aria-label={t({ ko: '지금 모양을 새 슬롯으로', en: 'Save as a new slot' })} className={popChipAddClassName('size-9 animate-chat-flag-pop motion-reduce:animate-chat-flag-fade')}>
            <Plus className="size-4" />
          </button>
        ) : null}
      </div>
      {active ? (
        <div className="flex h-8 items-center gap-0.5 animate-in fade-in-0 motion-reduce:animate-none" style={delay(file.slots.length + 2)}>
          {renaming === null ? (
            <>
              <IconButton size="icon-sm" variant="ghost" active={active.id === file.defaultSlotId} label={t({ ko: '새 채팅 기본', en: 'New-chat default' })} onClick={() => void onSaveSlots({ defaultSlotId: active.id === file.defaultSlotId ? null : active.id, slots: file.slots })}>
                <Star className={cn('size-4', active.id === file.defaultSlotId && 'fill-primary text-primary')} />
              </IconButton>
              <IconButton size="icon-sm" variant="ghost" label={t({ ko: '이름 바꾸기', en: 'Rename' })} onClick={() => setRenaming(active.name)}><Pencil className="size-4" /></IconButton>
              <IconButton size="icon-sm" variant="ghost" label={t({ ko: '슬롯 지우기', en: 'Delete slot' })} onClick={() => void (async () => {
                if (!await confirm({ title: t({ ko: '슬롯 지우기', en: 'Delete slot' }), description: t({ ko: '"{name}" 슬롯을 지울까?', en: 'Delete the "{name}" slot?' }, { name: active.name }), confirmLabel: t({ ko: '지우기', en: 'Delete' }), tone: 'destructive' })) return
                await onSaveSlots({ defaultSlotId: file.defaultSlotId === active.id ? null : file.defaultSlotId, slots: file.slots.filter((slot) => slot.id !== active.id) })
              })()}>
                <Trash2 className="size-4" />
              </IconButton>
            </>
          ) : (
            <>
              <Input
                autoFocus
                value={renaming}
                maxLength={CHAT_APPEARANCE_LIMITS.name}
                aria-label={t({ ko: '슬롯 이름', en: 'Slot name' })}
                onChange={(event) => setRenaming(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); commitRename() }
                  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRenaming(null) }
                }}
                className="h-8 w-36"
              />
              <IconButton size="icon-sm" variant="ghost" label={t({ ko: '확인', en: 'Done' })} onClick={commitRename}><Check className="size-4" /></IconButton>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

export const CHAT_APPEARANCE_ICON = ALargeSmall

type AppearanceTab = 'text' | 'layout' | 'pictures' | 'background' | 'composer'
const TABS: AppearanceTab[] = ['text', 'layout', 'pictures', 'background', 'composer']

/**
 * The reader's adjustments for this chat, opened from the chat's info panel and placed beside `children` (its key):
 * under it, or (`side="left"`) to its left over the transcript, so a panel at the screen's edge stays readable.
 * `style` is the profile's look (the sample line and the background rows start from it); `layout` hides the width row
 * in the side panel, which is as wide as it is.
 */
export function ChatAppearancePopover({ threadId, style, layout = 'page', side = 'bottom', open, onOpenChange, children }: {
  threadId: number | null
  style?: ChatStyle | null
  layout?: 'page' | 'panel'
  side?: 'bottom' | 'left'
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const { appearance, file, update, setThread, saveSlots } = useChatAppearance(threadId)
  const backgroundId = useId()
  const namesId = useId()
  const toolsId = useId()
  const reasoningId = useId()
  const diagnosticsId = useId()
  const [slotsOpen, setSlotsOpen] = useState(false)
  const [tab, setTab] = useState<AppearanceTab>('text')
  const escapeHandledRef = useRef(false)
  const small = t({ ko: '작게', en: 'S' })
  const medium = t({ ko: '보통', en: 'M' })
  const large = t({ ko: '크게', en: 'L' })
  const tight = t({ ko: '좁게', en: 'Tight' })
  const normal = t({ ko: '보통', en: 'Normal' })
  const wide = t({ ko: '넓게', en: 'Wide' })
  const spacing: Choice<ChatSpacing>[] = [{ value: 'tight', label: tight }, { value: 'normal', label: normal }, { value: 'relaxed', label: wide }]
  // Short enough that all five sit on one line at the popover's width in either language.
  const tabLabel: Record<AppearanceTab, string> = {
    text: t({ ko: '글', en: 'Text' }), layout: t({ ko: '배치', en: 'Layout' }), pictures: t({ ko: '그림', en: 'Images' }), background: t({ ko: '배경', en: 'Backdrop' }), composer: t({ ko: '입력창', en: 'Input' }),
  }

  const activeSlot = file.slots.find((slot) => slot.id === appearance.slotId) ?? null
  const dirty = !sameLook(appearance, activeSlot ? normalize(activeSlot.appearance) : DEFAULT_CHAT_APPEARANCE)
  const background = style ? chatBackgroundLook(appearance, style) : null

  useEffect(() => { if (!open) setSlotsOpen(false) }, [open])

  const persistSlots = async (next: { defaultSlotId: number | null; slots: ChatAppearanceSlot[] }) => {
    try {
      return await saveSlots(next)
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, t({ ko: '슬롯을 저장하지 못했어.', en: 'Could not save the slot.' })), tone: 'error' })
      return null
    }
  }

  /** The look as it is now becomes a new slot, which this chat then counts as its own. */
  const saveAsNew = async () => {
    if (file.slots.length >= CHAT_APPEARANCE_LIMITS.slots) {
      showSnackbar({ message: t({ ko: `슬롯은 ${CHAT_APPEARANCE_LIMITS.slots}개까지야.`, en: `Up to ${CHAT_APPEARANCE_LIMITS.slots} slots.` }), tone: 'error' })
      return
    }
    const id = file.slots.reduce((max, slot) => Math.max(max, slot.id), 0) + 1
    const taken = new Set(file.slots.map((slot) => slot.name))
    let index = file.slots.length + 1
    while (taken.has(t({ ko: `저장${index}`, en: `Slot ${index}` }))) index += 1
    const next: ChatAppearance = { ...appearance, slotId: id }
    const saved = await persistSlots({ defaultSlotId: file.defaultSlotId, slots: [...file.slots, { id, name: t({ ko: `저장${index}`, en: `Slot ${index}` }), appearance: next }] })
    if (saved) setThread(next)
    setSlotsOpen(false)
  }

  const save = () => {
    if (!activeSlot) { void saveAsNew(); return }
    void persistSlots({ defaultSlotId: file.defaultSlotId, slots: file.slots.map((slot) => (slot.id === activeSlot.id ? { ...slot, appearance: { ...appearance, slotId: slot.id } } : slot)) })
  }

  const apply = (slot: ChatAppearanceSlot | null) => {
    setThread(slot ? normalize({ ...slot.appearance, slotId: slot.id }) : DEFAULT_CHAT_APPEARANCE)
    setSlotsOpen(false)
  }

  const sample = t({
    ko: '*창밖을 보다가 고개를 돌린다.* "어, 왔어?" \'조금 늦었네…\'',
    en: '*She looks up from the window.* "Oh, you made it." \'A bit late…\'',
  })

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent align={side === 'left' ? 'center' : 'end'} side={side} padding="none" className="relative flex max-h-[calc(100vh-6rem)] w-88 max-w-[calc(100vw-2rem)] flex-col overflow-hidden"
        // Focus moving back to its key (or out of a closing sheet) must not dismiss it; a click outside or Esc does.
        onFocusOutside={(event) => event.preventDefault()}
        // With the slot overlay open, Esc closes the overlay only (Radix would otherwise dismiss the popover too).
        onEscapeKeyDown={(event) => {
          escapeHandledRef.current = true
          if (slotsOpen) { event.preventDefault(); setSlotsOpen(false) }
        }}
        onKeyDownCapture={(event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          event.stopPropagation()
          // Radix's document handler ran first (and React re-rendered in between): nothing more to do here.
          if (escapeHandledRef.current) { escapeHandledRef.current = false; return }
          // A nested tooltip can consume Radix's document Escape handler before the popover sees it.
          if (slotsOpen) setSlotsOpen(false)
          else onOpenChange(false)
        }}>
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 pl-4 pr-3">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-sm font-semibold">{t({ ko: '채팅 모양', en: 'Chat appearance' })}</span>
            <span className="truncate text-xs text-muted-foreground">
              {activeSlot?.name ?? t({ ko: '기본값', en: 'Defaults' })}
              {dirty ? <span className="text-secondary-text">{t({ ko: ' · 수정됨', en: ' · edited' })}</span> : null}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1">
            <Button variant={dirty ? 'secondary' : 'ghost'} size="xs" disabled={!dirty || threadId === null} onClick={save}>
              {activeSlot || !dirty ? t({ ko: '저장', en: 'Save' }) : t({ ko: '새 슬롯', en: 'New slot' })}
            </Button>
            <IconButton size="icon-sm" variant="ghost" active={slotsOpen} aria-expanded={slotsOpen} disabled={threadId === null} onClick={() => setSlotsOpen((current) => !current)} label={t({ ko: '슬롯', en: 'Slots' })}>
              <Layers className={cn('transition-transform duration-300 ease-out motion-reduce:transition-none', slotsOpen && '-rotate-45 scale-110')} />
            </IconButton>
          </span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col" inert={slotsOpen || undefined}>
          {/* The sample line shows the text settings as the chat will, in the profile's colours. */}
          <div className="mx-4 shrink-0 overflow-hidden rounded-md bg-fill px-3 py-2.5" style={chatTranscriptStyle(appearance, style)} aria-hidden="true">
            <ChatMarkdown text={sample} roleplay={style?.roleplay} />
          </div>
          <TextTabs
            value={tab}
            items={TABS.map((key) => ({ value: key, label: tabLabel[key] }))}
            onChange={setTab}
            ariaLabel={t({ ko: '채팅 모양 항목', en: 'Appearance sections' })}
            className="shrink-0"
            stripClassName="mt-3 px-4"
          />
          <div role="tabpanel" className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-3 pt-3">
            {tab === 'text' ? (
              <>
                <RowGroup heading={t({ ko: '글자', en: 'Type' })}>
                  <AppearanceRow label={t({ ko: '글꼴', en: 'Typeface' })}>
                    <CompactChoice label={t({ ko: '글꼴', en: 'Typeface' })} value={appearance.fontFamily} onChange={(fontFamily) => update({ fontFamily })}
                      choices={[
                        { value: 'profile', label: t({ ko: '프로필', en: 'Profile' }) },
                        { value: 'sans', label: t({ ko: '고딕', en: 'Sans' }) },
                        { value: 'serif', label: <span style={{ fontFamily: CHAT_TYPEFACE_FAMILY.serif }}>{t({ ko: '명조', en: 'Serif' })}</span> },
                        { value: 'mono', label: <span style={{ fontFamily: CHAT_TYPEFACE_FAMILY.mono }}>{t({ ko: '고정폭', en: 'Mono' })}</span> },
                      ]} />
                  </AppearanceRow>
                  <SliderRow label={t({ ko: '글자 크기', en: 'Text size' })} value={appearance.fontSize} unit="px" min={CHAT_FONT_SIZE_RANGE.min} max={CHAT_FONT_SIZE_RANGE.max} step={1} onChange={(fontSize) => update({ fontSize })} />
                </RowGroup>
                <RowGroup heading={t({ ko: '간격', en: 'Spacing' })}>
                  <AppearanceRow label={t({ ko: '줄 간격', en: 'Line spacing' })}>
                    <CompactChoice label={t({ ko: '줄 간격', en: 'Line spacing' })} value={appearance.lineHeight} onChange={(lineHeight) => update({ lineHeight })} choices={spacing} />
                  </AppearanceRow>
                  <AppearanceRow label={t({ ko: '문단 간격', en: 'Paragraph spacing' })}>
                    <CompactChoice label={t({ ko: '문단 간격', en: 'Paragraph spacing' })} value={appearance.paragraphGap} onChange={(paragraphGap) => update({ paragraphGap })} choices={spacing} />
                  </AppearanceRow>
                  <AppearanceRow label={t({ ko: '자간', en: 'Letter spacing' })}>
                    <CompactChoice label={t({ ko: '자간', en: 'Letter spacing' })} value={appearance.letterSpacing} onChange={(letterSpacing) => update({ letterSpacing })}
                      choices={[{ value: 'tight', label: tight }, { value: 'normal', label: normal }, { value: 'wide', label: wide }]} />
                  </AppearanceRow>
                </RowGroup>
              </>
            ) : null}
            {tab === 'layout' ? (
              <>
                <RowGroup heading={t({ ko: '메시지', en: 'Messages' })}>
                  <AppearanceRow label={t({ ko: '답변 모양', en: 'Replies' })}>
                    <CompactChoice label={t({ ko: '답변 모양', en: 'Replies' })} value={appearance.replyShape} onChange={(replyShape) => update({ replyShape })}
                      choices={[{ value: 'flat', label: t({ ko: '평문', en: 'Plain' }) }, { value: 'bubble', label: t({ ko: '말풍선', en: 'Bubble' }) }]} />
                  </AppearanceRow>
                  <AppearanceRow label={t({ ko: '내 메시지', en: 'My messages' })}>
                    <CompactChoice label={t({ ko: '내 메시지', en: 'My messages' })} value={appearance.userPlacement} onChange={(userPlacement) => update({ userPlacement })}
                      choices={[{ value: 'right', label: t({ ko: '오른쪽', en: 'Right' }) }, { value: 'left', label: t({ ko: '왼쪽', en: 'Left' }) }, { value: 'flat', label: t({ ko: '평문', en: 'Plain' }) }]} />
                  </AppearanceRow>
                  {layout === 'page' ? (
                    <AppearanceRow label={t({ ko: '본문 폭', en: 'Width' })}>
                      <CompactChoice label={t({ ko: '본문 폭', en: 'Width' })} value={appearance.width} onChange={(width) => update({ width })}
                        choices={[{ value: 'narrow', label: t({ ko: '좁게', en: 'Narrow' }) }, { value: 'normal', label: normal }, { value: 'wide', label: wide }, { value: 'full', label: t({ ko: '꽉', en: 'Full' }) }]} />
                    </AppearanceRow>
                  ) : null}
                  <AppearanceRow label={t({ ko: '메시지 간격', en: 'Message spacing' })}>
                    <CompactChoice label={t({ ko: '메시지 간격', en: 'Message spacing' })} value={appearance.messageGap} onChange={(messageGap) => update({ messageGap })}
                      choices={[{ value: 'tight', label: t({ ko: '촘촘히', en: 'Tight' }) }, { value: 'normal', label: normal }, { value: 'relaxed', label: t({ ko: '넉넉히', en: 'Loose' }) }]} />
                  </AppearanceRow>
                </RowGroup>
                <RowGroup heading={t({ ko: '이름·시각', en: 'Names · time' })}>
                  <AppearanceRow label={t({ ko: '이름 표시', en: 'Names' })} htmlFor={namesId}>
                    <Switch id={namesId} checked={appearance.showNames} onCheckedChange={(showNames) => update({ showNames })} />
                  </AppearanceRow>
                  <AppearanceRow label={t({ ko: '보낸 시각', en: 'Time sent' })}>
                    <CompactChoice label={t({ ko: '보낸 시각', en: 'Time sent' })} value={appearance.timeStamps} onChange={(timeStamps) => update({ timeStamps })}
                      choices={[{ value: 'off', label: t({ ko: '끔', en: 'Off' }) }, { value: 'hover', label: t({ ko: '올리면', en: 'Hover' }) }, { value: 'always', label: t({ ko: '항상', en: 'Always' }) }]} />
                  </AppearanceRow>
                </RowGroup>
                <RowGroup heading={t({ ko: '답변 세부', en: 'Reply details' })}>
                  <AppearanceRow label={t({ ko: '도구 호출 칩', en: 'Tool chips' })} htmlFor={toolsId}>
                    <Switch id={toolsId} checked={appearance.showToolChips} onCheckedChange={(showToolChips) => update({ showToolChips })} />
                  </AppearanceRow>
                  <AppearanceRow label={t({ ko: '추론 블록', en: 'Reasoning' })} htmlFor={reasoningId}>
                    <Switch id={reasoningId} checked={appearance.showReasoning} onCheckedChange={(showReasoning) => update({ showReasoning })} />
                  </AppearanceRow>
                  <AppearanceRow label={t({ ko: '진단 아이콘', en: 'Diagnostics icon' })} htmlFor={diagnosticsId}>
                    <Switch id={diagnosticsId} checked={appearance.showDiagnostics} onCheckedChange={(showDiagnostics) => update({ showDiagnostics })} />
                  </AppearanceRow>
                </RowGroup>
              </>
            ) : null}
            {tab === 'pictures' ? (
              <>
                <RowGroup heading={t({ ko: '사진·이모티콘', en: 'Avatars · emoticons' })}>
                  <AppearanceRow label={t({ ko: '프로필 사진', en: 'Avatar' })}>
                    <CompactChoice label={t({ ko: '프로필 사진', en: 'Avatar' })} value={appearance.avatarSize} onChange={(avatarSize) => update({ avatarSize })}
                      choices={[{ value: 'none', label: t({ ko: '숨김', en: 'Off' }) }, { value: 'sm', label: small }, { value: 'md', label: medium }, { value: 'lg', label: large }]} />
                  </AppearanceRow>
                  <AppearanceRow label={t({ ko: '문장 속 이모티콘', en: 'Inline emoticons' })}>
                    <CompactChoice label={t({ ko: '문장 속 이모티콘', en: 'Inline emoticons' })} value={appearance.emoticonSize} onChange={(emoticonSize) => update({ emoticonSize })}
                      choices={[{ value: 'sm', label: 'S' }, { value: 'md', label: 'M' }, { value: 'lg', label: 'L' }, { value: 'xl', label: 'XL' }]} />
                  </AppearanceRow>
                  <AppearanceRow label={t({ ko: '스티커', en: 'Stickers' })}>
                    <CompactChoice label={t({ ko: '스티커', en: 'Stickers' })} value={appearance.stickerSize} onChange={(stickerSize) => update({ stickerSize })}
                      choices={[{ value: 'sm', label: small }, { value: 'md', label: medium }, { value: 'lg', label: large }]} />
                  </AppearanceRow>
                </RowGroup>
                <RowGroup heading={t({ ko: '생성 이미지', en: 'Generated images' })}>
                  <AppearanceRow label={t({ ko: '크기', en: 'Size' })}>
                    <CompactChoice label={t({ ko: '생성 이미지 크기', en: 'Generated image size' })} value={appearance.imageSize} onChange={(imageSize) => update({ imageSize })}
                      choices={[{ value: 'sm', label: small }, { value: 'md', label: medium }, { value: 'full', label: t({ ko: '채팅 너비', en: 'Full width' }) }]} />
                  </AppearanceRow>
                  <AppearanceRow label={t({ ko: '여러 장', en: 'Several images' })}>
                    <CompactChoice label={t({ ko: '여러 장', en: 'Several images' })} value={appearance.imageLayout} onChange={(imageLayout) => update({ imageLayout })}
                      choices={[{ value: 'grid', label: t({ ko: '그리드', en: 'Grid' }) }, { value: 'column', label: t({ ko: '세로', en: 'Stacked' }) }]} />
                  </AppearanceRow>
                </RowGroup>
              </>
            ) : null}
            {tab === 'background' ? (
              <>
                <RowGroup heading={t({ ko: '배경 이미지', en: 'Background image' })}>
                  <AppearanceRow label={t({ ko: '배경 표시', en: 'Show background' })} htmlFor={backgroundId}>
                    <Switch id={backgroundId} checked={appearance.showBackground} onCheckedChange={(showBackground) => update({ showBackground })} />
                  </AppearanceRow>
                  {appearance.showBackground ? (
                    <AppearanceRow label={t({ ko: '채우기', en: 'Fill' })}>
                      <CompactChoice label={t({ ko: '채우기', en: 'Fill' })} value={appearance.backgroundFit} onChange={(backgroundFit) => update({ backgroundFit })}
                        choices={[{ value: 'cover', label: t({ ko: '채움', en: 'Cover' }) }, { value: 'contain', label: t({ ko: '맞춤', en: 'Fit' }) }, { value: 'tile', label: t({ ko: '타일', en: 'Tile' }) }]} />
                    </AppearanceRow>
                  ) : null}
                </RowGroup>
                {appearance.showBackground ? (
                  <RowGroup heading={t({ ko: '효과', en: 'Effects' })}>
                    <SliderRow label={t({ ko: '어둡게', en: 'Dim' })} value={background?.dim ?? appearance.backgroundDim ?? 0} unit="%" min={0} max={90} step={5}
                      inherited={appearance.backgroundDim === null} onChange={(backgroundDim) => update({ backgroundDim })} onReset={() => update({ backgroundDim: null })} />
                    <SliderRow label={t({ ko: '흐리게', en: 'Blur' })} value={background?.blur ?? appearance.backgroundBlur ?? 0} unit="px" min={0} max={20} step={1}
                      inherited={appearance.backgroundBlur === null} onChange={(backgroundBlur) => update({ backgroundBlur })} onReset={() => update({ backgroundBlur: null })} />
                  </RowGroup>
                ) : null}
              </>
            ) : null}
            {tab === 'composer' ? (
              <RowGroup heading={t({ ko: '플래그', en: 'Flags' })}>
                <AppearanceRow label={t({ ko: '플래그 모양', en: 'Flag style' })}>
                  <CompactChoice label={t({ ko: '플래그 모양', en: 'Flag style' })} value={appearance.flagStyle} onChange={(flagStyle) => update({ flagStyle })}
                    choices={[{ value: 'icon', label: t({ ko: '아이콘', en: 'Icon' }) }, { value: 'label', label: t({ ko: '아이콘+이름', en: 'Icon + name' }) }]} />
                </AppearanceRow>
                <p className="pb-1 text-xs text-muted-foreground">
                  {t({ ko: '입력창 위로 펼쳐지는 플래그를 아이콘만, 또는 이름과 함께 보여 줘.', en: 'Flags above the composer show as icons only, or with their names.' })}
                </p>
              </RowGroup>
            ) : null}
          </div>
        </div>
        {slotsOpen ? <SlotOverlay file={file} appearance={appearance} onApply={apply} onNew={() => void saveAsNew()} onSaveSlots={persistSlots} onClose={() => setSlotsOpen(false)} /> : null}
      </PopoverContent>
    </Popover>
  )
}
