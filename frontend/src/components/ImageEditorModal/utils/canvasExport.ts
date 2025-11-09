import axios from 'axios';
import type { ImageTransform } from '../types/EditorTypes';

/**
 * Export canvas at ORIGINAL resolution (ignoring viewport zoom)
 * Standard image editor behavior: zoom affects viewing only, not the saved file
 */
export const exportAndSaveCanvas = async (
  layerRef: any,
  imageTransform: ImageTransform,
  imageId: number,
  currentZoom: number
): Promise<void> => {
  if (!layerRef) {
    throw new Error('Layer reference not available');
  }

  // Export at original resolution by compensating for viewport zoom
  // This ensures the saved image is at the original size, not zoomed
  const layer = layerRef;
  const dataURL = layer.toDataURL({
    x: imageTransform.x - imageTransform.width / 2,
    y: imageTransform.y - imageTransform.height / 2,
    width: imageTransform.width,
    height: imageTransform.height,
    pixelRatio: 1 / currentZoom, // Compensate for zoom to get original size
  });

  // Save to backend
  await axios.post(`/api/image-editor/${imageId}/save`, {
    imageData: dataURL,
  });
};
