import fs from 'fs';
import path from 'path';
import { resolveFolderPath } from '../../utils/pathResolver';
import type { WatchedFolderWatcherRecord } from './fileWatcherStore';

export interface InitialWatcherPathValidationResult {
  resolvedPath: string;
  isValid: boolean;
  errorMessage?: string;
}

export interface StartWatcherPathPreparationResult {
  resolvedPath: string;
  isReady: boolean;
  skipReason?: string;
  wasCreated?: boolean;
}

/** Resolve one watcher path and require it to already exist and be readable. */
export function validateInitialWatcherPath(folderPath: string): InitialWatcherPathValidationResult {
  const resolvedPath = resolveFolderPath(folderPath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      resolvedPath,
      isValid: false,
      errorMessage: '초기화 시 경로 접근 실패 - 경로가 존재하지 않음',
    };
  }

  try {
    fs.accessSync(resolvedPath, fs.constants.R_OK);
    return { resolvedPath, isValid: true };
  } catch {
    return {
      resolvedPath,
      isValid: false,
      errorMessage: '초기화 시 경로 접근 실패 - 읽기 권한 없음',
    };
  }
}

/** Resolve one watcher path and prepare the runtime directory policy used by startWatcher. */
export function prepareWatcherStartPath(folderPath: string): StartWatcherPathPreparationResult {
  const resolvedPath = resolveFolderPath(folderPath);

  if (!fs.existsSync(resolvedPath)) {
    if (!path.isAbsolute(folderPath)) {
      try {
        fs.mkdirSync(resolvedPath, { recursive: true });
        return {
          resolvedPath,
          isReady: true,
          wasCreated: true,
        };
      } catch {
        return {
          resolvedPath,
          isReady: false,
          skipReason: '폴더 생성 실패',
        };
      }
    }

    return {
      resolvedPath,
      isReady: false,
      skipReason: '폴더 없음',
    };
  }

  try {
    fs.accessSync(resolvedPath, fs.constants.R_OK);
  } catch {
    return {
      resolvedPath,
      isReady: false,
      skipReason: '읽기 권한 없음',
    };
  }

  return {
    resolvedPath,
    isReady: true,
  };
}

/** Parse one stored JSON-array column from watched_folders into a string array. */
export function parseWatcherJsonArray(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Detect whether a folder path should default to polling-mode watcher behavior. */
export function isNetworkDrivePath(folderPath: string): boolean {
  if (folderPath.startsWith('\\\\') || folderPath.startsWith('//')) return true;
  if (folderPath.includes('/mnt/') || folderPath.includes('/net/')) return true;
  return false;
}

/** Build watcher polling behavior from folder config and resolved path. */
export function resolveWatcherPollingOptions(folder: Pick<WatchedFolderWatcherRecord, 'watcher_polling_interval'>, resolvedPath: string) {
  if (folder.watcher_polling_interval !== null && folder.watcher_polling_interval !== undefined) {
    return {
      usePolling: true,
      pollingInterval: folder.watcher_polling_interval,
      pollingReason: 'user-configured',
    };
  }

  if (isNetworkDrivePath(resolvedPath)) {
    return {
      usePolling: true,
      pollingInterval: 5000,
      pollingReason: 'network-drive',
    };
  }

  return {
    usePolling: false,
    pollingInterval: undefined,
    pollingReason: 'default',
  };
}
