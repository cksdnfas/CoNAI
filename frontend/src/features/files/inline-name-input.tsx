import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/i18n'

/** The text to preselect: a file's name without its extension, a folder's whole name. */
function stemLength(name: string, folder: boolean) {
  const dot = name.lastIndexOf('.')
  return folder || dot <= 0 ? name.length : dot
}

/**
 * A name edited in place on a tile or row. Enter commits, Esc cancels and leaving the field commits; Enter that
 * confirms an IME composition does nothing. `onCommit` decides what an unchanged or empty name means.
 */
export function InlineNameInput({ value, folder, onChange, onCommit, onCancel }: {
  value: string
  folder: boolean
  onChange: (value: string) => void
  onCommit: () => Promise<unknown> | void
  onCancel: () => void
}) {
  const { t } = useI18n()
  const input = useRef<HTMLInputElement>(null)
  const committing = useRef(false)

  useEffect(() => {
    const field = input.current
    if (!field) return
    field.focus()
    field.setSelectionRange(0, stemLength(field.value, folder))
  // Only the first value is preselected; later edits keep the caret.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commit = () => {
    if (committing.current) return
    committing.current = true
    void Promise.resolve(onCommit()).catch(() => undefined).finally(() => { committing.current = false })
  }
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      // The field goes away with focus in it: that must not count as leaving it.
      committing.current = true
      onCancel()
    }
  }
  const stop = (event: MouseEvent) => event.stopPropagation()

  return (
    <Input
      ref={input}
      controlSize="compact"
      aria-label={t({ ko: '이름', en: 'Name' })}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={keyDown}
      onBlur={commit}
      onClick={stop}
      onDoubleClick={stop}
    />
  )
}
