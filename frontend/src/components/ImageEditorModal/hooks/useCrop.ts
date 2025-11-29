import { useState, useCallback, useRef, MutableRefObject } from 'react';
import type { SelectionRect, Position, CanvasSize } from '../types/EditorTypes';

interface UseCropProps {
  zoomRef: MutableRefObject<number>;
  stagePosRef: MutableRefObject<Position>;
  rotationRef: MutableRefObject<number>;
  scaleXRef: MutableRefObject<number>;
  canvasSizeRef: MutableRefObject<CanvasSize>;
  viewportSizeRef: MutableRefObject<{ width: number; height: number }>;
}

/**
 * Transform screen coordinates to original image coordinates
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
  const canvasX = (screenPos.x - stagePos.x) / zoom;
  const canvasY = (screenPos.y - stagePos.y) / zoom;

  const centerX = viewportSize.width / 2;
  const centerY = viewportSize.height / 2;

  const relX = canvasX - centerX;
  const relY = canvasY - centerY;

  const radians = (-rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let unrotatedX = relX * cos - relY * sin;
  let unrotatedY = relX * sin + relY * cos;

  if (scaleX < 0) {
    unrotatedX = -unrotatedX;
  }

  const imageX = unrotatedX + canvasSize.width / 2;
  const imageY = unrotatedY + canvasSize.height / 2;

  return { x: imageX, y: imageY };
};

export const useCrop = ({
  zoomRef,
  stagePosRef,
  rotationRef,
  scaleXRef,
  canvasSizeRef,
  viewportSizeRef,
}: UseCropProps) => {
  const [cropRect, setCropRect] = useState<SelectionRect | null>(null);
  const [isCropping, setIsCropping] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [resizeHandle, setResizeHandle] = useState<string | null>(null);
  const startPosRef = useRef<Position | null>(null);
  const originalCropRef = useRef<SelectionRect | null>(null);

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

  // Start crop selection
  const startCrop = useCallback((screenPos: Position) => {
    const imagePos = getImageCoords(screenPos);
    startPosRef.current = imagePos;
    setIsCropping(true);
    setCropRect({
      x: imagePos.x,
      y: imagePos.y,
      width: 0,
      height: 0,
    });
  }, [getImageCoords]);

  // Continue crop drag
  const continueCrop = useCallback((screenPos: Position) => {
    if (!isCropping || !startPosRef.current) return;

    const imagePos = getImageCoords(screenPos);
    const startPos = startPosRef.current;

    const x = Math.min(startPos.x, imagePos.x);
    const y = Math.min(startPos.y, imagePos.y);
    const width = Math.abs(imagePos.x - startPos.x);
    const height = Math.abs(imagePos.y - startPos.y);

    // Clamp to canvas bounds
    const canvasSize = canvasSizeRef.current;
    const clampedX = Math.max(0, x);
    const clampedY = Math.max(0, y);
    const clampedWidth = Math.min(width, canvasSize.width - clampedX);
    const clampedHeight = Math.min(height, canvasSize.height - clampedY);

    setCropRect({
      x: clampedX,
      y: clampedY,
      width: clampedWidth,
      height: clampedHeight,
    });
  }, [isCropping, getImageCoords, canvasSizeRef]);

  // End crop drag
  const endCrop = useCallback(() => {
    setIsCropping(false);
    startPosRef.current = null;

    // Validate minimum size
    if (cropRect && (cropRect.width < 10 || cropRect.height < 10)) {
      setCropRect(null);
    }
  }, [cropRect]);

  // Start resize handle drag
  const startResize = useCallback((handle: string, screenPos: Position) => {
    if (!cropRect) return;

    setIsResizing(true);
    setResizeHandle(handle);
    startPosRef.current = getImageCoords(screenPos);
    originalCropRef.current = { ...cropRect };
  }, [cropRect, getImageCoords]);

  // Continue resize
  const continueResize = useCallback((screenPos: Position) => {
    if (!isResizing || !resizeHandle || !originalCropRef.current || !startPosRef.current) return;

    const imagePos = getImageCoords(screenPos);
    const delta = {
      x: imagePos.x - startPosRef.current.x,
      y: imagePos.y - startPosRef.current.y,
    };
    const original = originalCropRef.current;
    const canvasSize = canvasSizeRef.current;

    let newRect = { ...original };

    // Handle different resize handles
    switch (resizeHandle) {
      case 'nw':
        newRect.x = Math.max(0, Math.min(original.x + delta.x, original.x + original.width - 10));
        newRect.y = Math.max(0, Math.min(original.y + delta.y, original.y + original.height - 10));
        newRect.width = original.width - (newRect.x - original.x);
        newRect.height = original.height - (newRect.y - original.y);
        break;
      case 'ne':
        newRect.y = Math.max(0, Math.min(original.y + delta.y, original.y + original.height - 10));
        newRect.width = Math.max(10, Math.min(original.width + delta.x, canvasSize.width - original.x));
        newRect.height = original.height - (newRect.y - original.y);
        break;
      case 'sw':
        newRect.x = Math.max(0, Math.min(original.x + delta.x, original.x + original.width - 10));
        newRect.width = original.width - (newRect.x - original.x);
        newRect.height = Math.max(10, Math.min(original.height + delta.y, canvasSize.height - original.y));
        break;
      case 'se':
        newRect.width = Math.max(10, Math.min(original.width + delta.x, canvasSize.width - original.x));
        newRect.height = Math.max(10, Math.min(original.height + delta.y, canvasSize.height - original.y));
        break;
      case 'n':
        newRect.y = Math.max(0, Math.min(original.y + delta.y, original.y + original.height - 10));
        newRect.height = original.height - (newRect.y - original.y);
        break;
      case 's':
        newRect.height = Math.max(10, Math.min(original.height + delta.y, canvasSize.height - original.y));
        break;
      case 'w':
        newRect.x = Math.max(0, Math.min(original.x + delta.x, original.x + original.width - 10));
        newRect.width = original.width - (newRect.x - original.x);
        break;
      case 'e':
        newRect.width = Math.max(10, Math.min(original.width + delta.x, canvasSize.width - original.x));
        break;
    }

    setCropRect(newRect);
  }, [isResizing, resizeHandle, getImageCoords, canvasSizeRef]);

  // End resize
  const endResize = useCallback(() => {
    setIsResizing(false);
    setResizeHandle(null);
    startPosRef.current = null;
    originalCropRef.current = null;
  }, []);

  // Apply crop - returns cropped image data
  const applyCrop = useCallback((
    image: HTMLImageElement,
    lines: Array<{ tool: string; points: number[]; color: string; strokeWidth: number }>,
    rotation: number,
    scaleX: number
  ): {
    croppedImage: HTMLCanvasElement;
    newCanvasSize: CanvasSize;
  } | null => {
    if (!cropRect || cropRect.width <= 0 || cropRect.height <= 0) {
      return null;
    }

    // Create canvas at crop size
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(cropRect.width);
    canvas.height = Math.round(cropRect.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    // Draw cropped portion of image
    ctx.drawImage(
      image,
      cropRect.x, cropRect.y, cropRect.width, cropRect.height,
      0, 0, canvas.width, canvas.height
    );

    // Draw lines (translated to crop space)
    for (const line of lines) {
      if (line.points.length < 4) continue;

      ctx.beginPath();
      ctx.strokeStyle = line.color;
      ctx.lineWidth = line.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = line.tool === 'eraser' ? 'destination-out' : 'source-over';

      ctx.moveTo(line.points[0] - cropRect.x, line.points[1] - cropRect.y);
      for (let i = 2; i < line.points.length; i += 2) {
        ctx.lineTo(line.points[i] - cropRect.x, line.points[i + 1] - cropRect.y);
      }
      ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';

    return {
      croppedImage: canvas,
      newCanvasSize: { width: canvas.width, height: canvas.height },
    };
  }, [cropRect]);

  // Clear crop
  const clearCrop = useCallback(() => {
    setCropRect(null);
    setIsCropping(false);
    setIsResizing(false);
    setResizeHandle(null);
    startPosRef.current = null;
    originalCropRef.current = null;
  }, []);

  // Set crop rect directly
  const setCropRectDirect = useCallback((rect: SelectionRect | null) => {
    setCropRect(rect);
  }, []);

  // Reset
  const reset = useCallback(() => {
    clearCrop();
  }, [clearCrop]);

  return {
    cropRect,
    isCropping,
    isResizing,
    resizeHandle,
    startCrop,
    continueCrop,
    endCrop,
    startResize,
    continueResize,
    endResize,
    applyCrop,
    clearCrop,
    setCropRect: setCropRectDirect,
    reset,
  };
};
