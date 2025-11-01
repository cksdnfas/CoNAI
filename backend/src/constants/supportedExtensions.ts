/**
 * Centralized configuration for supported file extensions
 *
 * This file defines all file extensions that the system can process.
 * Used by folder scanning, file watching, and file processing services.
 */

/**
 * Image extensions supported by the image processing pipeline
 */
export const SUPPORTED_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.bmp',
  '.tiff',
  '.tif'
] as const;

/**
 * Video extensions for future video processing support
 * Currently not processed, but reserved for future implementation
 * Note: GIF is classified as video due to animation support
 */
export const SUPPORTED_VIDEO_EXTENSIONS = [
  '.mp4',
  '.webm',
  '.mov',
  '.avi',
  '.gif'
] as const;

/**
 * All extensions that the system can potentially process
 * Images and videos are both supported
 */
export const ALL_SUPPORTED_EXTENSIONS = [
  ...SUPPORTED_IMAGE_EXTENSIONS,
  ...SUPPORTED_VIDEO_EXTENSIONS
] as const;

/**
 * Type guard to check if a file extension is supported
 * @param ext - File extension (with or without leading dot)
 * @returns true if the extension is supported
 */
export function isSupportedExtension(ext: string): boolean {
  const normalized = ext.toLowerCase().startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return (ALL_SUPPORTED_EXTENSIONS as readonly string[]).includes(normalized);
}

/**
 * Type guard to check if a file extension should be excluded
 * @param ext - File extension to check
 * @param excludeList - Array of extensions to exclude
 * @returns true if the extension should be excluded
 */
export function isExcludedExtension(ext: string, excludeList: string[]): boolean {
  if (!excludeList || excludeList.length === 0) {
    return false;
  }
  const normalized = ext.toLowerCase().startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return excludeList.map(e => e.toLowerCase()).includes(normalized);
}

/**
 * Check if a file should be processed based on extension
 * @param ext - File extension to check
 * @param excludeList - Optional array of extensions to exclude
 * @returns true if the file should be processed
 */
export function shouldProcessFileExtension(ext: string, excludeList: string[] = []): boolean {
  return isSupportedExtension(ext) && !isExcludedExtension(ext, excludeList);
}

/**
 * Check if file extension is a video format
 * @param ext - File extension to check
 * @returns true if the extension is a video format
 */
export function isVideoExtension(ext: string): boolean {
  const normalized = ext.toLowerCase().startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return (SUPPORTED_VIDEO_EXTENSIONS as readonly string[]).includes(normalized);
}

/**
 * Check if file extension is an image format
 * @param ext - File extension to check
 * @returns true if the extension is an image format
 */
export function isImageExtension(ext: string): boolean {
  const normalized = ext.toLowerCase().startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return (SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(normalized);
}
