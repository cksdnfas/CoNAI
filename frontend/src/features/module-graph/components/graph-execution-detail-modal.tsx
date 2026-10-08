import { useState, type ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Inset } from '@/components/ui/inset'
import { Text } from '@/components/ui/text'
import { Modal } from '@/components/ui/modal'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import { useI18n } from '@/i18n'
import type { GraphExecutionFinalResultRecord, GraphWorkflowRecord } from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import {
  getArtifactPreviewUrl,
  hasGraphArtifactVisualPreview,
  parseMetadataValue,
  resolveGraphArtifactMimeType,
} from '../module-graph-shared'
import {
  buildExecutionComparisonRows,
  buildExecutionComparisonSummary,
  buildExecutionPathDiagnosticRows,
  getExecutionInputEntries,
  getGraphExecutionLogEventLabel,
  getGraphExecutionLogLevelBadgeVariant,
  getGraphExecutionLogLevelLabel,
  type ParsedExecutionPlan,
} from './graph-execution-panel-helpers'
import { ExecutionComparisonContextBlock, ExecutionPathDiagnosticsBlock } from './graph-execution-panel-sections'
import { CODE_BLOCK_CLASS_NAME, ExecutionHeaderBadges, ExecutionInputEntriesList, type GraphExecutionDetail } from './graph-execution-shared-ui'
import { TechnicalReferenceHint } from './module-graph-field-shared'
import { EmptyState } from '@/components/ui/empty-state'
import { TextTabs } from '@/components/common/text-tabs'

type ExecutionDetailTab = 'result' | 'inputs' | 'diagnostics' | 'logs'

/** One run in a modal: results first (passed in as `resultContent`), technical inputs, diagnostics and logs behind text tabs. */
export function GraphExecutionDetailModal({
  open,
  onClose,
  executionDetail,
  selectedGraph,
  nodeLabelOverrides,
  selectedExecutionPlan,
  executionInputEntries,
  finalResults,
  resultContent,
}: {
  open: boolean
  onClose: () => void
  executionDetail: GraphExecutionDetail
  selectedGraph?: GraphWorkflowRecord | null
  nodeLabelOverrides?: Record<string, string> | null
  selectedExecutionPlan: ParsedExecutionPlan | null
  executionInputEntries: ReturnType<typeof getExecutionInputEntries>
  finalResults: GraphExecutionFinalResultRecord[]
  /** The run's results (final results and outputs); shown on the first tab. */
  resultContent?: ReactNode
}) {
  const { t, formatDateTime } = useI18n()
  const [tab, setTab] = useState<ExecutionDetailTab>(resultContent ? 'result' : 'diagnostics')
  const tabItems = [
    ...(resultContent ? [{ value: 'result' as const, label: t({ ko: '결과', en: 'Result' }) }] : []),
    ...(executionInputEntries.length > 0 ? [{ value: 'inputs' as const, label: t({ ko: '입력', en: 'Inputs' }), count: executionInputEntries.length }] : []),
    { value: 'diagnostics' as const, label: t({ ko: '진단', en: 'Diagnostics' }) },
    { value: 'logs' as const, label: t({ ko: '로그', en: 'Logs' }), count: executionDetail.logs.length },
  ]

  return (
    <Modal
      open={open}
      title={t({ ko: '실행 #{id}', en: 'Run #{id}' }, { id: executionDetail.execution.id })}
      headerContent={<TextTabs value={tab} items={tabItems} onChange={setTab} ariaLabel={t({ ko: '실행 상세', en: 'Run details' })} />}
      onClose={onClose}
      widthClassName="max-w-6xl"
    >
      <div className="space-y-4">
        {tab === 'result' ? resultContent : null}

        {tab === 'diagnostics' ? (
        <div className="space-y-2">
          <Alert>
            <AlertTitle className="flex flex-wrap items-center gap-2">
              <ExecutionHeaderBadges execution={executionDetail.execution} plan={selectedExecutionPlan} />
            </AlertTitle>
            <AlertDescription>
              {selectedExecutionPlan?.targetNodeId ? (
                <div className="flex items-center gap-1">
                  <span>{selectedExecutionPlan.forceRerun ? t({ ko: '선택 노드 강제 재실행', en: 'Force rerun selected node' }) : t({ ko: '선택 노드 실행', en: 'Run selected node' })}</span>
                  <TechnicalReferenceHint title={`node ${selectedExecutionPlan.targetNodeId}`} label={t({ ko: '실행 대상 노드 내부 식별자 보기', en: 'Show internal identifier for the target node' })} />
                </div>
              ) : null}
              {selectedExecutionPlan?.forceRerun ? <div>{t({ ko: '캐시 무시: upstream도 새로 실행', en: 'Ignore cache: rerun upstream as well' })}</div> : null}
              {selectedExecutionPlan?.reusedFromExecutionId ? <div>{t({ ko: '캐시 재사용: #{id} · 노드 {count}', en: 'Cache reused: #{id} · nodes {count}' }, { id: selectedExecutionPlan.reusedFromExecutionId, count: (selectedExecutionPlan.reusedNodeIds ?? []).length })}</div> : null}
              {executionDetail.execution.status === 'queued' && executionDetail.execution.queue_position ? <div>{t({ ko: '큐 순번 {position}', en: 'Queue position {position}' }, { position: executionDetail.execution.queue_position })}</div> : null}
              {executionDetail.execution.cancel_requested ? <div>{t({ ko: '취소 요청 접수됨', en: 'Cancel request received' })}</div> : null}
              {executionDetail.execution.error_message ? <div>{executionDetail.execution.error_message}</div> : null}
              {executionDetail.execution.failed_node_id ? (
                <div className="flex items-center gap-1">
                  <span>{t({ ko: '실패 노드 있음', en: 'Failed node present' })}</span>
                  <TechnicalReferenceHint title={`node ${executionDetail.execution.failed_node_id}`} label={t({ ko: '실패 노드 내부 식별자 보기', en: 'Show internal identifier for the failed node' })} />
                </div>
              ) : null}
            </AlertDescription>
          </Alert>
          <ExecutionComparisonContextBlock
            summary={buildExecutionComparisonSummary({
              inputEntries: executionInputEntries,
              artifacts: executionDetail.artifacts,
              finalResults,
              logs: executionDetail.logs,
              nodeIo: executionDetail.node_io ?? [],
            })}
            rows={buildExecutionComparisonRows(
              executionDetail.node_io ?? [],
              selectedGraph,
              nodeLabelOverrides,
            )}
          />
          <ExecutionPathDiagnosticsBlock
            rows={buildExecutionPathDiagnosticRows({
              execution: executionDetail.execution,
              logs: executionDetail.logs,
              plan: selectedExecutionPlan,
              selectedGraph,
              nodeLabelOverrides,
              t,
            })}
          />
        </div>
        ) : null}

        {tab === 'inputs' ? <ExecutionInputEntriesList entries={executionInputEntries} itemClassName="p-3" /> : null}

        {tab === 'logs' ? (
        <>
        <div className="space-y-2">
          <Text as="div" variant="overline" className="flex flex-wrap items-center gap-2 font-semibold">
            <span>{t({ ko: '아티팩트', en: 'Artifacts' })}</span>
            <Badge variant="outline">{executionDetail.artifacts.length}</Badge>
          </Text>
          {executionDetail.artifacts.map((artifact) => {
            const previewUrl = getArtifactPreviewUrl(artifact)
            const mimeType = resolveGraphArtifactMimeType(artifact)
            const parsedMetadata = parseMetadataValue(artifact.metadata)

            return (
              <Inset key={artifact.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground">{t({ ko: '출력 아티팩트', en: 'Output artifact' })}</span>
                      <Badge variant="outline">{artifact.artifact_type}</Badge>
                      <TechnicalReferenceHint title={`node ${artifact.node_id}\nport ${artifact.port_key}`} label={t({ ko: '아티팩트 내부 연결 정보 보기', en: 'Show internal connection info for the artifact' })} />
                    </div>
                    <div className="text-2xs text-muted-foreground">{formatDateTime(artifact.created_date)}</div>
                  </div>
                </div>

                {hasGraphArtifactVisualPreview(artifact) ? (
                  <InlineMediaPreview
                    src={previewUrl}
                    mimeType={mimeType}
                    alt={`${artifact.node_id}-${artifact.port_key}`}
                    frameClassName="mt-2 border-0 p-2"
                    mediaClassName="max-h-44 w-full object-contain"
                  />
                ) : null}

                {artifact.storage_path ? <div className="mt-2 rounded-sm bg-surface-lowest px-2 py-1.5 break-all text-2xs text-muted-foreground">{artifact.storage_path}</div> : null}

                {parsedMetadata ? (
                  <pre className={cn(CODE_BLOCK_CLASS_NAME, 'mt-2')}>{typeof parsedMetadata === 'string' ? parsedMetadata : JSON.stringify(parsedMetadata, null, 2)}</pre>
                ) : null}
              </Inset>
            )
          })}
        </div>

        <div className="space-y-2">
          <Text as="div" variant="overline" className="flex flex-wrap items-center gap-2 font-semibold">
            <span>{t({ ko: '로그', en: 'Logs' })}</span>
            <Badge variant="outline">{executionDetail.logs.length}</Badge>
          </Text>
          {executionDetail.logs.length === 0 ? (
            <EmptyState size="compact" title={t({ ko: '로그 없음', en: 'No logs' })} />
          ) : (
            executionDetail.logs.map((log) => {
              const parsedDetails = parseMetadataValue(log.details)
              return (
                <Inset key={log.id} data-level={log.level} className={cn('px-3 py-2.5', log.level === 'error' && 'bg-destructive-soft/45', log.level === 'warn' && 'bg-warning-soft/45')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={getGraphExecutionLogLevelBadgeVariant(log.level)}>{getGraphExecutionLogLevelLabel(log.level, t)}</Badge>
                      <span className="text-sm font-medium text-foreground" title={log.event_type}>{getGraphExecutionLogEventLabel(log.event_type, t)}</span>
                      {log.node_id ? <TechnicalReferenceHint title={`node ${log.node_id}`} label={t({ ko: '로그 대상 노드 내부 식별자 보기', en: 'Show internal identifier for the log target node' })} /> : null}
                    </div>
                    <div className="text-2xs text-muted-foreground">{formatDateTime(log.created_date)}</div>
                  </div>
                  <div className="mt-1.5 text-sm text-foreground">{log.message}</div>
                  {parsedDetails ? (
                    <pre className={cn(CODE_BLOCK_CLASS_NAME, 'mt-2')}>{typeof parsedDetails === 'string' ? parsedDetails : JSON.stringify(parsedDetails, null, 2)}</pre>
                  ) : null}
                </Inset>
              )
            })
          )}
        </div>
        </>
        ) : null}
      </div>
    </Modal>
  )
}
