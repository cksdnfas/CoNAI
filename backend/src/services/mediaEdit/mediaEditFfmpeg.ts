import fs from 'fs'
import path from 'path'
import { ffmpegBinary, ffprobeBinary, probeVideo, runTool } from '../sprite/spriteFfmpeg'

export type FrameSelection = ({ seconds: number } | { frameIndex: number } | { last: true }) & { position?: 'first' | 'middle' | 'last' }
export type ClipFormat = 'mp4' | 'webm' | 'gif' | 'webp' | 'mov' | 'mkv' | 'avi'

export const CLIP_MIME: Record<ClipFormat, string> = {
  mp4: 'video/mp4', webm: 'video/webm', gif: 'image/gif', webp: 'image/webp',
  mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
}

export function sourceClipFormat(filePath: string, mimeType: string): ClipFormat {
  const extension = path.extname(filePath).slice(1).toLowerCase()
  if (extension in CLIP_MIME) return extension as ClipFormat
  const format = (Object.keys(CLIP_MIME) as ClipFormat[]).find((key) => CLIP_MIME[key] === mimeType)
  if (!format) throw new Error('Unknown source container; specify format mp4, webm, gif or webp.')
  return format
}

/** Seek before decoding; copy timestamps so returned seconds stay on the source timeline, including VFR video. */
export async function captureVideoFrame(source: string, selection: FrameSelection, output: string, signal?: AbortSignal): Promise<number> {
  const last = 'last' in selection
  const duration = last ? (await probeVideo(source, signal)).duration : 0
  const seek = last ? duration > 1 ? ['-sseof', '-1'] : ['-ss', '0']
    : 'seconds' in selection ? ['-ss', String(selection.seconds)] : []
  const select = 'frameIndex' in selection ? [`select=eq(n\\,${selection.frameIndex})`] : []
  const { stderr } = await runTool(ffmpegBinary(), [
    '-hide_banner', '-nostats', '-loglevel', 'info', '-y', '-copyts', '-start_at_zero',
    ...seek, '-i', source, '-map', '0:v:0', '-an',
    '-vf', [...select, 'showinfo'].join(','),
    ...(last ? ['-update', '1'] : ['-frames:v', '1']),
    '-fps_mode', 'passthrough', '-c:v', 'png', output,
  ], { timeoutMs: 600_000, signal, captureStdout: false })
  const times = [...stderr.matchAll(/\bn:\s*\d+.*?\bpts_time:([-\d.e+]+)/g)].map((match) => Number(match[1]))
  const seconds = last ? times[times.length - 1] : times[0]
  if (!Number.isFinite(seconds) || !(await fs.promises.stat(output)).size) throw new Error('No decodable frame at this position; choose an earlier time or frame index.')
  return seconds
}

export async function encodeVideoClip(input: {
  source: string
  output: string
  start: number
  end: number
  format: ClipFormat
  copy: boolean
  fps?: number
  width?: number
  signal?: AbortSignal
}): Promise<void> {
  const filters: string[] = []
  if (input.fps !== undefined) filters.push(`fps=${input.fps}`)
  if (input.width !== undefined) filters.push(`scale=${input.width}:-1`)
  const animated = input.format === 'gif' || input.format === 'webp'
  const codecs: string[] = input.copy ? ['-c', 'copy'] : animated
    ? input.format === 'webp' ? ['-c:v', 'libwebp_anim', '-loop', '0'] : ['-loop', '0']
    : input.format === 'webm' ? ['-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-c:a', 'libopus']
      : input.format === 'avi' ? ['-c:v', 'mpeg4', '-c:a', 'libmp3lame']
        : ['-c:v', 'libx264', '-crf', '18', '-c:a', 'aac']
  if (!input.copy && !animated) filters.push('pad=ceil(iw/2)*2:ceil(ih/2)*2', 'format=yuv420p')
  const gifFilter = `[0:v:0]${[...filters, 'split[frames][palette_input]'].join(',')};[palette_input]palettegen=stats_mode=diff[palette];[frames][palette]paletteuse=dither=sierra2_4a[v]`
  await runTool(ffmpegBinary(), [
    '-hide_banner', '-loglevel', 'error', '-y', '-ss', String(input.start), '-t', String(input.end - input.start), '-i', input.source,
    ...(input.format === 'gif' ? ['-filter_complex', gifFilter, '-map', '[v]'] : ['-map', '0:v:0']),
    ...(animated ? ['-an'] : ['-map', '0:a?']),
    ...(filters.length && input.format !== 'gif' ? ['-vf', filters.join(',')] : []),
    ...codecs, ...(input.copy ? ['-avoid_negative_ts', 'make_zero'] : []),
    ...(['mp4', 'mov'].includes(input.format) ? ['-movflags', '+faststart'] : []),
    input.output,
  ], { timeoutMs: 600_000, signal: input.signal, captureStdout: false })
  if (!(await fs.promises.stat(input.output)).size) throw new Error('The clip is empty; check the selected range.')
}

export interface JoinStreams {
  hasAudio: boolean
  frameRate: [number, number]
  /** Equal keys mean the concat demuxer can stream-copy the files: same streams, codec parameters and extradata. */
  streamKey: string
}

function rational(value: unknown): [number, number] | null {
  const [numerator, denominator = 1] = String(value ?? '').split('/').map(Number)
  return Number.isInteger(numerator) && Number.isInteger(denominator) && numerator > 0 && denominator > 0 ? [numerator, denominator] : null
}

export async function probeJoinStreams(source: string, signal?: AbortSignal): Promise<JoinStreams> {
  const { stdout } = await runTool(ffprobeBinary(), ['-v', 'error', '-show_streams', '-show_data_hash', 'SHA256', '-of', 'json', source], { timeoutMs: 45_000, signal })
  const streams = ((JSON.parse(stdout.toString('utf8')) as { streams?: Array<Record<string, any>> }).streams ?? []).filter((stream) => !stream.disposition?.attached_pic)
  const video = streams.find((stream) => stream.codec_type === 'video')
  const frameRate = video && (rational(video.avg_frame_rate) ?? rational(video.r_frame_rate))
  if (!frameRate) throw new Error('No readable video stream with a known frame rate.')
  return {
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
    frameRate,
    streamKey: JSON.stringify(streams.map((stream) => [
      stream.codec_type, stream.codec_name, stream.codec_tag_string, stream.profile, stream.width, stream.height, stream.pix_fmt,
      stream.sample_aspect_ratio, stream.field_order, stream.r_frame_rate, stream.time_base, stream.extradata_hash, stream.tags?.rotate, stream.side_data_list,
    ])),
  }
}

/**
 * Normalize one clip to a joinable segment: exactly `frames` frames at the target size/rate (letterboxed, last frame held
 * when short) and, when `audio` is set, PCM audio of exactly the same length (source audio padded/trimmed, or silence).
 * Uniform x264 parameters make the segments concat-copyable; PCM has no encoder priming, so segment boundaries stay in sync.
 */
export async function encodeJoinSegment(input: {
  source: string
  output: string
  width: number
  height: number
  frameRate: [number, number]
  frames: number
  audio: 'source' | 'silence' | null
  signal?: AbortSignal
}): Promise<void> {
  const [numerator, denominator] = input.frameRate
  const samples = Math.round(input.frames * 48_000 * denominator / numerator)
  const { width, height } = input
  const graph = [`[0:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,`
    + `fps=${numerator}/${denominator}:start_time=0,tpad=stop=-1:stop_mode=clone,trim=end_frame=${input.frames},format=yuv420p[v]`]
  if (input.audio === 'source') graph.push(`[0:a:0]aresample=48000:async=1:first_pts=0,aformat=sample_fmts=s16:channel_layouts=stereo,apad=whole_len=${samples},atrim=end_sample=${samples}[a]`)
  else if (input.audio === 'silence') graph.push(`anullsrc=r=48000:cl=stereo,aformat=sample_fmts=s16,atrim=end_sample=${samples}[a]`)
  await runTool(ffmpegBinary(), [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', input.source, '-filter_complex', graph.join(';'),
    '-map', '[v]', ...(input.audio ? ['-map', '[a]', '-c:a', 'pcm_s16le'] : []), '-c:v', 'libx264', '-crf', '18', input.output,
  ], { timeoutMs: 600_000, signal: input.signal, captureStdout: false })
}

/** Concat-demux files in order with stream-copied video; audio, when present, is re-encoded once as AAC with gaps filled. */
export async function concatVideoFiles(input: {
  files: Array<{ file: string; duration?: number }>
  listFile: string
  output: string
  format: ClipFormat
  audio: boolean
  signal?: AbortSignal
}): Promise<void> {
  const quote = (file: string) => `'${path.resolve(file).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`
  const list = input.files.map((item) => `file ${quote(item.file)}\n${item.duration === undefined ? '' : `duration ${item.duration.toFixed(6)}\n`}`)
  await fs.promises.writeFile(input.listFile, list.join(''), 'utf8')
  await runTool(ffmpegBinary(), [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', input.listFile, '-map', '0:v:0',
    ...(input.audio ? ['-map', '0:a:0', '-af', 'aresample=async=1', '-c:a', 'aac'] : []), '-c:v', 'copy',
    ...(['mp4', 'mov'].includes(input.format) ? ['-movflags', '+faststart'] : []),
    input.output,
  ], { timeoutMs: 600_000, signal: input.signal, captureStdout: false })
  if (!(await fs.promises.stat(input.output)).size) throw new Error('The joined video is empty.')
}
