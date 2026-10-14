/** CoNAI web extension SDK v1. No cookies, localStorage, network access or approval tokens. */

/** The app's current colours and fonts as `--conai-*` variables for conai-plugin.css. Without a theme (older host) its dark defaults stay. */
function applyTheme(theme) {
  if (!theme || typeof theme !== 'object') return
  const root = document.documentElement
  if (theme.vars && typeof theme.vars === 'object') {
    for (const [key, value] of Object.entries(theme.vars)) {
      if (/^[a-z][a-z-]{0,39}$/.test(key) && typeof value === 'string' && value.length <= 200 && !/[;{}<>]/.test(value)) root.style.setProperty(`--conai-${key}`, value)
    }
  }
  if (theme.scheme === 'dark' || theme.scheme === 'light') { root.style.colorScheme = theme.scheme; root.dataset.theme = theme.scheme }
}

export function connectPlugin(handlers = {}) {
  return new Promise((resolve) => {
    function connect(event) {
      if (event.source !== window.parent || event.data?.type !== 'conai-plugin-connect' || event.data.version !== 1 || event.ports.length !== 1) return
      window.removeEventListener('message', connect)
      applyTheme(event.data.theme)
      const port = event.ports[0], pending = new Map(), saved = new Set()
      // Snapshots follow typing: the first goes at once, then the newest one every 100 ms at most.
      let queued = null, timer = null
      const flush = () => {
        timer = null
        if (!queued) return
        const next = queued; queued = null
        port.postMessage({ type: 'snapshot', snapshot: typeof next === 'function' ? next() : next })
        timer = setTimeout(flush, 100)
      }
      const api = {
        files: event.data.files, workspace: event.data.workspace, language: event.data.language,
        request(method, args) {
          if (pending.size >= 4) return Promise.reject(new Error('Too many pending requests'))
          return new Promise((resolve, reject) => {
            const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('Host request timed out')) }, 30000)
            pending.set(id, { resolve, reject, timer })
            port.postMessage({ type: 'request', id, method, args })
          })
        },
        /** The page's state for the app and a connected chat: an object, or a function building it when it is sent. Call it on every change. */
        publish(snapshot) { queued = snapshot; if (!timer) flush() },
        onSaved(listener) { saved.add(listener); return () => saved.delete(listener) },
      }
      api.app = {
        tools: (query = {}) => api.request('app.tools', query),
        call: (tool, args = {}, requestId = crypto.randomUUID()) => api.request('app.call', { tool, arguments: args, requestId }),
        run: (action, args = {}, requestId = crypto.randomUUID()) => api.request('app.action', { action, arguments: args, requestId }),
        getRequest: requestId => api.request('app.getRequest', { requestId }),
      }
      /** Plugins with a server module: send `body` to its `conai.onRequest` handler and get its answer. */
      api.server = body => api.request('server.request', { body })
      /** Stateless profile replies for trusted server plugins. Reuse requestId only for the same logical turn. */
      api.llm = {
        profiles: () => api.request('llm.profiles', {}),
        start: input => api.request('llm.start', input),
        get: jobId => api.request('llm.get', { jobId }),
        cancel: jobId => api.request('llm.cancel', { jobId }),
      }
      port.onmessage = async ({ data }) => {
        if (data?.type === 'response') {
          const request = pending.get(data.id)
          if (!request) return
          clearTimeout(request.timer); pending.delete(data.id)
          if (data.error) request.reject(new Error(data.error))
          else request.resolve(data.result)
        } else if (data?.type === 'action') {
          try {
            const handler = handlers[data.actionId]
            if (typeof handler !== 'function') throw new Error('Unknown extension action')
            await handler(data.args)
            port.postMessage({ type: 'action-result', id: data.id })
          } catch (error) { port.postMessage({ type: 'action-result', id: data.id, error: error instanceof Error ? error.message : String(error) }) }
        } else if (data?.type === 'saved') {
          for (const listener of saved) listener(data)
        } else if (data?.type === 'theme') {
          applyTheme(data.theme)
        }
      }
      port.start(); resolve(api)
    }
    window.addEventListener('message', connect)
  })
}
