import type { ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useI18n } from '@/i18n'
import { formatShortcut } from '@/lib/keyboard-shortcut'
import { Button } from './button'
import { ModalFooter, useOptionalModal } from './modal'
import { Tip } from './tooltip'

/**
 * The footer of an editor modal: Delete (red text, no fill) on the left, then the editor's other actions, and on the
 * right the unsaved-changes status, Revert, Cancel (closes the way ✕ does, asking first with unsaved edits) and Save,
 * all in words. Without a save it ends in Close.
 */
export function EditorFooter({ onDelete, deleteLabel, deleteDisabled = false, deleteTip, deleting = false, children, onRevert, canRevert = true, onSave, saveSubmit = false, canSave = true, saving = false, saveLabel, saveTip, cancel = true }: {
  /** Left out: no delete (a new item, or one that cannot be deleted). */
  onDelete?: () => void
  deleteLabel?: string
  deleteDisabled?: boolean
  deleteTip?: ReactNode
  deleting?: boolean
  /** Other actions (export, duplicate, test…): secondary buttons, or icon buttons for repeated small tools. */
  children?: ReactNode
  /** Drops the unsaved edits back to the saved state (the caller asks first); sits beside Cancel. */
  onRevert?: () => void
  canRevert?: boolean
  onSave?: () => void
  /** Inside a form: Save is its submit button (the form's onSubmit saves), so Enter in a field saves too. */
  saveSubmit?: boolean
  canSave?: boolean
  saving?: boolean
  /** The verb of the primary action when it is not a plain save ("만들기", "불러오기"). */
  saveLabel?: string
  saveTip?: ReactNode
  /** Cancel / Close key; on by default inside a modal. */
  cancel?: boolean
}) {
  const { t } = useI18n()
  const modal = useOptionalModal()
  const commits = Boolean(onSave || saveSubmit)
  return (
    <ModalFooter separated className="mt-4 gap-2">
      {onDelete ? (
        <Tip content={deleteTip}>
          <span>
            <Button type="button" size="sm" variant="destructive-ghost" onClick={onDelete} disabled={deleteDisabled || deleting || saving}>
              {deleting ? <LoaderCircle className="animate-spin" /> : null}
              {deleteLabel ?? t({ ko: '삭제', en: 'Delete' })}
            </Button>
          </span>
        </Tip>
      ) : null}
      {children}
      <span className="flex-1" />
      {modal?.dirty && commits ? (
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {t({ ko: '저장 안 한 변경 · {keys}', en: 'Unsaved changes · {keys}' }, { keys: formatShortcut('Mod+S') })}
        </span>
      ) : null}
      {onRevert ? (
        <Button type="button" size="sm" variant="ghost" onClick={onRevert} disabled={!canRevert || saving}>
          {t({ ko: '되돌리기', en: 'Revert' })}
        </Button>
      ) : null}
      {modal && cancel ? (
        <Button type="button" size="sm" variant="ghost" onClick={modal.requestClose} disabled={saving}>
          {commits ? t({ ko: '취소', en: 'Cancel' }) : t({ ko: '닫기', en: 'Close' })}
        </Button>
      ) : null}
      {commits ? (
        <Tip content={saveTip}>
          <span tabIndex={saveTip && (!canSave || saving) ? 0 : undefined} aria-disabled={saveTip && (!canSave || saving) ? true : undefined} aria-label={!canSave || saving ? typeof saveTip === 'string' ? saveTip : saveLabel ?? t({ ko: '저장', en: 'Save' }) : undefined} className="inline-flex shrink-0 rounded-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40">
            <Button size="sm" variant="default" type={saveSubmit ? 'submit' : 'button'} onClick={saveSubmit ? undefined : onSave} disabled={!canSave || saving}>
              {saving ? <LoaderCircle className="animate-spin" /> : null}
              {saveLabel ?? t({ ko: '저장', en: 'Save' })}
            </Button>
          </span>
        </Tip>
      ) : null}
    </ModalFooter>
  )
}
