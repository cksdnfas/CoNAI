import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Inset } from '@/components/ui/inset'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import type {
  GraphExecutionArtifactRecord,
  GraphExecutionFinalResultRecord,
  GraphExecutionLogRecord,
  GraphExecutionNodeIoRecord,
  GraphExecutionRecord,
} from '@/lib/api-module-graph'
import { getGraphExecutionStatusLabel } from '../module-graph-shared'
import {
  formatPrimitiveValue,
  getExecutionInputEntries,
  getExecutionModeLabel,
  type ParsedExecutionPlan,
} from './graph-execution-panel-helpers'

export type GraphExecutionDetail = {
  execution: GraphExecutionRecord
  artifacts: GraphExecutionArtifactRecord[]
  final_results: GraphExecutionFinalResultRecord[]
  logs: GraphExecutionLogRecord[]
  node_io: GraphExecutionNodeIoRecord[]
}

/** Failed runs get the destructive badge, completed ones the filled neutral badge. */
export function getExecutionStatusBadgeVariant(status: GraphExecutionRecord['status']) {
  if (status === 'failed') {
    return 'destructive' as const
  }

  return status === 'completed' ? 'secondary' as const : 'outline' as const
}

export const CODE_BLOCK_CLASS_NAME = 'overflow-auto rounded-sm bg-field p-2.5 text-2xs text-foreground'

/**
 * Run identity shared by the inline summary and the detail modal: id, status, mode, caller extras, date.
 * Renders a fragment so each caller keeps its own row container.
 */
export function ExecutionHeaderBadges({
  execution,
  plan,
  idClassName,
  children,
}: {
  execution: GraphExecutionRecord
  plan: ParsedExecutionPlan | null
  idClassName?: string
  children?: ReactNode
}) {
  const { t, formatDateTime } = useI18n()

  return (
    <>
      <span className={idClassName}>#{execution.id}</span>
      <Badge variant={getExecutionStatusBadgeVariant(execution.status)}>{getGraphExecutionStatusLabel(execution.status, t)}</Badge>
      <Badge variant="outline">{getExecutionModeLabel(plan, t)}</Badge>
      {children}
      <span className="text-2xs text-muted-foreground">{formatDateTime(execution.created_date)}</span>
    </>
  )
}

/** Inputs heading + value grid shared by the inline summary and the detail modal. */
export function ExecutionInputEntriesList({
  entries,
  itemClassName,
}: {
  entries: ReturnType<typeof getExecutionInputEntries>
  itemClassName: string
}) {
  const { t, formatNumber } = useI18n()

  return (
    <>
      <Text as="div" variant="overline" className="flex flex-wrap items-center gap-2 font-semibold">
        <span>{t({ ko: '입력', en: 'Inputs' })}</span>
        <Badge variant="outline">{formatNumber(entries.length)}</Badge>
      </Text>
      <div className="grid gap-2 md:grid-cols-2">
        {entries.map((entry) => (
          <Inset key={entry.key} className={itemClassName}>
            <Text as="div" variant="overline" className="font-semibold">{entry.label}</Text>
            {entry.label !== entry.key ? <div className="mt-0.5 text-2xs text-muted-foreground">{entry.key}</div> : null}
            <div className="mt-1 text-sm text-foreground whitespace-pre-wrap break-all">{formatPrimitiveValue(entry.value, t)}</div>
          </Inset>
        ))}
      </div>
    </>
  )
}
