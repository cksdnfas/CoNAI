import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useI18n } from '@/i18n'

/** One name to type (new folder, rename): an input and a save button; Enter saves. */
export function NameDialog({ open, title, value, onChange, onSubmit, onClose, busy = false, label, submitLabel }: {
  open: boolean
  title: string
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onClose: () => void
  busy?: boolean
  /** Accessible name of the input (default 이름). */
  label?: string
  submitLabel?: string
}) {
  const { t } = useI18n()
  return (
    <Modal open={open} title={title} onClose={() => { if (!busy) onClose() }} widthClassName="max-w-md">
      <form onSubmit={(event) => { event.preventDefault(); if (!busy && value.trim()) onSubmit() }}>
        <ModalBody>
          <Input variant="settings" autoFocus aria-label={label ?? t({ ko: '이름', en: 'Name' })} value={value} onChange={(event) => onChange(event.target.value)} />
        </ModalBody>
        <ModalFooter>
          <span className="flex-1" />
          <Button type="submit" disabled={busy || !value.trim()}>{submitLabel ?? t({ ko: '저장', en: 'Save' })}</Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}

export type FolderOption = { value: string; label: string; disabled?: boolean }

/** Choose the folder to move the selection into. `rootLabel` is the top level (value ''). */
export function MoveDialog({ open, value, onChange, folders, rootLabel, onSubmit, onClose, busy = false }: {
  open: boolean
  value: string
  onChange: (value: string) => void
  folders: FolderOption[]
  rootLabel: string
  onSubmit: () => void
  onClose: () => void
  busy?: boolean
}) {
  const { t } = useI18n()
  return (
    <Modal open={open} title={t({ ko: '폴더로 이동', en: 'Move to folder' })} onClose={() => { if (!busy) onClose() }} widthClassName="max-w-md">
      <ModalBody>
        <Select variant="settings" aria-label={t({ ko: '대상 폴더', en: 'Destination folder' })} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">{rootLabel}</option>
          {folders.map((folder) => <option key={folder.value} value={folder.value} disabled={folder.disabled}>{folder.label}</option>)}
        </Select>
      </ModalBody>
      <ModalFooter>
        <span className="flex-1" />
        <Button disabled={busy} onClick={onSubmit}>{t({ ko: '이동', en: 'Move' })}</Button>
      </ModalFooter>
    </Modal>
  )
}
