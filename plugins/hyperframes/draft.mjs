// One account-scoped recovery copy. CAS prevents another tab's draft from being overwritten.
export function draftRecovery(storage, notify) {
  let revision = null, blocked = false, ready = false, queue = Promise.resolve()
  const key = 'editor-draft'
  const enqueue = operation => {
    const result = queue.then(async () => {
      if (!ready || blocked) return false
      try { await operation(); return true }
      catch (error) { blocked = true; notify(`임시 보관을 멈췄어: ${error.message}. 현재 초안은 저장하거나 복사 저장해줘.`, true); return false }
    })
    queue = result.catch(() => {})
    return result
  }
  return {
    async load() {
      const state = await storage.get(key)
      revision = state.revision; ready = true
      return state.value
    },
    save(value) {
      // Capture this edit now, before waiting for the previous write.
      const copy = JSON.parse(JSON.stringify(value))
      return enqueue(async () => {
        if (new TextEncoder().encode(JSON.stringify(copy)).length > 65536) throw new Error('초안이 임시 보관 크기 한도를 넘었어')
        const result = await storage.set(key, copy, revision)
        revision = result.revision
        notify('초안을 임시 보관했어. 다시 열면 복구할 수 있어.')
      })
    },
    clear() {
      return enqueue(async () => {
        await storage.delete(key, revision); revision = null
        notify('')
      })
    },
  }
}
