/*
 * Game pictures on the page: the monsters, guardians, items, potions and skills the DM described and the game generated.
 * Each library hash is opened once (`open(hash)` → URL), made small, its plain background keyed out when the picture came
 * without alpha (a ComfyUI workflow without background removal), trimmed to what is drawn, and kept as a canvas (for the
 * dungeon painter) and a blob URL (for <img>). Nothing is stored: the library holds the pictures.
 */
// The plugin bridge allows four requests in flight for the whole page; pictures load one at a time so polling and the rest keep room.
const SIDE = 256, PARALLEL = 1, RETRY_MS = 30_000, TRIES = 3, KEY_NEAR = 46, KEY_FAR = 84

/** Corner colour of an opaque picture, or null when its corners already carry alpha or disagree (a full scene). */
export function backdropOf({ data, width, height }) {
  const corners = [[0, 0], [width - 3, 0], [0, height - 3], [width - 3, height - 3]].map(([x0, y0]) => {
    const sum = [0, 0, 0, 0]
    for (let y = y0; y < y0 + 3; y++) for (let x = x0; x < x0 + 3; x++) { const i = (y * width + x) * 4; for (let c = 0; c < 4; c++) sum[c] += data[i + c] }
    return sum.map(v => v / 9)
  })
  if (corners.some(c => c[3] < 250)) return null
  const mean = [0, 1, 2].map(c => corners.reduce((s, k) => s + k[c], 0) / 4)
  return corners.every(k => Math.hypot(k[0] - mean[0], k[1] - mean[1], k[2] - mean[2]) < 40) ? mean : null
}

/** Clear the background reachable from the border that is close to `bg`; edges fade instead of cutting hard. */
export function keyOut({ data, width, height }, bg) {
  const seen = new Uint8Array(width * height), queue = new Int32Array(width * height)
  let head = 0, tail = 0
  const far = i => Math.hypot(data[i * 4] - bg[0], data[i * 4 + 1] - bg[1], data[i * 4 + 2] - bg[2])
  const push = i => { if (!seen[i]) { seen[i] = 1; queue[tail++] = i } }
  for (let x = 0; x < width; x++) { push(x); push((height - 1) * width + x) }
  for (let y = 0; y < height; y++) { push(y * width); push(y * width + width - 1) }
  while (head < tail) {
    const i = queue[head++], d = far(i)
    if (d >= KEY_FAR) continue
    if (d > KEY_NEAR) { data[i * 4 + 3] = Math.min(data[i * 4 + 3], Math.round(255 * (d - KEY_NEAR) / (KEY_FAR - KEY_NEAR))); continue }
    data[i * 4 + 3] = 0
    const x = i % width
    if (x > 0) push(i - 1)
    if (x < width - 1) push(i + 1)
    if (i >= width) push(i - width)
    if (i < width * (height - 1)) push(i + width)
  }
}

/** The box around what is drawn (alpha above 16), or null for an empty picture. */
export function drawnBox({ data, width, height }) {
  let x0 = width, y0 = height, x1 = -1, y1 = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

export function createArtCache({ open, changed = () => {} }) {
  const items = new Map(), waiting = []
  let running = 0
  // The media address is another origin than this sandboxed page: without a CORS load the canvas is tainted and
  // reading it back (keying, trimming, toBlob) throws, so no picture ever became ready.
  const load = url => new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => resolve(img); img.onerror = () => reject(new Error('그림을 열 수 없어.')); img.src = url })
  async function prepare(hash) {
    const url = await open(hash), img = await load(url)
    const scale = Math.min(1, SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale))
    const work = document.createElement('canvas'); work.width = w; work.height = h
    const ctx = work.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0, w, h)
    let box = { x: 0, y: 0, w, h }
    try {
      const pixels = ctx.getImageData(0, 0, w, h), bg = backdropOf(pixels)
      if (bg) keyOut(pixels, bg)
      else if (pixels.data[3] > 250 && pixels.data[(w * h - 1) * 4 + 3] > 250) {
        // A full scene with no plain background: a soft round frame instead of a hard square.
        const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = Math.hypot(x + .5 - cx, y + .5 - cy) / r, i = (y * w + x) * 4 + 3; pixels.data[i] = d >= 1 ? 0 : d > .86 ? Math.round(pixels.data[i] * (1 - d) / .14) : pixels.data[i] }
      }
      ctx.putImageData(pixels, 0, 0)
      box = drawnBox(pixels) ?? box
    } catch { /* an image the page cannot read back: shown as it is */ }
    const pad = 2, canvas = document.createElement('canvas'); canvas.width = box.w + pad * 2; canvas.height = box.h + pad * 2
    canvas.getContext('2d').drawImage(work, box.x, box.y, box.w, box.h, pad, pad, box.w, box.h)
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
    return { canvas, url: blob ? URL.createObjectURL(blob) : url }
  }
  function pump() {
    while (running < PARALLEL && waiting.length) {
      const hash = waiting.shift(), item = items.get(hash); running++
      prepare(hash).then(done => Object.assign(item, done, { state: 'ready' }), () => Object.assign(item, { state: 'failed', tries: (item.tries ?? 0) + 1, retryAt: Date.now() + RETRY_MS }))
        .finally(() => { running--; changed(hash); pump() })
    }
  }
  function want(hash) {
    if (typeof hash !== 'string' || !hash) return null
    let item = items.get(hash)
    if (!item) { item = { state: 'loading' }; items.set(hash, item); waiting.push(hash); pump() }
    // A busy bridge or a slow library: try that picture again a little later, a few times.
    else if (item.state === 'failed' && item.tries < TRIES && Date.now() >= item.retryAt) { item.state = 'loading'; waiting.push(hash); pump() }
    return item.state === 'ready' ? item : null
  }
  return {
    /** A trimmed, keyed canvas for the painter, or null while it loads (draw the old shape meanwhile). */
    sprite: hash => want(hash)?.canvas ?? null,
    /** A blob URL for <img>, or null while it loads. */
    url: hash => want(hash)?.url ?? null,
  }
}
