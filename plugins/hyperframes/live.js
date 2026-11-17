// Live preview: the composition runs in the browser with the HyperFrames runtime, so edits show at once without
// rendering. The host serves it at one address per window; each redraw loads a fresh frame behind the visible one
// and swaps when its media is ready, keeping the playhead and play state.
const RUNTIME = 'vendor/hyperframe.runtime.iife.js', PACKAGE = [RUNTIME, 'vendor/gsap.min.js']

export function previewDocument(html) {
  const tag = `<script src="${RUNTIME}"></script>`, end = html.lastIndexOf('</body>')
  return end < 0 ? html + tag : html.slice(0, end) + tag + html.slice(end)
}

/** The runtime and GSAP from this package, and every project asset at its own path. */
export function previewFiles(assets) {
  const files = Object.fromEntries(PACKAGE.map(path => [path, { source: 'package', path }]))
  for (const asset of assets) if (asset.path) files[asset.path] = asset.reference
  return files
}

export function livePreview(api, stage, { onState = () => {}, onError = () => {} } = {}) {
  const state = { time: 0, duration: 0, playing: false, muted: false, ready: false }
  let url = null, shown = null, incoming = null, key = '', wanted = null, running = false, delay = null, swapTimer = null
  const control = (frame, action, extra = {}) => frame?.contentWindow?.postMessage({ source: 'hf-parent', type: 'control', action, ...extra }, '*')
  function fit() {
    for (const frame of stage.querySelectorAll('iframe')) {
      const scale = Math.min(stage.clientWidth / frame.width, stage.clientHeight / frame.height) || 0
      frame.style.transform = `translate(-50%, -50%) scale(${scale})`
    }
  }
  new ResizeObserver(fit).observe(stage)
  function swap(frame) {
    if (frame !== incoming) return
    clearTimeout(swapTimer); incoming = null
    shown?.remove(); shown = frame; frame.classList.remove('incoming')
    state.ready = true; onState(state)
  }
  function load(width, height) {
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-scripts'); frame.allow = 'autoplay'; frame.referrerPolicy = 'no-referrer'
    frame.title = '실시간 미리보기'; frame.tabIndex = -1; frame.width = width; frame.height = height; frame.className = 'incoming'
    incoming?.remove(); incoming = frame
    frame.src = url
    stage.append(frame); fit()
    // A composition that never reports ready (a script error) is still shown, so the page never sticks on the old one.
    clearTimeout(swapTimer); swapTimer = setTimeout(() => swap(frame), 8000)
  }
  async function run() {
    if (running) return
    running = true
    try {
      while (wanted && wanted.key !== key) {
        const next = wanted, content = { html: previewDocument(next.html), files: next.files }
        try { url = (url ? await api.preview.update(url, content) : await api.preview.open(content)).url }
        catch (e) {
          // An expired address (the window idled past its lease) gets a new one; other failures surface.
          if (!url) throw e
          url = null
          url = (await api.preview.open(content)).url
        }
        key = next.key
        load(next.width, next.height)
      }
    } catch (e) { key = ''; wanted = null; onError(e) } finally { running = false }
  }
  window.addEventListener('message', event => {
    const data = event.data
    if (data?.source !== 'hf-preview') return
    const frame = event.source === incoming?.contentWindow ? incoming : event.source === shown?.contentWindow ? shown : null
    if (!frame) return
    if (frame === incoming) {
      if (data.type === 'ready') {
        control(frame, 'set-muted', { muted: state.muted })
        control(frame, 'seek', { timeSeconds: state.time })
        if (state.playing) control(frame, 'play')
        clearTimeout(swapTimer); swapTimer = setTimeout(() => swap(frame), 1500)
      }
      if (data.type === 'assets-ready') swap(frame)
      return
    }
    if (data.type === 'timeline' && Number.isFinite(data.durationSeconds)) { state.duration = data.durationSeconds; onState(state) }
    if (data.type === 'state') {
      state.time = data.currentTime ?? state.time; state.playing = !!data.isPlaying && !data.ended
      if (typeof data.muted === 'boolean') state.muted = data.muted
      onState(state)
    }
  })
  return {
    state,
    /** Redraw after edits settle; identical contents are skipped (false). */
    show({ html, files, width, height }, wait = 300) {
      const next = { html, files, width, height, key: JSON.stringify([html, files, width, height]) }
      if (next.key === (wanted?.key ?? key)) return false
      clearTimeout(delay)
      wanted = next
      delay = setTimeout(() => { void run() }, wait)
      return true
    },
    play() { if (state.duration && state.time >= state.duration - 0.05) control(shown, 'seek', { timeSeconds: 0 }); control(shown, 'play') },
    pause() { control(shown, 'pause') },
    toggle() { if (state.playing) this.pause(); else this.play() },
    seek(seconds) { state.time = Math.max(0, Math.min(seconds, state.duration || seconds)); control(shown, 'seek', { timeSeconds: state.time }); onState(state) },
    mute(muted) { state.muted = muted; control(shown, 'set-muted', { muted }); onState(state) },
  }
}
