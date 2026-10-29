/** JSON-shaped immutable page/editor state: unchanged branches need no traversal or serialization. */
export function chatDraftEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  // JSON registration keys represented all non-finite numbers as null (and -0 as 0).
  if (typeof left === 'number' && !Number.isFinite(left)) left = null
  if (typeof right === 'number' && !Number.isFinite(right)) right = null
  if (left === right) return true
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    // JSON arrays represent holes/undefined as null; do not skip holes with Array.every.
    for (let index = 0; index < left.length; index++) if (!chatDraftEqual(left[index] ?? null, right[index] ?? null)) return false
    return true
  }
  const a = left as Record<string, unknown>
  const b = right as Record<string, unknown>
  const keys = Object.keys(a).filter((key) => a[key] !== undefined)
  return keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length && keys.every((key) => Object.hasOwn(b, key) && chatDraftEqual(a[key], b[key]))
}
