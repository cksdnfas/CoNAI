import { useState } from 'react'
import { CHAT_PROFILE_TEXT_LIMITS } from '@conai/shared'
import { ChevronDown, Folder } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import { folderPath, useCharacterFolders } from '../character-library-shared'
import { CharacterFolderPickerModal } from './character-folder-nav'

/** Where a new appearance setting goes: its folder and name (Enter saves). */
export function CharacterSettingSaveDialog({ title, initialName, initialFolderId = null, busy = false, submitLabel, onSubmit, onClose }: {
  title: string
  initialName: string
  initialFolderId?: number | null
  busy?: boolean
  /** The verb of the submit key (default 저장). */
  submitLabel?: string
  onSubmit: (target: { folderId: number | null; name: string }) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [name, setName] = useState(initialName)
  const [folderId, setFolderId] = useState(initialFolderId)
  const [picking, setPicking] = useState(false)
  const foldersQuery = useCharacterFolders()
  const folders = foldersQuery.data ?? []
  const pathLabel = [t({ ko: '최상위', en: 'Top level' }), ...folderPath(new Map(folders.map((folder) => [folder.id, folder])), folderId).map((folder) => folder.name)].join(' / ')
  return (
    <Modal open title={title} onClose={() => { if (!busy) onClose() }} size="md">
      <form onSubmit={(event) => { event.preventDefault(); if (!busy && name.trim()) onSubmit({ folderId, name: name.trim() }) }}>
        <ModalBody>
          <div className="space-y-4">
            <FieldGroup label={t({ ko: '폴더', en: 'Folder' })}>
              <Button type="button" variant="field" size="field" className="w-full" disabled={busy || foldersQuery.isPending} onClick={() => setPicking(true)}>
                <span className="flex min-w-0 items-center gap-2"><Folder className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{pathLabel}</span></span>
                <ChevronDown className="text-muted-foreground" />
              </Button>
            </FieldGroup>
            <Field label={t({ ko: '외형 설정 이름', en: 'Setting name' })}>
              <Input variant="settings" autoFocus value={name} maxLength={CHAT_PROFILE_TEXT_LIMITS.name} disabled={busy} placeholder={t({ ko: '기본, 수영복…', en: 'Default, swimsuit…' })} onChange={(event) => setName(event.target.value)} />
            </Field>
          </div>
        </ModalBody>
        <ModalFooter>
          <span className="flex-1" />
          <Button type="submit" disabled={busy || !name.trim()}>{busy ? <Spinner className="size-3" /> : null}{submitLabel ?? t({ ko: '저장', en: 'Save' })}</Button>
        </ModalFooter>
      </form>
      {picking ? (
        <CharacterFolderPickerModal
          title={t({ ko: '폴더 고르기', en: 'Choose folder' })}
          folders={folders}
          value={folderId}
          submitLabel={t({ ko: '선택', en: 'Select' })}
          onPick={(picked) => { setFolderId(picked); setPicking(false) }}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </Modal>
  )
}
