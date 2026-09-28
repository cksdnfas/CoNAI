import { AlertTriangle, Crosshair } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/icon-button'
import { Inset } from '@/components/ui/inset'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { WorkflowValidationIssue } from '../module-graph-types'
import { TechnicalReferenceHint } from './module-graph-field-shared'

export type { WorkflowValidationIssue } from '../module-graph-types'

type WorkflowValidationPanelProps = {
  issues: WorkflowValidationIssue[]
  title?: string
  showHeader?: boolean
  onIssueSelect?: (issue: WorkflowValidationIssue) => void
}

function getActivationStateLabel(issue: WorkflowValidationIssue, t: ReturnType<typeof useI18n>['t']) {
  switch (issue.activationState) {
    case 'definition-missing':
      return t({ ko: '정의 없음', en: 'Definition missing' })
    case 'final-result-required':
      return t({ ko: '최종 결과 필요', en: 'Final result required' })
    case 'missing-required-input':
      return t({ ko: '필수 입력 누락', en: 'Required input missing' })
    case 'runtime-input-waiting':
      return t({ ko: '실행 입력 대기', en: 'Runtime input waiting' })
    case 'system-capability-disabled':
      return t({ ko: '기능 비활성', en: 'Capability disabled' })
    default:
      return null
  }
}

/** Summarize whether a workflow can run and list blocking reasons in plain language. */
export function WorkflowValidationPanel({
  issues,
  title,
  showHeader = true,
  onIssueSelect,
}: WorkflowValidationPanelProps) {
  const { t, formatNumber } = useI18n()
  const resolvedTitle = title ?? t({ ko: '실행 준비 상태', en: 'Execution Readiness' })
  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length
  const runtimeInputWaitingCount = issues.filter((issue) => issue.activationState === 'runtime-input-waiting').length
  const shouldShowSummary = issues.length > 0

  if (issues.length === 0 && !showHeader) {
    return null
  }

  return (
    <div className="space-y-3.5">
      {showHeader ? (
        <SectionHeading variant="inside" heading={resolvedTitle} />
      ) : null}

      {shouldShowSummary ? (
        <Inset className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <AlertTriangle className={cn('h-4 w-4', errorCount > 0 ? 'text-destructive' : 'text-warning')} aria-hidden />
            <Text variant="label">{errorCount > 0 ? t({ ko: '치명 이슈가 있어 실행이 막혀', en: 'Critical issues are blocking execution' }) : t({ ko: '경고가 있지만 실행 전 보완 가능해', en: 'There are warnings, but you can fix them before execution' })}</Text>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {errorCount > 0 ? <Badge variant="destructive">{t({ ko: '치명 {count}', en: 'Critical {count}' }, { count: formatNumber(errorCount) })}</Badge> : null}
            {warningCount > 0 ? <Badge className="bg-warning-soft text-warning-soft-foreground">{t({ ko: '경고 {count}', en: 'Warnings {count}' }, { count: formatNumber(warningCount) })}</Badge> : null}
            {runtimeInputWaitingCount > 0 ? <Badge variant="secondary">{t({ ko: '실행 입력 {count}', en: 'Runtime inputs {count}' }, { count: formatNumber(runtimeInputWaitingCount) })}</Badge> : null}
          </div>
        </Inset>
      ) : null}

      {issues.length > 0 ? (
        <ul className="space-y-2">
          {issues.map((issue) => {
            const canFocusNode = Boolean(issue.nodeId && onIssueSelect)
            const activationStateLabel = getActivationStateLabel(issue, t)

            return (
              <li
                key={issue.id}
                data-severity={issue.severity}
                className={cn('rounded-sm px-3 py-3', issue.severity === 'error' ? 'bg-destructive-soft/45' : 'bg-warning-soft/45')}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Text as="span" variant="label">{issue.title}</Text>
                  <Badge variant="outline">{issue.severity === 'error' ? t({ ko: '치명', en: 'Critical' }) : t({ ko: '경고', en: 'Warning' })}</Badge>
                  {activationStateLabel ? <Badge variant="outline">{activationStateLabel}</Badge> : null}
                  <Badge variant="secondary">{issue.nodeLabel}</Badge>
                  {issue.nodeId ? <TechnicalReferenceHint title={`node ${issue.nodeId}${issue.portKey ? `\nport ${issue.portKey}` : ''}`} label={t({ ko: '이슈 대상 내부 식별자 보기', en: 'Show issue target internal identifier' })} /> : null}
                  {canFocusNode ? (
                    <IconButton size="icon-xs" variant="ghost" className="ml-auto" onClick={() => onIssueSelect?.(issue)} label={t({ ko: '노드로 이동', en: 'Jump to node' })}>
                      <Crosshair aria-hidden />
                    </IconButton>
                  ) : null}
                </div>
                <Text variant="caption" className="mt-1">{issue.detail}</Text>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
