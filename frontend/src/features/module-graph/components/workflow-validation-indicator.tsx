import { useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import type { WorkflowValidationIssue } from '../module-graph-types'

/**
 * Validation state as one icon: green check when clean, a warning/critical icon with a count otherwise. Opens the issue
 * list; picking an issue jumps to its node (the caller opens the editor when needed).
 */
export function WorkflowValidationIndicator({
  issues,
  onIssueSelect,
  size = 'icon-sm',
  className,
}: {
  issues: WorkflowValidationIssue[]
  onIssueSelect?: (issue: WorkflowValidationIssue) => void
  size?: 'icon-sm' | 'icon'
  className?: string
}) {
  const { t, formatNumber } = useI18n()
  const [open, setOpen] = useState(false)
  const errorCount = issues.filter((issue) => issue.severity === 'error').length
  const warningCount = issues.filter((issue) => issue.severity === 'warning').length
  const tone = errorCount > 0 ? 'error' : warningCount > 0 ? 'warning' : 'ready'
  const label = tone === 'error'
    ? t({ ko: '실행을 막는 문제 {count}개', en: '{count} blocking issues' }, { count: formatNumber(errorCount) })
    : tone === 'warning'
      ? t({ ko: '경고 {count}개', en: '{count} warnings' }, { count: formatNumber(warningCount) })
      : t({ ko: '검증 통과', en: 'Validation passed' })
  const count = errorCount > 0 ? errorCount : warningCount

  const button = (
    <IconButton
      size={size}
      variant="ghost"
      label={label}
      className={cn(
        'relative',
        tone === 'ready' && 'text-success hover:text-success',
        tone === 'warning' && 'text-warning hover:text-warning',
        tone === 'error' && 'text-destructive hover:text-destructive',
        className,
      )}
    >
      {tone === 'ready' ? <CheckCircle2 /> : <AlertTriangle />}
      {count > 0 ? (
        <span
          aria-hidden
          className={cn(
            'absolute top-0 right-0 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-1 font-mono text-2xs leading-none font-bold',
            tone === 'error' ? 'bg-destructive text-background' : 'bg-warning text-background',
          )}
        >
          {count}
        </span>
      ) : null}
    </IconButton>
  )

  if (issues.length === 0) {
    return button
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-[min(360px,calc(100vw-2rem))] p-1.5">
        <div className="max-h-[min(50vh,420px)] overflow-y-auto">
          {issues.map((issue) => (
            <Button
              key={issue.id}
              type="button"
              variant="ghost"
              disabled={!onIssueSelect || !issue.nodeId}
              onClick={() => {
                setOpen(false)
                onIssueSelect?.(issue)
              }}
              className="h-auto w-full items-start justify-start gap-2 px-2 py-2 text-left font-normal whitespace-normal disabled:opacity-100"
            >
              <AlertTriangle className={cn('mt-0.5 size-4 shrink-0', issue.severity === 'error' ? 'text-destructive' : 'text-warning')} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-foreground">
                  {issue.nodeLabel ? <span className="text-muted-foreground">{issue.nodeLabel} · </span> : null}
                  {issue.title}
                </span>
                {issue.detail ? <span className="mt-0.5 block text-xs text-muted-foreground">{issue.detail}</span> : null}
              </span>
            </Button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
