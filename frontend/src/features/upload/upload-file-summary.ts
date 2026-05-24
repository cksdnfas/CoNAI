export type UploadFileSizeLike = {
  size: number
}

export function getUploadFileTotalSize(files: readonly UploadFileSizeLike[]) {
  return files.reduce((sum, file) => sum + file.size, 0)
}
