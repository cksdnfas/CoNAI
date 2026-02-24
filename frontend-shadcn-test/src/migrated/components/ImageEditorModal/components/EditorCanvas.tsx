import React, { useRef, useEffect, useState, useMemo } from 'react';
import { Box, CircularProgress, Alert } from '@mui/material';
import { Stage, Layer, Image as KonvaImage, Line, Rect, Group } from 'react-konva';
import type {
  DrawLine,
  ImageTransform,
  Position,
  CanvasSize,
  Selection,
  SelectionRect,
  Layer as LayerType,
} from '../types/EditorTypes';

interface EditorCanvasProps {
  image: HTMLImageElement | null;
  error: string | null;
  layers: LayerType[];
  activeLayerId: string | null;
  imageTransform: ImageTransform;
  canvasSize: CanvasSize;
  rotation: number;
  scaleX: number;
  zoom: number;
  stagePos: Position;
  cursor: string;
  stageRef: React.RefObject<any>;
  layerRef: React.RefObject<any>;
  // Selection
  selection: Selection;
  // Crop
  cropRect: SelectionRect | null;
  isCropMode: boolean;
  // Current drawing lines (for real-time rendering while drawing)
  currentDrawingLines?: DrawLine[];
  // Event handlers
  onMouseDown: (e: any) => void;
  onMouseMove: (e: any) => void;
  onMouseUp: () => void;
  onWheel: (e: any) => void;
  onViewportResize?: (width: number, height: number) => void;
  onPasteLayerDrag?: (layerId: string, x: number, y: number) => void;
}

// Marching ants animation for selection
const SelectionOverlay: React.FC<{
  selection: Selection;
  rotation: number;
  scaleX: number;
  canvasSize: CanvasSize;
  imageTransform: ImageTransform;
  zoom: number;
}> = ({ selection, rotation, scaleX, canvasSize, imageTransform, zoom }) => {
  if (!selection) return null;

  const [dashOffset, setDashOffset] = useState(0);

  // Animate marching ants
  useEffect(() => {
    const interval = setInterval(() => {
      setDashOffset((prev) => (prev + 1) % 16);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  if (selection.type === 'rect' && selection.rect) {
    const { x, y, width, height } = selection.rect;
    return (
      <Group
        x={imageTransform.x}
        y={imageTransform.y}
        rotation={rotation}
        scaleX={scaleX}
        scaleY={1}
        offsetX={canvasSize.width / 2}
        offsetY={canvasSize.height / 2}
      >
        {/* White dashed line */}
        <Rect
          x={x}
          y={y}
          width={width}
          height={height}
          stroke="white"
          strokeWidth={1 / zoom}
          dash={[4 / zoom, 4 / zoom]}
          dashOffset={dashOffset / zoom}
          listening={false}
        />
        {/* Black dashed line (offset) */}
        <Rect
          x={x}
          y={y}
          width={width}
          height={height}
          stroke="black"
          strokeWidth={1 / zoom}
          dash={[4 / zoom, 4 / zoom]}
          dashOffset={(dashOffset + 4) / zoom}
          listening={false}
        />
      </Group>
    );
  }

  if (selection.type === 'lasso' && selection.lasso) {
    return (
      <Group
        x={imageTransform.x}
        y={imageTransform.y}
        rotation={rotation}
        scaleX={scaleX}
        scaleY={1}
        offsetX={canvasSize.width / 2}
        offsetY={canvasSize.height / 2}
      >
        <Line
          points={[...selection.lasso.points, selection.lasso.points[0], selection.lasso.points[1]]}
          stroke="white"
          strokeWidth={1 / zoom}
          dash={[4 / zoom, 4 / zoom]}
          dashOffset={dashOffset / zoom}
          closed
          listening={false}
        />
        <Line
          points={[...selection.lasso.points, selection.lasso.points[0], selection.lasso.points[1]]}
          stroke="black"
          strokeWidth={1 / zoom}
          dash={[4 / zoom, 4 / zoom]}
          dashOffset={(dashOffset + 4) / zoom}
          closed
          listening={false}
        />
      </Group>
    );
  }

  return null;
};

// Crop overlay with handles
const CropOverlay: React.FC<{
  cropRect: SelectionRect;
  rotation: number;
  scaleX: number;
  canvasSize: CanvasSize;
  imageTransform: ImageTransform;
  zoom: number;
}> = ({ cropRect, rotation, scaleX, canvasSize, imageTransform, zoom }) => {
  const handleSize = 8 / zoom;
  const { x, y, width, height } = cropRect;

  return (
    <Group
      x={imageTransform.x}
      y={imageTransform.y}
      rotation={rotation}
      scaleX={scaleX}
      scaleY={1}
      offsetX={canvasSize.width / 2}
      offsetY={canvasSize.height / 2}
    >
      {/* Dimmed overlay outside crop area */}
      {/* Top */}
      <Rect
        x={0}
        y={0}
        width={canvasSize.width}
        height={y}
        fill="rgba(0,0,0,0.5)"
        listening={false}
      />
      {/* Bottom */}
      <Rect
        x={0}
        y={y + height}
        width={canvasSize.width}
        height={canvasSize.height - y - height}
        fill="rgba(0,0,0,0.5)"
        listening={false}
      />
      {/* Left */}
      <Rect
        x={0}
        y={y}
        width={x}
        height={height}
        fill="rgba(0,0,0,0.5)"
        listening={false}
      />
      {/* Right */}
      <Rect
        x={x + width}
        y={y}
        width={canvasSize.width - x - width}
        height={height}
        fill="rgba(0,0,0,0.5)"
        listening={false}
      />

      {/* Crop border */}
      <Rect
        x={x}
        y={y}
        width={width}
        height={height}
        stroke="white"
        strokeWidth={2 / zoom}
        listening={false}
      />

      {/* Rule of thirds grid */}
      <Line
        points={[x + width / 3, y, x + width / 3, y + height]}
        stroke="rgba(255,255,255,0.5)"
        strokeWidth={1 / zoom}
        listening={false}
      />
      <Line
        points={[x + (width * 2) / 3, y, x + (width * 2) / 3, y + height]}
        stroke="rgba(255,255,255,0.5)"
        strokeWidth={1 / zoom}
        listening={false}
      />
      <Line
        points={[x, y + height / 3, x + width, y + height / 3]}
        stroke="rgba(255,255,255,0.5)"
        strokeWidth={1 / zoom}
        listening={false}
      />
      <Line
        points={[x, y + (height * 2) / 3, x + width, y + (height * 2) / 3]}
        stroke="rgba(255,255,255,0.5)"
        strokeWidth={1 / zoom}
        listening={false}
      />

      {/* Resize handles */}
      {/* Corners */}
      <Rect x={x - handleSize / 2} y={y - handleSize / 2} width={handleSize} height={handleSize} fill="white" stroke="black" strokeWidth={1 / zoom} name="nw" />
      <Rect x={x + width - handleSize / 2} y={y - handleSize / 2} width={handleSize} height={handleSize} fill="white" stroke="black" strokeWidth={1 / zoom} name="ne" />
      <Rect x={x - handleSize / 2} y={y + height - handleSize / 2} width={handleSize} height={handleSize} fill="white" stroke="black" strokeWidth={1 / zoom} name="sw" />
      <Rect x={x + width - handleSize / 2} y={y + height - handleSize / 2} width={handleSize} height={handleSize} fill="white" stroke="black" strokeWidth={1 / zoom} name="se" />
      {/* Edges */}
      <Rect x={x + width / 2 - handleSize / 2} y={y - handleSize / 2} width={handleSize} height={handleSize} fill="white" stroke="black" strokeWidth={1 / zoom} name="n" />
      <Rect x={x + width / 2 - handleSize / 2} y={y + height - handleSize / 2} width={handleSize} height={handleSize} fill="white" stroke="black" strokeWidth={1 / zoom} name="s" />
      <Rect x={x - handleSize / 2} y={y + height / 2 - handleSize / 2} width={handleSize} height={handleSize} fill="white" stroke="black" strokeWidth={1 / zoom} name="w" />
      <Rect x={x + width - handleSize / 2} y={y + height / 2 - handleSize / 2} width={handleSize} height={handleSize} fill="white" stroke="black" strokeWidth={1 / zoom} name="e" />
    </Group>
  );
};

// Convert paste layer ImageData to canvas element for Konva
const PasteLayerImage: React.FC<{
  layer: LayerType;
  isActive: boolean;
  onDragEnd?: (x: number, y: number) => void;
}> = ({ layer, isActive, onDragEnd }) => {
  const canvasImage = useMemo(() => {
    if (!layer.pasteData) return null;
    const canvas = document.createElement('canvas');
    canvas.width = layer.pasteData.width;
    canvas.height = layer.pasteData.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.putImageData(layer.pasteData.imageData, 0, 0);
    }
    return canvas;
  }, [layer.pasteData]);

  if (!canvasImage || !layer.pasteData) return null;

  // Only allow dragging if this is the active layer and not locked
  const canDrag = isActive && !layer.locked;

  return (
    <KonvaImage
      image={canvasImage}
      x={layer.pasteData.x}
      y={layer.pasteData.y}
      width={layer.pasteData.width}
      height={layer.pasteData.height}
      opacity={layer.opacity}
      draggable={canDrag}
      onDragEnd={(e) => {
        if (onDragEnd) {
          onDragEnd(e.target.x(), e.target.y());
        }
      }}
      // Add stroke when active to show it's selected
      stroke={isActive ? '#00aaff' : undefined}
      strokeWidth={isActive ? 2 : 0}
    />
  );
};

export const EditorCanvas: React.FC<EditorCanvasProps> = ({
  image,
  error,
  layers,
  activeLayerId,
  imageTransform,
  canvasSize,
  rotation,
  scaleX,
  zoom,
  stagePos,
  cursor,
  stageRef,
  layerRef,
  selection,
  cropRect,
  isCropMode,
  currentDrawingLines = [],
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onWheel,
  onViewportResize,
  onPasteLayerDrag,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });

  // Dynamic viewport sizing
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        setViewportSize({ width, height });
        onViewportResize?.(width, height);
      }
    };

    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [onViewportResize]);

  // For 90/270 rotation, the display dimensions are swapped
  const is90or270 = rotation === 90 || rotation === 270;
  const displayWidth = is90or270 ? canvasSize.height : canvasSize.width;
  const displayHeight = is90or270 ? canvasSize.width : canvasSize.height;

  // Canvas boundary position (centered in viewport coordinates)
  const boundaryX = imageTransform.x - displayWidth / 2;
  const boundaryY = imageTransform.y - displayHeight / 2;

  // Get all lines from visible drawing layers
  const layerLines: DrawLine[] = layers
    .filter((l) => l.visible && l.type === 'drawing' && l.lines)
    .flatMap((l) => l.lines || []);

  // Combine layer lines with current drawing lines (for real-time preview)
  const visibleLines: DrawLine[] = [...layerLines, ...currentDrawingLines];

  // Get paste layers
  const pasteLayers = layers.filter((l) => l.visible && l.type === 'paste' && l.pasteData);

  return (
    <Box
      ref={containerRef}
      sx={{
        flex: 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        bgcolor: '#2a2a2a',
        position: 'relative',
        overflow: 'hidden',
        backgroundImage: `
          linear-gradient(45deg, #1a1a1a 25%, transparent 25%),
          linear-gradient(-45deg, #1a1a1a 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #1a1a1a 75%),
          linear-gradient(-45deg, transparent 75%, #1a1a1a 75%)
        `,
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
      }}
    >
      {error && (
        <Alert
          severity="error"
          sx={{ position: 'absolute', top: 16, left: 16, right: 16, zIndex: 10 }}
        >
          {error}
        </Alert>
      )}

      {!image && !error && <CircularProgress />}

      {image && (
        <Stage
          ref={stageRef}
          width={viewportSize.width}
          height={viewportSize.height}
          scaleX={zoom}
          scaleY={zoom}
          x={stagePos.x}
          y={stagePos.y}
          onMouseDown={onMouseDown}
          onMousemove={onMouseMove}
          onMouseup={onMouseUp}
          onMouseleave={onMouseUp}
          onWheel={onWheel}
          style={{ cursor }}
        >
          <Layer ref={layerRef}>
            {/* Canvas boundary (rotated dimensions) */}
            <Rect
              x={boundaryX}
              y={boundaryY}
              width={displayWidth}
              height={displayHeight}
              stroke="white"
              strokeWidth={2 / zoom}
              listening={false}
            />

            {/* Clipping Group - clips to rotated canvas bounds */}
            <Group
              clipFunc={(ctx: any) => {
                ctx.rect(boundaryX, boundaryY, displayWidth, displayHeight);
              }}
            >
              {/*
                Document Group - contains image + drawings
                All transforms (rotation, flip) are applied to this group
                so that image and drawings rotate together
              */}
              <Group
                x={imageTransform.x}
                y={imageTransform.y}
                rotation={rotation}
                scaleX={scaleX}
                scaleY={1}
                offsetX={canvasSize.width / 2}
                offsetY={canvasSize.height / 2}
              >
                {/* Background Image - no transform, just dimensions */}
                <KonvaImage
                  image={image}
                  x={0}
                  y={0}
                  width={canvasSize.width}
                  height={canvasSize.height}
                />

                {/* Drawing Lines - in original coordinate system */}
                {visibleLines.map((line, i) => (
                  <Line
                    key={i}
                    points={line.points}
                    stroke={line.color}
                    strokeWidth={line.strokeWidth}
                    tension={0.5}
                    lineCap="round"
                    lineJoin="round"
                    globalCompositeOperation={
                      line.tool === 'eraser' ? 'destination-out' : 'source-over'
                    }
                  />
                ))}

                {/* Paste layers */}
                {pasteLayers.map((layer) => (
                  <PasteLayerImage
                    key={layer.id}
                    layer={layer}
                    isActive={layer.id === activeLayerId}
                    onDragEnd={(x, y) => onPasteLayerDrag?.(layer.id, x, y)}
                  />
                ))}
              </Group>
            </Group>

            {/* Selection overlay (outside document group for proper rendering) */}
            {selection && !isCropMode && (
              <SelectionOverlay
                selection={selection}
                rotation={rotation}
                scaleX={scaleX}
                canvasSize={canvasSize}
                imageTransform={imageTransform}
                zoom={zoom}
              />
            )}

            {/* Crop overlay */}
            {cropRect && isCropMode && (
              <CropOverlay
                cropRect={cropRect}
                rotation={rotation}
                scaleX={scaleX}
                canvasSize={canvasSize}
                imageTransform={imageTransform}
                zoom={zoom}
              />
            )}
          </Layer>
        </Stage>
      )}
    </Box>
  );
};
