export { buildApiUrl } from '@/lib/api-url'

export function triggerBrowserDownload(url: string, filename?: string) {
  const anchor = document.createElement('a')
  anchor.href = url
  if (filename) {
    anchor.download = filename
  }
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

export function triggerBlobDownload(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob)
  try {
    triggerBrowserDownload(objectUrl, filename)
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
  }
}
