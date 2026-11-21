import { useId, useState, type ReactNode } from 'react'
import { ActionContextMenu, type ActionMenuEntry } from '@/components/ui/action-menu'
import { Chip } from '@/components/ui/chip'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'

/**
 * A wrapping row of removable chips ending in a bare field that adds one (Enter, or leaving the field with text). The
 * caller owns the value: `onAdd` gets the typed text (trimmed, never empty) and decides how it joins the list, so word
 * lists (style badges, keywords) and prompt pieces (appearance sections) share the row. `suggestions` are offered
 * while typing; `chipMenu` adds right-click entries before 빼기, `chipExtra` a small key inside the chip.
 */
export function ChipListInput({ items, editable, disabled = false, onAdd, onRemove, addLabel, removeLabel, placeholder, maxLength, full = false, suggestions, chipMenu, chipExtra, chipDrag }: {
  items: string[]
  editable: boolean
  disabled?: boolean
  onAdd: (text: string) => void
  onRemove: (index: number) => void
  /** The field's accessible name. */
  addLabel: string
  /** The X key's name for one chip (default "<item> 빼기"). */
  removeLabel?: (item: string) => string
  placeholder?: string
  /** Characters per item. */
  maxLength?: number
  /** The list is at its limit: the field stays, disabled. */
  full?: boolean
  suggestions?: readonly string[]
  chipMenu?: (index: number) => ActionMenuEntry[]
  chipExtra?: (index: number) => ReactNode
  /** Makes chips draggable (moving a piece between lists). */
  chipDrag?: { onDragStart: (index: number) => void; onDragEnd: () => void }
}) {
  const { t } = useI18n()
  const listId = useId()
  const [text, setText] = useState('')
  const add = () => {
    if (!editable || disabled || full || !text.trim()) return
    onAdd(text.trim())
    setText('')
  }
  const known = new Set(items.map((item) => item.toLowerCase()))
  const offered = suggestions?.filter((item) => !known.has(item.toLowerCase())) ?? []
  const nameOf = (item: string) => removeLabel?.(item) ?? t({ ko: '{item} 빼기', en: 'Remove {item}' }, { item })
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {items.map((item, index) => {
        const chip = (
          <span className="group/tag inline-flex max-w-full min-w-0">
            <Chip
              draggable={editable && !disabled && Boolean(chipDrag)}
              onDragStart={chipDrag ? (event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item); chipDrag.onDragStart(index) } : undefined}
              onDragEnd={chipDrag?.onDragEnd}
              onRemove={editable ? () => onRemove(index) : undefined}
              removeDisabled={disabled}
              removeLabel={nameOf(item)}
            >
              <span className="truncate">{item}</span>
              {chipExtra?.(index)}
            </Chip>
          </span>
        )
        return chipMenu ? (
          <ActionContextMenu key={`${index}:${item}`} disabled={!editable} entries={[
            ...chipMenu(index),
            '-',
            { key: 'remove', label: t({ ko: '빼기', en: 'Remove' }), destructive: true, disabled, onSelect: () => onRemove(index) },
          ]}>
            {chip}
          </ActionContextMenu>
        ) : <span key={`${index}:${item}`} className="inline-flex max-w-full min-w-0">{chip}</span>
      })}
      {editable ? <>
        <Input variant="bare" controlSize="compact" className="w-28 min-w-20 flex-1" aria-label={addLabel}
          disabled={disabled || full} value={text} maxLength={maxLength} placeholder={placeholder} list={offered.length ? listId : undefined}
          onChange={(event) => setText(event.target.value)}
          onBlur={add} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); add() } }} />
        {offered.length ? <datalist id={listId}>{offered.map((item) => <option key={item} value={item} />)}</datalist> : null}
      </> : null}
    </div>
  )
}

/** Add one word to a list: kept once (case-insensitive), within the count. */
export function addTerm(items: readonly string[], text: string, max: number) {
  const term = text.replace(/\s+/g, ' ').trim()
  if (!term || items.length >= max || items.some((item) => item.toLowerCase() === term.toLowerCase())) return [...items]
  return [...items, term]
}
