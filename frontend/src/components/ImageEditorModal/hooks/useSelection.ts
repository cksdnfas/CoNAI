import { useState, useCallback, useRef, MutableRefObject } from 'react';
import type { Selection, SelectionRect, Position, CanvasSize } from '../types/EditorTypes';

interface UseSelectionProps {
  zoomRef: MutableRefObject<number>;
  stagePosRef: MutableRefObject<Position>;
  rotationRef: MutableRefObject<number>;
  scaleXRef: MutableRefObject<number>;
  canvasSizeRef: MutableRefObject<CanvasSize>;
  viewportSizeRef: MutableRefObject<{ width: number; height: number }>;
}

/**
 * Transform screen coordinates to original image coordinates
 * Same logic as useDrawing for consistency
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

export const useSelection = ({
  zoomRef,
  stagePosRef,
  rotationRef,
  scaleXRef,
  canvasSizeRef,
  viewportSizeRef,
}: UseSelectionProps) => {
  const [selection, setSelection] = useState<Selection>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const startPosRef = useRef<Position | null>(null);
  const currentToolRef = useRef<'select' | 'lasso'>('select');

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

  // Start rectangle selection
  const startRectSelection = useCallback((screenPos: Position) => {
    const imagePos = getImageCoords(screenPos);
    startPosRef.current = imagePos;
    currentToolRef.current = 'select';
    setIsSelecting(true);
    setSelection({
      type: 'rect',
      rect: {
        x: imagePos.x,
        y: imagePos.y,
        width: 0,
        height: 0,
      },
    });
  }, [getImageCoords]);

  // Start lasso selection
  const startLassoSelection = useCallback((screenPos: Position) => {
    const imagePos = getImageCoords(screenPos);
    startPosRef.current = imagePos;
    currentToolRef.current = 'lasso';
    setIsSelecting(true);
    setSelection({
      type: 'lasso',
      lasso: {
        points: [imagePos.x, imagePos.y],
      },
    });
  }, [getImageCoords]);

  // Continue selection (drag)
  const continueSelection = useCallback((screenPos: Position) => {
    if (!isSelecting || !startPosRef.current) return;

    const imagePos = getImageCoords(screenPos);

    if (currentToolRef.current === 'select' && startPosRef.current) {
      // Rectangle selection: calculate bounds
      const startPos = startPosRef.current;
      const x = Math.min(startPos.x, imagePos.x);
      const y = Math.min(startPos.y, imagePos.y);
      const width = Math.abs(imagePos.x - startPos.x);
      const height = Math.abs(imagePos.y - startPos.y);

      setSelection({
        type: 'rect',
        rect: { x, y, width, height },
      });
    } else if (currentToolRef.current === 'lasso') {
      // Lasso selection: add points
      setSelection(prev => {
        if (!prev || prev.type !== 'lasso' || !prev.lasso) return prev;
        return {
          type: 'lasso',
          lasso: {
            points: [...prev.lasso.points, imagePos.x, imagePos.y],
          },
        };
      });
    }
  }, [isSelecting, getImageCoords]);

  // End selection
  const endSelection = useCallback(() => {
    if (!isSelecting) return;

    setIsSelecting(false);

    // Validate selection (minimum size)
    if (selection?.type === 'rect' && selection.rect) {
      const { width, height } = selection.rect;
      if (width < 5 || height < 5) {
        setSelection(null);
        return;
      }
    } else if (selection?.type === 'lasso' && selection.lasso) {
      if (selection.lasso.points.length < 6) {
        setSelection(null);
        return;
      }
    }

    startPosRef.current = null;
  }, [isSelecting, selection]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelection(null);
    setIsSelecting(false);
    startPosRef.current = null;
  }, []);

  // Select all (entire canvas)
  const selectAll = useCallback(() => {
    const { width, height } = canvasSizeRef.current;
    setSelection({
      type: 'rect',
      rect: { x: 0, y: 0, width, height },
    });
  }, [canvasSizeRef]);

  // Invert selection (for rectangle)
  const invertSelection = useCallback(() => {
    // Inversion is complex for arbitrary shapes
    // For simplicity, we only support it for rectangles
    // This would require masking operations for proper implementation
    console.warn('Invert selection not fully implemented');
  }, []);

  // Get selection bounds (for both rect and lasso)
  const getSelectionBounds = useCallback((): SelectionRect | null => {
    if (!selection) return null;

    if (selection.type === 'rect' && selection.rect) {
      return selection.rect;
    }

    if (selection.type === 'lasso' && selection.lasso) {
      const points = selection.lasso.points;
      if (points.length < 4) return null;

      let minX = Infinity, minY = Infinity;
      let maxX = -Infinity, maxY = -Infinity;

      for (let i = 0; i < points.length; i += 2) {
        minX = Math.min(minX, points[i]);
        maxX = Math.max(maxX, points[i]);
        minY = Math.min(minY, points[i + 1]);
        maxY = Math.max(maxY, points[i + 1]);
      }

      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    }

    return null;
  }, [selection]);

  // Check if a point is inside selection
  const isPointInSelection = useCallback((x: number, y: number): boolean => {
    if (!selection) return false;

    if (selection.type === 'rect' && selection.rect) {
      const { x: sx, y: sy, width, height } = selection.rect;
      return x >= sx && x <= sx + width && y >= sy && y <= sy + height;
    }

    if (selection.type === 'lasso' && selection.lasso) {
      // Point-in-polygon test (ray casting algorithm)
      const points = selection.lasso.points;
      let inside = false;

      for (let i = 0, j = points.length - 2; i < points.length; j = i, i += 2) {
        const xi = points[i], yi = points[i + 1];
        const xj = points[j], yj = points[j + 1];

        if (((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
          inside = !inside;
        }
      }

      return inside;
    }

    return false;
  }, [selection]);

  // Move selection
  const moveSelection = useCallback((dx: number, dy: number) => {
    if (!selection) return;

    if (selection.type === 'rect' && selection.rect) {
      setSelection({
        type: 'rect',
        rect: {
          ...selection.rect,
          x: selection.rect.x + dx,
          y: selection.rect.y + dy,
        },
      });
    } else if (selection.type === 'lasso' && selection.lasso) {
      const newPoints = selection.lasso.points.map((val, i) =>
        i % 2 === 0 ? val + dx : val + dy
      );
      setSelection({
        type: 'lasso',
        lasso: { points: newPoints },
      });
    }
  }, [selection]);

  // Reset
  const reset = useCallback(() => {
    setSelection(null);
    setIsSelecting(false);
    startPosRef.current = null;
  }, []);

  return {
    selection,
    isSelecting,
    startRectSelection,
    startLassoSelection,
    continueSelection,
    endSelection,
    clearSelection,
    selectAll,
    invertSelection,
    getSelectionBounds,
    isPointInSelection,
    moveSelection,
    reset,
  };
};
