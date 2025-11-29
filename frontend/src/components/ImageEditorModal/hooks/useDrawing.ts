import { useState, useRef, useCallback, MutableRefObject } from 'react';
import type { DrawLine, Tool, Position, CanvasSize } from '../types/EditorTypes';

interface UseDrawingProps {
  tool: Tool;
  brushSize: number;
  brushColor: string;
  eraserSize: number;
  // Use refs for stable coordinates (prevents stale closure issues)
  zoomRef: MutableRefObject<number>;
  stagePosRef: MutableRefObject<Position>;
  rotationRef: MutableRefObject<number>;
  scaleXRef: MutableRefObject<number>;
  canvasSizeRef: MutableRefObject<CanvasSize>;
  viewportSizeRef: MutableRefObject<{ width: number; height: number }>;
  onDrawingComplete: (lines: DrawLine[]) => void;
}

/**
 * Transform screen coordinates to original image coordinates
 * Accounts for zoom, pan, rotation, and flip
 */
const screenToImageCoords = (
  screenPos: Position,
  zoom: number,
  stagePos: Position,
  rotation: number,
  scaleX: number,
  canvasSize: CanvasSize,
  viewportSize: { width: number; height: number }
): Position => {
  // 1. Remove zoom and pan to get canvas coordinates
  const canvasX = (screenPos.x - stagePos.x) / zoom;
  const canvasY = (screenPos.y - stagePos.y) / zoom;

  // 2. Get center point (image is centered in viewport)
  const centerX = viewportSize.width / 2;
  const centerY = viewportSize.height / 2;

  // 3. Translate to center-relative coordinates
  const relX = canvasX - centerX;
  const relY = canvasY - centerY;

  // 4. Reverse rotation
  const radians = (-rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let unrotatedX = relX * cos - relY * sin;
  let unrotatedY = relX * sin + relY * cos;

  // 5. Reverse flip
  if (scaleX < 0) {
    unrotatedX = -unrotatedX;
  }

  // 6. Translate back to image coordinates (0,0 at top-left)
  const imageX = unrotatedX + canvasSize.width / 2;
  const imageY = unrotatedY + canvasSize.height / 2;

  return { x: imageX, y: imageY };
};

export const useDrawing = ({
  tool,
  brushSize,
  brushColor,
  eraserSize,
  zoomRef,
  stagePosRef,
  rotationRef,
  scaleXRef,
  canvasSizeRef,
  viewportSizeRef,
  onDrawingComplete,
}: UseDrawingProps) => {
  const [lines, setLines] = useState<DrawLine[]>([]);
  const isDrawingRef = useRef(false);

  // Get image coordinates from screen position
  const getImageCoords = useCallback((pos: Position): Position => {
    return screenToImageCoords(
      pos,
      zoomRef.current,
      stagePosRef.current,
      rotationRef.current,
      scaleXRef.current,
      canvasSizeRef.current,
      viewportSizeRef.current
    );
  }, [zoomRef, stagePosRef, rotationRef, scaleXRef, canvasSizeRef, viewportSizeRef]);

  const startDrawing = useCallback((pos: Position) => {
    if (tool !== 'brush' && tool !== 'eraser') return;

    isDrawingRef.current = true;
    const imagePos = getImageCoords(pos);

    const newLine: DrawLine = {
      tool,
      points: [imagePos.x, imagePos.y],
      color: tool === 'brush' ? brushColor : '#ffffff',
      strokeWidth: tool === 'brush' ? brushSize : eraserSize,
    };

    setLines((prev) => [...prev, newLine]);
  }, [tool, brushSize, brushColor, eraserSize, getImageCoords]);

  const continueDrawing = useCallback((pos: Position) => {
    if (!isDrawingRef.current) return;

    const imagePos = getImageCoords(pos);

    setLines((prev) => {
      const lastLine = prev[prev.length - 1];
      if (!lastLine) return prev;

      const updatedLine = {
        ...lastLine,
        points: lastLine.points.concat([imagePos.x, imagePos.y]),
      };

      return [...prev.slice(0, -1), updatedLine];
    });
  }, [getImageCoords]);

  const endDrawing = useCallback(() => {
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      setLines((currentLines) => {
        onDrawingComplete(currentLines);
        return currentLines;
      });
    }
  }, [onDrawingComplete]);

  const clearLines = useCallback(() => {
    setLines([]);
    onDrawingComplete([]);
  }, [onDrawingComplete]);

  const setLinesFromHistory = useCallback((newLines: DrawLine[]) => {
    setLines(newLines);
  }, []);

  const reset = useCallback(() => {
    setLines([]);
    isDrawingRef.current = false;
  }, []);

  return {
    lines,
    isDrawing: isDrawingRef.current,
    startDrawing,
    continueDrawing,
    endDrawing,
    clearLines,
    setLinesFromHistory,
    reset,
  };
};
