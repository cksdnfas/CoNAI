import { useContext, useId, useState, type ReactNode } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Check, ImageOff } from 'lucide-react'
import { chatFormLayout, chatFormSliderStep, readChatFormPath, writeChatFormPath, type ChatFormChoicePicker, type ChatFormInput, type ChatFormMediaPicker } from '@conai/shared'
import { MediaCard } from '@/components/common/media-card'
import { SegmentedControl } from '@/components/common/segmented-control'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SettingRow } from '@/components/ui/setting-row'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { useImageFeedSafety } from '@/features/images/components/image-list/use-image-feed-safety'
import { useI18n } from '@/i18n'
import { buildApiUrl } from '@/lib/api-client'
import { getImage, getImageDetailQueryKey } from '@/lib/api-images'
import { cn } from '@/lib/utils'
import { ChatChoicePassedLine, ChatChoiceStatesContext } from './chat-choice'
import { buildChatLibraryImageRecord } from './chat-image-record'
import { ChatMediaMasonry } from './chat-media-masonry'
import { ProposalFooter, ProposalFrame } from './chat-proposal-parts'
import { useCodexChat, useCodexChatLiveTurn, type ChatFormCardData } from './codex-chat-context'

/*
 * Input forms (show_form): an A2UI component list drawn as one flat column of rows with the app's shared controls.
 * The open one sits under its reply; a press sends the values as the next message, and the reply keeps one line
 * (ChatChoiceLines) from then on.
 */

/** Short enough to sit side by side as segments instead of a dropdown. */
const SEGMENT_MAX_OPTIONS = 3
const SEGMENT_MAX_LABEL_CHARS = 24

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function toggled(list: string[], item: string, single: boolean) {
  if (single) return list.includes(item) ? [] : [item]
  return list.includes(item) ? list.filter((entry) => entry !== item) : [...list, item]
}

function ChoiceControl({ id, input, picked, disabled, onChange }: { id: string; input: ChatFormChoicePicker; picked: string[]; disabled: boolean; onChange: (next: string[]) => void }) {
  const { t } = useI18n()
  if (input.variant === 'multipleSelection') {
    return input.options.map((option) => {
      const on = picked.includes(option.value)
      return <Button key={option.value} variant="subtle" size="xs" disabled={disabled} aria-pressed={on} data-pressed={on} onClick={() => onChange(toggled(picked, option.value, false))}>{option.label}</Button>
    })
  }
  if (input.options.length <= SEGMENT_MAX_OPTIONS && input.options.reduce((total, option) => total + option.label.length, 0) <= SEGMENT_MAX_LABEL_CHARS) {
    return <SegmentedControl fullWidth ariaLabel={input.label} value={picked[0] ?? ''} items={input.options.map((option) => ({ value: option.value, label: option.label, disabled }))} onChange={(value) => onChange([value])} />
  }
  return (
    <Select id={id} value={picked[0] ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value ? [event.target.value] : [])}>
      {picked.length === 0 ? <option value="">{t({ ko: '선택', en: 'Choose' })}</option> : null}
      {input.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </Select>
  )
}

/** Library media to pick from, as the chat shows any library tile: by-hash thumbnails, the reader's safety blur. */
function MediaControl({ input, picked, disabled, onChange }: { input: ChatFormMediaPicker; picked: string[]; disabled: boolean; onChange: (next: string[]) => void }) {
  const { t } = useI18n()
  const { canViewImages } = useImagePermissions()
  const queries = useQueries({ queries: input.items.map((hash) => ({ enabled: canViewImages, queryKey: getImageDetailQueryKey(hash), queryFn: ({ signal }: { signal: AbortSignal }) => getImage(hash, { signal }), retry: false })) })
  const images = queries.flatMap((query) => (query.data ? [query.data] : []))
  const safety = useImageFeedSafety({ items: images, enabled: input.items.length > 0 })
  const visible = new Map(safety.visibleItems.map((image) => [image.composite_hash, image]))
  const tiles = input.items.map((hash, index) => {
    // Readers without gallery access see the media through the chat's by-hash routes.
    const image = canViewImages ? visible.get(hash) : buildChatLibraryImageRecord(hash)
    const on = picked.includes(hash)
    return (
      <MediaCard
        key={hash}
        className="w-full"
        selected={on}
        disabled={disabled}
        aria-pressed={on}
        aria-label={t({ ko: '{index}번 이미지', en: 'Image {index}' }, { index: index + 1 })}
        onClick={() => onChange(toggled(picked, hash, input.variant === 'mutuallyExclusive'))}
        media={image
          ? <img src={canViewImages ? buildApiUrl(`/api/images/${encodeURIComponent(hash)}/thumbnail`) : image.thumbnail_url ?? ''} alt="" loading="lazy" className={cn('block w-full', canViewImages && safety.shouldBlurItemPreview(image) && 'blur-md')} />
          : <span className="flex aspect-square items-center justify-center"><ImageOff className="size-5 text-muted-foreground" /></span>}
        overlay={on ? <span className="absolute left-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"><Check className="size-3" /></span> : null}
      />
    )
  })
  return <ChatMediaMasonry tiles={tiles} size="sm" />
}

type RowProps<T extends ChatFormInput> = { id: string; input: T; value: unknown; disabled: boolean; onChange: (value: unknown) => void }

/** One renderer per canonical input: a new member of ChatFormInput fails typecheck until it has one. */
const FORM_ROWS: { [K in ChatFormInput['component']]: (props: RowProps<Extract<ChatFormInput, { component: K }>>) => ReactNode } = {
  TextField: ({ id, input, value, disabled, onChange }) => {
    const text = typeof value === 'string' ? value : ''
    if (input.variant === 'longText') {
      return <SettingRow stacked label={input.label} htmlFor={id}><Textarea id={id} autoGrow value={text} placeholder={input.placeholder} disabled={disabled} onChange={(event) => onChange(event.target.value)} /></SettingRow>
    }
    const numeric = input.variant === 'number'
    return (
      <SettingRow label={input.label} htmlFor={id} controlWidth="standard">
        <Input id={id} value={text} placeholder={input.placeholder} disabled={disabled} mono={numeric} inputMode={numeric ? 'decimal' : undefined}
          onChange={(event) => { if (!numeric || /^-?\d*\.?\d*$/.test(event.target.value)) onChange(event.target.value) }} />
      </SettingRow>
    )
  },
  CheckBox: ({ id, input, value, disabled, onChange }) => (
    <SettingRow label={input.label} htmlFor={id}><Switch id={id} checked={value === true} disabled={disabled} onCheckedChange={onChange} /></SettingRow>
  ),
  Slider: ({ input, value, disabled, onChange }) => {
    const number = typeof value === 'number' ? value : input.min
    return (
      <SettingRow label={input.label} controlWidth="standard">
        <Slider aria-label={input.label} value={[number]} min={input.min} max={input.max} step={chatFormSliderStep(input)} disabled={disabled} onValueChange={([next]) => onChange(Number(next.toFixed(4)))} />
        <span className="min-w-8 text-right font-mono text-xs tabular-nums text-muted-foreground">{Number.isInteger(number) ? number : Number(number.toFixed(2))}</span>
      </SettingRow>
    )
  },
  ChoicePicker: ({ id, input, value, disabled, onChange }) => {
    const multiple = input.variant === 'multipleSelection'
    return <SettingRow label={input.label} htmlFor={multiple ? undefined : id} align={multiple ? 'start' : 'center'} controlWidth={multiple ? undefined : 'standard'}><ChoiceControl id={id} input={input} picked={stringList(value)} disabled={disabled} onChange={onChange} /></SettingRow>
  },
  MediaPicker: ({ input, value, disabled, onChange }) => {
    const picked = stringList(value)
    return (
      <SettingRow stacked label={<>{input.label}<span className="ml-2 font-mono text-xs tabular-nums text-muted-foreground">{picked.length}/{input.items.length}</span></>}>
        <MediaControl input={input} picked={picked} disabled={disabled} onChange={onChange} />
      </SettingRow>
    )
  },
}

function FormRow({ input, value, disabled, onChange }: Omit<RowProps<ChatFormInput>, 'id'>) {
  const id = useId()
  const render = FORM_ROWS[input.component] as (props: RowProps<ChatFormInput>) => ReactNode
  return render({ id, input, value, disabled, onChange })
}

/** A number field left half-typed ("-", ".") goes out empty rather than as a value the card would refuse. */
function sendable(form: ChatFormCardData, values: Record<string, unknown>) {
  return chatFormLayout(form).rows.reduce((model, row) => {
    if (row.component !== 'TextField' || row.variant !== 'number') return model
    const text = readChatFormPath(model, row.value['@path'])
    return typeof text === 'string' && text.trim() && !Number.isFinite(Number(text)) ? writeChatFormPath(model, row.value['@path'], '') : model
  }, values)
}

function ChatFormCard({ form, threadId }: { form: ChatFormCardData; threadId: number }) {
  const { t } = useI18n()
  const chat = useCodexChat()
  const busy = useCodexChatLiveTurn(threadId) !== null
  const [values, setValues] = useState(form.dataModel)
  const [closed, setClosed] = useState(false)
  if (closed || !chat) return <ChatChoicePassedLine question={form.title} />
  const { rows, buttons } = chatFormLayout(form)
  return (
    <ProposalFrame role="group" aria-label={form.title}>
      <p className="text-xs font-semibold">{form.title}</p>
      <div>
        {rows.map((row) => row.component === 'Text'
          ? <p key={row.id} className={cn('py-2', row.variant === 'caption' ? 'text-xs text-muted-foreground' : 'text-sm')}>{row.text}</p>
          : <FormRow key={row.id} input={row} value={readChatFormPath(values, row.value['@path'])} disabled={busy} onChange={(value) => setValues((current) => writeChatFormPath(current, row.value['@path'], value))} />)}
      </div>
      <ProposalFooter>
        {buttons.map((button) => (
          <Button key={button.event} size="xs" variant={button.primary ? 'default' : 'subtle'} disabled={busy} onClick={() => void chat.answerForm(threadId, form, button.event, sendable(form, values))}>{button.label}</Button>
        ))}
        {/* Not while the reply runs: the live bubble gives way to the stored message, which would bring a dismissed card back. */}
        <Button size="xs" variant="ghost" disabled={busy} onClick={() => setClosed(true)}>{t({ ko: '무시', en: 'Dismiss' })}</Button>
      </ProposalFooter>
    </ProposalFrame>
  )
}

/** An input form of a reply while it still waits for an answer, under its text. */
export function ChatFormProposalCard({ proposal, threadId }: { proposal: ChatFormCardData; threadId?: number }) {
  const states = useContext(ChatChoiceStatesContext)
  // Outside the chat view (no card states) a form has nowhere to send its answer.
  if (!states || threadId === undefined || states.has(proposal.id)) return null
  return <ChatFormCard form={proposal} threadId={threadId} />
}
