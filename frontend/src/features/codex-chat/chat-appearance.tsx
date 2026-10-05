import { useEffect, useId, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { ALargeSmall, RotateCcw } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { ChatStyle, ChatTypeface } from '@/lib/api-codex-chat'

export type ChatAvatarSize = 'sm' | 'md' | 'lg'
export type ChatFontSize = 'sm' | 'md' | 'lg' | 'xl'
export type ChatLineHeight = 'tight' | 'normal' | 'relaxed'

/**
 * What a reader may adjust, per browser, on top of the profile's look (typeface, colours, background): avatar and
 * text size, line spacing, and whether to show the background at all.
 */
export type ChatAppearance = {
  avatarSize: ChatAvatarSize
  fontSize: ChatFontSize
  lineHeight: ChatLineHeight
  showBackground: boolean
  /** Emoticons inside a sentence; larger ones open up their line, by choice. */
  emoticonSize: ChatEmoticonSize
  /** Emoticons on a line of their own. */
  stickerSize: ChatStickerSize
  /** Images and videos replies bring: small / medium thumbnails, or the chat's width at their own ratio. */
  imageSize: ChatImageSize
  /** Chat flags in the composer's tray: round icons (name on hover) or icon and name. */
  flagStyle: ChatFlagStyle
}

export type ChatFlagStyle = 'icon' | 'label'

export type ChatImageSize = 'sm' | 'md' | 'full'

export type ChatEmoticonSize = 'sm' | 'md' | 'lg' | 'xl'
export type ChatStickerSize = 'sm' | 'md' | 'lg'

const EMOTICON_SIZE_EM: Record<ChatEmoticonSize, number> = { sm: 1.3, md: 1.6, lg: 2.2, xl: 3 }
const STICKER_SIZE_PX: Record<ChatStickerSize, number> = { sm: 96, md: 128, lg: 192 }

const STORAGE_KEY = 'conai.chat.appearance'
const CHANGED_EVENT = 'conai:chat-appearance-changed'

export const DEFAULT_CHAT_APPEARANCE: ChatAppearance = { avatarSize: 'md', fontSize: 'md', lineHeight: 'normal', showBackground: true, emoticonSize: 'md', stickerSize: 'md', imageSize: 'full', flagStyle: 'icon' }

const FONT_SIZE_PX: Record<ChatFontSize, number> = { sm: 13, md: 14, lg: 16, xl: 18 }
const LINE_HEIGHT: Record<ChatLineHeight, number> = { tight: 1.5, normal: 1.7, relaxed: 1.9 }
export const CHAT_TYPEFACE_FAMILY: Record<ChatTypeface, string | undefined> = {
  sans: undefined,
  serif: 'ui-serif, Georgia, "Noto Serif KR", "Nanum Myeongjo", Batang, serif',
  mono: 'ui-monospace, "Cascadia Code", "D2Coding", Consolas, monospace',
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function normalize(value: unknown): ChatAppearance {
  const raw = (value && typeof value === 'object' ? value : {}) as Partial<Record<keyof ChatAppearance, unknown>>
  return {
    avatarSize: pick(raw.avatarSize, ['sm', 'md', 'lg'], DEFAULT_CHAT_APPEARANCE.avatarSize),
    fontSize: pick(raw.fontSize, ['sm', 'md', 'lg', 'xl'], DEFAULT_CHAT_APPEARANCE.fontSize),
    lineHeight: pick(raw.lineHeight, ['tight', 'normal', 'relaxed'], DEFAULT_CHAT_APPEARANCE.lineHeight),
    showBackground: raw.showBackground !== false,
    emoticonSize: pick(raw.emoticonSize, ['sm', 'md', 'lg', 'xl'], DEFAULT_CHAT_APPEARANCE.emoticonSize),
    stickerSize: pick(raw.stickerSize, ['sm', 'md', 'lg'], DEFAULT_CHAT_APPEARANCE.stickerSize),
    imageSize: pick(raw.imageSize, ['sm', 'md', 'full'], DEFAULT_CHAT_APPEARANCE.imageSize),
    flagStyle: pick(raw.flagStyle, ['icon', 'label'], DEFAULT_CHAT_APPEARANCE.flagStyle),
  }
}

function readAppearance(): ChatAppearance {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return normalize(raw ? JSON.parse(raw) : null)
  } catch {
    return DEFAULT_CHAT_APPEARANCE
  }
}

function writeAppearance(appearance: ChatAppearance) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance))
  } catch {
    // Storage blocked (private window): the choice lasts for this page only.
  }
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: appearance }))
}

/** The panel and the /chat page share one setting; a change in either (or another tab) applies to both. */
export function useChatAppearance() {
  const [appearance, setAppearance] = useState<ChatAppearance>(readAppearance)

  useEffect(() => {
    const handleChanged = (event: Event) => setAppearance(normalize((event as CustomEvent<ChatAppearance>).detail))
    const handleStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) {
        setAppearance(readAppearance())
      }
    }
    window.addEventListener(CHANGED_EVENT, handleChanged)
    window.addEventListener('storage', handleStorage)
    return () => {
      window.removeEventListener(CHANGED_EVENT, handleChanged)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  const update = (patch: Partial<ChatAppearance>) => writeAppearance(normalize({ ...appearance, ...patch }))
  return { appearance, update, reset: () => writeAppearance(DEFAULT_CHAT_APPEARANCE) }
}

/**
 * Inherited by every message: the reader's text size and spacing, the profile's typeface and roleplay colours (as
 * variables the Markdown renderer uses). Small labels (names, tool chips) keep their own size.
 */
export function chatTranscriptStyle(appearance: ChatAppearance, style: ChatStyle | null | undefined): CSSProperties {
  const colors = style?.roleplay ? style.colors : null
  return {
    fontSize: `${FONT_SIZE_PX[appearance.fontSize]}px`,
    lineHeight: LINE_HEIGHT[appearance.lineHeight],
    fontFamily: style ? CHAT_TYPEFACE_FAMILY[style.typeface] : undefined,
    '--chat-emoticon-size': `${EMOTICON_SIZE_EM[appearance.emoticonSize]}em`,
    '--chat-sticker-size': `${STICKER_SIZE_PX[appearance.stickerSize]}px`,
    ...(colors?.dialogue ? { '--chat-rp-dialogue': colors.dialogue } : {}),
    ...(colors?.narration ? { '--chat-rp-narration': colors.narration } : {}),
    ...(colors?.thought ? { '--chat-rp-thought': colors.thought } : {}),
  } as CSSProperties
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
    <div role="radiogroup" aria-label={label} onKeyDown={move} className="flex shrink-0 gap-0.5 rounded-md bg-foreground/6 p-0.5">
      {choices.map((choice) => {
        const checked = choice.value === value
        return (
          // eslint-disable-next-line no-restricted-syntax -- a radio pill; Button's sizes and fills do not fit this compact control
          <button
            key={choice.value}
            type="button"
            role="radio"
            aria-checked={checked}
            data-value={choice.value}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(choice.value)}
            className={cn(
              'h-6 cursor-pointer whitespace-nowrap rounded-sm px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40',
              checked ? 'bg-foreground font-semibold text-background' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {choice.label}
          </button>
        )
      })}
    </div>
  )
}

function AppearanceRow({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3">
      {htmlFor ? <label htmlFor={htmlFor} className="cursor-pointer text-sm">{label}</label> : <span className="text-sm">{label}</span>}
      {children}
    </div>
  )
}

function AppearanceGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-2.5 first-of-type:border-t-0 first-of-type:pt-1">
      <h3 className="text-2xs font-semibold text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

export const CHAT_APPEARANCE_ICON = ALargeSmall

/**
 * The reader's adjustments (avatar, text, spacing, emoticons, images, background), opened from the chat menu and
 * placed under `children` (the menu's button). It is not nested in the menu: moving the pointer across menu items
 * would take focus away and close it before it could be reached.
 */
export function ChatAppearancePopover({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const { t } = useI18n()
  const { appearance, update, reset } = useChatAppearance()
  const backgroundId = useId()
  const isDefault = JSON.stringify(appearance) === JSON.stringify(DEFAULT_CHAT_APPEARANCE)
  const small = t({ ko: '작게', en: 'S' })
  const medium = t({ ko: '보통', en: 'M' })
  const large = t({ ko: '크게', en: 'L' })

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent align="end" side="bottom" className="max-h-[calc(100vh-6rem)] w-80 space-y-1.5 overflow-y-auto px-3.5 pb-2 pt-3"
        // Focus returning to the menu button as the menu closes must not dismiss it; a click outside or Esc does.
        onFocusOutside={(event) => event.preventDefault()}
        onKeyDownCapture={(event) => {
          // A nested tooltip can consume Radix's document Escape handler before the popover sees it.
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onOpenChange(false)
          }
        }}>
        <div className="flex h-7 items-center justify-between">
          <span className="text-sm font-semibold">{t({ ko: '채팅 모양', en: 'Chat appearance' })}</span>
          <IconButton size="icon-xs" variant="ghost" disabled={isDefault} onClick={reset} label={t({ ko: '기본값으로', en: 'Reset' })}>
            <RotateCcw />
          </IconButton>
        </div>
        <AppearanceGroup title={t({ ko: '글', en: 'Text' })}>
          <AppearanceRow label={t({ ko: '글자 크기', en: 'Text size' })}>
            <CompactChoice label={t({ ko: '글자 크기', en: 'Text size' })} value={appearance.fontSize} onChange={(fontSize) => update({ fontSize })}
              choices={(['sm', 'md', 'lg', 'xl'] as const).map((size) => ({ value: size, label: <span className="tabular-nums">{FONT_SIZE_PX[size]}</span> }))} />
          </AppearanceRow>
          <AppearanceRow label={t({ ko: '줄 간격', en: 'Line spacing' })}>
            <CompactChoice label={t({ ko: '줄 간격', en: 'Line spacing' })} value={appearance.lineHeight} onChange={(lineHeight) => update({ lineHeight })}
              choices={[{ value: 'tight', label: t({ ko: '좁게', en: 'Tight' }) }, { value: 'normal', label: medium }, { value: 'relaxed', label: t({ ko: '넓게', en: 'Wide' }) }]} />
          </AppearanceRow>
        </AppearanceGroup>
        <AppearanceGroup title={t({ ko: '사진·이모티콘', en: 'Avatars · emoticons' })}>
          <AppearanceRow label={t({ ko: '프로필 사진', en: 'Avatar' })}>
            <CompactChoice label={t({ ko: '프로필 사진', en: 'Avatar' })} value={appearance.avatarSize} onChange={(avatarSize) => update({ avatarSize })}
              choices={[{ value: 'sm', label: small }, { value: 'md', label: medium }, { value: 'lg', label: large }]} />
          </AppearanceRow>
          <AppearanceRow label={t({ ko: '문장 속 이모티콘', en: 'Inline emoticons' })}>
            <CompactChoice label={t({ ko: '문장 속 이모티콘', en: 'Inline emoticons' })} value={appearance.emoticonSize} onChange={(emoticonSize) => update({ emoticonSize })}
              choices={[{ value: 'sm', label: 'S' }, { value: 'md', label: 'M' }, { value: 'lg', label: 'L' }, { value: 'xl', label: 'XL' }]} />
          </AppearanceRow>
          <AppearanceRow label={t({ ko: '스티커', en: 'Stickers' })}>
            <CompactChoice label={t({ ko: '스티커', en: 'Stickers' })} value={appearance.stickerSize} onChange={(stickerSize) => update({ stickerSize })}
              choices={[{ value: 'sm', label: small }, { value: 'md', label: medium }, { value: 'lg', label: large }]} />
          </AppearanceRow>
        </AppearanceGroup>
        <AppearanceGroup title={t({ ko: '이미지', en: 'Images' })}>
          <AppearanceRow label={t({ ko: '답변 이미지', en: 'Reply images' })}>
            <CompactChoice label={t({ ko: '답변 이미지', en: 'Reply images' })} value={appearance.imageSize} onChange={(imageSize) => update({ imageSize })}
              choices={[{ value: 'sm', label: small }, { value: 'md', label: medium }, { value: 'full', label: t({ ko: '채팅 너비', en: 'Full width' }) }]} />
          </AppearanceRow>
          <AppearanceRow label={t({ ko: '배경 이미지', en: 'Background image' })} htmlFor={backgroundId}>
            <Switch id={backgroundId} checked={appearance.showBackground} onCheckedChange={(showBackground) => update({ showBackground })} />
          </AppearanceRow>
        </AppearanceGroup>
        <AppearanceGroup title={t({ ko: '입력창', en: 'Composer' })}>
          <AppearanceRow label={t({ ko: '플래그 모양', en: 'Flags' })}>
            <CompactChoice label={t({ ko: '플래그 모양', en: 'Flags' })} value={appearance.flagStyle} onChange={(flagStyle) => update({ flagStyle })}
              choices={[{ value: 'icon', label: t({ ko: '아이콘', en: 'Icon' }) }, { value: 'label', label: t({ ko: '아이콘+이름', en: 'Icon + name' }) }]} />
          </AppearanceRow>
        </AppearanceGroup>
      </PopoverContent>
    </Popover>
  )
}

