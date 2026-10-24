/**
 * Image processing and storage constants
 */

export const IMAGE_PROCESSING = {
  THUMBNAIL_SIZE: 1080,
  MAX_FILE_SIZE_MB: 50,
  MAX_FILE_SIZE_BYTES: 50 * 1024 * 1024,
  WEBP_QUALITY: 95,
} as const;

/** Multipart library upload limits shared by the HTTP parser, client batching, and plugin bridge. */
export const UPLOAD_LIMITS = {
  maxFileBytes: 500 * 1024 * 1024,
  maxFilesPerRequest: 20,
  maxRequestBytes: 1024 * 1024 * 1024,
} as const;

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 25,
  GROUP_IMAGES_LIMIT: 20,
  MAX_LIMIT: 100,
} as const;
