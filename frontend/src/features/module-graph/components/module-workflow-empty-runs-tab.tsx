import { Square, SquareCheckBig, Trash2, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { GraphExecutionRecord } from '@/lib/api'
import { formatDateTime } from '../module-graph-shared'

/** Render the queue and empty-run tab for workflow browse management. */
export function ModuleWorkflowEmptyRunsTab({
  queueExecutions,
  selectedQueueExecutionIds,
  allQueueSelected,
  workflowNameById,
  isCleaningQueue,
  onToggleVisibleSelection,
  onToggleQueueSelection,
  onCancelSingle,
  onDeleteSingle,
}: {
  queueExecutions: GraphExecutionRecord[]
  selectedQueueExecutionIds: number[]
  allQueueSelected: boolean
  workflowNameById: Map<number, string>
  isCleaningQueue: boolean
  onToggleVisibleSelection: () => void
  onToggleQueueSelection: (executionId: number) => void
  onCancelSingle: (executionId: number) => void
  onDeleteSingle: (executionId: number) => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">Queue & Empty Runs</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="outline">{queueExecutions.length}</Badge>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onToggleVisibleSelection}
            disabled={queueExecutions.length === 0}
          >
            {allQueueSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            {allQueueSelected ? 'Clear Visible' : 'Select Visible'}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {queueExecutions.length === 0 ? (
          <div className="rounded-sm border border-dashed border-border px-4 py-10 text-sm text-muted-foreground">
            No empty or output-less executions were found in this scope.
          </div>
        ) : (
          <div className="space-y-3">
            {queueExecutions.map((execution) => {
              const isSelected = selectedQueueExecutionIds.includes(execution.id)
              const isCancelable = execution.status === 'queued' || execution.status === 'running'

              return (
                <div key={execution.id} className={`rounded-sm border px-4 py-3 ${isSelected ? 'border-primary bg-primary/5' : 'border-border bg-surface-low'}`}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button type="button" className="text-sm font-medium text-foreground" onClick={() => onToggleQueueSelection(execution.id)}>
                          {workflowNameById.get(execution.graph_workflow_id) ?? `Workflow #${execution.graph_workflow_id}`}
                        </button>
                        <Badge variant={isSelected ? 'secondary' : 'outline'}>{isSelected ? 'Selected' : 'Select'}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Execution #{execution.id} · created {formatDateTime(execution.created_date)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={execution.status === 'failed' ? 'destructive' : 'outline'}>{execution.status}</Badge>
                      {execution.queue_position !== null && execution.queue_position !== undefined ? <Badge variant="outline">Queue {execution.queue_position}</Badge> : null}
                      <Button type="button" size="sm" variant="ghost" onClick={() => onToggleQueueSelection(execution.id)}>
                        {isSelected ? <SquareCheckBig className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                      </Button>
                      {isCancelable ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => onCancelSingle(execution.id)} disabled={isCleaningQueue}>
                          <XCircle className="h-4 w-4" />
                          Cancel
                        </Button>
                      ) : (
                        <Button type="button" size="sm" onClick={() => onDeleteSingle(execution.id)} disabled={isCleaningQueue}>
                          <Trash2 className="h-4 w-4" />
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                  {execution.error_message ? (
                    <div className="mt-3 rounded-sm border border-border bg-background/50 px-3 py-2 text-xs text-muted-foreground">
                      {execution.error_message}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
