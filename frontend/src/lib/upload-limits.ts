/**
 * Library upload limits enforced by the backend multipart parser.
 * Mirrors backend/src/middleware/upload.ts (MAX_UPLOAD_FILE_SIZE_BYTES,
 * MAX_MULTIPLE_UPLOAD_FILES, MAX_MULTIPLE_UPLOAD_TOTAL_BYTES); keep in sync.
 */
export const UPLOAD_LIMITS = {
  /** Largest single file the server accepts. */
  maxFileBytes: 500 * 1024 * 1024,
  /** Files per /upload-multiple request. */
  maxFilesPerRequest: 20,
  /** Combined file bytes per /upload-multiple request. */
  maxRequestBytes: 1024 * 1024 * 1024,
} as const
