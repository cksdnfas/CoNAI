import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import sharp from 'sharp'
import type { StoredFileEntry } from '@conai/shared'
import { FileStoreError, FileStoreService, TEXT_EXTENSIONS } from './fileStoreService'
import { fileStoreThumbnailPath } from './fileStorePaths'
import { VideoFrameExtractor } from './videoFrameExtractor'

/** Never use the uploader's MIME for an inline response. Active document extensions are always inert. */
export async function filePreviewMime(entry: StoredFileEntry, filePath: string): Promise<string | null> {
  const ext = path.extname(entry.name).toLowerCase()
  if (TEXT_EXTENSIONS.has(ext)) return 'text/plain; charset=utf-8'
  const handle = await fs.promises.open(filePath, 'r')
  const header = Buffer.alloc(512)
  let size: number
  try { size = (await handle.read(header, 0, header.length, 0)).bytesRead } finally { await handle.close() }
  const bytes = header.subarray(0, size)
  const ascii = (offset: number, text: string) => bytes.toString('ascii', offset, offset + text.length) === text
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif'
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp'
  if (ascii(0, '%PDF-')) return 'application/pdf'
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav'
  if (ascii(0, 'fLaC')) return 'audio/flac'
  if (ascii(0, 'ID3') || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0)) return 'audio/mpeg'
  if (ascii(0, 'OggS')) return ['.ogv', '.ogg'].includes(ext) && entry.mimeType?.startsWith('video/') ? 'video/ogg' : 'audio/ogg'
  if (bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) && bytes.includes(Buffer.from('webm'))) return ext === '.weba' ? 'audio/webm' : 'video/webm'
  if (ascii(4, 'ftyp')) {
    if (ascii(8, 'avif') || ascii(8, 'avis')) return 'image/avif'
    if (['.mp4', '.m4v', '.mov', '.m4a'].includes(ext)) return ext === '.m4a' ? 'audio/mp4' : 'video/mp4'
  }
  return null
}

const thumbnails = new Map<string, Promise<string>>()
let decoding = 0
const waiting: Array<() => void> = []

async function acquireDecoder() {
  if (decoding >= 2) {
    if (waiting.length >= 200) throw new FileStoreError('잠시 뒤 다시 열어줘.', 503)
    await new Promise<void>((resolve) => waiting.push(resolve))
  } else decoding++
  return () => {
    const next = waiting.shift()
    if (next) next()
    else decoding--
  }
}

/** Deduplicate concurrent requests; publish atomically and recheck ownership/existence after slow decoding. */
export function getFileThumbnail(owner: string, entry: StoredFileEntry, filePath: string): Promise<string> {
  const pending = thumbnails.get(entry.id)
  if (pending) return pending
  const work = (async () => {
    const mime = await filePreviewMime(entry, filePath)
    if (!mime?.startsWith('image/') && !mime?.startsWith('video/')) throw new FileStoreError('No thumbnail', 404)
    const cached = fileStoreThumbnailPath(entry.id)
    const directory = path.dirname(cached)
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new FileStoreError('Invalid thumbnail directory')
    if (fs.existsSync(cached) && fs.lstatSync(cached).isSymbolicLink()) throw new FileStoreError('Invalid thumbnail file')
    if (fs.existsSync(cached) && fs.statSync(cached).mtimeMs >= fs.statSync(filePath).mtimeMs) return cached
    fs.mkdirSync(directory, { recursive: true })
    const temporary = path.join(directory, `${entry.id}-${crypto.randomUUID()}.webp`)
    const release = await acquireDecoder()
    try {
      FileStoreService.resolveFile(owner, entry.id)
      if (mime.startsWith('video/')) await VideoFrameExtractor.extractPreviewFrame(filePath, temporary)
      else await sharp(filePath, { animated: false, limitInputPixels: 50_000_000 }).rotate().resize(320, 320, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(temporary)
      FileStoreService.resolveFile(owner, entry.id)
      fs.renameSync(temporary, cached)
      return cached
    } finally {
      release()
      await fs.promises.rm(temporary, { force: true }).catch(() => undefined)
    }
  })()
  thumbnails.set(entry.id, work)
  void work.finally(() => thumbnails.delete(entry.id)).catch(() => undefined)
  return work
}
