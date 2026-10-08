import { useState, type DragEvent, type KeyboardEvent } from 'react'
import { Check, ChevronRight, Download, Filter, FolderPlus, Inbox, MessageSquare, MoreHorizontal, Pencil, Plus, Search, SlidersHorizontal, Sparkles, Trash2 } from 'lucide-react'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { SidebarItem, SidebarNav } from '@/components/ui/sidebar'
import { useI18n } from '@/i18n'
import type { AudioGroup, AudioGroupFilter, AudioProject } from '@/lib/api-audio'
import { cn } from '@/lib/utils'
import { audioDragType, readAudioDrag } from './audio-candidate-list'

export type AudioSidebarFilter = Extract<AudioGroupFilter, 'unselected' | 'pending_comments'> | null

/** Sounds the generation tab saves land in this project (backend AUDIO_GENERATION_TAB_PROJECT_NAME). */
const GENERATION_TAB_PROJECT = '생성 탭'

/** Projects as a tree: each one opens onto its 받은 파일 (when it holds something) and its effects. */
export function AudioSidebar({
  projects,
  groupsByProject,
  expanded,
  onToggleProject,
  activeGroupId,
  onSelectGroup,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  canEdit,
  exporting,
  onEditProject,
  onExportProject,
  onDeleteProject,
  onCreateGroup,
  onDropCandidates,
  onDropFiles,
}: {
  projects: AudioProject[]
  groupsByProject: Record<string, AudioGroup[] | undefined>
  expanded: ReadonlySet<string>
  onToggleProject: (id: string) => void
  activeGroupId: string | null
  onSelectGroup: (group: AudioGroup) => void
  search: string
  onSearchChange: (value: string) => void
  filter: AudioSidebarFilter
  onFilterChange: (value: AudioSidebarFilter) => void
  canEdit: boolean
  exporting: boolean
  onEditProject: (project: AudioProject) => void
  onExportProject: (project: AudioProject) => void
  onDeleteProject: (project: AudioProject) => void
  /** Resolves true once the effect exists (the page opens it). */
  onCreateGroup: (projectId: string, name: string) => Promise<boolean>
  onDropCandidates: (group: AudioGroup, ids: string[]) => void
  onDropFiles: (target: { groupId: string } | { projectId: string }, files: File[]) => void
}) {
  const { t } = useI18n()
  const [adding, setAdding] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const searching = Boolean(search.trim()) || filter !== null
  const filters: Array<[AudioSidebarFilter, string]> = [[null, t({ ko: '전체', en: 'All' })], ['unselected', t({ ko: '채택 없는 효과음', en: 'No adopted take' })], ['pending_comments', t({ ko: '코멘트 대기', en: 'Open comments' })]]

  const startAdding = (projectId: string) => {
    setDraft('')
    setAdding(projectId)
    if (!expanded.has(projectId)) onToggleProject(projectId)
  }
  const submitDraft = async (projectId: string) => {
    const name = draft.trim()
    if (!name) {
      setAdding(null)
      return
    }
    if (await onCreateGroup(projectId, name)) setAdding(null)
  }
  const onDraftKey = (event: KeyboardEvent<HTMLInputElement>, projectId: string) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submitDraft(projectId)
    }
    if (event.key === 'Escape') setAdding(null)
  }

  /** Takes dragged from the list go to an effect of the same project; files go to the effect, or a project's 받은 파일. */
  const dropProps = (key: string, accepts: (event: DragEvent) => boolean, onDrop: (event: DragEvent) => void) => ({
    onDragOver: (event: DragEvent) => {
      if (!accepts(event)) return
      event.preventDefault()
      setDropTarget(key)
    },
    onDragLeave: () => setDropTarget((current) => (current === key ? null : current)),
    onDrop: (event: DragEvent) => {
      setDropTarget(null)
      if (!accepts(event)) return
      event.preventDefault()
      onDrop(event)
    },
  })
  const hasFiles = (event: DragEvent) => canEdit && event.dataTransfer.types.includes('Files')

  const visibleProjects = searching ? projects.filter((project) => (groupsByProject[project.id]?.length ?? 0) > 0) : projects

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input className="pl-8" type="search" placeholder={t({ ko: '효과음 검색', en: 'Search effects' })} value={search} onChange={(event) => onSearchChange(event.target.value)} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton variant="ghost" size="icon-sm" active={filter !== null} label={t({ ko: '필터', en: 'Filter' })}><Filter /></IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={filter ?? 'all'} onValueChange={(value) => onFilterChange(value === 'all' ? null : value as AudioSidebarFilter)}>
              {filters.map(([value, label]) => <DropdownMenuRadioItem key={value ?? 'all'} value={value ?? 'all'}>{label}</DropdownMenuRadioItem>)}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <SidebarNav aria-label={t({ ko: '프로젝트와 효과음', en: 'Projects and effects' })}>
        {visibleProjects.map((project) => {
          const open = searching || expanded.has(project.id)
          const groups = groupsByProject[project.id] ?? []
          const inbox = groups.find((group) => group.is_inbox)
          const effects = groups.filter((group) => !group.is_inbox)
          const showInbox = inbox && (inbox.candidate_count > 0 || inbox.id === activeGroupId)
          return (
            <div key={project.id} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-0.5">
                <SidebarItem
                  className={cn('min-w-0 flex-1 font-semibold text-foreground', dropTarget === `project:${project.id}` && 'bg-primary/10')}
                  icon={<ChevronRight className={cn('size-4 transition-transform', open && 'rotate-90')} />}
                  aria-expanded={open}
                  label={(
                    <span className="flex min-w-0 items-center gap-1.5">
                      {project.name === GENERATION_TAB_PROJECT ? <Sparkles className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
                      <span className="truncate">{project.name}</span>
                    </span>
                  )}
                  count={open ? undefined : project.candidate_count}
                  onClick={(event) => { event.preventDefault(); if (!searching) onToggleProject(project.id) }}
                  {...dropProps(`project:${project.id}`, hasFiles, (event) => onDropFiles({ projectId: project.id }, Array.from(event.dataTransfer.files)))}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton variant="ghost" size="icon-xs" label={t({ ko: '프로젝트 메뉴', en: 'Project menu' })}><MoreHorizontal /></IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canEdit ? <DropdownMenuItem onSelect={() => startAdding(project.id)}><Plus />{t({ ko: '효과음 추가', en: 'Add effect' })}</DropdownMenuItem> : null}
                    {canEdit ? <DropdownMenuItem onSelect={() => onEditProject(project)}><Pencil />{t({ ko: '프로젝트 수정', en: 'Edit project' })}</DropdownMenuItem> : null}
                    <DropdownMenuItem disabled={exporting} onSelect={() => onExportProject(project)}><Download />{t({ ko: '채택본 전체 내보내기', en: 'Export all adopted takes' })}</DropdownMenuItem>
                    {canEdit ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => onDeleteProject(project)}><Trash2 />{t({ ko: '프로젝트 삭제', en: 'Delete project' })}</DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {open ? (
                <>
                  {showInbox ? (
                    <SidebarItem
                      depth={1}
                      icon={Inbox}
                      active={inbox.id === activeGroupId}
                      className={cn(dropTarget === inbox.id && 'bg-primary/10')}
                      label={t({ ko: '받은 파일', en: 'Inbox' })}
                      count={inbox.candidate_count}
                      onClick={() => onSelectGroup(inbox)}
                      {...dropProps(inbox.id, hasFiles, (event) => onDropFiles({ groupId: inbox.id }, Array.from(event.dataTransfer.files)))}
                    />
                  ) : null}
                  {effects.map((group) => (
                    <SidebarItem
                      key={group.id}
                      depth={1}
                      active={group.id === activeGroupId}
                      className={cn(dropTarget === group.id && 'bg-primary/10')}
                      label={group.name}
                      title={group.label ?? undefined}
                      count={<EffectCounts group={group} />}
                      onClick={() => onSelectGroup(group)}
                      {...dropProps(
                        group.id,
                        (event) => hasFiles(event) || (canEdit && group.id !== activeGroupId && event.dataTransfer.types.includes(audioDragType(group.project_id))),
                        (event) => {
                          const ids = readAudioDrag(event, group.project_id)
                          if (ids.length > 0) onDropCandidates(group, ids)
                          else onDropFiles({ groupId: group.id }, Array.from(event.dataTransfer.files))
                        },
                      )}
                    />
                  ))}
                  {canEdit && adding === project.id ? (
                    <div className="py-0.5 pr-1 pl-[calc(0.625rem+1rem)]">
                      <Input
                        autoFocus
                        className="h-8"
                        maxLength={120}
                        placeholder={t({ ko: '효과음 이름', en: 'Effect name' })}
                        aria-label={t({ ko: '새 효과음 이름', en: 'New effect name' })}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => onDraftKey(event, project.id)}
                        onBlur={() => { if (!draft.trim()) setAdding(null) }}
                      />
                    </div>
                  ) : canEdit && !searching ? (
                    <SidebarItem depth={1} icon={Plus} className="text-muted-foreground/75" label={t({ ko: '효과음 추가', en: 'Add effect' })} onClick={() => startAdding(project.id)} />
                  ) : null}
                </>
              ) : null}
            </div>
          )
        })}
      </SidebarNav>
    </div>
  )
}

function EffectCounts({ group }: { group: AudioGroup }) {
  return (
    <span className="flex items-center gap-2">
      {group.pending_comment_count > 0 ? <span className="flex items-center gap-0.5 text-primary"><MessageSquare className="size-3" aria-hidden />{group.pending_comment_count}</span> : null}
      {group.selected_count > 0 ? <span className="flex items-center gap-0.5 text-success"><Check className="size-3" aria-hidden />{group.selected_count}</span> : null}
      <span>{group.candidate_count}</span>
    </span>
  )
}

/** Sidebar footer: new project and the audio settings. */
export function AudioSidebarFooter({ canEdit, onNewProject, onOpenSettings }: { canEdit: boolean; onNewProject: () => void; onOpenSettings: () => void }) {
  const { t } = useI18n()
  return (
    <>
      {canEdit ? <IconButton variant="ghost" size="icon-sm" label={t({ ko: '새 프로젝트', en: 'New project' })} onClick={onNewProject}><FolderPlus /></IconButton> : null}
      <IconButton variant="ghost" size="icon-sm" label={t({ ko: '오디오 설정', en: 'Audio settings' })} onClick={onOpenSettings}><SlidersHorizontal /></IconButton>
    </>
  )
}
