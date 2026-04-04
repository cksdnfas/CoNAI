import { Badge } from '@/components/ui/badge'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import type { GraphExecutionArtifactRecord } from '@/lib/api'
import { formatDateTime, getArtifactPreviewUrl } from '../module-graph-shared'
import { cn } from '@/lib/utils'
import { buildArtifactDetailLines, buildArtifactSummaryText } from './graph-execution-panel-helpers'

export interface ExecutionArtifactCardProps {
  artifact: GraphExecutionArtifactRecord
  compact?: boolean
}

/** Render one execution artifact card with preview, summary text, and detail lines. */
export function ExecutionArtifactCard({ artifact, compact = false }: ExecutionArtifactCardProps) {
  const previewUrl = getArtifactPreviewUrl(artifact)
  const summaryText = buildArtifactSummaryText(artifact)
  const detailLines = buildArtifactDetailLines(artifact)

  return (
    <div className={cn('rounded-sm border border-border bg-surface-low p-3', compact ? 'space-y-2' : 'space-y-2.5')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium text-foreground">{artifact.port_key}</span>
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
          mediaClassName={cn(compact ? 'max-h-40 w-full object-contain' : 'max-h-52 w-full object-contain')}
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
