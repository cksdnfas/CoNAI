import type { ImageTransform, CanvasSize } from '../types/EditorTypes';

export const getImageTransform = (
  image: HTMLImageElement | null,
  canvasSize: CanvasSize,
  _rotation: number,
  viewportWidth: number,
  viewportHeight: number
): ImageTransform => {
  if (!image) return { x: 0, y: 0, width: 0, height: 0 };

  // Center position in viewport
  const x = viewportWidth / 2;
  const y = viewportHeight / 2;

  return { x, y, width: canvasSize.width, height: canvasSize.height };
};

/**
 * Calculate initial zoom to fit image in viewport
 * Standard image editor behavior: auto-fit on load
 */
export const calculateInitialZoom = (
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number
): number => {
  if (!imageWidth || !imageHeight || !viewportWidth || !viewportHeight) {
    return 1;
  }

  // Add padding (10% margin)
  const paddedViewportWidth = viewportWidth * 0.9;
  const paddedViewportHeight = viewportHeight * 0.9;

  // Calculate scale to fit
  const scaleX = paddedViewportWidth / imageWidth;
  const scaleY = paddedViewportHeight / imageHeight;

  // Use smaller scale to fit entire image
  const fitZoom = Math.min(scaleX, scaleY, 1); // Max 1x (100%) on initial load

  return fitZoom;
};
