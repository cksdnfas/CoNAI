import { useId, useRef, type ReactNode } from 'react'
import { ImagePlus, RotateCcw, X } from 'lucide-react'
import { SegmentedControl } from '@/components/common/segmented-control'
import { IconButton } from '@/components/ui/icon-button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tip } from '@/components/ui/tooltip'
import { CHAT_TYPEFACE_FAMILY, chatTranscriptStyle, DEFAULT_CHAT_APPEARANCE } from '@/features/codex-chat/chat-appearance'
import { ChatMarkdown } from '@/features/codex-chat/chat-markdown'
import { useI18n } from '@/i18n'
import type { ChatStyle, ChatTypeface } from '@/lib/api-codex-chat'
import { ChatProfileAssetInput } from './chat-profile-asset-input'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'

/** An overline-labelled group. Not a <label>: these hold several controls (segments, a picture and its remove key). */
function Group({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div role="group" aria-label={typeof label === 'string' ? label : undefined} className="theme-settings-field flex flex-col text-sm">
      <span className="text-2xs font-semibold tracking-overline text-muted-foreground uppercase">{label}</span>
      {children}
    </div>
  )
}

type ColorKey = keyof ChatStyle['colors']

function ColorField({ label, value, fallback, onChange }: { label: string; value: string; fallback: string; onChange: (value: string) => void }) {
  const { t } = useI18n()
  return (
    <Group label={label}>
      <div className="flex items-center gap-1">
        <input
          type="color"
          aria-label={label}
          value={value || fallback}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-14 cursor-pointer rounded-sm border border-line bg-transparent p-1"
        />
        <span className="flex-1 font-mono text-xs text-muted-foreground">{value || t({ ko: '기본 글자색', en: 'Text colour' })}</span>
        {value ? (
          <IconButton size="icon-xs" variant="ghost" onClick={() => onChange('')} label={t({ ko: '기본 글자색으로', en: 'Use text colour' })}>
            <RotateCcw />
          </IconButton>
        ) : null}
      </div>
    </Group>
  )
}

/** The profile's look: typeface, background, roleplay colours, with a sample line rendered as the chat would. */
export function ChatProfileLook({ style, defaults, backgroundUrl, onStyleChange, onBackgroundChange, characterName, hasBackground, onBackgroundHashChange, onBusyChange, busy, backgroundActions }: {
  style: ChatStyle
  defaults: ChatStyle | undefined
  /** What the background shows now (saved image, or a newly picked one); null when there is none. */
  backgroundUrl: string | null
  onStyleChange: (style: ChatStyle) => void
  characterName: string
  hasBackground: boolean
  onBackgroundHashChange: (hash: string) => void
  onBusyChange: (busy: boolean) => void
  busy: boolean
  /** Clear the legacy image alongside its library hash. */
  onBackgroundChange: (background: string | null) => void
  /** Extra controls after the background's inputs (the profile editor's generate button). */
  backgroundActions?: ReactNode
}) {
  const { t } = useI18n()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const roleplayId = useId()
  const patch = (next: Partial<ChatStyle>) => onStyleChange({ ...style, ...next })
  const setColor = (key: ColorKey, value: string) => patch({ colors: { ...style.colors, [key]: value } })

  const sample = t({
    ko: '*창밖을 보다가 천천히 고개를 돌린다.* "어, 왔어? 기다렸잖아." \'조금 늦었네…\'',
    en: '*She looks up from the window.* "Oh, you made it! I was waiting." \'A bit late, though…\'',
  })

  return (
    <div className="space-y-4">
      <Group label={t({ ko: '글꼴', en: 'Typeface' })}>
        <SegmentedControl
          size="sm"
          value={style.typeface}
          onChange={(value) => patch({ typeface: value as ChatTypeface })}
          items={[
            { value: 'sans', label: t({ ko: '기본', en: 'Default' }) },
            { value: 'serif', label: <span style={{ fontFamily: CHAT_TYPEFACE_FAMILY.serif }}>{t({ ko: '명조', en: 'Serif' })}</span> },
            { value: 'mono', label: <span style={{ fontFamily: CHAT_TYPEFACE_FAMILY.mono }}>{t({ ko: '고정폭', en: 'Mono' })}</span> },
          ]}
        />
      </Group>

      <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
        <Group label={t({ ko: '배경 이미지', en: 'Background' })}>
          <div className="relative">
            <Tip content={backgroundUrl ? t({ ko: '배경 바꾸기', en: 'Change background' }) : t({ ko: '배경 고르기', en: 'Pick a background' })}>
              {/* eslint-disable-next-line no-restricted-syntax -- the picture itself is the control; Button padding would crop it */}
              <button
                type="button"
                aria-label={t({ ko: '배경 고르기', en: 'Pick a background' })}
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
                className="flex aspect-video w-full cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed border-line bg-cover bg-center text-muted-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                <ChatProfileImage src={backgroundUrl} fallback={<ImagePlus className="size-5" />} />
              </button>
            </Tip>
            {hasBackground ? (
              <IconButton size="icon-xs" variant="secondary" disabled={busy} className="absolute right-1.5 top-1.5" onClick={() => onBackgroundChange(null)} label={t({ ko: '배경 지우기', en: 'Remove background' })}>
                <X />
              </IconButton>
            ) : null}
            <div className="flex items-center">
              <ChatProfileAssetInput characterName={characterName} onChange={onBackgroundHashChange} onBusyChange={onBusyChange} busy={busy} uploadRef={fileInputRef} />
              {backgroundActions}
            </div>
          </div>
        </Group>
        {backgroundUrl ? (
          <div className="space-y-4 md:pt-7">
            <Group label={t({ ko: '어둡게 {value}%', en: 'Dim {value}%' }, { value: style.backgroundDim })}>
              <Slider min={0} max={90} step={5} value={[style.backgroundDim]} onValueChange={([value]) => patch({ backgroundDim: value })} aria-label={t({ ko: '어둡게', en: 'Dim' })} />
            </Group>
            <Group label={t({ ko: '흐리게 {value}px', en: 'Blur {value}px' }, { value: style.backgroundBlur })}>
              <Slider min={0} max={20} step={1} value={[style.backgroundBlur]} onValueChange={([value]) => patch({ backgroundBlur: value })} aria-label={t({ ko: '흐리게', en: 'Blur' })} />
            </Group>
          </div>
        ) : null}
      </div>

      <div className="flex min-h-10 items-center justify-between gap-3 text-sm">
        <label htmlFor={roleplayId} className="flex-1 cursor-pointer">{t({ ko: '롤플레이 글자색', en: 'Roleplay text colours' })}</label>
        <Switch id={roleplayId} checked={style.roleplay} onCheckedChange={(roleplay) => patch({ roleplay })} />
      </div>
      {style.roleplay ? (
        <div className="grid gap-3 md:grid-cols-3">
          <ColorField label={t({ ko: '"대사"', en: '"Dialogue"' })} value={style.colors.dialogue} fallback="#ffffff" onChange={(value) => setColor('dialogue', value)} />
          <ColorField label={t({ ko: '*묘사*', en: '*Narration*' })} value={style.colors.narration} fallback={defaults?.colors.narration ?? style.colors.narration} onChange={(value) => setColor('narration', value)} />
          <ColorField label={t({ ko: "'속마음'", en: "'Thoughts'" })} value={style.colors.thought} fallback={defaults?.colors.thought ?? style.colors.thought} onChange={(value) => setColor('thought', value)} />
        </div>
      ) : null}

      <div className="relative overflow-hidden rounded-md border border-line">
        {backgroundUrl ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            <div className="absolute inset-0" style={{ filter: style.backgroundBlur > 0 ? `blur(${style.backgroundBlur}px)` : undefined, transform: style.backgroundBlur > 0 ? 'scale(1.06)' : undefined }}><ChatProfileImage src={backgroundUrl} /></div>
            <div className="absolute inset-0 bg-background" style={{ opacity: style.backgroundDim / 100 }} />
          </div>
        ) : null}
        <div className="relative px-4 py-3" style={chatTranscriptStyle(DEFAULT_CHAT_APPEARANCE, style)}>
          <ChatMarkdown text={sample} roleplay={style.roleplay} />
        </div>
      </div>
    </div>
  )
}
