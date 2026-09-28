import { useMemo } from 'react'
import { Eye } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import type {
  GraphExecutionArtifactRecord,
  GraphExecutionFinalResultRecord,
  GraphWorkflowRecord,
} from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import {
  buildExecutionComparisonRows,
  buildExecutionComparisonSummary,
  buildExecutionPathDiagnosticRows,
  buildNodeDisplayLabelMap,
  getExecutionInputEntries,
  getGraphExecutionLogEventLabel,
  getNodeDisplayLabel,
  getNodeDisplayLabelFromMap,
  type ParsedExecutionPlan,
} from './graph-execution-panel-helpers'
import { ExecutionComparisonContextBlock, ExecutionOutputGroupCard, ExecutionPathDiagnosticsBlock } from './graph-execution-panel-sections'
import { CODE_BLOCK_CLASS_NAME, ExecutionHeaderBadges, ExecutionInputEntriesList, type GraphExecutionDetail } from './graph-execution-shared-ui'
import { WorkflowFinalResultsSection } from './workflow-final-results-section'
import { buildFinalResultLifecycleWarningSourceLabel, findLlmResponseDiagnostic, listFinalResultLifecycleWarnings } from './workflow-execution-log-alerts'
import { EmptyState } from '@/components/ui/empty-state'

/** Inline summary for the expanded run row: header, diagnostics, inputs, final results and outputs. */
export function SelectedExecutionSummary({
  executionDetail,
  selectedGraph,
  nodeLabelOverrides,
  selectedExecutionPlan,
  executionInputEntries,
  finalResults,
  compactArtifactGroups,
  onOpenDetail,
}: {
  executionDetail: GraphExecutionDetail
  selectedGraph?: GraphWorkflowRecord | null
  nodeLabelOverrides?: Record<string, string> | null
  selectedExecutionPlan: ParsedExecutionPlan | null
  executionInputEntries: ReturnType<typeof getExecutionInputEntries>
  finalResults: GraphExecutionFinalResultRecord[]
  compactArtifactGroups: Array<{ nodeId: string; nodeLabel: string; artifacts: GraphExecutionArtifactRecord[] }>
  onOpenDetail: () => void
}) {
  const { t, formatNumber } = useI18n()
  const finalResultLifecycleWarnings = useMemo(() => listFinalResultLifecycleWarnings(executionDetail.logs), [executionDetail.logs])
  const llmResponseDiagnostic = useMemo(() => findLlmResponseDiagnostic(executionDetail.logs), [executionDetail.logs])
  const finalResultLifecycleWarning = finalResultLifecycleWarnings[0] ?? null
  const additionalFinalResultWarningCount = Math.max(0, finalResultLifecycleWarnings.length - 1)
  const nodeLabelMap = useMemo(() => buildNodeDisplayLabelMap(selectedGraph), [selectedGraph])
  const finalResultLifecycleWarningSourceLabel = finalResultLifecycleWarning?.sourceNodeId
    ? buildFinalResultLifecycleWarningSourceLabel(
      finalResultLifecycleWarning,
      getNodeDisplayLabelFromMap(nodeLabelMap, finalResultLifecycleWarning.sourceNodeId, nodeLabelOverrides),
    )
    : buildFinalResultLifecycleWarningSourceLabel(finalResultLifecycleWarning)
  const executionComparisonSummary = useMemo(() => buildExecutionComparisonSummary({
    inputEntries: executionInputEntries,
    artifacts: executionDetail.artifacts,
    finalResults,
    logs: executionDetail.logs,
    nodeIo: executionDetail.node_io ?? [],
  }), [executionDetail.artifacts, executionDetail.logs, executionDetail.node_io, executionInputEntries, finalResults])
  const executionComparisonRows = useMemo(() => buildExecutionComparisonRows(
    executionDetail.node_io ?? [],
    selectedGraph,
    nodeLabelOverrides,
  ), [executionDetail.node_io, nodeLabelOverrides, selectedGraph])
  const executionPathDiagnosticRows = useMemo(() => buildExecutionPathDiagnosticRows({
    execution: executionDetail.execution,
    logs: executionDetail.logs,
    plan: selectedExecutionPlan,
    selectedGraph,
    nodeLabelOverrides,
    t,
  }), [executionDetail.execution, executionDetail.logs, nodeLabelOverrides, selectedExecutionPlan, selectedGraph, t])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <ExecutionHeaderBadges execution={executionDetail.execution} plan={selectedExecutionPlan} idClassName="font-medium text-foreground">
            {selectedExecutionPlan?.targetNodeId ? <Badge variant="outline">{getNodeDisplayLabel(selectedGraph, selectedExecutionPlan.targetNodeId, nodeLabelOverrides)}</Badge> : null}
            {selectedExecutionPlan?.forceRerun ? <Badge variant="outline">{t({ ko: '강제', en: 'Forced' })}</Badge> : null}
            {selectedExecutionPlan?.reusedFromExecutionId ? <Badge variant="outline">{t({ ko: '재사용 #{id}', en: 'Reused #{id}' }, { id: selectedExecutionPlan.reusedFromExecutionId })}</Badge> : null}
          </ExecutionHeaderBadges>
        </div>
        <IconButton size="icon-sm" variant="ghost" label={t({ ko: '상세', en: 'Details' })} onClick={onOpenDetail}>
          <Eye className="h-4 w-4" />
        </IconButton>
      </div>

      {executionDetail.execution.error_message ? (
        <div role="alert" className="rounded-sm bg-destructive-soft px-3 py-2 text-sm text-destructive-soft-foreground">
          {executionDetail.execution.error_message}
        </div>
      ) : null}

      {llmResponseDiagnostic ? (
        <div className="space-y-2 rounded-sm bg-destructive-soft/45 px-3 py-2 text-sm text-foreground">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{t({ ko: 'LLM 응답 로그', en: 'LLM response log' })}</span>
              {llmResponseDiagnostic.failedLog ? <Badge variant="destructive" title={llmResponseDiagnostic.failedLog.event_type}>{getGraphExecutionLogEventLabel(llmResponseDiagnostic.failedLog.event_type, t)}</Badge> : null}
              {llmResponseDiagnostic.providerLog ? <Badge variant="outline" title={llmResponseDiagnostic.providerLog.event_type}>{getGraphExecutionLogEventLabel(llmResponseDiagnostic.providerLog.event_type, t)}</Badge> : null}
            </div>
            <IconButton size="icon-sm" variant="ghost" label={t({ ko: '로그', en: 'Logs' })} onClick={onOpenDetail}>
              <Eye className="h-4 w-4" />
            </IconButton>
          </div>
          {llmResponseDiagnostic.textPreview ? (
            <pre className={cn(CODE_BLOCK_CLASS_NAME, 'max-h-44 whitespace-pre-wrap break-words')}>{llmResponseDiagnostic.textPreview}</pre>
          ) : llmResponseDiagnostic.rawResponsePreview ? (
            <pre className={cn(CODE_BLOCK_CLASS_NAME, 'max-h-44 whitespace-pre-wrap break-words')}>{llmResponseDiagnostic.rawResponsePreview}</pre>
          ) : null}
        </div>
      ) : null}

      {finalResultLifecycleWarning ? (
        <div role="status" className="rounded-sm bg-warning-soft px-3 py-2 text-sm text-warning-soft-foreground">
          <div>
            {finalResultLifecycleWarning.kind === 'source_artifact_missing'
              ? finalResultLifecycleWarningSourceLabel
                ? t({
                  ko: '최종 결과 노드는 실행됐지만 {source} 출력이 저장된 결과물을 만들지 못했어. 연결한 출력 포트를 확인해줘.',
                  en: 'The final result node ran, but the {source} output did not create a saved result. Check the connected output port.',
                }, { source: finalResultLifecycleWarningSourceLabel })
                : t({ ko: '최종 결과 노드는 실행됐지만 연결된 출력이 저장된 결과물을 만들지 못했어. 연결한 출력 포트를 확인해줘.', en: 'The final result node ran, but the connected output did not create a saved result. Check the connected output port.' })
              : finalResultLifecycleWarningSourceLabel
                ? t({
                  ko: '최종 결과는 저장됐지만 {source} 출력의 생성 기록 연결은 실패했어. 상세 로그에서 원인을 확인해줘.',
                  en: 'The final result was saved, but linking the {source} output into generation history failed. Check the detailed logs for the cause.',
                }, { source: finalResultLifecycleWarningSourceLabel })
                : t({ ko: '최종 결과는 저장됐지만 생성 기록 연결은 실패했어. 상세 로그에서 원인을 확인해줘.', en: 'The final result was saved, but linking it into generation history failed. Check the detailed logs for the cause.' })}
          </div>
          {additionalFinalResultWarningCount > 0 ? (
            <div className="mt-1 text-xs text-warning-soft-foreground/80">
              {t({ ko: '추가 최종 결과 경고 {count}개가 더 있어. 상세 로그에서 함께 확인해줘.', en: '{count} more final-result warnings are available in the detailed logs.' }, { count: formatNumber(additionalFinalResultWarningCount) })}
            </div>
          ) : null}
        </div>
      ) : null}

      <ExecutionComparisonContextBlock
        summary={executionComparisonSummary}
        rows={executionComparisonRows}
        compact
      />
      <ExecutionPathDiagnosticsBlock rows={executionPathDiagnosticRows} compact />

      {executionInputEntries.length > 0 ? (
        <div className="space-y-2.5">
          <ExecutionInputEntriesList entries={executionInputEntries} itemClassName="px-3 py-2" />
        </div>
      ) : null}

      <div>
        <WorkflowFinalResultsSection
          finalResults={finalResults}
          artifacts={executionDetail.artifacts}
          selectedGraph={selectedGraph}
          nodeLabelOverrides={nodeLabelOverrides}
        />
      </div>

      <div className="space-y-2.5">
        <Text as="div" variant="overline" className="flex flex-wrap items-center gap-2 font-semibold">
          <span>{t({ ko: '출력', en: 'Outputs' })}</span>
        </Text>

        {compactArtifactGroups.length === 0 ? (
          <EmptyState size="compact" title={t({ ko: '표시할 출력 없음', en: 'No outputs to display' })} />
        ) : (
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(12rem,1fr))]">
            {compactArtifactGroups.map((group) => (
              <ExecutionOutputGroupCard key={group.nodeId} group={group} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
