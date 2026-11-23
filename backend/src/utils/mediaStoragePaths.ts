import path from 'path';

/**
 * Dated storage folder (`YYYY-MM-DD`, local time = the app time zone, services/appTimeZone.ts) of new uploads and
 * results. Stored names: mediaFileNames.ts.
 */
export function getDateFolder(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function normalizeRelativePath(targetPath: string, basePath: string): string {
  return path.relative(basePath, targetPath).replace(/\\/g, '/');
}
