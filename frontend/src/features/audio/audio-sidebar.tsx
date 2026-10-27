import { useState, type DragEvent, type KeyboardEvent } from 'react'
import {
  AudioWaveform,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Filter,
  Folder,
  FolderOpen,
  FolderPlus,
  Inbox,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  Wand,
} from 'lucide-react'
import { SearchField } from '@/components/common/search-field'
import { ActionContextMenu } from '@/components/ui/action-menu'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { ErrorState } from '@/components/ui/error-state'
import { SidebarGroupLabel, SidebarItem, SidebarNav } from '@/components/ui/sidebar'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import type { AudioFolder, AudioGroup, AudioGroupFilter, AudioProject } from '@/lib/api-audio'
import { cn } from '@/lib/utils'
import { audioDragType, readAudioDrag } from './audio-candidate-list'

export type AudioSidebarFilter = Extract<AudioGroupFilter, 'unselected' | 'pending_comments'> | null

/** Sounds the generation tab saves land in this project (backend AUDIO_GENERATION_TAB_PROJECT_NAME). */
const GENERATION_TAB_PROJECT = '생성 탭'

/** An effect dragged within the tree (to sort it into a folder); its payload is the effect id. */
const EFFECT_DRAG_TYPE = 'application/x-conai-audio-effect'

type Draft = { kind: 'effect'; folderId: string | null } | { kind: 'folder' } | { kind: 'rename'; folderId: string }

/**
 * The open project (picked from a dropdown) as a tree: its 받은 파일 (when it holds something), its folders (그룹) with
 * their effects, then the effects outside any folder. A search or filter lists matching effects of every project.
 */
export function AudioSidebar({
  projects,
  hasMoreProjects,
  loadingProjects,
  onMoreProjects,
  project,
  onSelectProject,
  groups,
  folders,
  searchResults,
  hasMoreGroups,
  loadingGroups,
  onMoreGroups,
  listError,
  onRetryGroups,
  expandedFolders,
  onToggleFolder,
  activeGroupId,
  onSelectGroup,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  canEdit,
  exporting,
  onNewProject,
  onEditProject,
  onExportProject,
  onDeleteProject,
  onCreateGroup,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveGroup,
  onDropCandidates,
  onDropFiles,
}: {
  projects: AudioProject[]
  hasMoreProjects: boolean
  loadingProjects: boolean
  onMoreProjects: () => void
  project: AudioProject | null
  onSelectProject: (id: string) => void
  /** Loaded pages of the open project, 받은 파일 included. */
  groups: AudioGroup[]
  folders: AudioFolder[]
  /** Matching effects by project while searching or filtering; null otherwise. */
  searchResults: Record<string, AudioGroup[] | undefined> | null
  hasMoreGroups: boolean
  loadingGroups: boolean
  onMoreGroups: () => void
  listError: Error | null
  onRetryGroups: () => void
  expandedFolders: ReadonlySet<string>
  onToggleFolder: (id: string, open?: boolean) => void
  activeGroupId: string | null
  onSelectGroup: (group: AudioGroup) => void
  search: string
  onSearchChange: (value: string) => void
  filter: AudioSidebarFilter
  onFilterChange: (value: AudioSidebarFilter) => void
  canEdit: boolean
  exporting: boolean
  onNewProject: () => void
  onEditProject: (project: AudioProject) => void
  onExportProject: (project: AudioProject) => void
  onDeleteProject: (project: AudioProject) => void
  /** Resolves true once the effect exists (the page opens it). */
  onCreateGroup: (projectId: string, name: string, folderId: string | null) => Promise<boolean>
  onCreateFolder: (projectId: string, name: string) => Promise<boolean>
  onRenameFolder: (folder: AudioFolder, name: string) => Promise<boolean>
  onDeleteFolder: (folder: AudioFolder) => void
  onMoveGroup: (group: AudioGroup, folderId: string | null) => void
  onDropCandidates: (group: AudioGroup, ids: string[]) => void
  onDropFiles: (target: { groupId: string } | { projectId: string }, files: File[]) => void
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [text, setText] = useState('')
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const filters: Array<[AudioSidebarFilter, string]> = [[null, t({ ko: '전체', en: 'All' })], ['unselected', t({ ko: '채택 없는 효과음', en: 'No adopted take' })], ['pending_comments', t({ ko: '코멘트 대기', en: 'Open comments' })]]

  const startDraft = (next: Draft, initial = '') => {
    setText(initial)
    setDraft(next)
    if (next.kind === 'effect' && next.folderId) onToggleFolder(next.folderId, true)
  }
  const submitDraft = async () => {
    const name = text.trim()
    if (!draft || !project) return
    if (!name) {
      setDraft(null)
      return
    }
    const done = draft.kind === 'effect' ? await onCreateGroup(project.id, name, draft.folderId)
      : draft.kind === 'folder' ? await onCreateFolder(project.id, name)
      : await (async () => {
        const folder = folders.find((entry) => entry.id === draft.folderId)
        return !folder || folder.name === name || onRenameFolder(folder, name)
      })()
    if (done) setDraft(null)
  }
  const onDraftKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submitDraft()
    }
    if (event.key === 'Escape') setDraft(null)
  }
  const draftInput = (depth: number, placeholder: string) => (
    <div className="py-0.5 pr-1" style={{ paddingLeft: `calc(0.625rem + ${depth} * 1rem)` }}>
      <Input
        autoFocus
        className="h-8"
        maxLength={120}
        placeholder={placeholder}
        aria-label={placeholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onDraftKey}
        onBlur={() => { if (!text.trim()) setDraft(null) }}
      />
    </div>
  )

  /** Takes dragged from the list go to an effect of the same project; files go to the effect, or the project's 받은 파일. */
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
  const hasEffect = (event: DragEvent) => canEdit && event.dataTransfer.types.includes(EFFECT_DRAG_TYPE)
  const draggedEffect = (event: DragEvent) => groups.find((entry) => entry.id === event.dataTransfer.getData(EFFECT_DRAG_TYPE)) ?? null
  /** Sort the dragged effect into a folder (null = out of any folder). */
  const moveDragged = (event: DragEvent, folderId: string | null) => {
    const dragged = draggedEffect(event)
    if (dragged && dragged.folder_id !== folderId) onMoveGroup(dragged, folderId)
  }

  const effectRow = (group: AudioGroup, depth: number, sortable: boolean) => {
    const tip = [group.description, group.label ? t({ ko: '내보낼 파일명: {label}', en: 'Export file name: {label}' }, { label: group.label }) : ''].filter(Boolean).join('\n')
    return (
      <Tip key={group.id} content={tip || null} side="right" className="max-w-72 whitespace-pre-line">
        <SidebarItem
          depth={depth}
          icon={<AudioWaveform className="size-3.5 text-muted-foreground/75" />}
          active={group.id === activeGroupId}
          data-drop-target={dropTarget === group.id ? 'true' : undefined}
          label={group.name}
          count={<EffectCounts group={group} />}
          onClick={() => onSelectGroup(group)}
          draggable={sortable && canEdit}
          onDragStart={sortable && canEdit ? (event) => {
            event.dataTransfer.setData(EFFECT_DRAG_TYPE, group.id)
            event.dataTransfer.effectAllowed = 'move'
          } : undefined}
          {...dropProps(
            group.id,
            (event) => hasFiles(event) || (sortable && hasEffect(event)) || (canEdit && group.id !== activeGroupId && event.dataTransfer.types.includes(audioDragType(group.project_id))),
            (event) => {
              if (event.dataTransfer.types.includes(EFFECT_DRAG_TYPE)) return moveDragged(event, group.folder_id)
              const ids = readAudioDrag(event, group.project_id)
              if (ids.length > 0) onDropCandidates(group, ids)
              else onDropFiles({ groupId: group.id }, Array.from(event.dataTransfer.files))
            },
          )}
        />
      </Tip>
    )
  }

  const inbox = groups.find((group) => group.is_inbox)
  const effects = groups.filter((group) => !group.is_inbox)
  const showInbox = inbox && (inbox.candidate_count > 0 || inbox.id === activeGroupId)
  const folderIds = new Set(folders.map((folder) => folder.id))
  const loose = effects.filter((group) => !group.folder_id || !folderIds.has(group.folder_id))

  return (
    <div className="flex flex-col gap-3">
      {project ? (
        <div className="flex items-center gap-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="nav"
                size="lg"
                aria-label={t({ ko: '프로젝트', en: 'Project' })}
                className="min-w-0 flex-1 justify-start text-left"
                data-drop-target={dropTarget === 'project' ? 'true' : undefined}
                {...dropProps('project', hasFiles, (event) => onDropFiles({ projectId: project.id }, Array.from(event.dataTransfer.files)))}
              >
                {project.name === GENERATION_TAB_PROJECT ? <Wand className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : null}
                <span className="min-w-0 flex-1 truncate">{project.name}</span>
                <span className="shrink-0 text-xs font-normal text-muted-foreground/75 tabular-nums">{project.candidate_count}</span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
              <DropdownMenuRadioGroup value={project.id} onValueChange={onSelectProject}>
                {projects.map((entry) => (
                  <DropdownMenuRadioItem key={entry.id} value={entry.id}>
                    {entry.name === GENERATION_TAB_PROJECT ? <Wand className="size-3.5 text-muted-foreground" aria-hidden /> : null}
                    <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                    <span className="ml-3 text-xs text-muted-foreground/75 tabular-nums">{entry.candidate_count}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {hasMoreProjects ? (
                <DropdownMenuItem disabled={loadingProjects} onSelect={(event) => { event.preventDefault(); onMoreProjects() }}>
                  {t({ ko: '프로젝트 더 불러오기', en: 'Load more projects' })}
                </DropdownMenuItem>
              ) : null}
              {canEdit ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onNewProject}><FolderPlus />{t({ ko: '새 프로젝트', en: 'New project' })}</DropdownMenuItem>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton variant="ghost" size="icon-sm" label={t({ ko: '프로젝트 메뉴', en: 'Project menu' })}><MoreHorizontal /></IconButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canEdit ? <DropdownMenuItem onSelect={() => startDraft({ kind: 'effect', folderId: null })}><Plus />{t({ ko: '효과음 추가', en: 'Add effect' })}</DropdownMenuItem> : null}
              {canEdit ? <DropdownMenuItem onSelect={() => startDraft({ kind: 'folder' })}><FolderPlus />{t({ ko: '그룹 추가', en: 'Add group' })}</DropdownMenuItem> : null}
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
      ) : null}
      <div className="flex items-center gap-1">
        <SearchField className="flex-1" placeholder={t({ ko: '효과음 검색', en: 'Search effects' })} value={search} onChange={onSearchChange} />
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
      <SidebarNav aria-label={t({ ko: '그룹과 효과음', en: 'Groups and effects' })}>
        {searchResults ? (
          Object.entries(searchResults).map(([id, entries]) => {
            const found = (entries ?? []).filter((group) => !group.is_inbox)
            if (found.length === 0) return null
            return (
              <div key={id} className="flex flex-col gap-0.5">
                <SidebarGroupLabel>{projects.find((entry) => entry.id === id)?.name ?? found[0].project_name}</SidebarGroupLabel>
                {found.map((group) => effectRow(group, 0, false))}
              </div>
            )
          })
        ) : (
          <>
            {showInbox ? (
              <SidebarItem
                icon={Inbox}
                active={inbox.id === activeGroupId}
                data-drop-target={dropTarget === inbox.id ? 'true' : undefined}
                label={t({ ko: '받은 파일', en: 'Inbox' })}
                count={inbox.candidate_count}
                onClick={() => onSelectGroup(inbox)}
                {...dropProps(inbox.id, hasFiles, (event) => onDropFiles({ groupId: inbox.id }, Array.from(event.dataTransfer.files)))}
              />
            ) : null}
            {canEdit && draft?.kind === 'folder' ? draftInput(0, t({ ko: '그룹 이름', en: 'Group name' })) : null}
            {folders.map((folder) => {
              const open = expandedFolders.has(folder.id)
              const inside = effects.filter((group) => group.folder_id === folder.id)
              if (draft?.kind === 'rename' && draft.folderId === folder.id) return <div key={folder.id}>{draftInput(0, t({ ko: '그룹 이름', en: 'Group name' }))}</div>
              return (
                <div key={folder.id} className="flex flex-col gap-0.5">
                  <ActionContextMenu
                    disabled={!canEdit}
                    entries={[
                      { key: 'add', icon: Plus, label: t({ ko: '효과음 추가', en: 'Add effect' }), onSelect: () => startDraft({ kind: 'effect', folderId: folder.id }) },
                      { key: 'rename', icon: Pencil, label: t({ ko: '이름 바꾸기', en: 'Rename' }), onSelect: () => startDraft({ kind: 'rename', folderId: folder.id }, folder.name) },
                      '-',
                      { key: 'delete', icon: Trash2, label: t({ ko: '그룹 삭제', en: 'Delete group' }), destructive: true, onSelect: () => onDeleteFolder(folder) },
                    ]}
                  >
                    <SidebarItem
                      data-drop-target={dropTarget === `folder:${folder.id}` ? 'true' : undefined}
                      icon={<ChevronRight className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-90')} />}
                      aria-expanded={open}
                      label={(
                        <span className="flex min-w-0 items-center gap-1.5">
                          {open ? <FolderOpen className="size-3.5 shrink-0 text-warning" aria-hidden /> : <Folder className="size-3.5 shrink-0 text-warning" aria-hidden />}
                          <span className="truncate">{folder.name}</span>
                        </span>
                      )}
                      count={folder.group_count}
                      onClick={(event) => { event.preventDefault(); onToggleFolder(folder.id) }}
                      {...dropProps(`folder:${folder.id}`, hasEffect, (event) => {
                        moveDragged(event, folder.id)
                        onToggleFolder(folder.id, true)
                      })}
                    />
                  </ActionContextMenu>
                  {open ? (
                    <>
                      {inside.map((group) => effectRow(group, 1, true))}
                      {canEdit && draft?.kind === 'effect' && draft.folderId === folder.id ? draftInput(1, t({ ko: '효과음 이름', en: 'Effect name' })) : null}
                    </>
                  ) : null}
                </div>
              )
            })}
            {loose.map((group) => effectRow(group, 0, true))}
            {canEdit && draft?.kind === 'effect' && draft.folderId === null ? draftInput(0, t({ ko: '효과음 이름', en: 'Effect name' })) : null}
            {canEdit && project && !(draft?.kind === 'effect' && draft.folderId === null) ? (
              <div className="flex items-center gap-0.5">
                <SidebarItem
                  icon={Plus}
                  className="min-w-0 flex-1"
                  data-drop-target={dropTarget === 'loose' ? 'true' : undefined}
                  label={t({ ko: '효과음 추가', en: 'Add effect' })}
                  onClick={() => startDraft({ kind: 'effect', folderId: null })}
                  {...dropProps('loose', hasEffect, (event) => moveDragged(event, null))}
                />
                <IconButton variant="ghost" size="icon-xs" label={t({ ko: '그룹 추가', en: 'Add group' })} onClick={() => startDraft({ kind: 'folder' })}><FolderPlus /></IconButton>
              </div>
            ) : null}
          </>
        )}
      </SidebarNav>
      {listError ? <ErrorState error={listError} onRetry={onRetryGroups} isRetrying={loadingGroups} /> : null}
      {hasMoreGroups ? (
        <Button variant="ghost" size="sm" disabled={loadingGroups} onClick={onMoreGroups}>
          {t({ ko: '효과음 더 불러오기', en: 'Load more effects' })}
        </Button>
      ) : null}
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
