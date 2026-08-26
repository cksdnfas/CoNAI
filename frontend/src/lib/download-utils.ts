import type { AppSettings } from '@conai/shared'
import { triggerBlobDownload } from '@/lib/api-client'
import { appQueryClient } from '@/lib/app-query-client'

type ApiErrorPayload = {
  error?: unknown
}

interface DownloadWritableFileStream {
  write(data: Blob): Promise<void>
  close(): Promise<void>
  abort?(): Promise<void>
}

interface DownloadFileHandle {
  createWritable(): Promise<DownloadWritableFileStream>
}

interface DownloadFilePickerWindow extends Window {
  showSaveFilePicker?: (options: { suggestedName: string }) => Promise<DownloadFileHandle>
}

export interface PreparedDownloadTarget {
  fileHandle: DownloadFileHandle | null
}

function getSafeSuggestedDownloadName(filename: string) {
  return filename.replace(/\\/g, '/').split('/').at(-1)?.trim() || 'download'
}

function isDownloadPickerCancelled(error: unknown) {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
}

/** Open the native save dialog before asynchronous download work consumes user activation. */
export async function prepareDownloadTarget(suggestedFileName: string): Promise<PreparedDownloadTarget | null> {
  const settings = appQueryClient.getQueryData<AppSettings>(['app-settings'])
  if (!settings?.general.promptForDownloadLocation) {
    return { fileHandle: null }
  }

  const showSaveFilePicker = (window as DownloadFilePickerWindow).showSaveFilePicker
  if (!showSaveFilePicker) {
    throw new Error(settings.general.language === 'en'
      ? 'This browser cannot choose a save location. Use Chrome or Edge, or turn off this option.'
      : '현재 브라우저는 저장 위치 선택을 지원하지 않습니다. Chrome 또는 Edge를 사용하거나 해당 옵션을 꺼주세요.')
  }

  try {
    const fileHandle = await showSaveFilePicker.call(window, {
      suggestedName: getSafeSuggestedDownloadName(suggestedFileName),
    })
    return { fileHandle }
  } catch (error) {
    if (isDownloadPickerCancelled(error)) {
      return null
    }
    throw error
  }
}

/** Write a blob to the selected file, or keep the existing browser-download behavior. */
export async function saveDownloadBlob(target: PreparedDownloadTarget, blob: Blob, filename: string) {
  if (!target.fileHandle) {
    triggerBlobDownload(blob, filename)
    return
  }

  const writable = await target.fileHandle.createWritable()
  try {
    await writable.write(blob)
    await writable.close()
  } catch (error) {
    await writable.abort?.().catch(() => undefined)
    throw error
  }
}

/** Extract a suggested filename from Content-Disposition when available. */
export function getDownloadFileName(contentDisposition: string | null, fallbackFileName: string) {
  if (!contentDisposition) {
    return fallbackFileName
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1])
  }

  const basicMatch = contentDisposition.match(/filename="?([^";]+)"?/i)
  if (basicMatch?.[1]) {
    return basicMatch[1]
  }

  return fallbackFileName
}

/** Build a usable filename when a single media response omits Content-Disposition. */
export function getSingleImageDownloadFallbackName(identifier: string, type: 'thumbnail' | 'original', contentType: string | null) {
  const normalizedContentType = contentType?.toLowerCase() ?? ''

  if (type === 'thumbnail') {
    return `${identifier}-thumbnail.webp`
  }

  if (normalizedContentType.includes('image/png')) {
    return `${identifier}.png`
  }
  if (normalizedContentType.includes('image/jpeg')) {
    return `${identifier}.jpg`
  }
  if (normalizedContentType.includes('image/webp')) {
    return `${identifier}.webp`
  }
  if (normalizedContentType.includes('image/gif')) {
    return `${identifier}.gif`
  }
  if (normalizedContentType.includes('video/mp4')) {
    return `${identifier}.mp4`
  }
  if (normalizedContentType.includes('video/webm')) {
    return `${identifier}.webm`
  }
  if (normalizedContentType.includes('video/quicktime')) {
    return `${identifier}.mov`
  }

  return `${identifier}.bin`
}

/** Read a useful message from failed blob download responses. */
export async function readDownloadError(response: Response, fallbackMessage?: string) {
  const contentType = response.headers.get('Content-Type') || ''

  if (contentType.includes('application/json')) {
    try {
      const payload = (await response.json()) as ApiErrorPayload
      return typeof payload.error === 'string' && payload.error.length > 0
        ? payload.error
        : fallbackMessage || `Request failed: ${response.status}`
    } catch {
      return fallbackMessage || `Request failed: ${response.status}`
    }
  }

  const text = await response.text().catch(() => '')
  return text || fallbackMessage || `Request failed: ${response.status}`
}

/** Read a blob response while preserving backend error text when the request fails. */
export async function readDownloadBlob(response: Response, fallbackMessage?: string) {
  if (!response.ok) {
    const message = await readDownloadError(response, fallbackMessage)
    throw new Error(message || fallbackMessage || `Request failed: ${response.status}`)
  }

  return response.blob()
}
