import type { FSWatcher } from 'chokidar';

interface WaitForChokidarReadyOptions {
  watcher: FSWatcher;
  timeoutMs?: number;
  timeoutMessage: string;
  onReady?: () => void;
  onError?: (error: unknown, errorMessage: string) => void;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForChokidarReady(options: WaitForChokidarReadyOptions): Promise<void> {
  const { watcher, timeoutMs = 10000, timeoutMessage, onReady, onError } = options;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timeout);
      watcher.off('ready', handleReady);
      watcher.off('error', handleError);
    }

    function handleReady(): void {
      cleanup();
      onReady?.();
      resolve();
    }

    function handleError(error: unknown): void {
      cleanup();
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      onError?.(error, errorMessage);
      reject(error instanceof Error ? error : new Error(errorMessage));
    }

    watcher.on('ready', handleReady);
    watcher.on('error', handleError);
  });
}
