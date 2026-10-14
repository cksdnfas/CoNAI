import { useEffect, useState } from 'react'
import type { SystemFolderRootId } from '@conai/shared'
import { useSearchParams } from 'react-router-dom'
import { FolderKanban, Plus } from 'lucide-react'
import { PageWithSidebar } from '@/components/common/page-with-sidebar'
import { PageToolbar } from '@/components/common/page-toolbar'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { LoadingState } from '@/components/ui/loading-state'
import { SidebarNav } from '@/components/ui/sidebar'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useI18n } from '@/i18n'
import { FileBrowser } from './file-browser'
import { StoreFolderSidebarGroup } from './store-folders'
import { SystemFolderSidebarGroup, type SystemFolderLocation } from './system-folder-browser'
import { WorkspaceBrowser } from './workspace-browser'
import { WorkspaceProjectDialog } from './workspace-dialogs'
import { useWorkspaceProjects, WorkspaceSidebarGroup } from './workspace-projects'

const SYSTEM_ROOTS: readonly SystemFolderRootId[] = ['recycle-bin', 'uploads', 'save', 'temp', 'logs']

/** `?view=workspaces` without a project: open the newest one, or offer to make the first. */
function WorkspaceLanding({ onProject, onCreate, onStore, onSystem }: { onProject: (id: string) => void; onCreate: (() => void) | undefined; onStore: (id: string | null) => void; onSystem: (location: SystemFolderLocation) => void }) {
  const { t } = useI18n()
  const auth = useAuthStatusQuery()
  const { projects, query } = useWorkspaceProjects()
  const first = projects[0]?.id
  useEffect(() => { if (first) onProject(first) }, [first, onProject])
  return (
    <PageWithSidebar
      storageKey="files"
      sidebarLabel={t({ ko: '파일 보관함', en: 'Files' })}
      sidebar={(
        <SidebarNav aria-label={t({ ko: '폴더', en: 'Folders' })}>
          <WorkspaceSidebarGroup activeId={null} onOpen={onProject} onCreate={onCreate} />
          <StoreFolderSidebarGroup activeId={undefined} onOpen={onStore} />
          {auth.data?.isAdmin ? <SystemFolderSidebarGroup active={null} onOpen={(root) => onSystem({ root, path: '' })} /> : null}
        </SidebarNav>
      )}
      toolbar={<PageToolbar sticky title={t({ ko: '작업 공간', en: 'Workspaces' })} />}
    >
      {query.isPending || first ? <LoadingState /> : (
        <EmptyState
          icon={FolderKanban}
          title={t({ ko: '아직 프로젝트가 없어', en: 'No projects yet' })}
          action={onCreate ? <Button onClick={onCreate}><Plus />{t({ ko: '새 프로젝트', en: 'New project' })}</Button> : undefined}
        />
      )}
    </PageWithSidebar>
  )
}

export function FilesPage() {
  const [params, setParams] = useSearchParams()
  const auth = useAuthStatusQuery()
  const canCreateProject = auth.data?.permissionKeys?.includes('files.edit') === true
  const [creating, setCreating] = useState(false)
  const openProject = (id: string) => setParams({ view: 'workspaces', workspace: id })
  const openStore = (folder: string | null) => setParams(folder ? { folder } : {})
  const openSystem = (location: SystemFolderLocation) => setParams(location.path ? { system: location.root, path: location.path } : { system: location.root })
  const createProject = canCreateProject ? () => setCreating(true) : undefined
  const projectDialog = (
    <WorkspaceProjectDialog open={creating} project={null} canEdit={canCreateProject} onClose={() => setCreating(false)} onSaved={(project) => { setCreating(false); openProject(project.id) }} />
  )

  if (params.get('view') === 'workspaces') {
    const workspace = params.get('workspace')
    return (
      <>
        {workspace ? (
          <WorkspaceBrowser
            key={workspace}
            projectId={workspace}
            dir={params.get('dir') ?? ''}
            onNavigate={(dir) => setParams(dir ? { view: 'workspaces', workspace, dir } : { view: 'workspaces', workspace })}
            onProject={openProject}
            onCreateProject={createProject}
            onStore={openStore}
            onSystem={openSystem}
          />
        ) : <WorkspaceLanding onProject={(id) => setParams({ view: 'workspaces', workspace: id }, { replace: true })} onCreate={createProject} onStore={openStore} onSystem={openSystem} />}
        {projectDialog}
      </>
    )
  }
  const parentId = params.get('folder') || null
  // `system` + `path`: a server folder (admins) instead of the store.
  const systemRoot = params.get('system')
  const system = systemRoot && SYSTEM_ROOTS.includes(systemRoot as SystemFolderRootId)
    ? { root: systemRoot as SystemFolderRootId, path: params.get('path') ?? '' }
    : null
  return (
    <>
      <FileBrowser
        key={system ? 'system' : `shared:${parentId ?? 'root'}`}
        parentId={parentId}
        workspaces={{ onOpen: openProject, onCreate: createProject }}
        onNavigate={openStore}
        system={system}
        onSystemNavigate={openSystem}
      />
      {projectDialog}
    </>
  )
}
