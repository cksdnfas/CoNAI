import { libraryMediaFileUrl } from '@/lib/api-sprite'

export type SheetGrid = { columns: number; rows: number; frameCount: number }

const MAX_SIDE = 2048
const MAX_CELLS_PER_AXIS = 32
const ALPHA_ON = 16
/** Cell boundaries must be this much emptier than the sheet on average to count as a grid line. */
const BOUNDARY_RATIO = 0.35

/** Picks the finest exact split whose cell boundaries fall on (nearly) empty pixel lines. */
function detectAxis(profile: Float32Array, size: number) {
  const mean = profile.reduce((sum, value) => sum + value, 0) / profile.length
  if (mean <= 0) return 1
  const scale = profile.length / size
  let best = 1
  for (let count = 2; count <= MAX_CELLS_PER_AXIS; count++) {
    if (size % count !== 0) continue
    const cell = size / count
    let density = 0
    for (let k = 1; k < count; k++) {
      const at = Math.min(profile.length - 1, Math.max(1, Math.round(k * cell * scale)))
      density += (profile[at - 1] + profile[at]) / 2
    }
    if (density / (count - 1) / mean <= BOUNDARY_RATIO) best = count
  }
  return best
}

/**
 * Reads the sheet's alpha to find its grid (no spacing) and drops trailing empty cells from the frame count.
 * Opaque or unreadable images come back as one cell for the user to set.
 */
export async function detectSheetGrid(hash: string, width: number, height: number): Promise<SheetGrid> {
  const fallback = (): SheetGrid => ({ columns: 1, rows: 1, frameCount: 1 })
  try {
    const image = new Image()
    image.src = libraryMediaFileUrl(hash)
    await image.decode()
    const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
    const w = Math.max(1, Math.round(width * scale))
    const h = Math.max(1, Math.round(height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return fallback()
    context.drawImage(image, 0, 0, w, h)
    const { data } = context.getImageData(0, 0, w, h)
    const columnProfile = new Float32Array(w)
    const rowProfile = new Float32Array(h)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > ALPHA_ON) { columnProfile[x] += 1 / h; rowProfile[y] += 1 / w }
      }
    }
    const columns = detectAxis(columnProfile, width)
    const rows = detectAxis(rowProfile, height)
    if (columns === 1 && rows === 1) return fallback()

    const cellFilled = (index: number) => {
      const x0 = Math.floor((index % columns) * w / columns), x1 = Math.floor(((index % columns) + 1) * w / columns)
      const y0 = Math.floor(Math.floor(index / columns) * h / rows), y1 = Math.floor((Math.floor(index / columns) + 1) * h / rows)
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (data[(y * w + x) * 4 + 3] > ALPHA_ON) return true
      return false
    }
    let frameCount = columns * rows
    while (frameCount > 1 && !cellFilled(frameCount - 1)) frameCount--
    return { columns, rows, frameCount }
  } catch {
    return fallback()
  }
}
