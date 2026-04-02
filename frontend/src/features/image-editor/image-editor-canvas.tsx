import { useEffect, useState, type RefObject, type WheelEvent } from 'react'
import { Group, Image as KonvaImage, Layer, Line, Rect, Stage } from 'react-konva'
import type { ImageEditorCropRect, ImageEditorLayer, ImageEditorStroke } from './image-editor-types'
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
  return (
    <div
      ref={viewportRef}
      className="h-[70vh] min-h-[540px] overflow-hidden rounded-sm border border-border bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.06),_transparent_55%),linear-gradient(45deg,_rgba(255,255,255,0.03)_25%,_transparent_25%),linear-gradient(-45deg,_rgba(255,255,255,0.03)_25%,_transparent_25%),linear-gradient(45deg,_transparent_75%,_rgba(255,255,255,0.03)_75%),linear-gradient(-45deg,_transparent_75%,_rgba(255,255,255,0.03)_75%)] [background-position:0_0,0_0,0_12px,12px_-12px,-12px_0] [background-size:auto,24px_24px,24px_24px,24px_24px,24px_24px]"
      onWheel={onWheel}
    >
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
                          lineCap="round"
                          lineJoin="round"
                          tension={0.5}
                          globalCompositeOperation={line.mode === 'erase' ? 'destination-out' : 'source-over'}
                          listening={false}
                        />
                      ))}
                    </Group>
                  ) : null}

                  {normalizedSelectionRect ? (
                    <>
                      <Rect
                        x={normalizedSelectionRect.x}
                        y={normalizedSelectionRect.y}
                        width={normalizedSelectionRect.width}
                        height={normalizedSelectionRect.height}
                        stroke="#38bdf8"
                        strokeWidth={1.5 / zoom}
                        dash={[8 / zoom, 6 / zoom]}
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
                      <Rect x={normalizedCropRect.x} y={normalizedCropRect.y} width={normalizedCropRect.width} height={normalizedCropRect.height} fill="rgba(0,0,0,0)" stroke="#ffffff" strokeWidth={1.5 / zoom} listening={false} globalCompositeOperation="destination-out" />
                      <Rect x={normalizedCropRect.x} y={normalizedCropRect.y} width={normalizedCropRect.width} height={normalizedCropRect.height} stroke="#ffffff" strokeWidth={1.5 / zoom} listening={false} />
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
