import type { ImageDetailRenderMode } from './image-detail-utils'
import type { PixelPreviewMode, PixelPreviewSettings } from './image-detail-pixel-preview-utils'
import { ImageDetailAuxiliaryControls, ImageDetailTransformControls } from './image-detail-media-controls'

interface ImageDetailMediaToolbarProps {
  activePixelPreviewSettings: PixelPreviewSettings
  canToggleRenderMode: boolean
  canUsePixelPreview: boolean
  canZoomIn: boolean
  canZoomOut: boolean
  isControlsCollapsed: boolean
  isDefaultView: boolean
  isPixelPreviewEnabled: boolean
  isPixelPreviewPanelOpen: boolean
  isWheelZoomEnabled: boolean
  onResetView: () => void
  onRotateLeft: () => void
  onRotateRight: () => void
  onSetPixelPreviewMode: (mode: PixelPreviewMode) => void
  onToggleControlsCollapsed: () => void
  onTogglePixelPreviewEnabled: () => void
  onTogglePixelPreviewPanel: () => void
  onToggleRenderMode: () => void
  onToggleWheelZoomEnabled: () => void
  onUpdatePixelPreviewSettings: (patch: Partial<PixelPreviewSettings>) => void
  onZoomIn: () => void
  onZoomOut: () => void
  pixelPreviewMode: PixelPreviewMode
  renderMode: ImageDetailRenderMode
  transformSummary: string
}

/** Compose the auxiliary and transform toolbars outside the media/gesture implementation. */
export function ImageDetailMediaToolbar(props: ImageDetailMediaToolbarProps) {
  return (
    <>
      <ImageDetailAuxiliaryControls
        canToggleRenderMode={props.canToggleRenderMode}
        canUsePixelPreview={props.canUsePixelPreview}
        renderMode={props.renderMode}
        pixelPreviewMode={props.pixelPreviewMode}
        isPixelPreviewEnabled={props.isPixelPreviewEnabled}
        isPixelPreviewPanelOpen={props.isPixelPreviewPanelOpen}
        activePixelPreviewSettings={props.activePixelPreviewSettings}
        onToggleRenderMode={props.onToggleRenderMode}
        onTogglePixelPreviewPanel={props.onTogglePixelPreviewPanel}
        onTogglePixelPreviewEnabled={props.onTogglePixelPreviewEnabled}
        onSetPixelPreviewMode={props.onSetPixelPreviewMode}
        onUpdatePixelPreviewSettings={props.onUpdatePixelPreviewSettings}
      />
      <ImageDetailTransformControls
        canZoomIn={props.canZoomIn}
        canZoomOut={props.canZoomOut}
        isControlsCollapsed={props.isControlsCollapsed}
        isDefaultView={props.isDefaultView}
        isWheelZoomEnabled={props.isWheelZoomEnabled}
        transformSummary={props.transformSummary}
        onToggleWheelZoomEnabled={props.onToggleWheelZoomEnabled}
        onZoomIn={props.onZoomIn}
        onZoomOut={props.onZoomOut}
        onRotateLeft={props.onRotateLeft}
        onRotateRight={props.onRotateRight}
        onResetView={props.onResetView}
        onToggleControlsCollapsed={props.onToggleControlsCollapsed}
      />
    </>
  )
}
