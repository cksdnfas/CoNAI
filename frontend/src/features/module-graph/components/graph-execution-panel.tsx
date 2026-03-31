import { CircleHelp, Play, RotateCcw, Square } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type {
  GraphExecutionArtifactRecord,
  GraphExecutionLogRecord,
  GraphExecutionRecord,
} from '@/lib/api'
import { formatDateTime, getArtifactPreviewUrl, parseMetadataValue } from '../module-graph-shared'
import { cn } from '@/lib/utils'

type GraphExecutionDetail = {
  execution: GraphExecutionRecord
  artifacts: GraphExecutionArtifactRecord[]
  logs: GraphExecutionLogRecord[]
}

function TechnicalReferenceHint({ title, label }: { title: string; label: string }) {
  return (
    <span className="inline-flex cursor-help text-muted-foreground" title={title} aria-label={label}>
      <CircleHelp className="h-3.5 w-3.5" />
    </span>
  )
}

type GraphExecutionPanelProps = {
  selectedGraphId: number | null
  selectedExecutionId: number | null
  selectedExecutionStatus?: GraphExecutionRecord['status'] | null
  executionList: GraphExecutionRecord[]
  executionListError: string
  executionListIsError: boolean
  executionDetail: GraphExecutionDetail | undefined
  executionDetailError: string
  executionDetailIsError: boolean
  isExecutingGraph: boolean
  isCancellingExecution: boolean
  onSelectExecution: (executionId: number) => void
  onRerunGraph: () => void
  onRetryExecution: () => void
  onCancelExecution: () => void
  description?: string
  showHeader?: boolean
}

/** Render graph execution history, selected detail, artifacts, and logs. */
export function GraphExecutionPanel({
  selectedGraphId,
  selectedExecutionId,
  selectedExecutionStatus,
  executionList,
  executionListError,
  executionListIsError,
  executionDetail,
  executionDetailError,
  executionDetailIsError,
  isExecutingGraph,
  isCancellingExecution,
  onSelectExecution,
  onRerunGraph,
  onRetryExecution,
  onCancelExecution,
  description = '최근 실행 상태와 결과 아티팩트, 로그를 여기서 확인해.',
  showHeader = true,
}: GraphExecutionPanelProps) {
  const queuedExecutions = executionList
    .filter((execution) => execution.status === 'queued')
    .sort((left, right) => (left.queue_position ?? Number.MAX_SAFE_INTEGER) - (right.queue_position ?? Number.MAX_SAFE_INTEGER))
  const runningExecutions = executionList.filter((execution) => execution.status === 'running')
  const queuedCount = queuedExecutions.length
  const runningCount = runningExecutions.length
  const retryable = selectedExecutionStatus === 'failed' || selectedExecutionStatus === 'cancelled'
  const activeRunningExecution = runningExecutions[0] ?? null
  const nextQueuedExecution = queuedExecutions[0] ?? null

  const actionButtons = (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        onClick={onCancelExecution}
        disabled={isCancellingExecution || (selectedExecutionStatus !== 'queued' && selectedExecutionStatus !== 'running')}
        title={isCancellingExecution ? '취소 요청 중' : '실행 취소'}
        aria-label={isCancellingExecution ? '실행 취소 요청 중' : '실행 취소'}
      >
        <Square className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        onClick={onRetryExecution}
        disabled={!retryable || isExecutingGraph}
        title="다시 시도"
        aria-label="실행 다시 시도"
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        onClick={onRerunGraph}
        disabled={!selectedGraphId || isExecutingGraph}
        title={isExecutingGraph ? '실행 중' : '재실행'}
        aria-label={isExecutingGraph ? '워크플로우 실행 중' : '워크플로우 재실행'}
      >
        <Play className="h-4 w-4" />
      </Button>
    </div>
  )

  return (
    <Card>
      <CardContent className="space-y-3">
        {showHeader ? (
          <SectionHeading
            variant="inside"
            heading="Execution Results"
            description={description}
            actions={actionButtons}
          />
        ) : null}

        {!showHeader ? <div className="flex justify-end">{actionButtons}</div> : null}

        {!selectedGraphId ? (
          <Alert>
            <AlertTitle>그래프를 먼저 골라줘</AlertTitle>
            <AlertDescription>워크플로우를 먼저 선택해.</AlertDescription>
          </Alert>
        ) : null}

        {selectedGraphId && executionListIsError ? (
          <Alert variant="destructive">
            <AlertTitle>실행 목록 오류</AlertTitle>
            <AlertDescription>{executionListError}</AlertDescription>
          </Alert>
        ) : null}

        {selectedGraphId && executionList.length === 0 ? (
          <Alert>
            <AlertTitle>실행 기록이 없어</AlertTitle>
            <AlertDescription>먼저 실행해줘.</AlertDescription>
          </Alert>
        ) : null}

        {selectedGraphId ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">Q {queuedCount}</Badge>
              <Badge variant="outline">R {runningCount}</Badge>
            </div>

            {queuedCount > 0 || runningCount > 0 ? (
              <Alert>
                <AlertTitle>큐/실행 상태</AlertTitle>
                <AlertDescription>
                  {activeRunningExecution ? <div>실행 중 #{activeRunningExecution.id}</div> : null}
                  {nextQueuedExecution ? <div>다음 #{nextQueuedExecution.id} · 순번 {nextQueuedExecution.queue_position ?? '?'}</div> : null}
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : null}

        <div className="space-y-1.5">
          {executionList.map((execution) => (
            <button
              key={execution.id}
              type="button"
              onClick={() => onSelectExecution(execution.id)}
              className={cn('block w-full rounded-sm border px-2.5 py-2 text-left transition-colors hover:bg-surface-high', selectedExecutionId === execution.id ? 'border-primary/50 bg-surface-high' : 'border-border bg-surface-low')}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-sm font-medium text-foreground">#{execution.id}</span>
                  <Badge variant={execution.status === 'completed' ? 'secondary' : 'outline'}>{execution.status}</Badge>
                  {selectedExecutionId === execution.id ? <Badge variant="secondary">선택</Badge> : null}
                </div>
                <div className="text-[11px] text-muted-foreground">{formatDateTime(execution.created_date)}</div>
              </div>

              {(execution.status === 'queued' && execution.queue_position) || execution.cancel_requested || execution.error_message ? (
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                  {execution.status === 'queued' && execution.queue_position ? <span>순번 {execution.queue_position}</span> : null}
                  {execution.cancel_requested ? <span className="text-[#ffd180]">취소 요청됨</span> : null}
                  {execution.error_message ? <span className="text-[#ffb4ab] line-clamp-1">{execution.error_message}</span> : null}
                </div>
              ) : null}
            </button>
          ))}
        </div>

        {selectedExecutionId && executionDetailIsError ? (
          <Alert variant="destructive">
            <AlertTitle>실행 상세 오류</AlertTitle>
            <AlertDescription>{executionDetailError}</AlertDescription>
          </Alert>
        ) : null}

        {selectedExecutionId && executionDetail ? (
          <div className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
            <Alert>
              <AlertTitle className="flex flex-wrap items-center gap-2">
                <span>#{executionDetail.execution.id}</span>
                <Badge variant={executionDetail.execution.status === 'completed' ? 'secondary' : 'outline'}>{executionDetail.execution.status}</Badge>
                <span className="text-[11px] text-muted-foreground">{formatDateTime(executionDetail.execution.created_date)}</span>
              </AlertTitle>
              <AlertDescription>
                {executionDetail.execution.status === 'queued' && executionDetail.execution.queue_position ? <div>큐 순번 {executionDetail.execution.queue_position}</div> : null}
                {executionDetail.execution.cancel_requested ? <div>취소 요청 접수됨</div> : null}
                {executionDetail.execution.error_message ? <div>{executionDetail.execution.error_message}</div> : null}
                {executionDetail.execution.failed_node_id ? (
                  <div className="flex items-center gap-1">
                    <span>실패 노드 있음</span>
                    <TechnicalReferenceHint title={`node ${executionDetail.execution.failed_node_id}`} label="실패 노드 내부 식별자 보기" />
                  </div>
                ) : null}
              </AlertDescription>
            </Alert>

            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <span>Artifacts</span>
                <Badge variant="outline">{executionDetail.artifacts.length}</Badge>
              </div>
              {executionDetail.artifacts.map((artifact) => {
                const previewUrl = getArtifactPreviewUrl(artifact)
                const parsedMetadata = parseMetadataValue(artifact.metadata)

                return (
                  <div key={artifact.id} className="rounded-sm border border-border bg-surface-low p-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-medium text-foreground">출력 아티팩트</span>
                          <Badge variant="outline">{artifact.artifact_type}</Badge>
                          <TechnicalReferenceHint title={`node ${artifact.node_id}\nport ${artifact.port_key}`} label="아티팩트 내부 연결 정보 보기" />
                        </div>
                        <div className="text-[11px] text-muted-foreground">{formatDateTime(artifact.created_date)}</div>
                      </div>
                    </div>

                    {previewUrl && (artifact.artifact_type === 'image' || artifact.artifact_type === 'mask') ? (
                      <img src={previewUrl} alt={`${artifact.node_id}-${artifact.port_key}`} className="mt-2 max-h-44 rounded-sm border border-border object-contain" />
                    ) : null}

                    {artifact.storage_path ? <div className="mt-2 rounded-sm bg-surface-high px-2 py-1.5 break-all text-[11px] text-muted-foreground">{artifact.storage_path}</div> : null}

                    {parsedMetadata ? (
                      <pre className="mt-2 overflow-auto rounded-sm bg-[#0b111c] p-2.5 text-[11px] text-[#d7e3ff]">{typeof parsedMetadata === 'string' ? parsedMetadata : JSON.stringify(parsedMetadata, null, 2)}</pre>
                    ) : null}
                  </div>
                )
              })}
            </div>

            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <span>Logs</span>
                <Badge variant="outline">{executionDetail.logs.length}</Badge>
              </div>
              {executionDetail.logs.length === 0 ? (
                <Alert>
                  <AlertTitle>저장된 로그가 없어</AlertTitle>
                  <AlertDescription>이번 실행은 별도 로그 이벤트 없이 끝났어.</AlertDescription>
                </Alert>
              ) : (
                executionDetail.logs.map((log) => {
                  const parsedDetails = parseMetadataValue(log.details)
                  return (
                    <div key={log.id} className="rounded-sm border border-border bg-surface-low p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={log.level === 'error' ? 'outline' : 'secondary'}>{log.level}</Badge>
                          <span className="text-sm font-medium text-foreground">{log.event_type}</span>
                          {log.node_id ? <TechnicalReferenceHint title={`node ${log.node_id}`} label="로그 대상 노드 내부 식별자 보기" /> : null}
                        </div>
                        <div className="text-[11px] text-muted-foreground">{formatDateTime(log.created_date)}</div>
                      </div>
                      <div className="mt-1.5 text-sm text-foreground">{log.message}</div>
                      {parsedDetails ? (
                        <pre className="mt-2 overflow-auto rounded-sm bg-[#0b111c] p-2.5 text-[11px] text-[#d7e3ff]">{typeof parsedDetails === 'string' ? parsedDetails : JSON.stringify(parsedDetails, null, 2)}</pre>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
