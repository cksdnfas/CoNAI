import React, { useRef, useEffect, useState } from 'react';
import { Box, CircularProgress, Alert } from '@mui/material';
import { Stage, Layer, Image as KonvaImage, Line, Rect } from 'react-konva';
import type { DrawLine, ImageTransform, Position } from '../types/EditorTypes';

interface EditorCanvasProps {
  image: HTMLImageElement | null;
  error: string | null;
  lines: DrawLine[];
  imageTransform: ImageTransform;
  rotation: number;
  scaleX: number;
  zoom: number;
  stagePos: Position;
  cursor: string;
  stageRef: React.RefObject<any>;
  layerRef: React.RefObject<any>;
  onMouseDown: (e: any) => void;
  onMouseMove: (e: any) => void;
  onMouseUp: () => void;
  onWheel: (e: any) => void;
  onViewportResize?: (width: number, height: number) => void;
}

export const EditorCanvas: React.FC<EditorCanvasProps> = ({
  image,
  error,
  lines,
  imageTransform,
  rotation,
  scaleX,
  zoom,
  stagePos,
  cursor,
  stageRef,
  layerRef,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onWheel,
  onViewportResize,
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
            {/* Image boundary white border */}
            <Rect
              x={imageTransform.x - imageTransform.width / 2}
              y={imageTransform.y - imageTransform.height / 2}
              width={imageTransform.width}
              height={imageTransform.height}
              stroke="white"
              strokeWidth={2 / zoom}
              listening={false}
            />

            {/* Background Image */}
            <KonvaImage
              image={image}
              x={imageTransform.x}
              y={imageTransform.y}
              offsetX={imageTransform.width / 2}
              offsetY={imageTransform.height / 2}
              width={imageTransform.width}
              height={imageTransform.height}
              scaleX={scaleX}
              scaleY={1}
              rotation={rotation}
            />

            {/* Drawing Lines */}
            {lines.map((line, i) => (
              <Line
                key={i}
                points={line.points}
                stroke={line.color}
                strokeWidth={line.strokeWidth / zoom}
                tension={0.5}
                lineCap="round"
                lineJoin="round"
                globalCompositeOperation={
                  line.tool === 'eraser' ? 'destination-out' : 'source-over'
                }
              />
            ))}
          </Layer>
        </Stage>
      )}
    </Box>
  );
};
