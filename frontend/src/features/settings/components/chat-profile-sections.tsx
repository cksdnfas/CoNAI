import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Braces, Plus } from 'lucide-react'
import { CHAT_PROFILE_TEXT_LIMITS, rawTokenEstimate, unknownChatMacros } from '@conai/shared'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Text } from '@/components/ui/text'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/** A prompt section id; plain characters only, so it works without a secure context (no crypto.randomUUID). */
export function newPromptSectionId() {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** The frame of an in-place editor: Escape closes it without closing the dialog around it. */
export function PromptEditFrame({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <div
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }}
    >
      {children}
    </div>
  )
}

/** Inserts {{char}} / {{user}} at the caret of `textarea`. */
export function PromptMacroMenu({ textarea, value, onChange }: { textarea: RefObject<HTMLTextAreaElement | null>; value: string; onChange: (value: string) => void }) {
  const { t } = useI18n()
  const insert = (macro: string) => {
    const element = textarea.current
    const start = element?.selectionStart ?? value.length
    const end = element?.selectionEnd ?? start
    const next = value.slice(0, start) + macro + value.slice(end)
    if (element && element.maxLength >= 0 && next.length > element.maxLength) return
    onChange(next)
    setTimeout(() => { element?.focus(); element?.setSelectionRange(start + macro.length, start + macro.length) }, 0)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><IconButton size="icon-sm" variant="ghost" label={t({ ko: '변수 넣기', en: 'Insert variable' })}><Braces /></IconButton></DropdownMenuTrigger>
      <DropdownMenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
        <DropdownMenuItem onSelect={() => insert('{{char}}')}>{'{{char}}'} {t({ ko: '캐릭터', en: 'Character' })}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => insert('{{user}}')}>{'{{user}}'} {t({ ko: '사용자', en: 'User' })}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A zone's +: adds at once, or with `choices` unfolds them in place beside it (no menu) and adds the one picked.
 * Escape, a press outside the row or focus moving out of it folds them again.
 */
export function PromptAdder({ label, choices, disabled = false, onAdd }: { label: string; choices?: Array<{ value: string; label: string }>; disabled?: boolean; onAdd: (value: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const row = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!expanded) return
    const fold = (event: PointerEvent) => { if (!row.current?.contains(event.target as Node)) setExpanded(false) }
    document.addEventListener('pointerdown', fold)
    return () => document.removeEventListener('pointerdown', fold)
  }, [expanded])

  return (
    <div
      ref={row}
      className="flex flex-wrap items-center gap-1.5"
      // A click does not focus a button in every browser (Safari), so only focus that lands elsewhere folds the row.
      onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setExpanded(false) }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !expanded) return
        event.preventDefault()
        event.stopPropagation()
        setExpanded(false)
      }}
    >
      <Button variant="ghost" size="sm" disabled={disabled} aria-expanded={choices ? expanded : undefined} onClick={() => (choices ? setExpanded(!expanded) : onAdd(''))}><Plus />{label}</Button>
      {choices && expanded ? choices.map((choice, index) => (
        <Button key={choice.value} variant="secondary" size="sm" autoFocus={index === 0} onClick={() => { setExpanded(false); onAdd(choice.value) }}>{choice.label}</Button>
      )) : null}
    </div>
  )
}

/**
 * A prompt item that is not a speech bubble, as one row of a hairline list: an instruction (system prompt, section,
 * author's note) or an example kept as written. The row shows its title, its rough token count and two lines of its
 * text (more on request); clicking it edits it in place, with `kind` and `tools` in the editor's footer.
 */
export function PromptCard({ itemKey, title, meta, text, maxLength = CHAT_PROFILE_TEXT_LIMITS.text, placeholder, editPlaceholder, onTextChange, titleField, enabled = true, assisted = false, flash = false, note, kind, tools, remove, editing, onEditingChange: setEditing }: {
  /** `data-prompt-item`, which a preset scrolls to after adding. */
  itemKey: string
  title: string
  meta?: ReactNode
  text: string
  maxLength?: number
  /** Shown instead of empty text. */
  placeholder: string
  /** The hint in the empty editor. */
  editPlaceholder?: string
  onTextChange: (text: string) => void
  titleField?: { value: string; onChange: (value: string) => void }
  enabled?: boolean
  assisted?: boolean
  flash?: boolean
  note?: ReactNode
  /** The kind switch, first in the editor's footer. */
  kind?: ReactNode
  /** Off/on and order, in the editor's footer before the variables. */
  tools?: ReactNode
  /** Delete, just before Done. */
  remove?: ReactNode
  /** Held by the caller, which opens one item at a time. */
  editing: boolean
  onEditingChange: (editing: boolean) => void
}) {
  const { t, formatNumber } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const textRef = useRef<HTMLSpanElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const node = textRef.current
    if (!node || expanded) return
    const measure = () => setOverflowing(node.scrollHeight > node.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [text, expanded, editing])

  const warnings = editing ? unknownChatMacros(text) : []
  // The same rough estimate the server starts from (errs high).
  const tokens = text.trim() ? rawTokenEstimate(text) : 0

  return (
    <div
      data-prompt-item={itemKey}
      className={cn(
        'rounded-sm transition-shadow duration-500 motion-reduce:transition-none',
        editing && 'my-1 bg-fill/60',
        assisted && 'ring-1 ring-primary/50',
        flash && 'ring-2 ring-primary/60',
      )}
    >
      {editing ? (
        <PromptEditFrame onClose={() => setEditing(false)}>
          <div className="space-y-2 p-2">
            {titleField ? (
              <Input variant="settings" controlSize="compact" value={titleField.value} maxLength={CHAT_PROFILE_TEXT_LIMITS.sectionTitle} aria-label={t({ ko: '제목', en: 'Title' })} placeholder={t({ ko: '제목 (예: 캐릭터, 세계관, 말투)', en: 'Title (e.g. Character, World, Tone)' })} onChange={(event) => titleField.onChange(event.target.value)} />
            ) : <Text variant="caption">{title}</Text>}
            <Textarea ref={textarea} variant="settings" autoGrow autoFocus rows={4} assisted={assisted} value={text} maxLength={maxLength} placeholder={editPlaceholder} aria-label={titleField?.value || title} onChange={(event) => onTextChange(event.target.value)} />
            {warnings.length ? <Text variant="caption" tone="warning">{t({ ko: '⚠ 모르는 변수 {variables}', en: '⚠ Unknown variables {variables}' }, { variables: warnings.join(', ') })}</Text> : null}
            {note}
            <div className="flex flex-wrap items-center gap-0.5">
              {kind}
              <span className="flex-1" />
              {tools}
              <PromptMacroMenu textarea={textarea} value={text} onChange={onTextChange} />
              {remove}
              <Button size="compact" onClick={() => setEditing(false)}>{t({ ko: '완료', en: 'Done' })}</Button>
            </div>
          </div>
        </PromptEditFrame>
      ) : (
        <>
          <Button variant="ghost" size="content" className="w-full" onClick={() => setEditing(true)}>
            <span className="flex w-full min-w-0 flex-col gap-0.5 px-1 py-1">
              <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm font-semibold text-foreground">
                <span className={cn(!enabled && 'text-muted-foreground line-through')}>{title}</span>
                {meta ? <span className="text-xs font-normal text-muted-foreground">{meta}</span> : null}
                {enabled ? null : <Badge variant="secondary" size="xs">{t({ ko: '꺼짐', en: 'Off' })}</Badge>}
                {tokens ? <span className="ml-auto text-2xs font-normal tabular-nums text-muted-foreground">{t({ ko: '약 {count} 토큰', en: '~{count} tokens' }, { count: formatNumber(tokens) })}</span> : null}
              </span>
              <span ref={textRef} className={cn('text-sm font-normal whitespace-pre-wrap break-words', text.trim() && enabled ? 'text-foreground/80' : 'text-muted-foreground', !expanded && 'line-clamp-2')}>
                {text.trim() ? text : placeholder}
              </span>
            </span>
          </Button>
          {note ? <div className="px-3 pb-2">{note}</div> : null}
          {overflowing || expanded ? (
            <div className="px-2 pb-1">
              <Button variant="link" size="xs" onClick={() => setExpanded(!expanded)}>{expanded ? t({ ko: '접기', en: 'Collapse' }) : t({ ko: '전체 보기', en: 'Show all' })}</Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
