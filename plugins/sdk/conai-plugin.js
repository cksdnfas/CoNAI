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
  return new Promise((resolve, reject) => {
    const connectionTimeout = setTimeout(() => { window.removeEventListener('message', connect); reject(new Error('Plugin host did not connect')) }, 30000)
    function connect(event) {
      if (event.source !== window.parent || event.data?.type !== 'conai-plugin-connect' || event.data.version !== 1 || event.ports.length !== 1) return
      window.removeEventListener('message', connect)
      clearTimeout(connectionTimeout)
      applyTheme(event.data.theme)
      const port = event.ports[0], pending = new Map(), saved = new Set(), listeners = new Map()
      let closed = false
      // Snapshots follow typing: the first goes at once, then the newest one every 100 ms at most.
      let queued = null, timer = null
      const flush = () => {
        timer = null
        if (!queued || closed) return
        const next = queued; queued = null
        port.postMessage({ type: 'snapshot', snapshot: typeof next === 'function' ? next() : next })
        timer = setTimeout(flush, 100)
      }
      const api = {
        files: event.data.files, workspace: event.data.workspace, language: event.data.language,
        host: { features: event.data.features || [], nativeApiRoots: event.data.nativeApiRoots || [] },
        supports(feature) { return api.host.features.includes(feature) },
        request(method, args, options = {}) {
          if (closed) return Promise.reject(new Error('Plugin connection closed'))
          if (options.signal?.aborted) return Promise.reject(options.signal.reason || new DOMException('Cancelled', 'AbortError'))
          if (pending.size >= (['app.cancel', 'llm.cancel'].includes(method) ? 5 : 4)) return Promise.reject(new Error('Too many pending requests'))
          return new Promise((resolve, reject) => {
            const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
            const timeoutMs = Math.min(600000, Math.max(1000, Number.isFinite(options.timeoutMs) ? options.timeoutMs : 600000))
            const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); pending.delete(id) }
            const cancel = reason => { port.postMessage({ type: 'cancel', id }); cleanup(); reject(reason) }
            const abort = () => cancel(options.signal.reason || new DOMException('Cancelled', 'AbortError'))
            const timer = setTimeout(() => cancel(new DOMException('Host request timed out; check job status before retrying a change', 'TimeoutError')), timeoutMs)
            pending.set(id, { resolve, reject, cleanup })
            options.signal?.addEventListener('abort', abort, { once: true })
            try { port.postMessage({ type: 'request', id, method, args, timeoutMs }) }
            catch (error) { cleanup(); reject(error) }
          })
        },
        /** The page's state for the app and a connected chat: an object, or a function building it when it is sent. Call it on every change. */
        publish(snapshot) { if (closed) return; queued = snapshot; if (!timer) flush() },
        onSaved(listener) { saved.add(listener); return () => saved.delete(listener) },
      }
      api.app = {
        tools: (query = {}, options) => api.request('app.tools', query, options),
        call: (tool, args = {}, requestId = crypto.randomUUID(), options) => api.request('app.call', { tool, arguments: args, requestId }, options),
        run: (action, args = {}, requestId = crypto.randomUUID(), options) => api.request('app.action', { action, arguments: args, requestId }, options),
        getRequest: (requestId, options) => api.request('app.getRequest', { requestId }, options),
        cancel: (requestId, options) => api.request('app.cancel', { requestId }, options),
        /** Native JSON, multipart and streaming responses; exactly the native route's permission/revision rules. Never automatically retries. */
        async fetch(path, options = {}) {
          if (!api.supports('app.fetch')) throw new Error('This host does not support app.fetch; update CoNAI')
          const { body, headers, method, signal, timeoutMs } = options
          const input = { path, method, headers: Object.fromEntries(new Headers(headers)) }
          if (body instanceof FormData) input.form = [...body].map(([name, value]) => ({ name, value, ...(value instanceof Blob ? { filename: value.name || 'upload' } : {}) }))
          else if (body !== undefined) input.body = body
          const result = await api.request('app.fetch', input, { signal, timeoutMs })
          let stream = result.body
          if (stream && signal) {
            const reader = stream.getReader()
            let target, ended = false
            const abort = () => { if (ended) return; ended = true; void reader.cancel(signal.reason).catch(() => {}); target?.error(signal.reason || new DOMException('Cancelled', 'AbortError')); signal.removeEventListener('abort', abort) }
            stream = new ReadableStream({
              start(controller) { target = controller; signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort() },
              async pull(controller) { try { const next = await reader.read(); if (ended) return; if (next.done) { ended = true; signal.removeEventListener('abort', abort); controller.close() } else controller.enqueue(next.value) } catch (error) { if (!ended) { ended = true; signal.removeEventListener('abort', abort); controller.error(error) } } },
              async cancel(reason) { ended = true; signal.removeEventListener('abort', abort); await reader.cancel(reason) },
            })
          }
          return new Response(stream, { status: result.status, statusText: result.statusText, headers: result.headers })
        },
        download: (path, filename) => api.request('app.download', { path, filename }),
      }
      const pause = (ms, signal) => new Promise((resolve, reject) => {
        const done = () => { signal?.removeEventListener('abort', abort); resolve() }
        const timer = setTimeout(done, ms)
        const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason || new DOMException('Cancelled', 'AbortError')) }
        signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort()
      })
      const wait = async (get, id, options = {}) => {
        const deadline = Date.now() + Math.min(600000, Math.max(1000, options.timeoutMs || 600000))
        while (true) {
          const state = await get(id, { ...options, timeoutMs: Math.max(1000, deadline - Date.now()) })
          if (['pending', 'completed', 'failed', 'cancelled'].includes(state.status)) return state
          if (Date.now() >= deadline) throw new DOMException('Wait timed out; query the same job again', 'TimeoutError')
          await pause(1000, options.signal)
        }
      }
      api.app.wait = (id, options) => wait(api.app.getRequest, id, options)
      api.storage = {
        get: key => api.request('storage.get', { key }),
        set: (key, value, revision = null) => api.request('storage.set', { key, value, revision }),
        delete: (key, revision) => api.request('storage.delete', { key, revision }),
      }
      api.media = { open: (artifactId, options) => api.request('media.open', { artifactId }, options) }
      /** A live HTML document to frame inside this page: `files` maps relative paths to media references or this package's files. update() keeps the address. */
      api.preview = {
        open: ({ html, files = {} }, options) => api.request('preview.open', { html, files }, options),
        update: (url, { html, files = {} }, options) => api.request('preview.update', { url, html, files }, options),
      }
      api.navigation = { open: path => api.request('navigation.open', { path }), openChat: threadId => api.request('navigation.openChat', { threadId }) }
      api.events = { on(name, listener) {
        if (typeof listener !== 'function') throw new TypeError('events.on(name, listener)')
        if (!listeners.size) void api.request('events.subscribe', { enabled: true }).catch(error => listener({ name: 'error', message: error.message }))
        const group = listeners.get(name) || new Set(); group.add(listener); listeners.set(name, group)
        return () => { group.delete(listener); if (!group.size) listeners.delete(name); if (!listeners.size) void api.request('events.subscribe', { enabled: false }).catch(() => {}) }
      } }
      /** Plugins with a server module: send `body` to its `conai.onRequest` handler and get its answer. */
      api.server = (body, options) => api.request('server.request', { body }, options)
      /** Where the page is shown: null on its own page, `{ kind: 'generation-block', surface }` inside a generation layout. */
      api.context = event.data.context || null
      /** Inside a layout block: the screen's form (`{ title, fields }`, or null) and filling some of its inputs by field id. */
      api.page = {
        form: options => api.request('page.form.get', {}, options),
        fill: (values, options) => api.request('page.form.fill', { values }, options),
      }
      /** Profile replies using the current account; no server module required. Reuse requestId only for the same turn. */
      api.llm = {
        profiles: options => api.request('llm.profiles', {}, options),
        measure: (input, options) => api.request('llm.measure', input, options),
        decide: (input, options) => api.request('llm.decide', input, options),
        judgeTurn: (input, options) => api.request('llm.judgeTurn', input, options),
        asset: (input, options) => api.request('llm.asset', input, options),
        start: (input, options) => api.request('llm.start', input, options),
        room: (input, options) => api.request('llm.room', input, options),
        forgetRooms: (input, options) => api.request('llm.forgetRooms', input, options),
        discard: (input, options) => api.request('llm.discard', input, options),
        get: (jobId, options) => api.request('llm.get', { jobId }, options),
        cancel: (jobId, options) => api.request('llm.cancel', { jobId }, options),
      }
      api.llm.wait = (id, options) => wait(api.llm.get, id, options)
      port.onmessage = async ({ data }) => {
        if (data?.type === 'response') {
          const request = pending.get(data.id)
          if (!request) return
          request.cleanup()
          if (data.error) request.reject(Object.assign(new Error(data.error), data.errorInfo || {}))
          else request.resolve(data.result)
        } else if (data?.type === 'closed') {
          closed = true; clearTimeout(timer); queued = null
          for (const request of pending.values()) { request.cleanup(); request.reject(new Error('Plugin connection closed')) }
          listeners.clear()
        } else if (data?.type === 'event') {
          for (const listener of new Set([...(listeners.get(data.event?.name) || []), ...(listeners.get('*') || [])])) {
            try { listener(data.event) } catch (error) { console.error(error) }
          }
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
