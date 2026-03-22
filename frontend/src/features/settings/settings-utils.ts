export function parseJsonArray(raw: string | null) {
  if (!raw) return [] as string[]

  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
  } catch {
    return []
  }
}

export function toCommaSeparatedInput(values: string[]) {
  return values.join(', ')
}

export function parseCommaSeparatedInput(raw: string) {
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

export function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ko-KR')
}

export function formatFileSize(value?: number | null) {
  if (value == null || Number.isNaN(value)) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

export interface NewWatchedFolderDraft {
  folder_path: string
  folder_name: string
  auto_scan: boolean
  scan_interval: number
  recursive: boolean
  watcher_enabled: boolean
  watcher_polling_interval: number
  exclude_extensions: string
  exclude_patterns: string
}

export function createNewWatchedFolderDraft(): NewWatchedFolderDraft {
  return {
    folder_path: '',
    folder_name: '',
    auto_scan: true,
    scan_interval: 5,
    recursive: true,
    watcher_enabled: true,
    watcher_polling_interval: 2000,
    exclude_extensions: '',
    exclude_patterns: '',
  }
}
