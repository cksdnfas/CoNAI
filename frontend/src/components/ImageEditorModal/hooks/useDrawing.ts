import { useState, useRef, useCallback } from 'react';
import type { DrawLine, Tool, Position } from '../types/EditorTypes';

interface UseDrawingProps {
  tool: Tool;
  brushSize: number;
  brushColor: string;
  eraserSize: number;
  zoom: number;
  stagePos: Position;
  onDrawingComplete: (lines: DrawLine[]) => void;
}

export const useDrawing = ({
  tool,
  brushSize,
  brushColor,
  eraserSize,
  zoom,
  stagePos,
  onDrawingComplete,
}: UseDrawingProps) => {
  const [lines, setLines] = useState<DrawLine[]>([]);
  const isDrawingRef = useRef(false);

  const startDrawing = useCallback((pos: Position) => {
    if (tool !== 'brush' && tool !== 'eraser') return;

    isDrawingRef.current = true;
    const relativePos = {
      x: (pos.x - stagePos.x) / zoom,
      y: (pos.y - stagePos.y) / zoom,
    };

    const newLine: DrawLine = {
      tool,
      points: [relativePos.x, relativePos.y],
      color: tool === 'brush' ? brushColor : '#ffffff',
      strokeWidth: tool === 'brush' ? brushSize : eraserSize,
    };

    setLines((prev) => [...prev, newLine]);
  }, [tool, brushSize, brushColor, eraserSize, zoom, stagePos]);

  const continueDrawing = useCallback((pos: Position) => {
    if (!isDrawingRef.current) return;

    const relativePos = {
      x: (pos.x - stagePos.x) / zoom,
      y: (pos.y - stagePos.y) / zoom,
    };

    setLines((prev) => {
      const lastLine = prev[prev.length - 1];
      if (!lastLine) return prev;

      const updatedLine = {
        ...lastLine,
        points: lastLine.points.concat([relativePos.x, relativePos.y]),
      };

      return [...prev.slice(0, -1), updatedLine];
    });
  }, [zoom, stagePos]);

  const endDrawing = useCallback(() => {
    if (isDrawingRef.current) {
      isDrawingRef.current = false;
      onDrawingComplete(lines);
    }
  }, [lines, onDrawingComplete]);

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
