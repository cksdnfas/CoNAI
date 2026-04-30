import { Folder, FolderOpen } from 'lucide-react'
import { HierarchyNav } from '@/components/common/hierarchy-nav'
import { getNavigationItemClassName } from '@/components/common/navigation-item'
import { useI18n } from '@/i18n'
import type { PromptGroupRecord } from '@/types/prompt'

interface PromptTreeProps {
  groups: PromptGroupRecord[]
  selectedGroupId?: number | null
  totalCount?: number
  onSelectGroup: (groupId?: number | null) => void
}

export function PromptTree({ groups, selectedGroupId, totalCount = 0, onSelectGroup }: PromptTreeProps) {
  const { formatNumber, t } = useI18n()

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => onSelectGroup(undefined)}
        className={getNavigationItemClassName({
          active: selectedGroupId == null,
          className: 'flex items-center justify-between',
        })}
      >
        <span>{t({ ko: '전체 프롬프트 ({count})', en: 'All prompts ({count})' }, { count: formatNumber(totalCount) })}</span>
      </button>

      <HierarchyNav
        items={groups}
        expandable
        selectedId={selectedGroupId}
        onSelect={(group) => onSelectGroup(group.id)}
        getId={(group) => group.id}
        getParentId={(group) => group.parent_id}
        getLabel={(group) => (
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="truncate">{group.group_name}</span>
            <span className="shrink-0 text-xs">{formatNumber(group.prompt_count ?? 0)}</span>
          </div>
        )}
        sortItems={(left, right) => left.display_order - right.display_order || left.group_name.localeCompare(right.group_name)}
        renderIcon={(group, state) => (state.hasChildren ? <FolderOpen className="h-4 w-4 shrink-0" /> : <Folder className="h-4 w-4 shrink-0" />)}
      />
    </div>
  )
}
