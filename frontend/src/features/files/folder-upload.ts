import { createSessionStore } from './session-store'

/** One file to upload with its path below the target folder (`a/b/name.ext`; just the name for a plain file). */
export type UploadEntry = { file: File; path: string }

/**
 * The folder upload in progress: files sent so far, files in all (null while the dropped folders are still being
 * read) and whether Stop was pressed. Kept outside the browser, which the files page remounts per folder: the progress
 * and Stop stay usable there and a second upload cannot start meanwhile.
 */
export type TreeUploadProgress = { done: number; total: number | null; stopping: boolean }
const treeUpload = createSessionStore<TreeUploadProgress | null>(null)
export const useTreeUploadProgress = treeUpload.useValue
export const treeUploadRunning = () => treeUpload.get() !== null
export const treeUploadStopping = () => treeUpload.get()?.stopping === true
export const startTreeUpload = () => treeUpload.set({ done: 0, total: null, stopping: false })
export const advanceTreeUpload = (done: number, total: number) => {
  const current = treeUpload.get()
  if (current) treeUpload.set({ ...current, done, total })
}
export const stopTreeUpload = () => {
  const current = treeUpload.get()
  if (current) treeUpload.set({ ...current, stopping: true })
}
export const finishTreeUpload = () => treeUpload.set(null)

/** A directory reader hands out its entries in chunks (Chromium: 100); read until it is empty. */
async function readAllEntries(reader: FileSystemDirectoryReader) {
  const entries: FileSystemEntry[] = []
  for (;;) {
    const chunk = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    if (chunk.length === 0) return entries
    entries.push(...chunk)
  }
}

async function walkEntry(entry: FileSystemEntry, prefix: string, out: UploadEntry[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    out.push({ file, path: `${prefix}${entry.name}` })
  } else if (entry.isDirectory) {
    for (const child of await readAllEntries((entry as FileSystemDirectoryEntry).createReader())) {
      await walkEntry(child, `${prefix}${entry.name}/`, out)
    }
  }
}

/**
 * Everything a drop carries, folders walked into (empty folders add nothing). The drag data is only readable while the
 * drop event runs, so the entries are taken first and walked after.
 */
export async function collectDroppedEntries(transfer: DataTransfer): Promise<UploadEntry[]> {
  const roots = Array.from(transfer.items).filter((item) => item.kind === 'file').map((item) => ({ entry: item.webkitGetAsEntry(), file: item.getAsFile() }))
  const out: UploadEntry[] = []
  for (const { entry, file } of roots) {
    if (entry) await walkEntry(entry, '', out)
    else if (file) out.push({ file, path: file.name })
  }
  return out
}

/** The files of a folder picked with `<input webkitdirectory>`: `webkitRelativePath` starts with the folder's name. */
export function entriesFromPickedFolder(files: File[]): UploadEntry[] {
  return files.map((file) => ({ file, path: file.webkitRelativePath || file.name }))
}

/** Batches within one request's limits: at most `maxFiles` files and `maxBytes` bytes. */
export function uploadBatches(entries: UploadEntry[], maxFiles: number, maxBytes: number) {
  const batches: UploadEntry[][] = []
  let bytes = 0
  for (const entry of entries) {
    const last = batches.at(-1)
    if (last && last.length < maxFiles && bytes + entry.file.size <= maxBytes) {
      last.push(entry)
      bytes += entry.file.size
    } else {
      batches.push([entry])
      bytes = entry.file.size
    }
  }
  return batches
}
