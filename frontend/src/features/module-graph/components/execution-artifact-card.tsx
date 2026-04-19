import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import type { GraphExecutionArtifactRecord } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatDateTime, getArtifactPreviewUrl, hasGraphArtifactVisualPreview, resolveGraphArtifactMimeType } from '../module-graph-shared'
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
  const [isImageModalOpen, setIsImageModalOpen] = useState(false)
  const previewUrl = getArtifactPreviewUrl(artifact)
  const mimeType = resolveGraphArtifactMimeType(artifact)
  const summaryText = buildArtifactSummaryText(artifact)
  const detailLines = buildArtifactDetailLines(artifact)
  const displayTitle = title ?? getCompactExecutionArtifactLabel(artifact)
  const hasVisualPreview = hasGraphArtifactVisualPreview(artifact)

  const visualPreview = hasVisualPreview && previewUrl ? (
    <button type="button" onClick={() => setIsImageModalOpen(true)} className="group relative block max-w-full overflow-hidden rounded-sm">
      <InlineMediaPreview
        src={previewUrl}
        mimeType={mimeType}
        alt={`${artifact.node_id}-${artifact.port_key}`}
        frameClassName={compact ? 'border-0 bg-transparent p-0' : 'p-2'}
        mediaClassName={cn(compact ? 'max-h-52 max-w-full w-auto object-contain' : 'max-h-52 w-full object-contain')}
        fitToMedia={compact}
      />
      <div className="pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/24 group-focus-visible:bg-black/24" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
        <span className="rounded-sm bg-black/72 px-2.5 py-1 text-[11px] font-medium text-white">보기</span>
      </div>
      {overlayLabel ? (
        <div className="pointer-events-none absolute left-2 top-2 max-w-[calc(100%-1rem)] rounded-sm bg-black/70 px-2 py-1 text-[11px] font-medium text-white shadow-sm backdrop-blur-sm">
          {overlayLabel}
        </div>
      ) : null}
    </button>
  ) : null

  const imageModal = previewUrl ? (
    <SettingsModal
      open={isImageModalOpen}
      title={displayTitle}
      widthClassName="max-w-6xl"
      onClose={() => setIsImageModalOpen(false)}
      closeOnBack={false}
    >
      <InlineMediaPreview
        src={previewUrl}
        mimeType={mimeType}
        alt={`${artifact.node_id}-${artifact.port_key}`}
        frameClassName="border-0 bg-transparent p-0"
        mediaClassName="max-h-[80vh] w-full object-contain"
      />
    </SettingsModal>
  ) : null

  if (compact) {
    if (hasVisualPreview && hideTitle) {
      return (
        <>
          <div className="flex max-w-full">{visualPreview}</div>
          {imageModal}
        </>
      )
    }

    return (
      <>
        <div className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
          {!hideTitle ? <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{displayTitle}</div> : null}
          {visualPreview}
          {!hasVisualPreview && overlayLabel ? <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{overlayLabel}</div> : null}
          {!previewUrl && summaryText ? <div className="text-sm leading-6 text-foreground whitespace-pre-wrap break-all">{summaryText}</div> : null}
        </div>
        {imageModal}
      </>
    )
  }

  return (
    <>
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

        {visualPreview}

        {!previewUrl && summaryText ? <div className="text-sm leading-6 text-foreground whitespace-pre-wrap break-all">{summaryText}</div> : null}

        {previewUrl && detailLines.length > 0 ? (
          <div className="space-y-1 text-xs text-muted-foreground">
            {detailLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        ) : null}
      </div>
      {imageModal}
    </>
  )
}
