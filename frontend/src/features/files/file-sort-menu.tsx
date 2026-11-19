import { ArrowUpDown } from 'lucide-react'
import type { FileStoreSortKey } from '@conai/shared'
import { ActionMenuButton } from '@/components/ui/action-menu'
import { useI18n } from '@/i18n'
import type { FileSort } from './file-view-mode'

/** The icon grid's way to choose the order (the detail list sorts from its column headers). */
export function FileSortMenu({ value, keys, onChange }: { value: FileSort; keys: readonly FileStoreSortKey[]; onChange: (next: FileSort) => void }) {
  const { t } = useI18n()
  const labels: Record<FileStoreSortKey, string> = {
    name: t({ ko: '이름', en: 'Name' }),
    modified: t({ ko: '수정일', en: 'Modified' }),
    size: t({ ko: '크기', en: 'Size' }),
  }
  return (
    <ActionMenuButton
      size="icon-sm"
      icon={ArrowUpDown}
      label={t({ ko: '정렬', en: 'Sort' })}
      entries={[
        ...keys.map((sort) => ({ key: sort, label: labels[sort], checked: value.sort === sort, onSelect: () => onChange({ ...value, sort }) })),
        '-',
        { key: 'asc', label: t({ ko: '오름차순', en: 'Ascending' }), checked: value.direction === 'asc', onSelect: () => onChange({ ...value, direction: 'asc' }) },
        { key: 'desc', label: t({ ko: '내림차순', en: 'Descending' }), checked: value.direction === 'desc', onSelect: () => onChange({ ...value, direction: 'desc' }) },
      ]}
    />
  )
}
