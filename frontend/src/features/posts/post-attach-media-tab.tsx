import { useMemo, type Dispatch, type SetStateAction } from 'react'
import { Plus, X } from 'lucide-react'
import { MediaLibraryBrowser } from '@/components/media/media-library-browser'
import type { ActionMenuEntry } from '@/components/ui/action-menu'
import { useI18n } from '@/i18n'
import type { ImageRecord } from '@/types/image'
import type { GroupWithHierarchy } from '@/types/group'
import { attachKey, type AttachItem } from './post-attach-shared'

/** Post-specific ordering and whole-group insertion over the app's shared media browser. */
export function AttachMediaTab({ selected, setSelected }: { selected: AttachItem[]; setSelected: Dispatch<SetStateAction<AttachItem[]>> }) {
  const { t } = useI18n()
  const orderByKey = useMemo(() => new Map(selected.map((item, index) => [item.key, index + 1])), [selected])
  const selectedHashes = useMemo(() => selected.flatMap((item) => item.kind === 'media' ? [item.hash] : []), [selected])
  // Keep the order things were picked in: new ids go to the end, dropped ones leave.
  const changeSelection = (ids: string[], items: ImageRecord[]) => {
    const byHash = new Map(items.map((item) => [item.composite_hash, item]))
    const next = new Set(ids)
    setSelected((current) => {
      const kept = current.filter((item) => item.kind !== 'media' || next.has(item.hash))
      const have = new Set(kept.flatMap((item) => item.kind === 'media' ? [item.hash] : []))
      const added = ids.flatMap((hash): AttachItem[] => {
        const record = byHash.get(hash)
        return !have.has(hash) && record ? [{ kind: 'media', key: attachKey.media(hash), hash, mimeType: record.mime_type ?? null }] : []
      })
      return [...kept, ...added]
    })
  }
  const selectionOrder = new Map(selected.flatMap((item, index) => item.kind === 'media' ? [[item.hash, index + 1] as const] : []))

  const toggleGroup = (group: GroupWithHierarchy) => setSelected((current) => current.some((item) => item.key === attachKey.group(group.id))
    ? current.filter((item) => item.key !== attachKey.group(group.id))
    : [...current, { kind: 'group', key: attachKey.group(group.id), id: group.id, name: group.name }])
  const pickedGroupIds = new Set(selected.flatMap((item) => item.kind === 'group' ? [item.id] : []))
  const getGroupMenu = (group: GroupWithHierarchy): ActionMenuEntry[] => {
    const picked = orderByKey.has(attachKey.group(group.id))
    return [{ key: 'insert-group', icon: picked ? X : Plus, label: picked ? t({ ko: '그룹 빼기', en: 'Remove group' }) : t({ ko: '그룹째 넣기', en: 'Insert whole group' }), onSelect: () => toggleGroup(group) }]
  }
  return <MediaLibraryBrowser selectedIds={selectedHashes} onSelectedIdsChange={changeSelection} selectionOrder={selectionOrder} getGroupMenu={getGroupMenu} pickedGroupIds={pickedGroupIds} />
}
