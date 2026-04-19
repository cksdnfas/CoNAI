import { Suspense, lazy } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import type { GraphWorkflowFolderRecord, GraphWorkflowRecord, ModuleDefinitionRecord } from '@/lib/api'

const WorkflowFolderSettingsPanelLazy = lazy(async () => {
  const module = await import('./workflow-folder-settings-panel')
  return { default: module.WorkflowFolderSettingsPanel }
})

const ModuleLibraryPanelLazy = lazy(async () => {
  const module = await import('./module-library-panel')
  return { default: module.ModuleLibraryPanel }
})

const CustomNodeManagementPanelLazy = lazy(async () => {
  const module = await import('./custom-node-management-panel')
  return { default: module.CustomNodeManagementPanel }
})

function WorkspaceModalFallback() {
  return <div className="min-h-[16rem] rounded-sm border border-border bg-surface-low animate-pulse" />
}

/** Render the browse/manage, folder-delete, and module-library modals for the module-graph page. */
export function ModuleGraphWorkspaceModals({
  workflowView,
  isBrowseManageModalOpen,
  browseManageModalTitle,
  graphWorkflowFolders,
  selectedGraphRecord,
  selectedFolderRecord,
  folderDeleteTarget,
  isModuleLibraryOpen,
  isCustomNodeManagerOpen,
  modules,
  modulesErrorMessage,
  modulesIsError,
  onCloseBrowseManage,
  onAssignWorkflowFolder,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onEditWorkflow,
  onDeleteWorkflow,
  onCloseFolderDelete,
  onConfirmDeleteFolder,
  onCloseModuleLibrary,
  onOpenCustomNodeManager,
  onCloseCustomNodeManager,
  onRefreshModules,
  onAddModule,
}: {
  workflowView: 'browse' | 'edit'
  isBrowseManageModalOpen: boolean
  browseManageModalTitle: string
  graphWorkflowFolders: GraphWorkflowFolderRecord[]
  selectedGraphRecord: GraphWorkflowRecord | null
  selectedFolderRecord: GraphWorkflowFolderRecord | null
  folderDeleteTarget: GraphWorkflowFolderRecord | null
  isModuleLibraryOpen: boolean
  isCustomNodeManagerOpen: boolean
  modules: ModuleDefinitionRecord[]
  modulesErrorMessage: string
  modulesIsError: boolean
  onCloseBrowseManage: () => void
  onAssignWorkflowFolder: (folderId: number | null) => void
  onCreateFolder: (input: { name: string; description?: string; parent_id?: number | null; assignToWorkflow?: boolean }) => void
  onUpdateFolder: (folderId: number, input: { name?: string; description?: string | null; parent_id?: number | null }) => void
  onDeleteFolder: (folderId: number) => void
  onEditWorkflow: () => void
  onDeleteWorkflow: () => Promise<void>
  onCloseFolderDelete: () => void
  onConfirmDeleteFolder: (mode: 'move_children' | 'delete_tree') => void
  onCloseModuleLibrary: () => void
  onOpenCustomNodeManager: () => void
  onCloseCustomNodeManager: () => void
  onRefreshModules: () => Promise<unknown> | void
  onAddModule: (module: ModuleDefinitionRecord) => void
}) {
  return (
    <>
      <SettingsModal
        open={workflowView === 'browse' && isBrowseManageModalOpen}
        title={browseManageModalTitle}
        onClose={onCloseBrowseManage}
        widthClassName="max-w-3xl"
        closeOnBack={false}
      >
        {workflowView === 'browse' && isBrowseManageModalOpen ? (
          <Suspense fallback={<WorkspaceModalFallback />}>
            <WorkflowFolderSettingsPanelLazy
              key={selectedGraphRecord ? `workflow-${selectedGraphRecord.id}` : selectedFolderRecord ? `folder-${selectedFolderRecord.id}` : 'root'}
              folders={graphWorkflowFolders}
              selectedFolder={selectedFolderRecord}
              selectedWorkflow={selectedGraphRecord}
              showHeader={false}
              onAssignWorkflowFolder={onAssignWorkflowFolder}
              onCreateFolder={onCreateFolder}
              onUpdateFolder={onUpdateFolder}
              onDeleteFolder={onDeleteFolder}
              onEditWorkflow={onEditWorkflow}
              onDeleteWorkflow={onDeleteWorkflow}
            />
          </Suspense>
        ) : null}
      </SettingsModal>

      <SettingsModal
        open={folderDeleteTarget !== null}
        title="폴더 삭제"
        onClose={onCloseFolderDelete}
        widthClassName="max-w-xl"
        closeOnBack={false}
      >
        <div className="space-y-4">
          <Alert>
            <AlertTitle>{folderDeleteTarget ? `"${folderDeleteTarget.name}" 폴더를 어떻게 삭제할지 골라줘.` : '폴더 삭제'}</AlertTitle>
            <AlertDescription>
              <div>원하는 정리 방식을 선택하면 돼.</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>폴더만 삭제: 하위 폴더와 워크플로우를 상위 폴더로 올림</li>
                <li>내용 포함 삭제: 하위 폴더와 그 안의 워크플로우까지 함께 삭제</li>
              </ul>
            </AlertDescription>
          </Alert>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onCloseFolderDelete}>
              취소
            </Button>
            <Button type="button" variant="outline" onClick={() => onConfirmDeleteFolder('move_children')}>
              폴더만 삭제
            </Button>
            <Button type="button" variant="destructive" onClick={() => onConfirmDeleteFolder('delete_tree')}>
              내용 포함 삭제
            </Button>
          </div>
        </div>
      </SettingsModal>

      <SettingsModal
        open={isModuleLibraryOpen}
        title="모듈 추가"
        description="사용자 모듈과 시스템 모듈을 나눠 보고, 필요한 항목을 바로 그래프에 추가해."
        onClose={onCloseModuleLibrary}
        widthClassName="max-w-6xl"
        closeOnBack={false}
      >
        {isModuleLibraryOpen ? (
          <Suspense fallback={<WorkspaceModalFallback />}>
            <ModuleLibraryPanelLazy
              modules={modules}
              isError={modulesIsError}
              errorMessage={modulesErrorMessage}
              onAddModule={onAddModule}
              onOpenCustomNodeManager={onOpenCustomNodeManager}
              surface="plain"
            />
          </Suspense>
        ) : null}
      </SettingsModal>

      <SettingsModal
        open={isCustomNodeManagerOpen}
        title="커스텀 노드 관리"
        description="user/custom_nodes 기반 로컬 커스텀 노드를 스캔, 생성, 테스트해."
        onClose={onCloseCustomNodeManager}
        widthClassName="max-w-6xl"
        closeOnBack={false}
      >
        {isCustomNodeManagerOpen ? (
          <Suspense fallback={<WorkspaceModalFallback />}>
            <CustomNodeManagementPanelLazy onModulesChanged={onRefreshModules} />
          </Suspense>
        ) : null}
      </SettingsModal>
    </>
  )
}
