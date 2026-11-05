import type { ComponentProps } from 'react'
import { ToolbarSearchField } from './search-field'

/** The toolbar's search toggle closes this field; Escape follows the same reset path. */
export function PageToolbarSearch({ onClose, onKeyDown, ...props }: ComponentProps<typeof ToolbarSearchField> & { onClose: () => void }) {
  return <ToolbarSearchField autoFocus {...props} onKeyDown={(event) => {
    if (event.key === 'Escape') onClose()
    onKeyDown?.(event)
  }} />
}
