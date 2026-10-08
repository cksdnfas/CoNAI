import type { RuntimeJobContext } from '../runtimeJobs/runtimeJobRunner';

/**
 * Shared pacing for whole-library passes.
 *
 * images.db has one synchronous better-sqlite3 connection, so a pass over every row must page by key (never OFFSET,
 * never one big SELECT), keep each write transaction to one page, and give the event loop back between pages.
 * Another connection that wants to write waits (busy_timeout, synchronously) for as long as a write transaction
 * stays open, so a short transaction is what keeps the server responsive, not only the yield.
 */

/** Rows per page and per write transaction. */
export const LIBRARY_BATCH_SIZE = 500;

export interface LibraryBatchHooks {
  /** Rows (or items) done so far out of `total` (total may be an estimate). */
  progress?: (processed: number, total: number) => void;
  /** Called between pages; defaults to one setImmediate turn. */
  yield?: () => Promise<void>;
  throwIfCancelled?: () => void;
  /** One failed item; jobs keep the most recent ones. */
  recordError?: (target: string, error: unknown) => void;
}

export const yieldToEventLoop = (): Promise<void> => new Promise<void>((resolve) => setImmediate(resolve));

/** Hooks wired to a runtime job: progress, cancel checkpoints, event-loop yields and the error log. */
export function libraryBatchHooksFromJob(ctx: RuntimeJobContext<any>, label?: string): LibraryBatchHooks {
  return {
    progress: (processed, total) => ctx.report({ processed, total, currentLabel: label ?? null }),
    yield: () => ctx.yield(),
    throwIfCancelled: () => ctx.throwIfCancelled(),
    recordError: (target, error) => ctx.recordError(target, error),
  };
}

/** Run the page boundary: cancel checkpoint, then give the event loop a turn. */
export async function pageBoundary(hooks: LibraryBatchHooks): Promise<void> {
  hooks.throwIfCancelled?.();
  await (hooks.yield ?? yieldToEventLoop)();
}

export function chunkArray<T>(items: readonly T[], size: number = LIBRARY_BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}
