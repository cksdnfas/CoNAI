/**
 * Formatting utilities for file sizes, dates, and strings
 * Shared between backend and frontend for consistent formatting
 */

/**
 * Format file size in bytes to human-readable string
 * @param bytes - File size in bytes
 * @returns Formatted string (e.g., "1.5 MB", "500 KB")
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Format date string to localized string
 * @param dateString - ISO date string
 * @param locale - Locale string (default: 'ko-KR')
 * @returns Localized date string
 */
export const formatDate = (dateString: string, locale: string = 'ko-KR'): string => {
  return new Date(dateString).toLocaleString(locale);
};

/**
 * Truncate filename to specified length while preserving extension
 * @param filename - Original filename
 * @param maxLength - Maximum length (default: 40)
 * @returns Truncated filename
 */
export const truncateFilename = (filename: string, maxLength: number = 40): string => {
  if (filename.length <= maxLength) return filename;

  const ext = filename.split('.').pop();
  if (!ext) return filename.substring(0, maxLength) + '...';

  const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
  const truncatedName = nameWithoutExt.substring(0, maxLength - ext.length - 4) + '...';
  return `${truncatedName}.${ext}`;
};

/**
 * Format duration in seconds to MM:SS format
 * @param seconds - Duration in seconds
 * @returns Formatted string (e.g., "3:45")
 */
export const formatDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${String(secs).padStart(2, '0')}`;
};

/**
 * Format bitrate to Mbps
 * @param bitrate - Bitrate in bits per second
 * @returns Formatted string (e.g., "2.50 Mbps")
 */
export const formatBitrate = (bitrate: number): string => {
  return `${(bitrate / 1000000).toFixed(2)} Mbps`;
};
