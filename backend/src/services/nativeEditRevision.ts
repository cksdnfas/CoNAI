import { createHash } from 'crypto'
import type { Request, Response } from 'express'

/** Hash the complete native record, including children/items and private settings, without disclosing it. */
export function nativeEditRevision(record: unknown) {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable)
    if (!value || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'children' && key !== 'assistant_revision').sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => {
      if (['marked_fields', 'public_queue_role_limits', 'synonyms'].includes(key) && typeof item === 'string') { try { item = JSON.parse(item) } catch { /* retain malformed legacy data */ } }
      return [key, stable(item)]
    }))
  }
  return createHash('sha256').update(JSON.stringify(stable(record))).digest('hex')
}
export function withNativeEditRevisions<T extends object>(records: T[]): Array<T & { assistant_revision: string }> {
  return records.map((item) => {
    const children = (item as { children?: T[] }).children
    return { ...item, assistant_revision: nativeEditRevision(item), ...(children ? { children: withNativeEditRevisions(children) } : {}) }
  })
}
/** Optional optimistic concurrency for reviewed writes. Check immediately before the synchronous native mutation. */
export function requireNativeEditRevision(req: Request, res: Response, record: unknown): boolean {
  const expected = req.get('If-Match')
  if (expected && expected !== nativeEditRevision(record)) { res.status(409).json({ success: false, error: '다른 작업에서 저장한 내용이 바뀌었어. 새로 읽고 다시 제안받아줘.' }); return false }
  return true
}
