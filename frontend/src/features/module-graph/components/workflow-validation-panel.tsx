import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n'
import { TechnicalReferenceHint } from './module-graph-field-shared'

export type WorkflowValidationIssue = {
  id: string
  nodeId?: string
  portKey?: string
  nodeLabel: string
  severity: 'error' | 'warning'
  title: string
  detail: string
}

type WorkflowValidationPanelProps = {
  issues: WorkflowValidationIssue[]
  title?: string
  description?: string
  showHeader?: boolean
  onIssueSelect?: (issue: WorkflowValidationIssue) => void
}

/** Summarize whether a workflow can run and list blocking reasons in plain language. */
export function WorkflowValidationPanel({
  issues,
  title,
  description,
  showHeader = true,
  onIssueSelect,
}: WorkflowValidationPanelProps) {
  const { t, formatNumber } = useI18n()
  const resolvedTitle = title ?? t({ ko: '실행 준비 상태', en: 'Execution Readiness' })
  const resolvedDescription = description ?? t({ ko: '실행 전 확인', en: 'Before execution' })
  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length
  const isReady = errorCount === 0

  return (
    <div className="space-y-3.5">
      {showHeader ? (
        <SectionHeading
          variant="inside"
          heading={resolvedTitle}
          description={resolvedDescription}
        />
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-3 rounded-sm border border-border/70 bg-surface-low px-4 py-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {errorCount > 0 ? <AlertTriangle className="h-4 w-4 text-rose-300" /> : warningCount > 0 ? <AlertTriangle className="h-4 w-4 text-amber-300" /> : <CheckCircle2 className="h-4 w-4 text-emerald-300" />}
            <div className="text-sm font-medium text-foreground">{errorCount > 0 ? t({ ko: '치명 이슈가 있어 실행이 막혀', en: 'Critical issues are blocking execution' }) : warningCount > 0 ? t({ ko: '경고가 있지만 실행 전 보완 가능해', en: 'There are warnings, but you can fix them before execution' }) : t({ ko: '지금 바로 실행 가능', en: 'Ready to run now' })}</div>
          </div>
          <div className="text-xs text-muted-foreground">
            {errorCount > 0 ? t({ ko: '아래 치명 이슈를 먼저 정리해.', en: 'Resolve the critical issues below first.' }) : warningCount > 0 ? t({ ko: '아래 경고는 저장 가능하지만 실행 전에 확인하는 쪽이 좋아.', en: 'The warnings below can be saved, but it is better to review them before execution.' }) : t({ ko: '필수 입력 확인 완료.', en: 'Required inputs confirmed.' })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isReady ? 'secondary' : 'outline'}>{isReady ? 'ready' : t({ ko: '치명 {count}', en: 'Critical {count}' }, { count: formatNumber(errorCount) })}</Badge>
          {warningCount > 0 ? <Badge variant="outline">{t({ ko: '경고 {count}', en: 'Warnings {count}' }, { count: formatNumber(warningCount) })}</Badge> : null}
        </div>
      </div>

      {issues.length > 0 ? (
        <div className="space-y-2">
          {issues.map((issue) => {
            const canFocusNode = Boolean(issue.nodeId && onIssueSelect)

            return (
              <button
                key={issue.id}
                type="button"
                onClick={() => onIssueSelect?.(issue)}
                disabled={!canFocusNode}
                className={`w-full rounded-sm border px-3 py-3 text-left ${issue.severity === 'error' ? 'border-rose-500/40 bg-rose-500/10' : 'border-amber-500/40 bg-amber-500/10'} ${canFocusNode ? 'cursor-pointer transition hover:border-primary/50 hover:bg-surface-high' : 'cursor-default'}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm font-medium text-foreground">{issue.title}</div>
                  <Badge variant={issue.severity === 'error' ? 'outline' : 'secondary'}>{issue.severity === 'error' ? t({ ko: '치명', en: 'Critical' }) : t({ ko: '경고', en: 'Warning' })}</Badge>
                  <Badge variant="secondary">{issue.nodeLabel}</Badge>
                  {issue.nodeId ? <TechnicalReferenceHint title={`node ${issue.nodeId}${issue.portKey ? `\nport ${issue.portKey}` : ''}`} label={t({ ko: '이슈 대상 내부 식별자 보기', en: 'Show issue target internal identifier' })} /> : null}
                  {canFocusNode ? <Badge variant="secondary">{t({ ko: '노드로 이동', en: 'Jump to node' })}</Badge> : null}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{issue.detail}</div>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
