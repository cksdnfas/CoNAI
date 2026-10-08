import { spawn } from 'child_process'
import fs from 'fs'
import ffmpegStaticPath from 'ffmpeg-static'
import { SpriteError } from './spriteErrors'
import type { SpriteResizeMode, SpriteVideoInfo } from './spriteOptions'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffprobeStatic = require('ffprobe-static') as { path?: string }

/** Same binaries as VideoProcessor: the bundled static builds first, the system ones as a fallback. */
export function ffmpegBinary(): string {
  return (ffmpegStaticPath as unknown as string | null) || 'ffmpeg'
}

export function ffprobeBinary(): string {
  return ffprobeStatic.path || 'ffprobe'
}

export interface ProcessRunResult {
  stdout: Buffer
  stderr: string
}

/** Run a media tool to completion. Errors carry the last stderr line, like the original `_run`. */
export function runTool(command: string, args: string[], options: { timeoutMs: number; signal?: AbortSignal; captureStdout?: boolean }): Promise<ProcessRunResult> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new SpriteError('작업이 취소되었습니다.'))
      return
    }
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false
    const finish = (error: Error | null, result?: ProcessRunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(result!)
    }
    const onAbort = () => {
      child.kill('SIGKILL')
      finish(new SpriteError('작업이 취소되었습니다.'))
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new SpriteError(`${commandLabel(command)} 처리 시간이 제한을 초과했습니다.`))
    }, options.timeoutMs)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => { if (options.captureStdout !== false) stdout.push(chunk) })
    child.stderr.on('data', (chunk: Buffer) => { stderr.push(chunk) })
    child.on('error', (error) => {
      finish(new SpriteError(`필수 미디어 도구를 찾을 수 없습니다: ${commandLabel(command)} (${error.message})`))
    })
    child.on('close', (code) => {
      const stderrText = Buffer.concat(stderr).toString('utf8')
      if (code !== 0) {
        const lines = stderrText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
        finish(new SpriteError(`${commandLabel(command)} 처리 실패: ${lines[lines.length - 1] ?? `종료 코드 ${code}`}`))
        return
      }
      finish(null, { stdout: Buffer.concat(stdout), stderr: stderrText })
    })
  })
}

function commandLabel(command: string): string {
  return /ffprobe/i.test(command) ? 'ffprobe' : /ffmpeg/i.test(command) ? 'ffmpeg' : command
}

function parseRate(value: unknown): number {
  if (typeof value !== 'string' || !value || value === '0/0') return 0
  const [numerator, denominator] = value.split('/')
  const rate = denominator === undefined ? Number(numerator) : Number(numerator) / Number(denominator)
  return Number.isFinite(rate) && rate > 0 ? rate : 0
}

function parsePositive(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

function rotation(stream: Record<string, unknown>): number {
  const tags = stream.tags as Record<string, unknown> | undefined
  if (tags && tags.rotate !== undefined) {
    const value = Number.parseInt(String(tags.rotate), 10)
    if (Number.isFinite(value)) return ((value % 360) + 360) % 360
  }
  const sideData = stream.side_data_list
  if (Array.isArray(sideData)) {
    for (const item of sideData) {
      if (item && typeof item === 'object' && 'rotation' in item) {
        const value = Number.parseInt(String((item as { rotation: unknown }).rotation), 10)
        if (Number.isFinite(value)) return ((value % 360) + 360) % 360
      }
    }
  }
  return 0
}

const round6 = (value: number) => Number(value.toFixed(6))

/** Port of `probe_video`: rotation swaps width/height, avg then r_frame_rate, nb_frames then duration*fps. */
export async function probeVideo(filePath: string, signal?: AbortSignal): Promise<SpriteVideoInfo> {
  const { stdout } = await runTool(ffprobeBinary(), ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-show_format', '-of', 'json', filePath], { timeoutMs: 45_000, signal })
  let stream: Record<string, unknown>
  let format: Record<string, unknown> = {}
  try {
    const payload = JSON.parse(stdout.toString('utf8')) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> }
    stream = payload.streams?.[0] as Record<string, unknown>
    if (!stream) throw new Error('no stream')
    format = payload.format && typeof payload.format === 'object' ? payload.format : {}
  } catch {
    throw new SpriteError('읽을 수 있는 영상 스트림이 없습니다.')
  }
  let width = Number(stream.width) || 0
  let height = Number(stream.height) || 0
  if (width <= 0 || height <= 0) throw new SpriteError('영상 해상도를 확인할 수 없습니다.')
  if ([90, 270].includes(rotation(stream))) [width, height] = [height, width]
  const fps = parseRate(stream.avg_frame_rate) || parseRate(stream.r_frame_rate)
  if (fps <= 0) throw new SpriteError('영상 프레임 속도를 확인할 수 없습니다.')
  const duration = parsePositive(stream.duration) || parsePositive(format.duration)
  if (duration <= 0) throw new SpriteError('영상 재생 시간을 확인할 수 없습니다.')
  let frameCount = Number.parseInt(String(stream.nb_frames ?? 0), 10) || 0
  if (frameCount <= 0) frameCount = Math.max(1, Math.round(duration * fps))
  const lastFrameTime = Math.max(0, Math.min(duration, (frameCount - 1) / fps))
  return {
    duration: round6(duration),
    width,
    height,
    fps: round6(fps),
    frameCount,
    lastFrameTime: round6(lastFrameTime),
    formatName: String(format.format_name || 'unknown'),
  }
}

/** Resize filters as the original ordered them, minus contain's pad (added after keying, see padToSize / D2). */
export function resizeFilters(mode: SpriteResizeMode, width: number, height: number): string[] {
  if (mode === 'contain') return [`scale=${width}:${height}:force_original_aspect_ratio=decrease`]
  if (mode === 'cover') return [`scale=${width}:${height}:force_original_aspect_ratio=increase`, `crop=${width}:${height}`]
  if (mode === 'stretch') return [`scale=${width}:${height}`]
  return []
}

/** Read the WxH of the first rawvideo output stream from ffmpeg's `-loglevel info` banner. */
export function parseRawOutputSize(stderr: string): { width: number; height: number } | null {
  const output = stderr.indexOf('Output #0')
  if (output < 0) return null
  const line = stderr.slice(output).split(/\r?\n/).find((entry) => /Stream #0:0.*Video:/.test(entry))
  const match = line?.match(/, (\d+)x(\d+)(?=[\s,[]|$)/)
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null
}

export interface RawFramesFile {
  file: string
  width: number
  height: number
  count: number
}

function rawFramesResult(file: string, stderr: string): RawFramesFile {
  const size = parseRawOutputSize(stderr)
  if (!size) throw new SpriteError('추출한 프레임 크기를 확인하지 못했습니다.')
  const bytes = fs.existsSync(file) ? fs.statSync(file).size : 0
  const frameBytes = size.width * size.height * 4
  if (bytes === 0 || bytes % frameBytes !== 0) throw new SpriteError('선택한 구간에서 프레임을 추출하지 못했습니다.')
  return { file, ...size, count: bytes / frameBytes }
}

/**
 * Decode the selected source frames to one raw RGBA file. Frames are chosen by decode-order index in both sampling
 * modes (select=eq(n,…), as the original count mode did); pre-crop and the given scale filters run in ffmpeg exactly
 * where the original ran them.
 */
export async function extractRawFrames(input: {
  source: string
  frameIndices: number[]
  crop: { x: number; y: number; width: number; height: number } | null
  scale: string[]
  output: string
  signal?: AbortSignal
}): Promise<RawFramesFile> {
  const selection = input.frameIndices.map((index) => `eq(n\\,${index})`).join('+')
  const filters = [`select=${selection}`, 'setpts=N/TB']
  if (input.crop) filters.push(`crop=${input.crop.width}:${input.crop.height}:${input.crop.x}:${input.crop.y}`)
  filters.push(...input.scale, 'format=rgba')
  const { stderr } = await runTool(ffmpegBinary(), [
    '-hide_banner', '-nostats', '-loglevel', 'info', '-y',
    '-i', input.source, '-an', '-vf', filters.join(','),
    '-frames:v', String(input.frameIndices.length), '-fps_mode', 'passthrough',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', input.output,
  ], { timeoutMs: 600_000, signal: input.signal, captureStdout: false })
  return rawFramesResult(input.output, stderr)
}

/** Scale already-keyed RGBA frames (the original keyed before scaling in colorkey mode). */
export async function scaleRawFrames(input: { file: string; width: number; height: number; scale: string[]; output: string; signal?: AbortSignal }): Promise<RawFramesFile> {
  const { stderr } = await runTool(ffmpegBinary(), [
    '-hide_banner', '-nostats', '-loglevel', 'info', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${input.width}x${input.height}`, '-framerate', '1', '-i', input.file,
    '-vf', [...input.scale, 'format=rgba'].join(','),
    '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgba', input.output,
  ], { timeoutMs: 600_000, signal: input.signal, captureStdout: false })
  return rawFramesResult(input.output, stderr)
}

/** `build_sprite_animation` MP4 branch: frames over a solid colour, padded to even size, H.264 yuv420p CRF 18. */
export async function encodeAnimationMp4(input: { framesFile: string; width: number; height: number; frameCount: number; fps: number; background: string; output: string; signal?: AbortSignal }): Promise<void> {
  const color = `0x${input.background.replace(/^#/, '').toLowerCase()}`
  const fps = input.fps.toFixed(6)
  const filterComplex = `color=c=${color}:s=${input.width}x${input.height}:r=${fps}[bg];[bg][0:v]overlay=shortest=1:format=auto,pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p[v]`
  await runTool(ffmpegBinary(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${input.width}x${input.height}`, '-framerate', fps, '-i', input.framesFile,
    '-filter_complex', filterComplex, '-map', '[v]', '-frames:v', String(input.frameCount), '-an',
    '-c:v', 'libx264', '-crf', '18', '-movflags', '+faststart', input.output,
  ], { timeoutMs: 300_000, signal: input.signal, captureStdout: false })
}
