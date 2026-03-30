import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { SectionHeading } from '@/components/common/section-heading'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

export type WorkflowValidationIssue = {
  id: string
  nodeId?: string
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
  title = 'Execution Readiness',
  description = '실행 전에 막히는 입력/설정 문제를 여기서 먼저 보여줘.',
  showHeader = true,
  onIssueSelect,
}: WorkflowValidationPanelProps) {
  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length
  const isReady = errorCount === 0

  return (
    <Card className="bg-surface-container">
      <CardContent className="space-y-3.5">
        {showHeader ? (
          <SectionHeading
            variant="inside"
            heading={title}
            description={description}
          />
        ) : null}

        <div className={`rounded-sm border px-4 py-3 ${isReady ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'}`}>
          <div className="flex flex-wrap items-center gap-2">
            {isReady ? <CheckCircle2 className="h-4 w-4 text-emerald-300" /> : <AlertTriangle className="h-4 w-4 text-amber-300" />}
            <div className="text-sm font-medium text-foreground">{isReady ? '지금 바로 실행 가능' : '수정이 필요한 실행 문제 있음'}</div>
            <Badge variant={isReady ? 'secondary' : 'outline'}>{isReady ? 'ready' : `errors ${errorCount}`}</Badge>
            {warningCount > 0 ? <Badge variant="outline">warnings {warningCount}</Badge> : null}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {isReady ? '필수 입력과 주요 시스템 설정이 현재 기준으로는 충족돼.' : '아래 이슈들을 해결해야 실행이 덜 막혀.'}
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
                  className={`w-full rounded-sm border px-3 py-3 text-left ${issue.severity === 'error' ? 'border-amber-500/40 bg-amber-500/10' : 'border-border bg-surface-low'} ${canFocusNode ? 'cursor-pointer transition hover:border-primary/50 hover:bg-surface-high' : 'cursor-default'}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="text-sm font-medium text-foreground">{issue.title}</div>
                    <Badge variant={issue.severity === 'error' ? 'outline' : 'secondary'}>{issue.nodeLabel}</Badge>
                    {issue.nodeId ? <Badge variant="outline">node {issue.nodeId}</Badge> : null}
                    {canFocusNode ? <Badge variant="secondary">노드로 이동</Badge> : null}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{issue.detail}</div>
                </button>
              )
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
