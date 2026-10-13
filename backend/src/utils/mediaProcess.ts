import { spawn } from 'child_process';

export interface MediaProcessResult { stdout: Buffer; stderr: string }
export interface MediaProcessOptions { timeoutMs: number; signal?: AbortSignal; captureStdout?: boolean }

export class MediaProcessError extends Error {
  constructor(
    readonly reason: 'cancelled' | 'timeout' | 'spawn' | 'exit',
    readonly command: string,
    readonly stderr = '',
    readonly exitCode: number | null = null,
    readonly originalError?: NodeJS.ErrnoException,
  ) { super(originalError?.message ?? reason); }
}

function runOnce(command: string, args: string[], options: MediaProcessOptions): Promise<MediaProcessResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(new MediaProcessError('cancelled', command)); return; }
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    let stderr = Buffer.alloc(0);
    let stderrHead = Buffer.alloc(0);
    let stderrBytes = 0;
    let stopped: MediaProcessError | null = null;
    let settled = false;
    const finish = (error: Error | null, result?: MediaProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(result!);
    };
    const stop = (reason: 'cancelled' | 'timeout') => {
      stopped ??= new MediaProcessError(reason, command);
      child.kill('SIGKILL');
      // Settle on close so callers can safely remove files on Windows.
    };
    const onAbort = () => stop('cancelled');
    const timer = setTimeout(() => stop('timeout'), options.timeoutMs);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => { if (options.captureStdout !== false) stdout.push(chunk); });
    child.stderr.on('data', (chunk: Buffer) => {
      // Retain the stream banner (raw frame dimensions) and the diagnostic tail (loudnorm JSON).
      if (stderrHead.length < 64 * 1024) stderrHead = Buffer.concat([stderrHead, chunk.subarray(0, 64 * 1024 - stderrHead.length)]);
      stderrBytes += chunk.length;
      const combined = Buffer.concat([stderr, chunk]);
      stderr = combined.subarray(Math.max(0, combined.length - 1024 * 1024));
    });
    child.once('error', (error: NodeJS.ErrnoException) => finish(stopped ?? new MediaProcessError('spawn', command, '', null, error)));
    child.once('close', (code) => {
      const diagnostic = stderrBytes > stderr.length ? `${stderrHead.toString('utf8')}\n…\n${stderr.toString('utf8')}` : stderr.toString('utf8');
      finish(stopped ?? (code === 0 ? null : new MediaProcessError('exit', command, diagnostic, code)), { stdout: Buffer.concat(stdout), stderr: diagnostic });
    });
  });
}

/** Retry only when a binary cannot start; processing errors, cancellation and timeouts never rerun a task. */
export async function runMediaProcess(commands: string[], args: string[], options: MediaProcessOptions): Promise<MediaProcessResult> {
  const candidates = [...new Set(commands.filter(Boolean))];
  for (const [index, command] of candidates.entries()) {
    try { return await runOnce(command, args, options); }
    catch (error) {
      if (error instanceof MediaProcessError && error.reason === 'spawn'
        && ['ENOENT', 'EACCES'].includes(error.originalError?.code ?? '') && index < candidates.length - 1) continue;
      throw error;
    }
  }
  throw new Error('No media tool configured');
}
