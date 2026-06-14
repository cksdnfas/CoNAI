import fs from 'fs';
import path from 'path';

import { runtimePaths } from '../../config/runtimePaths';

const DANBOORU_DB_DOWNLOAD_URL = 'https://github.com/cksdnfas/danbooru-db-viewer';
const DANBOORU_DB_FILE_PATTERNS = ['danbooru.sqlite', '*danbooru*.sqlite', '*danbooru*.sqlite3', '*danbooru*.db'];
const DANBOORU_DB_EXTENSIONS = new Set(['.sqlite', '.sqlite3', '.db']);

export interface DanbooruBrowserDatabaseInfo {
  available: boolean;
  path: string;
  expectedPath: string;
  expectedDirectory: string;
  downloadUrl: string;
  filePatterns: string[];
  matchedBy: 'configured' | 'default' | 'discovered' | 'missing';
}

function isDanbooruDbCandidate(fileName: string): boolean {
  const lowerFileName = fileName.toLowerCase();
  const extension = path.extname(lowerFileName);
  return lowerFileName.includes('danbooru')
    && DANBOORU_DB_EXTENSIONS.has(extension)
    && !lowerFileName.endsWith('-wal')
    && !lowerFileName.endsWith('-shm')
    && !lowerFileName.endsWith('-journal');
}

function compareDanbooruDbCandidates(left: string, right: string): number {
  const scoreCandidate = (filePath: string) => {
    const fileName = path.basename(filePath).toLowerCase();
    const extension = path.extname(fileName);
    const baseName = fileName.slice(0, fileName.length - extension.length);
    const stat = fs.statSync(filePath);

    return {
      exact: fileName === 'danbooru.sqlite' ? 0 : 1,
      startsWith: baseName.startsWith('danbooru') ? 0 : 1,
      extension: extension === '.sqlite' ? 0 : extension === '.sqlite3' ? 1 : 2,
      length: fileName.length,
      newest: -stat.mtimeMs,
      fileName,
    };
  };

  const leftScore = scoreCandidate(left);
  const rightScore = scoreCandidate(right);
  return leftScore.exact - rightScore.exact
    || leftScore.startsWith - rightScore.startsWith
    || leftScore.extension - rightScore.extension
    || leftScore.length - rightScore.length
    || leftScore.newest - rightScore.newest
    || leftScore.fileName.localeCompare(rightScore.fileName);
}

function findDanbooruDbCandidate(directory: string): string | null {
  if (!fs.existsSync(directory)) {
    return null;
  }

  const candidates = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isDanbooruDbCandidate(entry.name))
    .map((entry) => path.join(directory, entry.name))
    .sort(compareDanbooruDbCandidates);

  return candidates[0] ?? null;
}

export function resolveDanbooruDbInfo(): DanbooruBrowserDatabaseInfo {
  const expectedDirectory = runtimePaths.databaseDir;
  const expectedPath = path.join(expectedDirectory, 'danbooru.sqlite');
  const configuredPath = process.env.DANBOORU_SQLITE_PATH?.trim();

  if (configuredPath) {
    const resolvedConfiguredPath = path.resolve(configuredPath);
    const exists = fs.existsSync(resolvedConfiguredPath);
    return {
      available: exists,
      path: resolvedConfiguredPath,
      expectedPath: resolvedConfiguredPath,
      expectedDirectory: path.dirname(resolvedConfiguredPath),
      downloadUrl: DANBOORU_DB_DOWNLOAD_URL,
      filePatterns: DANBOORU_DB_FILE_PATTERNS,
      matchedBy: exists ? 'configured' : 'missing',
    };
  }

  if (fs.existsSync(expectedPath)) {
    return {
      available: true,
      path: expectedPath,
      expectedPath,
      expectedDirectory,
      downloadUrl: DANBOORU_DB_DOWNLOAD_URL,
      filePatterns: DANBOORU_DB_FILE_PATTERNS,
      matchedBy: 'default',
    };
  }

  const discoveredPath = findDanbooruDbCandidate(expectedDirectory);
  if (discoveredPath) {
    return {
      available: true,
      path: discoveredPath,
      expectedPath,
      expectedDirectory,
      downloadUrl: DANBOORU_DB_DOWNLOAD_URL,
      filePatterns: DANBOORU_DB_FILE_PATTERNS,
      matchedBy: 'discovered',
    };
  }

  return {
    available: false,
    path: expectedPath,
    expectedPath,
    expectedDirectory,
    downloadUrl: DANBOORU_DB_DOWNLOAD_URL,
    filePatterns: DANBOORU_DB_FILE_PATTERNS,
    matchedBy: 'missing',
  };
}
