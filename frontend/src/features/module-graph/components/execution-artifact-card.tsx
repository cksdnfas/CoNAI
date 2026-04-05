import { Badge } from '@/components/ui/badge'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import type { GraphExecutionArtifactRecord } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatDateTime, getArtifactPreviewUrl } from '../module-graph-shared'
import { buildArtifactDetailLines, buildArtifactSummaryText, getCompactExecutionArtifactLabel } from './graph-execution-panel-helpers'

export interface ExecutionArtifactCardProps {
  artifact: GraphExecutionArtifactRecord
  compact?: boolean
  title?: string
  hideTitle?: boolean
  overlayLabel?: string
}

/** Render one execution artifact card with either a compact clean preview or the full technical card. */
export function ExecutionArtifactCard({ artifact, compact = false, title, hideTitle = false, overlayLabel }: ExecutionArtifactCardProps) {
  const previewUrl = getArtifactPreviewUrl(artifact)
  const summaryText = buildArtifactSummaryText(artifact)
  const detailLines = buildArtifactDetailLines(artifact)
  const displayTitle = title ?? getCompactExecutionArtifactLabel(artifact)
  const hasVisualPreview = Boolean(previewUrl && (artifact.artifact_type === 'image' || artifact.artifact_type === 'mask'))

  if (compact) {
    if (hasVisualPreview && hideTitle) {
      return (
        <div className="flex max-w-full">
          <div className="relative max-w-full overflow-hidden rounded-sm border border-border bg-surface-lowest">
            <InlineMediaPreview
              src={previewUrl}
              alt={`${artifact.node_id}-${artifact.port_key}`}
              frameClassName="border-0 bg-transparent p-0"
              mediaClassName="max-h-52 max-w-full w-auto object-contain"
              fitToMedia
            />
            {overlayLabel ? (
              <div className="pointer-events-none absolute left-2 top-2 max-w-[calc(100%-1rem)] rounded-sm bg-black/70 px-2 py-1 text-[11px] font-medium text-white shadow-sm backdrop-blur-sm">
                {overlayLabel}
              </div>
            ) : null}
          </div>
        </div>
      )
    }

    return (
      <div className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
        {!hideTitle ? <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{displayTitle}</div> : null}

        {hasVisualPreview ? (
          <div className="flex max-w-full">
            <div className="relative max-w-full">
              <InlineMediaPreview
                src={previewUrl}
                alt={`${artifact.node_id}-${artifact.port_key}`}
                frameClassName="p-0"
                mediaClassName="max-h-40 max-w-full w-auto object-contain"
                fitToMedia
              />
              {overlayLabel ? (
                <div className="pointer-events-none absolute left-2 top-2 max-w-[calc(100%-1rem)] rounded-sm bg-black/70 px-2 py-1 text-[11px] font-medium text-white shadow-sm backdrop-blur-sm">
                  {overlayLabel}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {!hasVisualPreview && overlayLabel ? <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{overlayLabel}</div> : null}
        {!previewUrl && summaryText ? <div className="text-sm leading-6 text-foreground whitespace-pre-wrap break-all">{summaryText}</div> : null}
      </div>
    )
  }

  return (
    <div className={cn('rounded-sm border border-border bg-surface-low p-3', compact ? 'space-y-2' : 'space-y-2.5')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-foreground">{title ?? artifact.port_key}</span>
            <Badge variant="outline">{artifact.artifact_type}</Badge>
          </div>
          <div className="text-[11px] text-muted-foreground">{formatDateTime(artifact.created_date)}</div>
        </div>
      </div>

      {previewUrl && (artifact.artifact_type === 'image' || artifact.artifact_type === 'mask') ? (
        <InlineMediaPreview
          src={previewUrl}
          alt={`${artifact.node_id}-${artifact.port_key}`}
          frameClassName="p-2"
          mediaClassName={cn('max-h-52 w-full object-contain')}
        />
      ) : null}

      {!previewUrl && summaryText ? <div className="text-sm leading-6 text-foreground whitespace-pre-wrap break-all">{summaryText}</div> : null}

      {previewUrl && detailLines.length > 0 ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          {detailLines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
