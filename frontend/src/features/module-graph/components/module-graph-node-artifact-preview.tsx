import type { MouseEvent } from 'react'
import { InlineMediaPreview } from '@/features/images/components/inline-media-preview'

/** Prevent artifact preview controls from triggering node drag or canvas selection. */
function stopArtifactPreviewActionEvent(event: MouseEvent<HTMLElement>) {
  event.preventDefault()
  event.stopPropagation()
}

/** Render a compact text artifact preview with optional modal expansion. */
function ArtifactTextPreviewCard({
  preview,
  fullText,
  onOpen,
}: {
  preview: string
  fullText?: string | null
  onOpen: () => void
}) {
  const canOpen = Boolean(fullText && (fullText !== preview || fullText.includes('\n')))

  return (
    <div className="px-1 py-1 text-[11px] leading-4 text-foreground">
      <div className="max-h-[6.25rem] overflow-hidden whitespace-pre-wrap break-words [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:5]">{preview}</div>
      {canOpen ? (
        <button type="button" className="mt-1 text-[10px] text-muted-foreground hover:text-foreground" onMouseDown={stopArtifactPreviewActionEvent} onClick={onOpen}>
          open
        </button>
      ) : null}
    </div>
  )
}

/** Render one minimal output preview body so result nodes stay plain instead of card-heavy. */
export function NodeArtifactPreviewBody({
  previewUrl,
  previewAlt,
  textPreview,
  textValue,
  onOpenText,
  compact = false,
}: {
  previewUrl?: string | null
  previewAlt: string
  textPreview?: string | null
  textValue?: string | null
  onOpenText: () => void
  compact?: boolean
}) {
  if (previewUrl) {
    return (
      <InlineMediaPreview
        src={previewUrl}
        alt={previewAlt}
        frameClassName="mt-1 border-border/50 bg-background/30 p-1"
        mediaClassName={compact ? 'max-h-20 w-full object-contain' : 'max-h-24 w-full object-contain'}
      />
    )
  }

  if (textPreview) {
    return (
      <div className="mt-1 border-l border-border/40 pl-2">
        <ArtifactTextPreviewCard preview={textPreview} fullText={textValue} onOpen={onOpenText} />
      </div>
    )
  }

  return null
}
