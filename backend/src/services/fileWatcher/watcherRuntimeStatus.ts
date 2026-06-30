export type WatcherRuntimeState = 'initializing' | 'watching' | 'error' | 'stopped';

export interface WatcherRuntimeStatus {
  folderId: number;
  folderPath: string;
  folderName: string;
  state: WatcherRuntimeState;
  error?: string;
  lastEvent?: Date;
  eventCount: number;
  retryAttempts: number;
  isRetrying?: boolean;
}

const runtimeStatuses = new Map<number, WatcherRuntimeStatus>();

export function setWatcherRuntimeStatus(status: WatcherRuntimeStatus): void {
  runtimeStatuses.set(status.folderId, {
    ...status,
    lastEvent: status.lastEvent ? new Date(status.lastEvent) : undefined,
  });
}

export function removeWatcherRuntimeStatus(folderId: number): void {
  runtimeStatuses.delete(folderId);
}

export function getWatcherRuntimeStatus(folderId: number): WatcherRuntimeStatus | null {
  const status = runtimeStatuses.get(folderId);
  return status
    ? {
      ...status,
      lastEvent: status.lastEvent ? new Date(status.lastEvent) : undefined,
    }
    : null;
}
