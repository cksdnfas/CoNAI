import { ArrowLeft, Copy, FolderPlus, PenSquare, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import type { GraphWorkflowFolderRecord, GraphWorkflowRecord, ModuleDefinitionRecord } from '@/lib/api-module-graph'
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
  onDuplicateWorkflow,
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
  onDuplicateWorkflow: () => void
  onEditWorkflow: () => void
  onDeleteWorkflow: () => void
  onDeleteFolder: (folderId: number) => void
}) {
  const { t } = useI18n()

  return (
    <SavedGraphList
      graphs={graphs}
      folders={folders}
      selectedGraphId={selectedGraphId}
      selectedFolderId={selectedFolderId}
      moduleDefinitionById={moduleDefinitionById}
      onLoadGraph={onLoadGraph}
      onSelectFolder={onSelectFolder}
      leftToolbar={
        workflowView === 'edit' ? (
          <Button
            type="button"
            size="icon-sm"
            variant="outline"
            className="bg-surface-low"
            onClick={onLeaveEditor}
            aria-label={t({ ko: '목록으로', en: 'Back to list' })}
            title={t({ ko: '목록으로', en: 'Back to list' })}
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
            aria-label={t({ ko: '새로고침', en: 'Refresh' })}
            title={t({ ko: '새로고침', en: 'Refresh' })}
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
            aria-label={t({ ko: '새 워크플로우', en: 'New workflow' })}
            title={t({ ko: '새 워크플로우', en: 'New workflow' })}
          >
            <Plus className="h-4 w-4" />
          </Button>
          {workflowView === 'browse' && selectedGraphRecord ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="bg-surface-low"
              onClick={onDuplicateWorkflow}
              aria-label={t({ ko: '워크플로우 복제', en: 'Duplicate workflow' })}
              title={t({ ko: '워크플로우 복제', en: 'Duplicate workflow' })}
            >
              <Copy className="h-4 w-4" />
            </Button>
          ) : null}
          {workflowView === 'browse' && selectedGraphRecord ? (
            <Button
              type="button"
              size="icon-sm"
              variant="outline"
              className="bg-surface-low"
              onClick={onEditWorkflow}
              aria-label={t({ ko: '워크플로우 편집', en: 'Edit workflow' })}
              title={t({ ko: '워크플로우 편집', en: 'Edit workflow' })}
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
              aria-label={t({ ko: '워크플로우 삭제', en: 'Delete workflow' })}
              title={t({ ko: '워크플로우 삭제', en: 'Delete workflow' })}
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
              aria-label={t({ ko: '폴더 삭제', en: 'Delete folder' })}
              title={t({ ko: '폴더 삭제', en: 'Delete folder' })}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          ) : null}
        </>
      )}
    />
  )
}
