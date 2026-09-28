import { useMemo, useState } from 'react'
import { FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Text } from '@/components/ui/text'
import { Modal } from '@/components/ui/modal'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import { useI18n } from '@/i18n'
import type { GraphExecutionArtifactRecord } from '@/lib/api-module-graph'
import {
  getArtifactPreviewUrl,
  hasGraphArtifactVisualPreview,
  resolveGraphArtifactMimeType,
} from '../module-graph-shared'
import {
  buildArtifactGroupModalText,
  pickPrimaryExecutionArtifact,
  type ExecutionComparisonRow,
  type ExecutionComparisonSummary,
  type ExecutionPathDiagnosticRow,
} from './graph-execution-panel-helpers'
import { EmptyState } from '@/components/ui/empty-state'

export function ExecutionOutputGroupCard({
  group,
}: {
  group: { nodeId: string; nodeLabel: string; artifacts: GraphExecutionArtifactRecord[] }
}) {
  const { t, formatNumber } = useI18n()
  const [modalType, setModalType] = useState<'text' | 'image' | null>(null)
  const primaryArtifact = useMemo(() => pickPrimaryExecutionArtifact(group.artifacts), [group.artifacts])
  const modalText = useMemo(() => buildArtifactGroupModalText(group.artifacts), [group.artifacts])
  const hasVisualPreview = Boolean(primaryArtifact && hasGraphArtifactVisualPreview(primaryArtifact))
  const previewUrl = primaryArtifact ? getArtifactPreviewUrl(primaryArtifact) : null
  const mimeType = primaryArtifact ? resolveGraphArtifactMimeType(primaryArtifact) : null

  return (
    <>
      <div className="border-b border-line py-2.5 last:border-b-0">
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Text as="div" variant="title" className="truncate">{group.nodeLabel}</Text>
            {primaryArtifact ? <div className="truncate text-2xs text-muted-foreground">{primaryArtifact.port_key}</div> : null}
          </div>
          <Badge variant="outline" className="h-6 shrink-0 px-1.5">{t({ ko: '출력 {count}', en: 'Outputs {count}' }, { count: formatNumber(group.artifacts.length) })}</Badge>
        </div>

        {hasVisualPreview && previewUrl && primaryArtifact ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setModalType('image')}
            className="group relative block h-auto w-full overflow-hidden p-0"
          >
            <InlineMediaPreview
              src={previewUrl}
              mimeType={mimeType}
              alt={`${primaryArtifact.node_id}-${primaryArtifact.port_key}`}
              frameClassName="border-0 bg-transparent p-0"
              mediaClassName="h-[9.5rem] w-full object-contain"
            />
            <div className="pointer-events-none absolute inset-0 transition-colors duration-200 group-hover:bg-backdrop/30 group-focus-visible:bg-backdrop/30" />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
              <span className="rounded-sm bg-backdrop px-2.5 py-1 text-2xs font-medium text-white">{t({ ko: '보기', en: 'View' })}</span>
            </div>
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            onClick={() => setModalType('text')}
            className="h-[9.5rem] w-full"
          >
            <FileText aria-hidden />
            {t({ ko: '텍스트 컨텐츠', en: 'Text content' })}
          </Button>
        )}
      </div>

      <Modal
        open={modalType === 'text'}
        title={group.nodeLabel}
        widthClassName="max-w-4xl"
        onClose={() => setModalType(null)}
      >
        <pre className="max-h-[70vh] overflow-auto text-xs leading-5 text-foreground whitespace-pre-wrap break-words">
          {modalText}
        </pre>
      </Modal>

      <Modal
        open={modalType === 'image'}
        title={group.nodeLabel}
        widthClassName="max-w-6xl"
        onClose={() => setModalType(null)}
      >
        {previewUrl && primaryArtifact ? (
          <InlineMediaPreview
            src={previewUrl}
            mimeType={mimeType}
            alt={`${primaryArtifact.node_id}-${primaryArtifact.port_key}`}
            frameClassName="border-0 bg-transparent p-0"
            mediaClassName="max-h-[80vh] w-full object-contain"
          />
        ) : null}
      </Modal>
    </>
  )
}

export function ExecutionComparisonContextBlock({
  summary,
  rows,
  compact = false,
}: {
  summary: ExecutionComparisonSummary
  rows: ExecutionComparisonRow[]
  compact?: boolean
}) {
  const { t, formatNumber } = useI18n()
  const visibleRows = compact ? rows.slice(0, 5) : rows
  const hiddenRowCount = Math.max(0, rows.length - visibleRows.length)

  return (
    <div className="space-y-2.5">
      <Text as="div" variant="overline" className="flex flex-wrap items-center gap-2 font-semibold">
        <span>{t({ ko: '비교 맥락', en: 'Compare context' })}</span>
        <Badge variant="outline">{t({ ko: '입력 {count}', en: 'Inputs {count}' }, { count: formatNumber(summary.runtimeInputCount) })}</Badge>
        <Badge variant={summary.finalResultCount > 0 ? 'secondary' : 'outline'}>{t({ ko: '최종 {count}', en: 'Final {count}' }, { count: formatNumber(summary.finalResultCount) })}</Badge>
        {summary.issueLogCount > 0 ? <Badge variant="outline">{t({ ko: '경고/오류 {count}', en: 'Warnings/errors {count}' }, { count: formatNumber(summary.issueLogCount) })}</Badge> : null}
        {summary.finalResultWarningCount > 0 ? <Badge variant="outline">{t({ ko: '최종 경고 {count}', en: 'Final warnings {count}' }, { count: formatNumber(summary.finalResultWarningCount) })}</Badge> : null}
      </Text>

      {visibleRows.length === 0 ? (
        <EmptyState size="compact" title={t({ ko: '압축 입출력 원장 없음', en: 'No compact input/output ledger yet' })} />
      ) : (
        <div>
          {visibleRows.map((row) => (
            <div key={row.id} className="border-b border-line py-2.5 last:border-b-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={row.direction === 'output' ? 'secondary' : 'outline'}>{row.direction === 'output' ? t({ ko: '출력', en: 'Output' }) : t({ ko: '입력', en: 'Input' })}</Badge>
                <span className="min-w-0 truncate text-sm font-medium text-foreground">{row.nodeLabel}</span>
                <Badge variant="outline">{row.portKey}</Badge>
                {row.artifactType ? <Badge variant="outline">{row.artifactType}</Badge> : null}
              </div>
              {row.sourceLabel || row.refLabel || row.summaryText ? (
                <div className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                  {row.sourceLabel ? <div className="break-all">{t({ ko: '소스 {value}', en: 'Source {value}' }, { value: row.sourceLabel })}</div> : null}
                  {row.refLabel ? <div className="break-all">{row.refLabel}</div> : null}
                  {row.summaryText ? <div className="break-all">{row.summaryText}</div> : null}
                </div>
              ) : null}
            </div>
          ))}
          {hiddenRowCount > 0 ? (
            <div className="text-xs text-muted-foreground">
              {t({ ko: '추가 원장 {count}개는 상세에서 확인 가능', en: '{count} more ledger rows available in details' }, { count: formatNumber(hiddenRowCount) })}
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

export function ExecutionPathDiagnosticsBlock({
  rows,
  compact = false,
}: {
  rows: ExecutionPathDiagnosticRow[]
  compact?: boolean
}) {
  const { t, formatNumber } = useI18n()
  const visibleRows = compact ? rows.slice(0, 4) : rows
  const hiddenRowCount = Math.max(0, rows.length - visibleRows.length)

  if (rows.length === 0) {
    return null
  }

  return (
    <div className="space-y-2.5">
      <Text as="div" variant="overline" className="flex flex-wrap items-center gap-2 font-semibold">
        <span>{t({ ko: '경로 진단', en: 'Path diagnostics' })}</span>
      </Text>
      <div>
        {visibleRows.map((row) => (
          <div key={row.id} className="border-b border-line py-2.5 last:border-b-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={row.tone === 'failed' ? 'destructive' : row.tone === 'blocked' ? 'outline' : 'secondary'}>
                {row.tone === 'failed'
                  ? t({ ko: '실패', en: 'Failed' })
                  : row.tone === 'blocked'
                    ? t({ ko: '차단', en: 'Blocked' })
                    : t({ ko: '건너뜀', en: 'Skipped' })}
              </Badge>
              <span className="min-w-0 truncate text-sm font-medium text-foreground">{row.nodeLabel}</span>
              <Badge variant="outline">{row.reasonLabel}</Badge>
            </div>
            {row.sourceLabel ? <div className="mt-1.5 break-all text-xs text-muted-foreground">{t({ ko: '원인 {value}', en: 'Cause {value}' }, { value: row.sourceLabel })}</div> : null}
          </div>
        ))}
      </div>
      {hiddenRowCount > 0 ? (
        <div className="text-xs text-muted-foreground">
          {t({ ko: '추가 경로 진단 {count}개는 상세에서 확인 가능', en: '{count} more path diagnostics available in details' }, { count: formatNumber(hiddenRowCount) })}
        </div>
      ) : null}
    </div>
  )
}
