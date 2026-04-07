import { Download, Square, SquareCheckBig } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import type { GraphExecutionRecord } from '@/lib/api'
import type { WatchedFolder } from '@/types/folder'
import { formatDateTime } from '../module-graph-shared'

export type ModuleWorkflowGeneratedOutputItem = {
  id: string
  type: string
  previewUrl: string | null
  downloadUrl: string | null
  downloadName: string
  createdDate: string
  workflowName: string
  executionId: number
  storagePath: string | null
  label: string
  status?: GraphExecutionRecord['status']
}

/** Render the generated-output tab for workflow browse management. */
export function ModuleWorkflowGeneratedOutputsTab({
  outputItems,
  selectedOutputIds,
  allVisibleSelected,
  isCopyPanelOpen,
  copyTargetFolderId,
  isCopying,
  isDownloading,
  watchedFolders,
  watchedFoldersLoading,
  onToggleVisibleSelection,
  onToggleOutputSelection,
  onCopyTargetFolderChange,
  onCloseCopyPanel,
  onCopySelected,
  onDownloadItems,
}: {
  outputItems: ModuleWorkflowGeneratedOutputItem[]
  selectedOutputIds: string[]
  allVisibleSelected: boolean
  isCopyPanelOpen: boolean
  copyTargetFolderId: string
  isCopying: boolean
  isDownloading: boolean
  watchedFolders: WatchedFolder[]
  watchedFoldersLoading: boolean
  onToggleVisibleSelection: () => void
  onToggleOutputSelection: (outputId: string) => void
  onCopyTargetFolderChange: (value: string) => void
  onCloseCopyPanel: () => void
  onCopySelected: () => void
  onDownloadItems: (items: ModuleWorkflowGeneratedOutputItem[]) => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Generated Outputs</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{outputItems.length}</Badge>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onToggleVisibleSelection}
            disabled={outputItems.length === 0}
          >
            {allVisibleSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            {allVisibleSelected ? 'Clear Visible' : 'Select Visible'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isCopyPanelOpen ? (
          <div className="rounded-sm border border-border bg-surface-low px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-foreground">Copy selected outputs to watched folder</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  선택한 생성물을 watched folder로 복사한 뒤, 기존 스캐너 흐름에 맡겨 관리 라이브러리에 편입시켜.
                </div>
              </div>
              <Badge variant="outline">{selectedOutputIds.length}</Badge>
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-end">
              <div className="space-y-2">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">Target folder</div>
                <Select value={copyTargetFolderId} onChange={(event) => onCopyTargetFolderChange(event.target.value)}>
                  <option value="">폴더 선택</option>
                  {watchedFolders.map((folder) => (
                    <option key={folder.id} value={String(folder.id)}>
                      {folder.folder_name}
                    </option>
                  ))}
                </Select>
                {copyTargetFolderId ? (
                  <div className="text-xs text-muted-foreground">
                    {watchedFolders.find((folder) => String(folder.id) === copyTargetFolderId)?.folder_path}
                  </div>
                ) : null}
              </div>

              <Button type="button" variant="ghost" onClick={onCloseCopyPanel} disabled={isCopying}>
                Cancel
              </Button>
              <Button type="button" onClick={onCopySelected} disabled={isCopying || watchedFoldersLoading || !copyTargetFolderId}>
                {isCopying ? 'Copying…' : 'Copy Selected'}
              </Button>
            </div>
          </div>
        ) : null}

        {outputItems.length === 0 ? (
          <div className="rounded-sm border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
            No generated outputs were found in this scope yet.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {outputItems.map((item) => {
              const isSelected = selectedOutputIds.includes(item.id)

              return (
                <div
                  key={item.id}
                  className={`overflow-hidden rounded-sm border bg-surface-low transition ${isSelected ? 'border-primary shadow-sm ring-1 ring-primary/30' : 'border-border'}`}
                >
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => onToggleOutputSelection(item.id)}
                    title={isSelected ? 'Deselect output' : 'Select output'}
                  >
                    {item.previewUrl ? (
                      <div className="relative aspect-[4/3] border-b border-border bg-black/10">
                        <img src={item.previewUrl} alt={item.label} className="h-full w-full object-contain" />
                        <div className="absolute right-2 top-2">
                          <Badge variant={isSelected ? 'secondary' : 'outline'}>{isSelected ? 'Selected' : 'Select'}</Badge>
                        </div>
                      </div>
                    ) : (
                      <div className="relative flex aspect-[4/3] items-center justify-center border-b border-border bg-surface-high text-xs uppercase tracking-[0.12em] text-muted-foreground">
                        {item.type}
                        <div className="absolute right-2 top-2">
                          <Badge variant={isSelected ? 'secondary' : 'outline'}>{isSelected ? 'Selected' : 'Select'}</Badge>
                        </div>
                      </div>
                    )}
                  </button>

                  <div className="space-y-2 px-3 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate text-sm font-medium text-foreground">{item.workflowName}</div>
                      {item.status ? <Badge variant="outline">{item.status}</Badge> : null}
                    </div>
                    <div className="text-xs text-muted-foreground">{item.label}</div>
                    <div className="text-xs text-muted-foreground">Execution #{item.executionId} · {formatDateTime(item.createdDate)}</div>
                    {item.storagePath ? (
                      <div className="truncate text-[11px] text-muted-foreground">{item.storagePath}</div>
                    ) : null}

                    <div className="flex items-center justify-between gap-2 pt-1">
                      <Button type="button" size="sm" variant="outline" onClick={() => onToggleOutputSelection(item.id)}>
                        {isSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                        {isSelected ? 'Selected' : 'Select'}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => onDownloadItems([item])}
                        disabled={!item.downloadUrl || isDownloading}
                      >
                        <Download className="h-4 w-4" />
                        Download
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
