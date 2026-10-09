import type { ReactNode } from 'react'
import { LoaderCircle, Save, Trash2 } from 'lucide-react'
import { useI18n } from '@/i18n'
import { IconButton } from './icon-button'
import { ModalFooter } from './modal'

/**
 * The footer of an editor modal: Delete (red icon, no fill) on the left, then the editor's other actions as icons, and
 * Save at the right end. There is no Cancel: the header ✕ closes, and asks first when there are unsaved edits.
 */
export function EditorFooter({ onDelete, deleteLabel, deleting = false, children, onSave, saveSubmit = false, canSave = true, saving = false, saveLabel }: {
  /** Left out: no delete (a new item, or one that cannot be deleted). */
  onDelete?: () => void
  deleteLabel?: string
  deleting?: boolean
  /** Other actions (export, duplicate, test…) as icon buttons. */
  children?: ReactNode
  onSave?: () => void
  /** Inside a form: Save is its submit button (the form's onSubmit saves), so Enter in a field saves too. */
  saveSubmit?: boolean
  canSave?: boolean
  saving?: boolean
  saveLabel?: string
}) {
  const { t } = useI18n()
  return (
    <ModalFooter className="mt-4 gap-1 border-t border-line pt-3">
      {onDelete ? (
        <IconButton size="icon-sm" variant="destructive-ghost" onClick={onDelete} disabled={deleting || saving} label={deleteLabel ?? t({ ko: '삭제', en: 'Delete' })}>
          {deleting ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
        </IconButton>
      ) : null}
      {children}
      <span className="flex-1" />
      {onSave || saveSubmit ? (
        <IconButton size="icon-sm" variant="default" type={saveSubmit ? 'submit' : 'button'} onClick={saveSubmit ? undefined : onSave} disabled={!canSave || saving} label={saveLabel ?? t({ ko: '저장', en: 'Save' })}>
          {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
        </IconButton>
      ) : null}
    </ModalFooter>
  )
}
