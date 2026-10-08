import { spawn } from 'child_process';
import ffmpegStaticPath from 'ffmpeg-static';
import { AudioServiceError } from './audioService';

/**
 * ffmpeg for the audio workspace (edits, previews, exports). Same binaries as VideoProcessor: the bundled static
 * build first, the system `ffmpeg` when the bundled one cannot be started.
 */

export const AUDIO_FFMPEG_TIMEOUT_MS = 90_000;

function ffmpegCandidates(): string[] {
  const bundled = (ffmpegStaticPath as unknown as string | null) || null;
  return [...new Set([bundled, 'ffmpeg'].filter((value): value is string => Boolean(value)))];
}

export interface AudioFfmpegResult {
  stdout: Buffer;
  stderr: string;
}

function runOnce(command: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<AudioFfmpegResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AudioServiceError('작업이 취소됐어.', 409));
      return;
    }
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const finish = (error: Error | null, result?: AudioFfmpegResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) reject(error);
      else resolve(result!);
    };
    const onAbort = () => {
      child.kill('SIGKILL');
      finish(new AudioServiceError('작업이 취소됐어.', 409));
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new AudioServiceError('오디오 처리 시간이 너무 오래 걸렸어.', 504));
    }, timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (error: NodeJS.ErrnoException) => finish(error));
    child.on('close', (code) => {
      const stderrText = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        finish(new AudioServiceError(`오디오 처리 실패: ${stderrText.slice(-800).trim()}`, 422));
        return;
      }
      finish(null, { stdout: Buffer.concat(stdout), stderr: stderrText });
    });
  });
}

/** Run ffmpeg to completion; a missing bundled binary falls back to the system one. */
export async function runAudioFfmpeg(args: string[], options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<AudioFfmpegResult> {
  const candidates = ffmpegCandidates();
  let lastError: unknown = null;
  for (const command of candidates) {
    try {
      return await runOnce(command, args, options.timeoutMs ?? AUDIO_FFMPEG_TIMEOUT_MS, options.signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT' || (error as NodeJS.ErrnoException)?.code === 'EACCES') {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw new AudioServiceError(`ffmpeg를 찾을 수 없어: ${(lastError as Error | null)?.message ?? 'not found'}`, 500);
}

/** A small FIFO semaphore: edits, previews and export renders share two slots, like the original `edit_slots`. */
class Semaphore {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly size: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.size) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

export const audioRenderSlots = new Semaphore(2);
