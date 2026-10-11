export interface WallpaperPuzzleRect {
  left: number
  top: number
  width: number
  height: number
}

interface WallpaperPuzzleLineCandidate {
  cost: number
  /** Image count per line, in order. */
  lineSizes: number[]
}

function clampAspect(aspect: number) {
  return Number.isFinite(aspect) && aspect > 0 ? Math.min(8, Math.max(0.125, aspect)) : 1
}

/**
 * Split the images, in order, into `lineCount` justified lines of a `mainLength` x `crossLength` box. A line's
 * natural thickness is what its images need to span `mainLength` uncropped; the cost is how far each image's line
 * sits from an even share of `crossLength`, i.e. how much it gets cropped.
 */
function solveWallpaperPuzzleLines(aspects: number[], mainLength: number, crossLength: number, lineCount: number, gap: number): WallpaperPuzzleLineCandidate | null {
  const count = aspects.length
  const targetThickness = (crossLength - gap * (lineCount - 1)) / lineCount
  if (targetThickness <= 0) {
    return null
  }

  const prefix = [0]
  for (const aspect of aspects) {
    prefix.push(prefix[prefix.length - 1] + aspect)
  }

  const lineCost = (start: number, end: number) => {
    const size = end - start
    const span = mainLength - gap * (size - 1)
    if (span <= 0) {
      return Number.POSITIVE_INFINITY
    }
    const thickness = span / (prefix[end] - prefix[start])
    return size * Math.log(thickness / targetThickness) ** 2
  }

  // best[k][i]: cheapest split of the first i images into k lines.
  const best = Array.from({ length: lineCount + 1 }, () => new Array<number>(count + 1).fill(Number.POSITIVE_INFINITY))
  const from = Array.from({ length: lineCount + 1 }, () => new Array<number>(count + 1).fill(0))
  best[0][0] = 0
  for (let k = 1; k <= lineCount; k += 1) {
    for (let i = k; i <= count; i += 1) {
      for (let j = k - 1; j < i; j += 1) {
        const cost = best[k - 1][j] + lineCost(j, i)
        if (cost < best[k][i]) {
          best[k][i] = cost
          from[k][i] = j
        }
      }
    }
  }

  if (!Number.isFinite(best[lineCount][count])) {
    return null
  }

  const lineSizes: number[] = []
  for (let k = lineCount, i = count; k > 0; k -= 1) {
    const j = from[k][i]
    lineSizes.unshift(i - j)
    i = j
  }
  return { cost: best[lineCount][count] / count, lineSizes }
}

/**
 * Lay out justified lines along the main axis; `rows` says whether lines are rows (main axis = x) or columns.
 * `aspects` are main/cross ratios, so columns pass height/width.
 */
function placeWallpaperPuzzleLines(aspects: number[], lineSizes: number[], width: number, height: number, gap: number, rows: boolean): WallpaperPuzzleRect[] {
  const mainLength = rows ? width : height
  const crossLength = rows ? height : width
  const lineCount = lineSizes.length
  const targetThickness = (crossLength - gap * (lineCount - 1)) / lineCount

  let index = 0
  const lines = lineSizes.map((size) => {
    const lineAspects = aspects.slice(index, index + size)
    index += size
    const aspectSum = lineAspects.reduce((sum, aspect) => sum + aspect, 0)
    const natural = (mainLength - gap * (size - 1)) / aspectSum
    // Lean each line halfway toward its natural thickness so busy lines crop less, then fit the box exactly.
    return { lineAspects, aspectSum, weight: Math.sqrt(natural * targetThickness) }
  })
  const weightSum = lines.reduce((sum, line) => sum + line.weight, 0)
  const crossAvailable = crossLength - gap * (lineCount - 1)

  const rects: WallpaperPuzzleRect[] = []
  let crossOffset = 0
  for (const line of lines) {
    const thickness = (line.weight / weightSum) * crossAvailable
    const mainAvailable = mainLength - gap * (line.lineAspects.length - 1)
    let mainOffset = 0
    for (const aspect of line.lineAspects) {
      const span = (aspect / line.aspectSum) * mainAvailable
      rects.push(rows
        ? { left: mainOffset, top: crossOffset, width: span, height: thickness }
        : { left: crossOffset, top: mainOffset, width: thickness, height: span })
      mainOffset += span + gap
    }
    crossOffset += thickness + gap
  }
  return rects
}

/**
 * Tile every image, in order, into a `width` x `height` box with no empty space: justified rows or justified
 * columns, whichever crops the images least. Tiles keep roughly their image's shape; object-cover hides the rest.
 */
export function computeWallpaperPuzzleLayout(imageAspects: number[], width: number, height: number, gap: number): WallpaperPuzzleRect[] {
  const count = imageAspects.length
  if (count === 0 || width <= 0 || height <= 0) {
    return []
  }

  const aspects = imageAspects.map(clampAspect)
  const inverseAspects = aspects.map((aspect) => 1 / aspect)
  let bestCandidate: { cost: number; lineSizes: number[]; rows: boolean } | null = null

  for (const rows of [true, false]) {
    for (let lineCount = 1; lineCount <= count; lineCount += 1) {
      const candidate = rows
        ? solveWallpaperPuzzleLines(aspects, width, height, lineCount, gap)
        : solveWallpaperPuzzleLines(inverseAspects, height, width, lineCount, gap)
      if (candidate && (!bestCandidate || candidate.cost < bestCandidate.cost - 1e-9)) {
        bestCandidate = { ...candidate, rows }
      }
    }
  }

  if (!bestCandidate) {
    return []
  }
  return placeWallpaperPuzzleLines(bestCandidate.rows ? aspects : inverseAspects, bestCandidate.lineSizes, width, height, gap, bestCandidate.rows)
}
