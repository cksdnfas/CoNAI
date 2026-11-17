// The host bridge refuses a fifth request in flight. Every SDK call goes through api.request, so queue there:
// at most four at once, the rest wait their turn. Cancels keep the bridge's reserved slot and never wait.
export function queueBridge(api, limit = 4) {
  if (typeof api.request !== 'function') return api
  const send = api.request.bind(api), waiting = []
  let active = 0
  function next() {
    while (active < limit && waiting.length) {
      const job = waiting.shift()
      if (job.options.signal?.aborted) { job.reject(job.options.signal.reason ?? new DOMException('Cancelled', 'AbortError')); continue }
      active++
      send(job.method, job.args, job.options).then(job.resolve, job.reject).finally(() => { active--; next() })
    }
  }
  api.request = (method, args, options = {}) => {
    if (method === 'app.cancel' || method === 'llm.cancel') return send(method, args, options)
    return new Promise((resolve, reject) => { waiting.push({ method, args, options, resolve, reject }); next() })
  }
  return api
}
