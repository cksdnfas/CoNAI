import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { getThemeToneStyle } from '@/lib/theme-tones'
import { cn } from '@/lib/utils'
import type { PromptGroupRecord, PromptTypeFilter } from '@/types/prompt'
import { PromptTree } from './prompt-tree'

interface PromptSidebarProps {
  promptType: PromptTypeFilter
  groups: PromptGroupRecord[]
  selectedGroupId?: number | null
  groupsLoading: boolean
  groupsError: string | null
  onChangeType: (nextType: PromptTypeFilter) => void
  onSelectGroup: (groupId?: number | null) => void
}

const PROMPT_TYPE_TABS = [
  ['positive', 'Positive'],
  ['negative', 'Negative'],
  ['auto', 'Auto'],
] as const satisfies readonly [PromptTypeFilter, string][]

export function PromptSidebar({
  promptType,
  groups,
  selectedGroupId,
  groupsLoading,
  groupsError,
  onChangeType,
  onSelectGroup,
}: PromptSidebarProps) {
  return (
    <aside className="rounded-sm bg-surface-lowest p-4 min-[800px]:sticky min-[800px]:top-24 min-[800px]:self-start">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">Explorer</h2>
        <Badge variant="outline">{groups.length}</Badge>
      </div>

      <div className="mb-4 flex gap-2 border-b border-white/5 pb-2 text-xs font-semibold">
        {PROMPT_TYPE_TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onChangeType(value)}
            className={cn(
              'rounded-sm px-2 py-1 transition-colors',
              promptType === value ? '' : 'text-muted-foreground hover:text-foreground',
            )}
            style={promptType === value ? getThemeToneStyle(value) : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {groupsLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-9 w-full rounded-sm" />
          ))}
        </div>
      ) : null}

      {groupsError ? (
        <Alert variant="destructive">
          <AlertTitle>그룹을 불러오지 못했어</AlertTitle>
          <AlertDescription>{groupsError}</AlertDescription>
        </Alert>
      ) : null}

      {!groupsLoading && !groupsError ? (
        <PromptTree groups={groups} selectedGroupId={selectedGroupId} onSelectGroup={onSelectGroup} />
      ) : null}
    </aside>
  )
}
