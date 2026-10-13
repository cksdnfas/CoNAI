import ffmpegStaticPath from 'ffmpeg-static';
import { AudioServiceError } from './audioService';
import { MediaProcessError, runMediaProcess, type MediaProcessResult } from '../../utils/mediaProcess';

/**
 * ffmpeg for the audio workspace (edits, previews, exports). Same binaries as VideoProcessor: the bundled static
 * build first, the system `ffmpeg` when the bundled one cannot be started.
 */

export const AUDIO_FFMPEG_TIMEOUT_MS = 90_000;

function ffmpegCandidates(): string[] {
  const bundled = (ffmpegStaticPath as unknown as string | null) || null;
  return [...new Set([bundled, 'ffmpeg'].filter((value): value is string => Boolean(value)))];
}

export type AudioFfmpegResult = MediaProcessResult;

/** Run ffmpeg to completion; a missing bundled binary falls back to the system one. */
export async function runAudioFfmpeg(args: string[], options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<AudioFfmpegResult> {
  try {
    return await runMediaProcess(ffmpegCandidates(), args, { timeoutMs: options.timeoutMs ?? AUDIO_FFMPEG_TIMEOUT_MS, signal: options.signal });
  } catch (error) {
    if (!(error instanceof MediaProcessError)) throw error;
    if (error.reason === 'cancelled') throw new AudioServiceError('작업이 취소됐어.', 409);
    if (error.reason === 'timeout') throw new AudioServiceError('오디오 처리 시간이 너무 오래 걸렸어.', 504);
    if (error.reason === 'exit') throw new AudioServiceError(`오디오 처리 실패: ${error.stderr.slice(-800).trim()}`, 422);
    if (!['ENOENT', 'EACCES'].includes(error.originalError?.code ?? '')) throw error.originalError ?? error;
    throw new AudioServiceError(`ffmpeg를 찾을 수 없어: ${error.message}`, 500);
  }
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
