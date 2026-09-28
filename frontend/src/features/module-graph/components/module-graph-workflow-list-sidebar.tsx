import { useRef } from 'react'
import { ArrowLeft, Copy, Download, FolderPlus, PenSquare, Plus, RefreshCw, Trash2, Upload } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { useI18n } from '@/i18n'
import type { GraphWorkflowFolderRecord, GraphWorkflowRecord, GraphWorkflowSummaryRecord } from '@/lib/api-module-graph'
import { SavedGraphList } from './saved-graph-list'

/** Render the saved-workflow sidebar and its browse/editor toolbar actions. */
export function ModuleGraphWorkflowListSidebar({
  graphs,
  folders,
  selectedGraphId,
  selectedFolderId,
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
  onExportWorkflow,
  onImportWorkflow,
  onEditWorkflow,
  onDeleteWorkflow,
  onDeleteFolder,
}: {
  graphs: GraphWorkflowSummaryRecord[]
  folders: GraphWorkflowFolderRecord[]
  selectedGraphId: number | null
  selectedFolderId: number | null
  workflowView: 'browse' | 'edit'
  selectedGraphRecord: GraphWorkflowRecord | null
  selectedFolderRecord: GraphWorkflowFolderRecord | null
  browseManageModalTitle: string
  onLoadGraph: (graph: GraphWorkflowSummaryRecord) => void
  onSelectFolder: (folderId: number | null) => void
  onLeaveEditor: () => void
  onRefreshWorkspace: () => void
  onOpenBrowseManage: () => void
  onCreateWorkflow: () => void
  onDuplicateWorkflow: () => void
  onExportWorkflow: () => void
  onImportWorkflow: (file: File) => void
  onEditWorkflow: () => void
  onDeleteWorkflow: () => void
  onDeleteFolder: (folderId: number) => void
}) {
  const { t } = useI18n()
  const importInputRef = useRef<HTMLInputElement | null>(null)

  return (
    <SavedGraphList
      graphs={graphs}
      folders={folders}
      selectedGraphId={selectedGraphId}
      selectedFolderId={selectedFolderId}
      onLoadGraph={onLoadGraph}
      onSelectFolder={onSelectFolder}
      leftToolbar={
        workflowView === 'edit' ? (
          <IconButton
            size="icon-xs"
            variant="ghost"
            onClick={onLeaveEditor}
            label={t({ ko: '목록으로', en: 'Back to list' })}
          >
            <ArrowLeft />
          </IconButton>
        ) : null
      }
      rightToolbar={(
        <>
          <IconButton
            size="icon-xs"
            variant="ghost"
            onClick={onRefreshWorkspace}
            label={t({ ko: '새로고침', en: 'Refresh' })}
          >
            <RefreshCw />
          </IconButton>
          {workflowView === 'browse' && !selectedGraphRecord ? (
            <IconButton
              size="icon-xs"
              variant="ghost"
              onClick={onOpenBrowseManage}
              label={browseManageModalTitle}
            >
              <FolderPlus />
            </IconButton>
          ) : null}
          <IconButton
            size="icon-xs"
            variant="ghost"
            onClick={onCreateWorkflow}
            label={t({ ko: '새 워크플로우', en: 'New workflow' })}
          >
            <Plus />
          </IconButton>
          {workflowView === 'browse' ? (
            <>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json,.conai-workflow.json"
                className="hidden"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0]
                  event.currentTarget.value = ''
                  if (file) {
                    onImportWorkflow(file)
                  }
                }}
              />
              <IconButton
                size="icon-xs"
                variant="ghost"
                onClick={() => importInputRef.current?.click()}
                label={t({ ko: '워크플로우 가져오기', en: 'Import workflow' })}
              >
                <Upload />
              </IconButton>
            </>
          ) : null}
          {workflowView === 'browse' && selectedGraphRecord ? (
            <IconButton
              size="icon-xs"
              variant="ghost"
              onClick={onDuplicateWorkflow}
              label={t({ ko: '워크플로우 복제', en: 'Duplicate workflow' })}
            >
              <Copy />
            </IconButton>
          ) : null}
          {workflowView === 'browse' && selectedGraphRecord ? (
            <IconButton
              size="icon-xs"
              variant="ghost"
              onClick={onExportWorkflow}
              label={t({ ko: '워크플로우 내보내기', en: 'Export workflow' })}
            >
              <Download />
            </IconButton>
          ) : null}
          {workflowView === 'browse' && selectedGraphRecord ? (
            <IconButton
              size="icon-xs"
              variant="ghost"
              onClick={onEditWorkflow}
              label={t({ ko: '워크플로우 편집', en: 'Edit workflow' })}
            >
              <PenSquare />
            </IconButton>
          ) : null}
          {workflowView === 'browse' && selectedGraphRecord ? (
            <IconButton
              size="icon-xs"
              variant="ghost"
              onClick={onDeleteWorkflow}
              label={t({ ko: '워크플로우 삭제', en: 'Delete workflow' })}
            >
              <Trash2 />
            </IconButton>
          ) : null}
          {workflowView === 'browse' && !selectedGraphRecord && selectedFolderRecord ? (
            <IconButton
              size="icon-xs"
              variant="ghost"
              onClick={() => onDeleteFolder(selectedFolderRecord.id)}
              label={t({ ko: '폴더 삭제', en: 'Delete folder' })}
            >
              <Trash2 />
            </IconButton>
          ) : null}
        </>
      )}
    />
  )
}
