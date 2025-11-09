/**
 * useDrawing Hook
 * RAF-based optimized drawing system for brush/eraser tools
 */

import { useRef, useCallback, useState } from 'react';
import type {
  Point,
  KonvaNode,
  LineNodeAttrs,
  EditorTool,
  ToolProperties,
} from '../types/EditorTypes';
import { generateId } from '../utils/editorUtils';

interface UseDrawingOptions {
  tool: EditorTool;
  toolProperties: ToolProperties;
  activeLayerId: string;
  onDrawingComplete?: (node: KonvaNode<LineNodeAttrs>) => void;
}

interface UseDrawingReturn {
  isDrawing: boolean;
  currentPoints: number[];
  startDrawing: (point: Point) => void;
  updateDrawing: (point: Point) => void;
  endDrawing: () => void;
  cancelDrawing: () => void;
}

/**
 * Custom hook for optimized drawing operations
 * Uses RAF to batch point updates and prevent excessive re-renders
 */
export function useDrawing(options: UseDrawingOptions): UseDrawingReturn {
  const { tool, toolProperties, activeLayerId, onDrawingComplete } = options;

  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState<number[]>([]);

  // Use refs for performance-critical data
  const pointsBufferRef = useRef<number[]>([]);
  const rafIdRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);

  /**
   * Flush buffered points to state
   * Called via RAF for optimal performance
   */
  const flushPoints = useCallback(() => {
    if (pointsBufferRef.current.length > 0) {
      setCurrentPoints([...pointsBufferRef.current]);
    }
    rafIdRef.current = null;
  }, []);

  /**
   * Schedule point flush via RAF
   */
  const scheduleFlush = useCallback(() => {
    if (rafIdRef.current === null) {
      rafIdRef.current = requestAnimationFrame(flushPoints);
    }
  }, [flushPoints]);

  /**
   * Start drawing operation
   */
  const startDrawing = useCallback(
    (point: Point) => {
      if (tool !== 'brush' && tool !== 'eraser') {
        return;
      }

      pointsBufferRef.current = [point.x, point.y];
      setCurrentPoints([point.x, point.y]);
      setIsDrawing(true);
      lastUpdateRef.current = Date.now();
    },
    [tool]
  );

  /**
   * Update drawing with new point
   * Uses RAF batching to avoid excessive updates
   */
  const updateDrawing = useCallback(
    (point: Point) => {
      if (!isDrawing || (tool !== 'brush' && tool !== 'eraser')) {
        return;
      }

      // Add point to buffer
      pointsBufferRef.current.push(point.x, point.y);

      // Throttle updates to max 60fps
      const now = Date.now();
      if (now - lastUpdateRef.current < 16) {
        scheduleFlush();
        return;
      }

      // Immediate update if enough time passed
      setCurrentPoints([...pointsBufferRef.current]);
      lastUpdateRef.current = now;

      // Cancel any pending RAF
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    },
    [isDrawing, tool, scheduleFlush]
  );

  /**
   * End drawing and create final node
   */
  const endDrawing = useCallback(() => {
    if (!isDrawing || (tool !== 'brush' && tool !== 'eraser')) {
      return;
    }

    // Cancel any pending RAF
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    // Final flush
    const finalPoints = [...pointsBufferRef.current];

    // Only create node if we have enough points (minimum 4 = 2 coordinates)
    if (finalPoints.length >= 4) {
      const isEraser = tool === 'eraser';

      const nodeAttrs: LineNodeAttrs = {
        x: 0,
        y: 0,
        points: finalPoints,
        stroke: isEraser ? '#FFFFFF' : toolProperties.brushColor,
        strokeWidth: toolProperties.brushSize,
        tension: 0.5,
        lineCap: 'round',
        lineJoin: 'round',
        opacity: isEraser ? 1 : toolProperties.brushOpacity,
        globalCompositeOperation: isEraser ? 'destination-out' : 'source-over',
      };

      const node: KonvaNode<LineNodeAttrs> = {
        id: generateId('line'),
        type: 'line',
        layerId: activeLayerId,
        attrs: nodeAttrs,
        name: isEraser ? 'eraser-line' : 'brush-line',
      };

      if (onDrawingComplete) {
        onDrawingComplete(node);
      }
    }

    // Reset state
    pointsBufferRef.current = [];
    setCurrentPoints([]);
    setIsDrawing(false);
  }, [isDrawing, tool, toolProperties, activeLayerId, onDrawingComplete]);

  /**
   * Cancel current drawing without creating node
   */
  const cancelDrawing = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }

    pointsBufferRef.current = [];
    setCurrentPoints([]);
    setIsDrawing(false);
  }, []);

  return {
    isDrawing,
    currentPoints,
    startDrawing,
    updateDrawing,
    endDrawing,
    cancelDrawing,
  };
}
