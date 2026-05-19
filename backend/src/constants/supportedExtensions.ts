/**
 * Centralized configuration for supported file extensions
 *
 * This file defines all file extensions that the system can process.
 * Used by folder scanning, file watching, and file processing services.
 */

/**
 * Image extensions supported by the image processing pipeline
 */
const SUPPORTED_IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.bmp',
  '.tiff',
  '.tif'
] as const;

/**
 * Video extensions for video processing support
 * Note: GIF is included here for file extension grouping,
 * but is classified as file_type='animated' (not 'video') in business logic
 */
const SUPPORTED_VIDEO_EXTENSIONS = [
  '.mp4',
  '.webm',
  '.mov',
  '.avi',
  '.gif'  // file_type='animated', mime_type='image/gif'
] as const;

/**
 * All extensions that the system can potentially process
 * Images and videos are both supported
 */
export const ALL_SUPPORTED_EXTENSIONS = [
  ...SUPPORTED_IMAGE_EXTENSIONS,
  ...SUPPORTED_VIDEO_EXTENSIONS
] as const;

const SUPPORTED_IMAGE_EXTENSION_SET = new Set<string>(SUPPORTED_IMAGE_EXTENSIONS);
const SUPPORTED_VIDEO_EXTENSION_SET = new Set<string>(SUPPORTED_VIDEO_EXTENSIONS);
const ALL_SUPPORTED_EXTENSION_SET = new Set<string>(ALL_SUPPORTED_EXTENSIONS);

export function normalizeFileExtension(ext: string): string {
  const normalized = ext.trim().toLowerCase();
  return normalized.startsWith('.') ? normalized : `.${normalized}`;
}

/**
 * Type guard to check if a file extension is supported
 * @param ext - File extension (with or without leading dot)
 * @returns true if the extension is supported
 */
export function isSupportedExtension(ext: string): boolean {
  return ALL_SUPPORTED_EXTENSION_SET.has(normalizeFileExtension(ext));
}

/**
 * Type guard to check if a file extension should be excluded
 * @param ext - File extension to check
 * @param excludeList - Array of extensions to exclude
 * @returns true if the extension should be excluded
 */
function isExcludedExtension(ext: string, excludeList: string[]): boolean {
  if (!excludeList || excludeList.length === 0) {
    return false;
  }
  const normalized = normalizeFileExtension(ext);
  return excludeList.some(excludedExtension => normalizeFileExtension(excludedExtension) === normalized);
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
  return SUPPORTED_VIDEO_EXTENSION_SET.has(normalizeFileExtension(ext));
}

/**
 * Check if file extension is an image format
 * @param ext - File extension to check
 * @returns true if the extension is an image format
 */
export function isImageExtension(ext: string): boolean {
  return SUPPORTED_IMAGE_EXTENSION_SET.has(normalizeFileExtension(ext));
}
