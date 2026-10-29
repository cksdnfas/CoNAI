import { ComfyInputValidationError } from '../prepareComfyPromptData'

const API_FILE_PATH_KEYS = new Set([
  'storagePath', 'storage_path', 'outputPath', 'output_path',
  'originalFilePath', 'original_file_path', 'imagePath', 'image_path', 'filePath', 'file_path',
])

/** Reject the path-bearing shapes the API node previously treated as server files. */
export function assertNoApiFilePaths(value: unknown, portKey?: string) {
  const reject = () => { throw new ComfyInputValidationError('서버 파일 경로는 워크플로 입력으로 사용할 수 없어. 이미지 해시나 업로드를 사용해줘.') }
  const isPathString = (entry: unknown) => typeof entry === 'string' && Boolean(entry.trim()) && !/^data:/i.test(entry.trim())
  if (portKey?.startsWith('values.') && API_FILE_PATH_KEYS.has(portKey.slice('values.'.length))
    && isPathString(value)) reject()
  const pending = [value]
  const seen = new WeakSet<object>()
  while (pending.length) {
    const current = pending.pop()
    if (typeof current === 'string') {
      const text = current.trim()
      if (text.startsWith('{') || text.startsWith('[')) {
        try { pending.push(JSON.parse(text)) } catch { /* A non-JSON string is data, not a file reference. */ }
      }
      continue
    }
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)
    if (Array.isArray(current)) {
      for (const entry of current) pending.push(entry)
      continue
    }
    const record = current as Record<string, unknown>
    if (typeof record.key === 'string' && API_FILE_PATH_KEYS.has(record.key.trim())
      && isPathString(record.value)) reject()
    for (const [key, entry] of Object.entries(record)) {
      if (API_FILE_PATH_KEYS.has(key) && isPathString(entry)) reject()
      pending.push(entry)
    }
  }
}
