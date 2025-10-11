/**
 * Format file size in bytes to human-readable string
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Format date string to Korean locale
 */
export const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleString('ko-KR');
};

/**
 * Truncate filename to specified length
 */
export const truncateFilename = (filename: string, maxLength: number = 40): string => {
  if (filename.length <= maxLength) return filename;
  const ext = filename.split('.').pop();
  const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.'));
  const truncatedName = nameWithoutExt.substring(0, maxLength - ext!.length - 4) + '...';
  return `${truncatedName}.${ext}`;
};
