import fs from 'fs'
import { once } from 'events'
import { ZipArchive } from 'archiver'
import { finished, pipeline } from 'stream/promises'

export type ZipEntry = { name: string; data: Buffer } | { name: string; file: string }

/** Write one entry at a time, including lazily produced metadata, without retaining every source in memory. */
export async function writeZip(output: string, entries: Iterable<ZipEntry> | AsyncIterable<ZipEntry>, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const stream = fs.createWriteStream(output)
  const archive = new ZipArchive({ zlib: { level: 6 } })
  archive.on('warning', (error) => archive.destroy(error))
  const completion = pipeline(archive, stream, { signal })
  // A destination error can arrive while an asynchronous entry source is still working.
  void completion.catch(() => undefined)
  try {
    for await (const entry of entries) {
      signal?.throwIfAborted()
      const stats = 'file' in entry ? await fs.promises.stat(entry.file) : undefined
      signal?.throwIfAborted()
      if (archive.destroyed) await completion
      const source = 'file' in entry ? fs.createReadStream(entry.file) : entry.data
      const input = Buffer.isBuffer(source) ? undefined : source
      const inputClosed = input ? finished(input) : undefined
      void inputClosed?.catch(() => undefined)
      input?.once('error', (error) => archive.destroy(error))
      const written = once(archive, 'entry')
      try {
        archive.append(source, { name: entry.name, stats, date: stats?.mtime, mode: stats?.mode })
        await written
      } finally {
        input?.destroy()
        await inputClosed?.catch(() => undefined)
      }
    }
    await Promise.all([completion, archive.finalize()])
  } finally {
    archive.abort()
    archive.destroy()
    stream.destroy()
    await Promise.allSettled([completion, finished(stream)])
  }
}
