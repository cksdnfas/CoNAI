import { useEffect, useEffectEvent, useRef, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { EditorFooter } from '@/components/ui/editor-footer'
import { IconButton } from '@/components/ui/icon-button'
import { Modal } from '@/components/ui/modal'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { CHAT_DOCK_INSET } from '@/features/settings/components/use-settings-editor-chat-page'
import { useI18n } from '@/i18n'
import { getErrorMessage } from '@/lib/error-message'
import { formatShortcut, isTypingTarget, openDialogCount } from '@/lib/keyboard-shortcut'

/**
 * The window of one library item over its list (appearance settings, art styles): the title row (the caller's title
 * field, favorite and ⋯), the body, and a footer that steps through the listed items with ‹ › and ← → (the next batch
 * loads at the end of the list), reverts and saves (Ctrl+S). Closing goes through the URL (`closeOnBack` off), so the
 * page's leave guard asks once about unsaved edits. The docked chat stays usable beside it. Without `canEdit` it only
 * shows.
 */
export function LibraryItemDialog({ title, leading, description, status, actions, ready, canEdit, dirty, canSave, saving, busy, isBusy, isCurrent, session, onSave, onRevert, items, total, openId, onLoadMore, onOpen, onClose, previousLabel, nextLabel, loadMoreError, children, after }: {
  title: ReactNode
  leading?: ReactNode
  description?: ReactNode
  status?: ReactNode
  actions?: ReactNode
  /** The item has loaded (save, revert and the saved state show only then). */
  ready: boolean
  canEdit: boolean
  dirty: boolean
  /** Beyond dirty and not busy: the draft is valid and no save or delete runs. */
  canSave: boolean
  saving: boolean
  /** An image operation or save runs: no stepping, no saving. */
  busy: boolean
  /** The same, read when a late batch lands. */
  isBusy: () => boolean
  /** The opened item is still the one open (captured when stepping starts). */
  isCurrent: () => boolean
  /** Changes per opened item: focus lost with the old body returns to the dialog. */
  session: number
  onSave: () => void
  /** After the person confirmed: put the draft back to the stored item. */
  onRevert: () => void
  /** The items loaded in the list, in order. */
  items: ReadonlyArray<{ id: number }>
  /** Every item of the list's scope (the counter's total). */
  total: number
  /** The item the address opens (null for a new draft). */
  openId: number | null
  /** Loads the list's next batch (null when everything is loaded) and resolves to the loaded items after it. */
  onLoadMore: (() => Promise<ReadonlyArray<{ id: number }>>) | null
  onOpen: (id: number) => void
  onClose: () => void
  previousLabel: string
  nextLabel: string
  /** The snackbar when the next batch fails to load. */
  loadMoreError: string
  /** The body (key it by `session` so per-item state starts fresh). */
  children: ReactNode
  /** Dialogs opened from the window (pickers). */
  after?: ReactNode
}) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const footer = useRef<HTMLSpanElement | null>(null)
  const save = () => { if (canEdit && dirty && canSave && !busy) onSave() }
  // The position comes from the address, so ‹ › stay (with their focus) while the next item loads.
  const index = openId === null ? -1 : items.findIndex((item) => item.id === openId)
  const atEnd = index === items.length - 1
  const step = async (direction: -1 | 1) => {
    if (busy || index < 0) return
    const stillOpen = isCurrent
    let list = items
    if (direction > 0 && atEnd && onLoadMore) {
      try { list = await onLoadMore() } catch (error) {
        showSnackbar({ message: getErrorMessage(error, loadMoreError), tone: 'error' })
        return
      }
    }
    // Closed or moved on while the batch loaded: a late batch must not reopen or jump the dialog.
    const next = list[index + direction]
    if (next && stillOpen() && !isBusy()) onOpen(next.id)
  }
  // ← → step unless a field, menu or tab strip has the keys, or another dialog is open over this one.
  const keyboard = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || isTypingTarget(event) || openDialogCount() > 1) return
    if (event.target instanceof Element && event.target.closest('[role="menu"],[role="tablist"],[data-chat-dock]')) return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); void step(event.key === 'ArrowLeft' ? -1 : 1) }
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyboard(event)
    document.addEventListener('keydown', listener)
    return () => document.removeEventListener('keydown', listener)
  }, [])
  // Stepping rebuilds the body and can disable ‹ ›; focus lost with either returns to the dialog, so Tab, Ctrl+S and
  // ← → stay here (a browser may drop focus from a disabled button only later).
  useEffect(() => {
    const active = document.activeElement
    if (!active || active === document.body || active.matches(':disabled')) footer.current?.closest<HTMLElement>('[role="dialog"]')?.focus({ preventScroll: true })
  }, [session])
  const revert = async () => {
    if (await confirm({ title: t({ ko: '변경 되돌리기', en: 'Revert changes' }), description: t({ ko: '저장하지 않은 변경을 모두 되돌릴까?', en: 'Revert every unsaved change?' }), confirmLabel: t({ ko: '되돌리기', en: 'Revert' }), tone: 'destructive' })) onRevert()
  }
  return (
    <Modal
      open
      size="xl"
      height="tall"
      // The docked chat stays usable beside the dialog: the assistant fills and saves the open item.
      sidePanelInset={CHAT_DOCK_INSET}
      // The URL is the dialog's address: browser back leaves the item through the page's guard.
      closeOnBack={false}
      title={title}
      leading={leading}
      description={description}
      status={status}
      actions={actions}
      onSave={canEdit ? save : undefined}
      onClose={onClose}
    >
      {children}
      <EditorFooter onSave={canEdit && ready ? save : undefined} canSave={dirty && canSave && !busy} saving={saving} onRevert={canEdit && ready ? () => void revert() : undefined} canRevert={dirty && !busy}>
        <span ref={footer} className="contents">{index >= 0 ? <>
          <IconButton variant="ghost" size="icon-sm" label={previousLabel} disabled={busy || index === 0} onClick={() => void step(-1)}><ChevronLeft /></IconButton>
          <span className="min-w-14 text-center text-xs text-muted-foreground tabular-nums">{index + 1} / {total}</span>
          <IconButton variant="ghost" size="icon-sm" label={nextLabel} disabled={busy || (atEnd && !onLoadMore)} onClick={() => void step(1)}><ChevronRight /></IconButton>
        </> : null}</span>
        {canEdit && ready ? <>
          <span className="hidden text-xs text-muted-foreground sm:inline" aria-live="polite">{dirty ? t({ ko: '저장 안 한 변경 · {keys}', en: 'Unsaved changes · {keys}' }, { keys: formatShortcut('Mod+S') }) : t({ ko: '저장됨', en: 'Saved' })}</span>
        </> : null}
      </EditorFooter>
      {after}
    </Modal>
  )
}
