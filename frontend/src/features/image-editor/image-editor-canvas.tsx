import { useEffect, useState, type RefObject, type WheelEvent } from 'react'
import { Group, Image as KonvaImage, Layer, Line, Rect, Stage, Text } from 'react-konva'
import type { ImageEditorCropRect, ImageEditorLayer, ImageEditorStroke, ImageEditorTool } from './image-editor-types'
import { loadEditorImage } from './image-editor-utils'

interface ImageEditorCanvasProps {
  viewportRef: RefObject<HTMLDivElement | null>
  documentGroupRef: RefObject<any>
  baseImage: HTMLImageElement | null
  loading: boolean
  viewportSize: { width: number; height: number }
  documentSize: { width: number; height: number }
  pan: { x: number; y: number }
  zoom: number
  rotation: number
  flippedX: boolean
  layers: ImageEditorLayer[]
  activeLayerId: string | null
  tool: ImageEditorTool
  brushPreviewPoint: { x: number; y: number } | null
  brushSize: number
  brushOpacity: number
  enableMaskEditing: boolean
  maskPreviewSurface: HTMLCanvasElement | null
  maskStrokes: ImageEditorStroke[]
  normalizedSelectionRect: ImageEditorCropRect | null
  normalizedCropRect: ImageEditorCropRect | null
  selectionHandleSize: number
  onWheel: (event: WheelEvent<HTMLDivElement>) => void
  onStagePointerDown: () => void
  onStagePointerMove: () => void
  onStagePointerUp: () => void
  onMovePasteLayer: (layerId: string, nextX: number, nextY: number) => void
}

function getImageEditorToolLabel(tool: ImageEditorTool) {
  switch (tool) {
    case 'pan':
      return 'Pan'
    case 'select':
      return 'Select'
    case 'brush':
      return 'Brush'
    case 'eraser':
      return 'Eraser'
    case 'mask-brush':
      return 'Mask Brush'
    case 'mask-eraser':
      return 'Mask Eraser'
    case 'crop':
      return 'Crop'
    default:
      return tool
  }
}

type LoadedPasteImageProps = {
  layer: Extract<ImageEditorLayer, { type: 'paste' }>
  isActive: boolean
  onMove: (layerId: string, nextX: number, nextY: number) => void
}

/** Render one pasted bitmap node and keep image loading local to the layer view. */
function LoadedPasteImage({ layer, isActive, onMove }: LoadedPasteImageProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const loadedImage = await loadEditorImage(layer.imageDataUrl)
        if (!cancelled) {
          setImage(loadedImage)
        }
      } catch {
        if (!cancelled) {
          setImage(null)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [layer.imageDataUrl])

  if (!image) {
    return null
  }

  return (
    <KonvaImage
      image={image}
      x={layer.x}
      y={layer.y}
      width={layer.width}
      height={layer.height}
      draggable={isActive && !layer.locked}
      onDragEnd={(event) => onMove(layer.id, event.target.x(), event.target.y())}
      stroke={isActive ? '#38bdf8' : undefined}
      strokeWidth={isActive ? 1.5 : 0}
    />
  )
}

/** Render the editor stage, overlays, and visible layer content. */
export function ImageEditorCanvas({
  viewportRef,
  documentGroupRef,
  baseImage,
  loading,
  viewportSize,
  documentSize,
  pan,
  zoom,
  rotation,
  flippedX,
  layers,
  activeLayerId,
  tool,
  brushPreviewPoint,
  brushSize,
  brushOpacity,
  enableMaskEditing,
  maskPreviewSurface,
  maskStrokes,
  normalizedSelectionRect,
  normalizedCropRect,
  selectionHandleSize,
  onWheel,
  onStagePointerDown,
  onStagePointerMove,
  onStagePointerUp,
  onMovePasteLayer,
}: ImageEditorCanvasProps) {
  const isMaskTool = tool === 'mask-brush' || tool === 'mask-eraser'
  const canvasCursorClassName = tool === 'pan'
    ? 'cursor-grab'
    : tool === 'select' || tool === 'crop'
      ? 'cursor-crosshair'
      : tool === 'brush' || tool === 'eraser' || isMaskTool
        ? 'cursor-none'
        : 'cursor-default'

  return (
    <div
      ref={viewportRef}
      className={`relative h-[70vh] min-h-[540px] overflow-hidden overscroll-contain rounded-sm border ${isMaskTool ? 'border-red-400/70 shadow-[inset_0_0_0_1px_rgba(248,113,113,0.35)]' : 'border-border'} bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.06),_transparent_55%),linear-gradient(45deg,_rgba(255,255,255,0.03)_25%,_transparent_25%),linear-gradient(-45deg,_rgba(255,255,255,0.03)_25%,_transparent_25%),linear-gradient(45deg,_transparent_75%,_rgba(255,255,255,0.03)_75%),linear-gradient(-45deg,_transparent_75%,_rgba(255,255,255,0.03)_75%)] [background-position:0_0,0_0,0_12px,12px_-12px,-12px_0] [background-size:auto,24px_24px,24px_24px,24px_24px,24px_24px] ${canvasCursorClassName}`}
      onWheelCapture={onWheel}
    >
      <div className="pointer-events-none absolute left-3 top-3 z-20 flex flex-wrap gap-2 rounded-sm border border-white/10 bg-black/55 px-3 py-2 text-[11px] text-white shadow-lg backdrop-blur-sm">
        <span className="font-medium text-white/90">{getImageEditorToolLabel(tool)}</span>
        <span className="text-white/50">•</span>
        <span>Zoom {Math.round(zoom * 100)}%</span>
        {(tool === 'brush' || tool === 'eraser' || tool === 'mask-brush' || tool === 'mask-eraser') ? (
          <>
            <span className="text-white/50">•</span>
            <span>Brush {brushSize}px</span>
            <span className="text-white/50">•</span>
            <span>Opacity {brushOpacity}%</span>
          </>
        ) : null}
        {normalizedSelectionRect ? (
          <>
            <span className="text-white/50">•</span>
            <span>Selection {Math.round(normalizedSelectionRect.x)},{Math.round(normalizedSelectionRect.y)} · {Math.round(normalizedSelectionRect.width)}×{Math.round(normalizedSelectionRect.height)}</span>
          </>
        ) : null}
        {normalizedCropRect ? (
          <>
            <span className="text-white/50">•</span>
            <span>Crop {Math.round(normalizedCropRect.x)},{Math.round(normalizedCropRect.y)} · {Math.round(normalizedCropRect.width)}×{Math.round(normalizedCropRect.height)}</span>
          </>
        ) : null}
      </div>
      {isMaskTool ? (
        <div className="pointer-events-none absolute right-3 top-3 z-20 max-w-[280px] rounded-sm border border-red-300/25 bg-red-950/60 px-3 py-2 text-[11px] text-red-50 shadow-lg backdrop-blur-sm">
          <div className="font-medium text-red-100">Mask mode active</div>
          <div className="mt-1 text-red-100/80">White regions are exported as editable infill mask areas. Use <span className="font-medium">M</span> for mask brush and <span className="font-medium">Shift+M</span> for mask eraser.</div>
        </div>
      ) : null}
      {baseImage ? (
        <Stage width={viewportSize.width} height={viewportSize.height} onMouseDown={onStagePointerDown} onMouseMove={onStagePointerMove} onMouseUp={onStagePointerUp} onMouseLeave={onStagePointerUp}>
          <Layer>
            <Group x={viewportSize.width / 2 + pan.x} y={viewportSize.height / 2 + pan.y} scaleX={zoom} scaleY={zoom}>
              <Group rotation={rotation} scaleX={flippedX ? -1 : 1}>
                <Rect x={-documentSize.width / 2} y={-documentSize.height / 2} width={documentSize.width} height={documentSize.height} stroke="rgba(255,255,255,0.65)" strokeWidth={1.5 / zoom} listening={false} />
                <Group ref={documentGroupRef} x={-documentSize.width / 2} y={-documentSize.height / 2} clipX={0} clipY={0} clipWidth={documentSize.width} clipHeight={documentSize.height}>
                  <KonvaImage image={baseImage} x={0} y={0} width={documentSize.width} height={documentSize.height} listening={false} />

                  {layers.map((layer) => {
                    if (!layer.visible) {
                      return null
                    }

                    if (layer.type === 'draw') {
                      return layer.lines.map((line) => (
                        <Line
                          key={line.id}
                          points={line.points}
                          stroke={line.color}
                          strokeWidth={line.strokeWidth}
                          opacity={line.opacity}
                          lineCap="round"
                          lineJoin="round"
                          tension={0.5}
                          globalCompositeOperation={line.mode === 'erase' ? 'destination-out' : 'source-over'}
                          listening={false}
                        />
                      ))
                    }

                    return <LoadedPasteImage key={layer.id} layer={layer} isActive={layer.id === activeLayerId} onMove={onMovePasteLayer} />
                  })}

                  {enableMaskEditing ? (
                    <Group opacity={0.8}>
                      {maskPreviewSurface ? <KonvaImage image={maskPreviewSurface} x={0} y={0} width={documentSize.width} height={documentSize.height} listening={false} /> : null}
                      {maskStrokes.map((line) => (
                        <Line
                          key={line.id}
                          points={line.points}
                          stroke="#ff4d4f"
                          strokeWidth={line.strokeWidth}
                          opacity={line.opacity}
                          lineCap="round"
                          lineJoin="round"
                          tension={0.5}
                          globalCompositeOperation={line.mode === 'erase' ? 'destination-out' : 'source-over'}
                          listening={false}
                        />
                      ))}
                    </Group>
                  ) : null}

                  {brushPreviewPoint && (tool === 'brush' || tool === 'eraser' || tool === 'mask-brush' || tool === 'mask-eraser') ? (
                    <Group listening={false}>
                      <Rect
                        x={brushPreviewPoint.x - 1 / zoom}
                        y={brushPreviewPoint.y - 1 / zoom}
                        width={2 / zoom}
                        height={2 / zoom}
                        fill={tool === 'mask-brush' || tool === 'mask-eraser' ? '#ff4d4f' : '#ffffff'}
                      />
                      <Line
                        points={Array.from({ length: 40 }, (_, index) => {
                          const angle = (Math.PI * 2 * index) / 40
                          const radius = brushSize / 2
                          return index === 0
                            ? [brushPreviewPoint.x + Math.cos(angle) * radius, brushPreviewPoint.y + Math.sin(angle) * radius]
                            : [brushPreviewPoint.x + Math.cos(angle) * radius, brushPreviewPoint.y + Math.sin(angle) * radius]
                        }).flat()}
                        stroke={tool === 'mask-brush' || tool === 'mask-eraser' ? '#ff4d4f' : '#ffffff'}
                        strokeWidth={1.25 / zoom}
                        closed
                        dash={tool === 'eraser' || tool === 'mask-eraser' ? [4 / zoom, 4 / zoom] : undefined}
                        opacity={0.95}
                      />
                    </Group>
                  ) : null}

                  {normalizedSelectionRect ? (
                    <>
                      <Rect
                        x={normalizedSelectionRect.x}
                        y={normalizedSelectionRect.y}
                        width={normalizedSelectionRect.width}
                        height={normalizedSelectionRect.height}
                        fill="rgba(56, 189, 248, 0.08)"
                        stroke="#38bdf8"
                        strokeWidth={1.5 / zoom}
                        dash={[8 / zoom, 6 / zoom]}
                        listening={false}
                      />
                      <Text
                        x={normalizedSelectionRect.x + 6 / zoom}
                        y={Math.max(0, normalizedSelectionRect.y - 20 / zoom)}
                        text={`Selection ${Math.round(normalizedSelectionRect.width)}×${Math.round(normalizedSelectionRect.height)}`}
                        fontSize={12 / zoom}
                        fill="#38bdf8"
                        listening={false}
                      />
                      {[
                        { x: normalizedSelectionRect.x, y: normalizedSelectionRect.y },
                        { x: normalizedSelectionRect.x + normalizedSelectionRect.width, y: normalizedSelectionRect.y },
                        { x: normalizedSelectionRect.x, y: normalizedSelectionRect.y + normalizedSelectionRect.height },
                        { x: normalizedSelectionRect.x + normalizedSelectionRect.width, y: normalizedSelectionRect.y + normalizedSelectionRect.height },
                      ].map((handlePoint, index) => (
                        <Rect
                          key={`selection-handle-${index}`}
                          x={handlePoint.x - selectionHandleSize / 2}
                          y={handlePoint.y - selectionHandleSize / 2}
                          width={selectionHandleSize}
                          height={selectionHandleSize}
                          fill="#ffffff"
                          stroke="#38bdf8"
                          strokeWidth={1.2 / zoom}
                          listening={false}
                        />
                      ))}
                    </>
                  ) : null}

                  {normalizedCropRect ? (
                    <>
                      <Rect x={0} y={0} width={documentSize.width} height={documentSize.height} fill="rgba(0,0,0,0.4)" listening={false} />
                      <Rect x={normalizedCropRect.x} y={normalizedCropRect.y} width={normalizedCropRect.width} height={normalizedCropRect.height} fill="rgba(255,255,255,0.06)" stroke="#ffffff" strokeWidth={1.5 / zoom} listening={false} globalCompositeOperation="destination-out" />
                      <Rect x={normalizedCropRect.x} y={normalizedCropRect.y} width={normalizedCropRect.width} height={normalizedCropRect.height} stroke="#ffffff" strokeWidth={1.5 / zoom} listening={false} />
                      <Text
                        x={normalizedCropRect.x + 6 / zoom}
                        y={Math.max(0, normalizedCropRect.y - 20 / zoom)}
                        text={`Crop ${Math.round(normalizedCropRect.width)}×${Math.round(normalizedCropRect.height)}`}
                        fontSize={12 / zoom}
                        fill="#ffffff"
                        listening={false}
                      />
                    </>
                  ) : null}
                </Group>
              </Group>
            </Group>
          </Layer>
        </Stage>
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{loading ? 'Loading editor image…' : 'Select a source image first.'}</div>
      )}
    </div>
  )
}
