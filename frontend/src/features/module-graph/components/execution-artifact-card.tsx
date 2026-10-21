import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { MediaCard } from '@/components/common/media-card'
import { Inset } from '@/components/ui/inset'
import { Modal } from '@/components/ui/modal'
import { Text } from '@/components/ui/text'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import { useI18n } from '@/i18n'
import type { GraphExecutionArtifactRecord } from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import { getArtifactPreviewUrl, hasGraphArtifactVisualPreview, resolveGraphArtifactMimeType } from '../module-graph-shared'
import { ArtifactPreviewHoverOverlay } from './artifact-preview-hover'
import { buildArtifactDetailLines, buildArtifactSummaryText, getCompactExecutionArtifactLabel } from './graph-execution-panel-helpers'

interface ExecutionArtifactCardProps {
  artifact: GraphExecutionArtifactRecord
  compact?: boolean
  title?: string
  hideTitle?: boolean
  overlayLabel?: string
}

/** Render one execution artifact card with either a compact clean preview or the full technical card. */
export function ExecutionArtifactCard({ artifact, compact = false, title, hideTitle = false, overlayLabel }: ExecutionArtifactCardProps) {
  const { formatDateTime } = useI18n()
  const [isImageModalOpen, setIsImageModalOpen] = useState(false)
  const previewUrl = getArtifactPreviewUrl(artifact)
  const mimeType = resolveGraphArtifactMimeType(artifact)
  const summaryText = buildArtifactSummaryText(artifact)
  const detailLines = buildArtifactDetailLines(artifact)
  const displayTitle = title ?? getCompactExecutionArtifactLabel(artifact)
  const hasVisualPreview = hasGraphArtifactVisualPreview(artifact)

  const visualPreview = hasVisualPreview && previewUrl ? (
    <MediaCard onClick={() => setIsImageModalOpen(true)} className="group max-w-full" media={(
      <InlineMediaPreview
        src={previewUrl}
        mimeType={mimeType}
        alt={`${artifact.node_id}-${artifact.port_key}`}
        frameClassName={compact ? 'border-0 bg-transparent p-0' : 'border-0 p-2'}
        mediaClassName={cn(compact ? 'max-h-52 max-w-full w-auto object-contain' : 'max-h-52 w-full object-contain')}
        fitToMedia={compact}
      />
    )} overlay={(
      <>
      <ArtifactPreviewHoverOverlay />
      {overlayLabel ? (
        <Badge variant="overlay" className="pointer-events-none absolute top-2 left-2 max-w-[calc(100%-1rem)]">
          <span className="truncate">{overlayLabel}</span>
        </Badge>
      ) : null}
      </>
    )} />
  ) : null

  const imageModal = previewUrl ? (
    <Modal
      open={isImageModalOpen}
      title={displayTitle}
      widthClassName="max-w-6xl"
      onClose={() => setIsImageModalOpen(false)}
    >
      <InlineMediaPreview
        src={previewUrl}
        mimeType={mimeType}
        alt={`${artifact.node_id}-${artifact.port_key}`}
        frameClassName="border-0 bg-transparent p-0"
        mediaClassName="max-h-[80vh] w-full object-contain"
      />
    </Modal>
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
        <Inset padding="sm" className="space-y-2">
          {!hideTitle ? <Text as="div" variant="overline">{displayTitle}</Text> : null}
          {visualPreview}
          {!hasVisualPreview && overlayLabel ? <Text as="div" variant="overline">{overlayLabel}</Text> : null}
          {!previewUrl && summaryText ? <div className="text-sm leading-6 text-foreground whitespace-pre-wrap break-all">{summaryText}</div> : null}
        </Inset>
        {imageModal}
      </>
    )
  }

  return (
    <>
      <Inset padding="sm" className={cn(compact ? 'space-y-2' : 'space-y-2.5')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-medium text-foreground">{title ?? artifact.port_key}</span>
              <Badge variant="outline">{artifact.artifact_type}</Badge>
            </div>
            <div className="text-2xs text-muted-foreground">{formatDateTime(artifact.created_date)}</div>
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
      </Inset>
      {imageModal}
    </>
  )
}
