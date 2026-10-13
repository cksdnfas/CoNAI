/** CoNAI web extension SDK v1. No cookies, localStorage, network access or approval tokens. */
export function connectPlugin(handlers = {}) {
  return new Promise((resolve) => {
    function connect(event) {
      if (event.source !== window.parent || event.data?.type !== 'conai-plugin-connect' || event.data.version !== 1 || event.ports.length !== 1) return
      window.removeEventListener('message', connect)
      const port = event.ports[0], pending = new Map(), saved = new Set()
      const api = {
        files: event.data.files, language: event.data.language,
        request(method, args) {
          if (pending.size >= 4) return Promise.reject(new Error('Too many pending requests'))
          return new Promise((resolve, reject) => {
            const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, '0')).join('')
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('Host request timed out')) }, 30000)
            pending.set(id, { resolve, reject, timer })
            port.postMessage({ type: 'request', id, method, args })
          })
        },
        publish(snapshot) { port.postMessage({ type: 'snapshot', snapshot }) },
        onSaved(listener) { saved.add(listener); return () => saved.delete(listener) },
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
        }
      }
      port.start(); resolve(api)
    }
    window.addEventListener('message', connect)
  })
}
