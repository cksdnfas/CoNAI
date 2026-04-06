import { ArrowLeft, FolderPlus, PenSquare, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GraphWorkflowFolderRecord, GraphWorkflowRecord, ModuleDefinitionRecord } from '@/lib/api'
import { SavedGraphList } from './saved-graph-list'

/** Render the saved-workflow sidebar and its browse/editor toolbar actions. */
export function ModuleGraphWorkflowListSidebar({
  graphs,
  folders,
  selectedGraphId,
  selectedFolderId,
  moduleDefinitionById,
  workflowView,
  selectedGraphRecord,
  selectedFolderRecord,
  browseManageModalTitle,
  onLoadGraph,
  onSelectFolder,
  onLeaveEditor,
  onRefreshWorkspace,
  onOpenBrowseManage,
  onCreateWorkflow,
  onEditWorkflow,
  onDeleteWorkflow,
  onDeleteFolder,
}: {
  graphs: GraphWorkflowRecord[]
  folders: GraphWorkflowFolderRecord[]
  selectedGraphId: number | null
  selectedFolderId: number | null
  moduleDefinitionById: Map<number, ModuleDefinitionRecord>
  workflowView: 'browse' | 'edit'
  selectedGraphRecord: GraphWorkflowRecord | null
  selectedFolderRecord: GraphWorkflowFolderRecord | null
  browseManageModalTitle: string
  onLoadGraph: (graph: GraphWorkflowRecord) => void
  onSelectFolder: (folderId: number | null) => void
  onLeaveEditor: () => void
  onRefreshWorkspace: () => void
  onOpenBrowseManage: () => void
  onCreateWorkflow: () => void
  onEditWorkflow: () => void
  onDeleteWorkflow: () => void
  onDeleteFolder: (folderId: number) => void
}) {
  return (
    <SavedGraphList
      graphs={graphs}
      folders={folders}
      selectedGraphId={selectedGraphId}
      selectedFolderId={selectedFolderId}
      moduleDefinitionById={moduleDefinitionById}
      onLoadGraph={onLoadGraph}
      onSelectFolder={onSelectFolder}
      floatingActionContainerClassName={workflowView === 'edit' ? 'bottom-24' : undefined}
      leftToolbar={
        workflowView === 'edit' ? (
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className="bg-surface-low"
            onClick={onLeaveEditor}
            aria-label="목록으로"
            title="목록으로"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        ) : null
      }
      rightToolbar={(
        <>
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className="bg-surface-low"
            onClick={onRefreshWorkspace}
            aria-label="새로고침"
            title="새로고침"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          {workflowView === 'browse' && !selectedGraphRecord ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="bg-surface-low"
              onClick={onOpenBrowseManage}
              aria-label={browseManageModalTitle}
              title={browseManageModalTitle}
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className="bg-surface-low"
            onClick={onCreateWorkflow}
            aria-label="새 워크플로우"
            title="새 워크플로우"
          >
            <Plus className="h-4 w-4" />
          </Button>
          {workflowView === 'browse' && selectedGraphRecord ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="bg-surface-low"
              onClick={onEditWorkflow}
              aria-label="워크플로우 편집"
              title="워크플로우 편집"
            >
              <PenSquare className="h-4 w-4" />
            </Button>
          ) : null}
          {workflowView === 'browse' && selectedGraphRecord ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="bg-surface-low"
              onClick={onDeleteWorkflow}
              aria-label="워크플로우 삭제"
              title="워크플로우 삭제"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
          {workflowView === 'browse' && !selectedGraphRecord && selectedFolderRecord ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="bg-surface-low"
              onClick={() => onDeleteFolder(selectedFolderRecord.id)}
              aria-label="폴더 삭제"
              title="폴더 삭제"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </>
      )}
    />
  )
}
