import { SegmentedControl } from '@/components/common/segmented-control'
import { EditorFooter } from '@/components/ui/editor-footer'
import { Modal, ModalBody } from '@/components/ui/modal'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import type { RefModImportConflict } from '@/lib/api-refmod-entries'

/** A picked RefMod bundle ZIP: what to do with names that already exist, then 가져오기. */
export function RefModImportDialog({ fileName, conflict, busy, onConflictChange, onSubmit, onClose }: {
  fileName: string
  conflict: RefModImportConflict
  busy: boolean
  onConflictChange: (conflict: RefModImportConflict) => void
  onSubmit: () => void
  onClose: () => void
}) {
  const { t } = useI18n()
  return (
    <Modal open size="md" title={t({ ko: 'RefMod 묶음 가져오기', en: 'Import a RefMod bundle' })} onClose={() => { if (!busy) onClose() }}>
      <ModalBody spacing="sm">
        <Text variant="caption" className="truncate">{fileName}</Text>
        <SegmentedControl
          value={conflict}
          ariaLabel={t({ ko: '같은 이름이 있을 때', en: 'When the name exists' })}
          onChange={(value) => onConflictChange(value as RefModImportConflict)}
          items={[
            { value: 'skip', label: t({ ko: '같은 이름은 건너뛰기', en: 'Skip taken names' }) },
            { value: 'overwrite', label: t({ ko: '같은 이름은 덮어쓰기', en: 'Overwrite taken names' }) },
          ]}
        />
      </ModalBody>
      <EditorFooter onSave={onSubmit} saving={busy} saveLabel={t({ ko: '가져오기', en: 'Import' })} />
    </Modal>
  )
}
