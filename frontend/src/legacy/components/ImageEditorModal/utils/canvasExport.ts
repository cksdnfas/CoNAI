import type { DrawLine, CanvasSize } from '../types/EditorTypes';

/**
 * Export edited image at ORIGINAL resolution using offscreen canvas
 * This is the correct approach - render everything fresh at original size
 * Zoom/pan are view-only and should NOT affect the output
 */
export const exportCanvasToDataURL = (
  image: HTMLImageElement,
  lines: DrawLine[],
  canvasSize: CanvasSize,
  rotation: number,
  scaleX: number
): string => {
  if (!image) {
    throw new Error('Image not available');
  }

  // Determine output dimensions based on rotation
  const is90or270 = rotation === 90 || rotation === 270;
  const outputWidth = is90or270 ? canvasSize.height : canvasSize.width;
  const outputHeight = is90or270 ? canvasSize.width : canvasSize.height;

  // Create offscreen canvas at original resolution
  const offscreenCanvas = document.createElement('canvas');
  offscreenCanvas.width = outputWidth;
  offscreenCanvas.height = outputHeight;
  const ctx = offscreenCanvas.getContext('2d');

  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }

  // Save context state
  ctx.save();

  // Move to center of output canvas
  ctx.translate(outputWidth / 2, outputHeight / 2);

  // Apply rotation (in radians)
  ctx.rotate((rotation * Math.PI) / 180);

  // Apply horizontal flip if needed
  if (scaleX < 0) {
    ctx.scale(-1, 1);
  }

  // Draw image centered (before rotation, so use original dimensions)
  ctx.drawImage(
    image,
    -canvasSize.width / 2,
    -canvasSize.height / 2,
    canvasSize.width,
    canvasSize.height
  );

  // Restore context for drawing lines
  ctx.restore();

  // Draw lines on top (lines are stored in original coordinates)
  // Need to transform line coordinates based on rotation/flip
  ctx.save();
  ctx.translate(outputWidth / 2, outputHeight / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  if (scaleX < 0) {
    ctx.scale(-1, 1);
  }
  ctx.translate(-canvasSize.width / 2, -canvasSize.height / 2);

  // Draw each line
  for (const line of lines) {
    if (line.points.length < 4) continue;

    ctx.beginPath();
    ctx.strokeStyle = line.color;
    ctx.lineWidth = line.strokeWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Set composite operation for eraser
    if (line.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
    } else {
      ctx.globalCompositeOperation = 'source-over';
    }

    // Draw the line path
    ctx.moveTo(line.points[0], line.points[1]);
    for (let i = 2; i < line.points.length; i += 2) {
      ctx.lineTo(line.points[i], line.points[i + 1]);
    }
    ctx.stroke();
  }

  ctx.restore();

  return offscreenCanvas.toDataURL('image/png');
};

/**
 * Legacy export function - deprecated
 * @deprecated Use exportCanvasToDataURL with offscreen canvas instead
 */
export const exportAndSaveCanvas = async (
  image: HTMLImageElement,
  lines: DrawLine[],
  canvasSize: CanvasSize,
  rotation: number,
  scaleX: number,
  imageId: number
): Promise<void> => {
  const dataURL = exportCanvasToDataURL(image, lines, canvasSize, rotation, scaleX);

  const { default: axios } = await import('axios');
  await axios.post(`/api/image-editor/${imageId}/save`, {
    imageData: dataURL,
  });
};
