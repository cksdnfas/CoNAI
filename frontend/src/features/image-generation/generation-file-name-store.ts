import { useCallback, useSyncExternalStore } from 'react'

/**
 * The stored-file name typed on the generation screen (NAI, ComfyUI, Codex share it). Kept in this browser until it
 * is cleared, like the result group; every control on the page shows the same value at once.
 * The server cleans the name and keeps it unique in the folder (settings › 파일 이름 › 이름이 겹칠 때).
 */

const STORAGE_KEY = 'conai:image-generation:file-name:v1'
const listeners = new Set<() => void>()
let memoryFallback = ''

function readValue() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? ''
  } catch {
    return memoryFallback
  }
}

function writeValue(value: string) {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, value)
    else window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    memoryFallback = value
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener()
  }
  window.addEventListener('storage', handleStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', handleStorage)
  }
}

export function useGenerationFileName() {
  const fileName = useSyncExternalStore(subscribe, readValue, () => '')
  const setFileName = useCallback((value: string) => writeValue(value), [])
  return {
    fileName,
    setFileName,
    /** What a generation request carries: undefined when nothing is typed. */
    requestFileName: fileName.trim() ? fileName.trim() : undefined,
  }
}
