/**
 * Village album: lists the library group the server collects residents' pictures into.
 * Reads through native app tools (search_images by group → get_media_download → api.media.open); nothing is copied.
 */
const PAGE = 30
const $ = id => document.getElementById(id)
const parse = call => {
  const result = call?.result
  const text = result?.content?.find?.(c => c.type === 'text')?.text ?? ''
  if (call?.status === 'failed' || result?.isError) throw new Error(text.slice(0, 300) || call?.error || '앨범을 읽지 못했어.')
  return JSON.parse(text)
}

export function createAlbum({ toast }) {
  let api = null, info = null, items = [], page = 0, total = 0, loading = false, seenAdded = null
  const layer = $('album'), grid = $('album-grid'), cols = $('album-cols'), view = $('album-view')
  // The bridge allows four pending requests and forty messages a second per page (the village poll uses one),
  // so links are opened two at a time instead of one burst per visible tile.
  const queue = []
  let active = 0
  const schedule = tile => { if (!queue.includes(tile)) queue.push(tile); pump() }
  function pump() {
    while (active < 2 && queue.length) {
      const tile = queue.shift(); active++
      void show(tile).finally(() => { active--; setTimeout(pump, 100) })
    }
  }
  const visible = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { visible.unobserve(entry.target); schedule(entry.target) }
  }, { root: grid, rootMargin: '300px' })

  /** One get_media_download per loaded page gives every tile its artifact ID. */
  async function resolveArtifacts(list) {
    const missing = list.filter(item => !item.artifactId)
    if (!missing.length) return
    const download = parse(await api.app.call('get_media_download', { composite_hashes: missing.map(item => item.hash) }))
    for (const entry of download.items ?? []) {
      const item = missing.find(i => i.hash === entry.composite_hash)
      if (item && entry.artifact?.artifact_id) item.artifactId = entry.artifact.artifact_id
      else if (item) item.unavailable = true
    }
  }
  async function urlFor(item) {
    if (item.url && item.expiresAt > Date.now() + 5_000) return item.url
    if (!item.artifactId) await resolveArtifacts([item])
    if (!item.artifactId) throw new Error('이미지를 열 수 없어.')
    const media = await api.media.open(item.artifactId)
    item.url = media.url; item.expiresAt = media.expiresAt ?? Date.now() + 60_000
    return item.url
  }
  async function show(tile) {
    const item = items.find(i => i.hash === tile.dataset.hash)
    if (!item) return
    try { tile.querySelector('img').src = await urlFor(item); delete tile.dataset.broken }
    catch {
      const tries = Number(tile.dataset.tries ?? 0) + 1
      tile.dataset.tries = String(tries)
      if (tries < 4 && !item.unavailable) setTimeout(() => schedule(tile), 1500 * tries)
      else tile.dataset.broken = 'true'
    }
  }
  function tileFor(item) {
    const tile = document.createElement('button'); tile.type = 'button'; tile.className = 'tile'; tile.dataset.hash = item.hash
    if (item.width && item.height) tile.style.aspectRatio = `${item.width} / ${item.height}`
    tile.title = item.prompt || ''
    const image = document.createElement('img'); image.alt = ''; image.decoding = 'async'
    image.addEventListener('error', () => { item.url = null; if (!tile.dataset.retried) { tile.dataset.retried = 'true'; schedule(tile) } })
    tile.append(image); tile.addEventListener('click', () => void enlarge(item))
    visible.observe(tile)
    return tile
  }
  function render() {
    $('album-count').textContent = total ? String(total) : ''
    $('album-empty').hidden = loading || items.length > 0
  }
  async function load(reset) {
    if (!api || loading) return
    if (!info?.groupId) { items = []; total = 0; cols.replaceChildren(); render(); return }
    if (reset) { items = []; page = 0; total = 0; cols.replaceChildren() }
    if (!reset && items.length >= total) return
    loading = true; render()
    try {
      const data = parse(await api.app.call('search_images', { group_id: info.groupId, page: page + 1, limit: PAGE, sort_by: 'upload_date', sort_order: 'DESC' }))
      page++; total = data.total ?? 0
      const fresh = (data.images ?? []).filter(i => !items.some(x => x.hash === i.composite_hash))
        .map(i => ({ hash: i.composite_hash, width: i.width, height: i.height, prompt: i.prompt, mediaType: i.media_type }))
      items.push(...fresh)
      await resolveArtifacts(fresh).catch(() => {}) // Tiles retry one by one if the batch fails.
      cols.append(...fresh.map(tileFor))
    } catch (error) { toast(error.message) }
    finally { loading = false; render() }
  }
  async function enlarge(item) {
    view.hidden = false
    const image = $('album-image'); image.removeAttribute('src')
    $('album-prompt').textContent = item.prompt || ''
    try { image.src = await urlFor(item) } catch (error) { toast(error.message); view.hidden = true }
  }

  grid.addEventListener('scroll', () => { if (grid.scrollTop + grid.clientHeight > grid.scrollHeight - 400) void load(false) })
  $('open-album').addEventListener('click', () => { layer.hidden = false; seenAdded = info?.added ?? 0; $('open-album').dataset.fresh = 'false'; void load(true) })
  $('album-close').addEventListener('click', () => { layer.hidden = true; view.hidden = true })
  layer.querySelector('.dim').addEventListener('click', () => { layer.hidden = true; view.hidden = true })
  view.addEventListener('click', () => { view.hidden = true })
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || layer.hidden) return
    if (!view.hidden) view.hidden = true; else layer.hidden = true
  })

  return {
    connect(next) { api = next },
    update(next) {
      const before = info
      info = next ?? null
      seenAdded ??= info?.added ?? 0 // Only pictures that arrive while the page is open get the new-mark.
      $('open-album').dataset.fresh = String((info?.added ?? 0) > seenAdded && layer.hidden)
      if (!layer.hidden && (before?.added !== info?.added || before?.groupId !== info?.groupId)) void load(true)
    },
    get open() { return !layer.hidden },
  }
}
