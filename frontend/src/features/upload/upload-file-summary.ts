export type UploadFileSizeLike = {
  size: number
}

export function getUploadFileTotalSize(files: readonly UploadFileSizeLike[]) {
  return files.reduce((sum, file) => sum + file.size, 0)
}

function getUploadQueueFileKey(file: Pick<File, 'name' | 'size' | 'lastModified'>) {
  // File names cannot contain '/', so this key is unambiguous.
  return `${file.name}/${file.size}/${file.lastModified}`
}

/** Append files to an upload queue, skipping any already queued (same name, size and modification time). */
export function mergeUploadQueueFiles<T extends Pick<File, 'name' | 'size' | 'lastModified'>>(current: readonly T[], added: readonly T[]) {
  const seen = new Set(current.map(getUploadQueueFileKey))
  const merged = [...current]

  for (const file of added) {
    const key = getUploadQueueFileKey(file)
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(file)
    }
  }

  return merged
}
