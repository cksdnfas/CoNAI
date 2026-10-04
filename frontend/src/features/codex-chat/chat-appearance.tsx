import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { ALargeSmall, RotateCcw } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tip } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { useI18n } from '@/i18n'
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
}

const STORAGE_KEY = 'conai.chat.appearance'
const CHANGED_EVENT = 'conai:chat-appearance-changed'

export const DEFAULT_CHAT_APPEARANCE: ChatAppearance = { avatarSize: 'md', fontSize: 'md', lineHeight: 'normal', showBackground: true }

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
    ...(colors?.dialogue ? { '--chat-rp-dialogue': colors.dialogue } : {}),
    ...(colors?.narration ? { '--chat-rp-narration': colors.narration } : {}),
    ...(colors?.thought ? { '--chat-rp-thought': colors.thought } : {}),
  } as CSSProperties
}

function AppearanceRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

/** Header key with the reader's adjustments: avatar size, text size, line spacing, background on/off. */
export function ChatAppearanceButton() {
  const { t } = useI18n()
  const { appearance, update, reset } = useChatAppearance()
  const isDefault = JSON.stringify(appearance) === JSON.stringify(DEFAULT_CHAT_APPEARANCE)

  return (
    <Popover>
      <Tip content={t({ ko: '채팅 모양', en: 'Chat appearance' })}>
        <PopoverTrigger asChild>
          <IconButton variant="ghost" size="icon-sm" label={t({ ko: '채팅 모양', en: 'Chat appearance' })} tooltip={false}>
            <ALargeSmall />
          </IconButton>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-72 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">{t({ ko: '채팅 모양', en: 'Chat appearance' })}</span>
          <IconButton size="icon-xs" variant="ghost" disabled={isDefault} onClick={reset} label={t({ ko: '기본값으로', en: 'Reset' })}>
            <RotateCcw />
          </IconButton>
        </div>
        <AppearanceRow label={t({ ko: '프로필 사진', en: 'Avatar' })}>
          <SegmentedControl
            size="xs"
            fullWidth
            value={appearance.avatarSize}
            onChange={(value) => update({ avatarSize: value as ChatAvatarSize })}
            items={[
              { value: 'sm', label: t({ ko: '작게', en: 'Small' }) },
              { value: 'md', label: t({ ko: '보통', en: 'Medium' }) },
              { value: 'lg', label: t({ ko: '크게', en: 'Large' }) },
            ]}
          />
        </AppearanceRow>
        <AppearanceRow label={t({ ko: '글자 크기', en: 'Text size' })}>
          <SegmentedControl
            size="xs"
            fullWidth
            value={appearance.fontSize}
            onChange={(value) => update({ fontSize: value as ChatFontSize })}
            items={(['sm', 'md', 'lg', 'xl'] as const).map((size) => ({ value: size, label: <span className="tabular-nums">{FONT_SIZE_PX[size]}</span> }))}
          />
        </AppearanceRow>
        <AppearanceRow label={t({ ko: '줄 간격', en: 'Line spacing' })}>
          <SegmentedControl
            size="xs"
            fullWidth
            value={appearance.lineHeight}
            onChange={(value) => update({ lineHeight: value as ChatLineHeight })}
            items={[
              { value: 'tight', label: t({ ko: '좁게', en: 'Tight' }) },
              { value: 'normal', label: t({ ko: '보통', en: 'Normal' }) },
              { value: 'relaxed', label: t({ ko: '넓게', en: 'Relaxed' }) },
            ]}
          />
        </AppearanceRow>
        <label className="flex cursor-pointer items-center justify-between gap-3 text-xs font-semibold text-muted-foreground">
          {t({ ko: '배경 이미지', en: 'Background image' })}
          <Switch checked={appearance.showBackground} onCheckedChange={(showBackground) => update({ showBackground })} />
        </label>
      </PopoverContent>
    </Popover>
  )
}
