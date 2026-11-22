/**
 * The shared plugin window a host UI is acting for right now (the media picker a page opened with `api.pickMedia`).
 * While one is open, app requests name it so the server lends that window's declared scope (backend
 * pluginRouteLending); nothing is lent from it on the client.
 */
const open: string[] = []

/** Names `instanceId` on app requests until the returned release runs. */
export function openPluginLendWindow(instanceId: string): () => void {
  open.push(instanceId)
  let released = false
  return () => {
    if (released) return
    released = true
    open.splice(open.lastIndexOf(instanceId), 1)
  }
}

export function pluginLendWindow(): string | null {
  return open.at(-1) ?? null
}

/** A media address (`/api/…` thumbnail or file) naming the open window, for `<img>`/`<video>` that cannot send headers. */
export function withPluginLendWindow<T extends string | null | undefined>(url: T): T {
  const instanceId = pluginLendWindow()
  if (!instanceId || !url || !url.includes('/api/')) return url
  return `${url}${url.includes('?') ? '&' : '?'}conaiPluginInstance=${encodeURIComponent(instanceId)}` as T
}
