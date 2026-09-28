import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Inset } from '@/components/ui/inset'
import { Modal } from '@/components/ui/modal'
import { Text } from '@/components/ui/text'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'
import { useI18n } from '@/i18n'
import type { GraphExecutionArtifactRecord } from '@/lib/api-module-graph'
import { cn } from '@/lib/utils'
import { getArtifactPreviewUrl, hasGraphArtifactVisualPreview, resolveGraphArtifactMimeType } from '../module-graph-shared'
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
  const { t, formatDateTime } = useI18n()
  const [isImageModalOpen, setIsImageModalOpen] = useState(false)
  const previewUrl = getArtifactPreviewUrl(artifact)
  const mimeType = resolveGraphArtifactMimeType(artifact)
  const summaryText = buildArtifactSummaryText(artifact)
  const detailLines = buildArtifactDetailLines(artifact)
  const displayTitle = title ?? getCompactExecutionArtifactLabel(artifact)
  const hasVisualPreview = hasGraphArtifactVisualPreview(artifact)

  const visualPreview = hasVisualPreview && previewUrl ? (
    <Button type="button" variant="ghost" onClick={() => setIsImageModalOpen(true)} className="group relative block h-auto max-w-full overflow-hidden p-0">
      <InlineMediaPreview
        src={previewUrl}
        mimeType={mimeType}
        alt={`${artifact.node_id}-${artifact.port_key}`}
        frameClassName={compact ? 'border-0 bg-transparent p-0' : 'border-0 p-2'}
        mediaClassName={cn(compact ? 'max-h-52 max-w-full w-auto object-contain' : 'max-h-52 w-full object-contain')}
        fitToMedia={compact}
      />
      <div className="pointer-events-none absolute inset-0 transition-colors duration-200 group-hover:bg-backdrop/30 group-focus-visible:bg-backdrop/30" />
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
        <span className="rounded-sm bg-backdrop px-2.5 py-1 text-2xs font-medium text-white">{t({ ko: '보기', en: 'View' })}</span>
      </div>
      {overlayLabel ? (
        <div className="pointer-events-none absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate rounded-sm bg-backdrop px-2 py-1 text-2xs font-medium text-white backdrop-blur-sm">
          {overlayLabel}
        </div>
      ) : null}
    </Button>
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
        <Inset className="space-y-2 p-3">
          {!hideTitle ? <Text as="div" variant="overline" className="font-semibold">{displayTitle}</Text> : null}
          {visualPreview}
          {!hasVisualPreview && overlayLabel ? <Text as="div" variant="overline" className="font-semibold">{overlayLabel}</Text> : null}
          {!previewUrl && summaryText ? <div className="text-sm leading-6 text-foreground whitespace-pre-wrap break-all">{summaryText}</div> : null}
        </Inset>
        {imageModal}
      </>
    )
  }

  return (
    <>
      <Inset className={cn('p-3', compact ? 'space-y-2' : 'space-y-2.5')}>
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
