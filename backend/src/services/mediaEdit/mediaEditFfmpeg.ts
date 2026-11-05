import fs from 'fs'
import path from 'path'
import { ffmpegBinary, probeVideo, runTool } from '../sprite/spriteFfmpeg'

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
