import { Suspense, lazy } from 'react'
import { Button } from '@/components/ui/button'
import { Modal, ModalFooter } from '@/components/ui/modal'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import type { GraphWorkflowFolderRecord, GraphWorkflowRecord } from '@/lib/api-module-graph'

const WorkflowFolderSettingsPanelLazy = lazy(async () => {
  const module = await import('./workflow-folder-settings-panel')
  return { default: module.WorkflowFolderSettingsPanel }
})

const CustomNodeManagementPanelLazy = lazy(async () => {
  const module = await import('./custom-node-management-panel')
  return { default: module.CustomNodeManagementPanel }
})

function WorkspaceModalFallback() {
  return <div className="min-h-[16rem] animate-pulse rounded-sm bg-fill" />
}

/** Render the browse/manage, folder-delete and custom-node modals for the module-graph page. */
export function ModuleGraphWorkspaceModals({
  workflowView,
  isBrowseManageModalOpen,
  browseManageModalTitle,
  graphWorkflowFolders,
  selectedGraphRecord,
  selectedFolderRecord,
  folderDeleteTarget,
  isCustomNodeManagerOpen,
  onCloseBrowseManage,
  onAssignWorkflowFolder,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onEditWorkflow,
  onDeleteWorkflow,
  onCloseFolderDelete,
  onConfirmDeleteFolder,
  onCloseCustomNodeManager,
  onRefreshModules,
}: {
  workflowView: 'browse' | 'edit'
  isBrowseManageModalOpen: boolean
  browseManageModalTitle: string
  graphWorkflowFolders: GraphWorkflowFolderRecord[]
  selectedGraphRecord: GraphWorkflowRecord | null
  selectedFolderRecord: GraphWorkflowFolderRecord | null
  folderDeleteTarget: GraphWorkflowFolderRecord | null
  isCustomNodeManagerOpen: boolean
  onCloseBrowseManage: () => void
  onAssignWorkflowFolder: (folderId: number | null) => void
  onCreateFolder: (input: { name: string; description?: string; parent_id?: number | null; assignToWorkflow?: boolean }) => void
  onUpdateFolder: (folderId: number, input: { name?: string; description?: string | null; parent_id?: number | null }) => void
  onDeleteFolder: (folderId: number) => void
  onEditWorkflow: () => void
  onDeleteWorkflow: () => Promise<void>
  onCloseFolderDelete: () => void
  onConfirmDeleteFolder: (mode: 'move_children' | 'delete_tree') => void
  onCloseCustomNodeManager: () => void
  onRefreshModules: () => Promise<unknown> | void
}) {
  const { t } = useI18n()

  return (
    <>
      <Modal
        open={workflowView === 'browse' && isBrowseManageModalOpen}
        title={browseManageModalTitle}
        onClose={onCloseBrowseManage}
        size="normal"
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
      </Modal>

      <Modal
        open={folderDeleteTarget !== null}
        title={t({ ko: '폴더 삭제', en: 'Delete folder' })}
        onClose={onCloseFolderDelete}
        size="narrow"
      >
        <p className="text-sm text-foreground">
          {folderDeleteTarget ? t({ ko: '"{name}" 폴더를 어떻게 삭제할지 골라줘.', en: 'Choose how to delete the "{name}" folder.' }, { name: folderDeleteTarget.name }) : null}
        </p>
        <ModalFooter className="mt-4 border-t border-line pt-3">
          <Tip content={t({ ko: '안의 항목은 상위 폴더로 옮겨', en: 'Contents move up a level' })}>
            <Button type="button" variant="secondary" onClick={() => onConfirmDeleteFolder('move_children')}>
              {t({ ko: '폴더만 삭제', en: 'Delete folder only' })}
            </Button>
          </Tip>
          <Tip content={t({ ko: '안의 폴더·워크플로우까지 지워', en: 'Child folders and workflows go too' })}>
            <Button type="button" variant="destructive" onClick={() => onConfirmDeleteFolder('delete_tree')}>
              {t({ ko: '내용 포함 삭제', en: 'Delete with contents' })}
            </Button>
          </Tip>
        </ModalFooter>
      </Modal>

      <Modal
        open={isCustomNodeManagerOpen}
        title={t({ ko: '커스텀 노드 관리', en: 'Manage custom nodes' })}
        onClose={onCloseCustomNodeManager}
        size="wide"
        height="tall"
      >
        {isCustomNodeManagerOpen ? (
          <Suspense fallback={<WorkspaceModalFallback />}>
            <CustomNodeManagementPanelLazy onModulesChanged={onRefreshModules} />
          </Suspense>
        ) : null}
      </Modal>
    </>
  )
}
