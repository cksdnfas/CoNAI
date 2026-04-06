import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import type { GraphWorkflowFolderRecord, GraphWorkflowRecord, ModuleDefinitionRecord } from '@/lib/api'
import { ModuleLibraryPanel } from './module-library-panel'
import { WorkflowFolderSettingsPanel } from './workflow-folder-settings-panel'

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
  onAddModule: (module: ModuleDefinitionRecord) => void
}) {
  return (
    <>
      <SettingsModal
        open={workflowView === 'browse' && isBrowseManageModalOpen}
        title={browseManageModalTitle}
        onClose={onCloseBrowseManage}
        widthClassName="max-w-3xl"
      >
        <WorkflowFolderSettingsPanel
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
      </SettingsModal>

      <SettingsModal
        open={folderDeleteTarget !== null}
        title="폴더 삭제"
        onClose={onCloseFolderDelete}
        widthClassName="max-w-xl"
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
      >
        <ModuleLibraryPanel
          modules={modules}
          isError={modulesIsError}
          errorMessage={modulesErrorMessage}
          onAddModule={onAddModule}
          surface="plain"
        />
      </SettingsModal>
    </>
  )
}
