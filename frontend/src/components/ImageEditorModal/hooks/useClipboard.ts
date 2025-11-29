import { useState, useCallback, useRef } from 'react';
import type { ClipboardData, Selection, CanvasSize, Layer, DrawLine } from '../types/EditorTypes';

interface UseClipboardProps {
  canvasSizeRef: React.MutableRefObject<CanvasSize>;
}

/**
 * Create ImageData from canvas selection
 */
const createImageDataFromSelection = (
  image: HTMLImageElement,
  layers: Layer[],
  selection: Selection,
  canvasSize: CanvasSize
): ImageData | null => {
  if (!selection) return null;

  const bounds = getSelectionBounds(selection);
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;

  // Create offscreen canvas for the selection area
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(bounds.width);
  canvas.height = Math.ceil(bounds.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Draw background image (translated to selection bounds)
  ctx.drawImage(
    image,
    bounds.x, bounds.y, bounds.width, bounds.height,
    0, 0, bounds.width, bounds.height
  );

  // Draw all visible drawing layers
  const visibleDrawingLayers = layers.filter(l => l.visible && l.type === 'drawing' && l.lines);
  for (const layer of visibleDrawingLayers) {
    if (!layer.lines) continue;
    ctx.globalAlpha = layer.opacity;

    for (const line of layer.lines) {
      if (line.points.length < 4) continue;

      ctx.beginPath();
      ctx.strokeStyle = line.color;
      ctx.lineWidth = line.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = line.tool === 'eraser' ? 'destination-out' : 'source-over';

      // Translate line coordinates to selection space
      ctx.moveTo(line.points[0] - bounds.x, line.points[1] - bounds.y);
      for (let i = 2; i < line.points.length; i += 2) {
        ctx.lineTo(line.points[i] - bounds.x, line.points[i + 1] - bounds.y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Apply lasso mask if needed
  if (selection.type === 'lasso' && selection.lasso) {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = bounds.width;
    maskCanvas.height = bounds.height;
    const maskCtx = maskCanvas.getContext('2d');
    if (maskCtx) {
      // Draw mask
      maskCtx.fillStyle = 'white';
      maskCtx.beginPath();
      const points = selection.lasso.points;
      maskCtx.moveTo(points[0] - bounds.x, points[1] - bounds.y);
      for (let i = 2; i < points.length; i += 2) {
        maskCtx.lineTo(points[i] - bounds.x, points[i + 1] - bounds.y);
      }
      maskCtx.closePath();
      maskCtx.fill();

      // Apply mask using destination-in
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(maskCanvas, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  return ctx.getImageData(0, 0, canvas.width, canvas.height);
};

/**
 * Get bounds of selection
 */
const getSelectionBounds = (selection: Selection): { x: number; y: number; width: number; height: number } | null => {
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
};

export const useClipboard = ({ canvasSizeRef }: UseClipboardProps) => {
  const [clipboardData, setClipboardData] = useState<ClipboardData | null>(null);
  const [pastePosition, setPastePosition] = useState<{ x: number; y: number } | null>(null);

  // Internal ref for async operations
  const clipboardRef = useRef<ClipboardData | null>(null);

  /**
   * Copy selection to internal clipboard
   */
  const copy = useCallback((
    image: HTMLImageElement,
    layers: Layer[],
    selection: Selection
  ): boolean => {
    if (!selection) {
      console.warn('No selection to copy');
      return false;
    }

    const imageData = createImageDataFromSelection(image, layers, selection, canvasSizeRef.current);
    if (!imageData) {
      console.warn('Failed to create image data from selection');
      return false;
    }

    const data: ClipboardData = {
      imageData,
      width: imageData.width,
      height: imageData.height,
    };

    setClipboardData(data);
    clipboardRef.current = data;

    // Also try to copy to system clipboard as PNG
    try {
      const canvas = document.createElement('canvas');
      canvas.width = imageData.width;
      canvas.height = imageData.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.putImageData(imageData, 0, 0);
        canvas.toBlob((blob) => {
          if (blob) {
            try {
              navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
              ]).catch(() => {
                // Fallback: system clipboard not available
              });
            } catch {
              // ClipboardItem not supported
            }
          }
        }, 'image/png');
      }
    } catch {
      // System clipboard not available
    }

    return true;
  }, [canvasSizeRef]);

  /**
   * Cut selection (copy + clear selected area)
   * Returns the lines to be modified (with selection area removed)
   */
  const cut = useCallback((
    image: HTMLImageElement,
    layers: Layer[],
    selection: Selection
  ): { success: boolean; clearedLines?: DrawLine[] } => {
    if (!selection) {
      return { success: false };
    }

    // First copy
    const copied = copy(image, layers, selection);
    if (!copied) {
      return { success: false };
    }

    // Clear the selected area from drawing layers
    // For simplicity, we return all lines that should be kept
    // (lines outside the selection area)
    // A proper implementation would clip lines at selection boundaries

    const bounds = getSelectionBounds(selection);
    if (!bounds) {
      return { success: true };
    }

    // For now, we don't modify the lines - just mark as cut
    // The caller should handle clearing the selection area visually

    return { success: true };
  }, [copy]);

  /**
   * Paste from clipboard at given position
   * Returns paste layer data
   */
  const paste = useCallback((
    targetX?: number,
    targetY?: number
  ): { imageData: ImageData; x: number; y: number } | null => {
    const data = clipboardRef.current || clipboardData;
    if (!data) {
      console.warn('No clipboard data to paste');
      return null;
    }

    // Default paste position: center of canvas
    const canvasSize = canvasSizeRef.current;
    const x = targetX ?? (canvasSize.width / 2 - data.width / 2);
    const y = targetY ?? (canvasSize.height / 2 - data.height / 2);

    setPastePosition({ x, y });

    return {
      imageData: data.imageData,
      x,
      y,
    };
  }, [clipboardData, canvasSizeRef]);

  /**
   * Paste from system clipboard (if available)
   */
  const pasteFromSystem = useCallback(async (): Promise<{ imageData: ImageData; x: number; y: number } | null> => {
    try {
      const items = await navigator.clipboard.read();

      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const bitmap = await createImageBitmap(blob);

            const canvas = document.createElement('canvas');
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) continue;

            ctx.drawImage(bitmap, 0, 0);
            const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);

            const data: ClipboardData = {
              imageData,
              width: bitmap.width,
              height: bitmap.height,
            };

            setClipboardData(data);
            clipboardRef.current = data;

            return paste();
          }
        }
      }

      // No image found in system clipboard, use internal clipboard
      return paste();
    } catch {
      // System clipboard not available, use internal clipboard
      return paste();
    }
  }, [paste]);

  /**
   * Check if clipboard has data
   */
  const hasClipboardData = useCallback((): boolean => {
    return !!(clipboardRef.current || clipboardData);
  }, [clipboardData]);

  /**
   * Clear clipboard
   */
  const clearClipboard = useCallback(() => {
    setClipboardData(null);
    clipboardRef.current = null;
    setPastePosition(null);
  }, []);

  /**
   * Reset
   */
  const reset = useCallback(() => {
    clearClipboard();
  }, [clearClipboard]);

  return {
    clipboardData,
    pastePosition,
    copy,
    cut,
    paste,
    pasteFromSystem,
    hasClipboardData,
    clearClipboard,
    reset,
  };
};
