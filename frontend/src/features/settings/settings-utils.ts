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

/** Normalize a backup target path so it stays relative to the Upload root. */
export function normalizeBackupTargetPath(raw: string) {
  return raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^uploads?(?:\/+|$)/i, '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/')
}

/** Build a human-readable Upload-root preview for one backup target path input. */
export function buildBackupTargetPreviewPath(raw: string) {
  const normalized = normalizeBackupTargetPath(raw)
  return normalized ? `Upload/${normalized}` : 'Upload'
}

export function normalizeUtcLikeTimestamp(value?: string | null) {
  if (!value) return value ?? null
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value
}

export function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(normalizeUtcLikeTimestamp(value) ?? value)
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

export interface NewBackupSourceDraft {
  source_path: string
  display_name: string
  target_folder_name: string
  recursive: boolean
  watcher_enabled: boolean
  watcher_polling_interval: number
  import_mode: 'copy_original' | 'convert_webp'
  webp_quality: number
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

export function createNewBackupSourceDraft(): NewBackupSourceDraft {
  return {
    source_path: '',
    display_name: '',
    target_folder_name: '',
    recursive: true,
    watcher_enabled: true,
    watcher_polling_interval: 2000,
    import_mode: 'copy_original',
    webp_quality: 90,
  }
}
