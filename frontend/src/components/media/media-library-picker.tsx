import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FieldInfo } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { getImageListDisplayName } from '@/features/images/components/image-list/image-list-utils'
import { useI18n } from '@/i18n'
import { MediaLibraryBrowser, type MediaLibraryKind } from './media-library-browser'

export interface MediaLibrarySelection {
  compositeHash: string
  name: string
  mimeType: string | null
}

export interface MediaLibraryPickerProps {
  initial: MediaLibrarySelection[]
  maxCount: number
  onPick: (items: MediaLibrarySelection[]) => void
  onClose: () => void
  title?: string
  applyLabel?: string
  note?: string | null
  initialGroupPath?: string
  /** Opens at this group (wins over `initialGroupPath`). */
  initialGroupId?: number
  mediaKind?: MediaLibraryKind
  /** Chat can apply an empty selection to remove its existing attachments. */
  allowEmpty?: boolean
}

/** Modal wrapper for callers that select library references rather than embedding the browser. */
export function MediaLibraryPicker({ initial, maxCount, onPick, onClose, title, applyLabel, note, initialGroupPath, initialGroupId, mediaKind = 'all', allowEmpty = false }: MediaLibraryPickerProps) {
  const { t } = useI18n()
  const { canViewImages } = useImagePermissions()
  const [selected, setSelected] = useState(() => new Map(initial.map((item) => [item.compositeHash, item])))

  return <Modal open title={title ?? t({ ko: '앱 미디어에서 고르기', en: 'Choose app media' })} onClose={onClose} size="wide" height="tall">
    <MediaLibraryBrowser
      selectedIds={[...selected.keys()]}
      maxCount={maxCount}
      mediaKind={mediaKind}
      initialGroupPath={initialGroupPath}
      initialGroupId={initialGroupId}
      onSelectedIdsChange={(ids, items) => {
        const available = new Map(selected)
        for (const item of items) {
          if (item.composite_hash) available.set(item.composite_hash, { compositeHash: item.composite_hash, name: getImageListDisplayName(item), mimeType: item.mime_type ?? null })
        }
        setSelected(new Map(ids.flatMap((id) => available.has(id) ? [[id, available.get(id)!] as const] : [])))
      }}
    />
    <ModalFooter>
      <span className="mr-auto flex items-center gap-1 text-sm text-muted-foreground">
        {t({ ko: '{count}개 선택', en: '{count} selected' }, { count: selected.size })}
        {note ? <FieldInfo>{note}</FieldInfo> : null}
      </span>
      <IconButton variant="ghost" disabled={!selected.size} label={t({ ko: '선택 해제', en: 'Clear selection' })} onClick={() => setSelected(new Map())}><X /></IconButton>
      <Button disabled={!canViewImages || selected.size > maxCount || (!allowEmpty && !selected.size)} onClick={() => onPick([...selected.values()])}>{applyLabel ?? t({ ko: '선택', en: 'Select' })}</Button>
    </ModalFooter>
  </Modal>
}
