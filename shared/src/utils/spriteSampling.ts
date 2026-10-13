/** Frame selection shared by the sprite page and the server. Limits apply before deduplication. */
export const MAX_SPRITE_FRAMES = 256;

export interface SpriteSamplingVideo {
  fps: number;
  frameCount: number;
  lastFrameTime: number;
}

export function sampleBounds(info: SpriteSamplingVideo, startTime: number, endTime: number): [number, number] {
  const lastIndex = Math.max(0, info.frameCount - 1);
  const startIndex = Math.min(lastIndex, Math.max(0, Math.floor(startTime * info.fps + 0.5)));
  const endIndex = Math.min(lastIndex, Math.max(startIndex, Math.floor(endTime * info.fps + 0.5)));
  return [startIndex, endIndex];
}

export function countModeIndices(info: SpriteSamplingVideo, startTime: number, endTime: number, count: number): number[] {
  const [startIndex, endIndex] = sampleBounds(info, startTime, endTime);
  const span = endIndex - startIndex;
  return Array.from({ length: count }, (_, index) => Math.floor(startIndex + span * index / (count - 1) + 0.5));
}

export function intervalFrameCount(startTime: number, endTime: number, interval: number): number {
  return Math.floor((endTime - startTime + 1e-9) / interval) + 1;
}

export function intervalModeIndices(info: SpriteSamplingVideo, startTime: number, endTime: number, interval: number): number[] {
  const count = intervalFrameCount(startTime, endTime, interval);
  const lastIndex = Math.max(0, info.frameCount - 1);
  const indices: number[] = [];
  for (let k = 0; k < count; k += 1) {
    const index = Math.min(lastIndex, Math.max(0, Math.floor((startTime + k * interval) * info.fps + 0.5)));
    if (indices[indices.length - 1] !== index) indices.push(index);
  }
  return indices;
}

export type SpriteSamplingProblem = 'range' | 'past_end' | 'count_range' | 'empty_count_range' | 'unavailable_count' | 'interval' | 'frame_limit';

export function planSpriteSampling(info: SpriteSamplingVideo, start: number, end: number, count: number, interval: number) {
  let problem: SpriteSamplingProblem | null = null;
  const [first, last] = sampleBounds(info, start, end);
  const available = last - first + 1;
  const requested = count || intervalFrameCount(start, end, interval);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) problem = 'range';
  else if (end > info.lastFrameTime + Math.max(0.001, 0.5 / info.fps)) problem = 'past_end';
  else if (count) {
    if (count < 2 || count > MAX_SPRITE_FRAMES) problem = 'count_range';
    else if (end <= start) problem = 'empty_count_range';
    else if (count > available) problem = 'unavailable_count';
  } else if (!Number.isFinite(interval) || interval <= 0) problem = 'interval';
  else if (requested < 1 || requested > MAX_SPRITE_FRAMES) problem = 'frame_limit';
  const indices = problem ? [] : count
    ? countModeIndices(info, start, end, count)
    : intervalModeIndices(info, start, end, interval);
  return { indices, requested, available, problem };
}
