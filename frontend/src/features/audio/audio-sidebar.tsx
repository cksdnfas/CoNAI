import { Download, FolderPlus, Inbox, Pencil, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { ToggleChip } from '@/components/ui/chip'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SidebarItem, SidebarNav } from '@/components/ui/sidebar'
import { useI18n } from '@/i18n'
import type { AudioGroup, AudioGroupFilter, AudioProject } from '@/lib/api-audio'

export type AudioSidebarFilter = Extract<AudioGroupFilter, 'unselected' | 'pending_comments'> | null

/** Project picker, group search and filters, and the group rows (받은 파일 first). */
export function AudioSidebar({
  projects,
  projectId,
  onProjectChange,
  groups,
  groupId,
  onGroupChange,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  canEdit,
  onNewGroup,
  onOpenSettings,
}: {
  projects: AudioProject[]
  projectId: string | null
  onProjectChange: (id: string) => void
  groups: AudioGroup[]
  groupId: string | null
  onGroupChange: (id: string) => void
  search: string
  onSearchChange: (value: string) => void
  filter: AudioSidebarFilter
  onFilterChange: (value: AudioSidebarFilter) => void
  canEdit: boolean
  onNewGroup: () => void
  onOpenSettings: () => void
}) {
  const { t } = useI18n()
  const filters: Array<[AudioSidebarFilter, string]> = [[null, t({ ko: '전체', en: 'All' })], ['unselected', t({ ko: '미채택', en: 'Unselected' })], ['pending_comments', t({ ko: '코멘트 대기', en: 'Open comments' })]]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <Select className="min-w-0 flex-1 font-semibold" aria-label={t({ ko: '프로젝트', en: 'Project' })} value={projectId ?? ''} disabled={projects.length === 0} onChange={(event) => onProjectChange(event.target.value)}>
          {projects.length === 0 ? <option value="">—</option> : null}
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </Select>
        {canEdit ? <IconButton variant="ghost" size="icon-sm" label={t({ ko: '새 그룹', en: 'New group' })} disabled={!projectId} onClick={onNewGroup}><Plus /></IconButton> : null}
        <IconButton variant="ghost" size="icon-sm" label={t({ ko: '음향 설정', en: 'Audio settings' })} onClick={onOpenSettings}><SlidersHorizontal /></IconButton>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input className="pl-8" type="search" placeholder={t({ ko: '그룹 검색', en: 'Search groups' })} value={search} onChange={(event) => onSearchChange(event.target.value)} />
      </div>
      <div className="flex flex-wrap gap-1">
        {filters.map(([value, label]) => (
          <ToggleChip key={value ?? 'all'} size="sm" pressed={filter === value} onClick={() => onFilterChange(value)}>{label}</ToggleChip>
        ))}
      </div>
      <SidebarNav aria-label={t({ ko: '그룹', en: 'Groups' })}>
        {groups.map((group) => (
          <SidebarItem
            key={group.id}
            active={group.id === groupId}
            className="min-h-11 py-1"
            icon={group.is_inbox ? Inbox : undefined}
            onClick={() => onGroupChange(group.id)}
            label={(
              <>
                <span className="block truncate">{group.is_inbox ? t({ ko: '받은 파일', en: 'Inbox' }) : group.name}</span>
                {!group.is_inbox && group.label ? <span className="block truncate font-mono text-2xs text-muted-foreground/75">{group.label}</span> : null}
              </>
            )}
            count={(
              <span className="flex flex-col items-end leading-tight">
                <span>{group.candidate_count}</span>
                {group.pending_comment_count > 0
                  ? <span className="text-2xs text-primary">{t({ ko: '코멘트 {count}', en: '{count} comments' }, { count: group.pending_comment_count })}</span>
                  : group.selected_count > 0 ? <span className="text-2xs font-semibold text-success">{t({ ko: '{count} 채택', en: '{count} adopted' }, { count: group.selected_count })}</span> : null}
              </span>
            )}
          />
        ))}
      </SidebarNav>
    </div>
  )
}

/** Sidebar footer: project create / edit and the whole-project export. */
export function AudioSidebarFooter({ project, canEdit, exporting, onNewProject, onEditProject, onExportProject }: {
  project: AudioProject | null
  canEdit: boolean
  exporting: boolean
  onNewProject: () => void
  onEditProject: () => void
  onExportProject: () => void
}) {
  const { t } = useI18n()
  return (
    <>
      {canEdit ? <IconButton variant="ghost" size="icon-sm" label={t({ ko: '새 프로젝트', en: 'New project' })} onClick={onNewProject}><FolderPlus /></IconButton> : null}
      {canEdit && project ? <IconButton variant="ghost" size="icon-sm" label={t({ ko: '프로젝트 수정', en: 'Edit project' })} onClick={onEditProject}><Pencil /></IconButton> : null}
      {project ? <IconButton variant="ghost" size="icon-sm" label={t({ ko: '프로젝트 채택본 내보내기', en: 'Export project selections' })} disabled={exporting} onClick={onExportProject}><Download /></IconButton> : null}
    </>
  )
}
