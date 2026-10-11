import type { RasterLayer } from './layer'
import { clampRect, context2d, copyRegion, unionRect, type Rect } from './raster'

export type StrokeMode = 'paint' | 'erase'

export type StrokeStyle = {
  mode: StrokeMode
  color: string
  size: number
  opacity: number
  /** Pen pressure scales the width (mouse and touch always draw at full width). */
  pressure: boolean
}

/** A pointer sample in document pixels; `p` is pen pressure 0–1 (1 for mouse and touch). */
export type StrokePoint = { x: number; y: number; p?: number }

type Point = { x: number; y: number; p: number }

/** Thinnest a pressure stroke gets, as a share of the brush size. */
const MIN_PRESSURE_WIDTH = 0.08

/**
 * One brush/eraser/mask stroke drawn straight into a layer.
 *
 * The stroke is traced at full strength into `buffer`; each frame the touched region of the layer is rebuilt as
 * `backup` (the layer before the stroke) plus `buffer` at the stroke opacity. Opacity therefore never stacks inside one
 * stroke, the eraser only touches its own layer, and what the screen shows is exactly the layer's pixels.
 */
export class StrokeSession {
  private points: Point[] = []
  private pending: Rect | null = null
  private touched: Rect | null = null
  private readonly bufferContext: CanvasRenderingContext2D
  private readonly layer: RasterLayer
  private readonly style: StrokeStyle
  private readonly backup: HTMLCanvasElement
  private readonly buffer: HTMLCanvasElement

  constructor(layer: RasterLayer, style: StrokeStyle, backup: HTMLCanvasElement, buffer: HTMLCanvasElement) {
    this.layer = layer
    this.style = style
    this.backup = backup
    this.buffer = buffer
    const backupContext = context2d(backup)
    backupContext.globalCompositeOperation = 'copy'
    backupContext.drawImage(layer.canvas, 0, 0)
    backupContext.globalCompositeOperation = 'source-over'

    this.bufferContext = context2d(buffer)
    this.bufferContext.clearRect(0, 0, buffer.width, buffer.height)
    this.bufferContext.lineCap = 'round'
    this.bufferContext.lineJoin = 'round'
    this.bufferContext.lineWidth = style.size
    this.bufferContext.strokeStyle = style.color
    this.bufferContext.fillStyle = style.color
  }

  /** Add pointer samples (document pixels). Drawing into the layer waits for `flush`. */
  addPoints(samples: StrokePoint[]) {
    for (const sample of samples) {
      const previous = this.points[this.points.length - 1]
      if (previous && Math.abs(previous.x - sample.x) < 0.5 && Math.abs(previous.y - sample.y) < 0.5) {
        continue
      }
      const raw = this.style.pressure ? Math.max(0, Math.min(1, sample.p ?? 1)) : 1
      // Light smoothing: pen pressure jitters from sample to sample.
      const p = previous ? previous.p * 0.5 + raw * 0.5 : raw
      this.points.push({ x: sample.x, y: sample.y, p })
      this.traceLastSegment()
    }
  }

  /** Rebuild the layer pixels touched since the last flush. Returns whether anything changed. */
  flush() {
    const rect = this.pending ? clampRect(this.pending, this.layer.canvas.width, this.layer.canvas.height) : null
    this.pending = null
    if (!rect) {
      return false
    }

    const context = this.layer.context
    context.save()
    context.globalAlpha = 1
    context.globalCompositeOperation = 'source-over'
    context.clearRect(rect.x, rect.y, rect.width, rect.height)
    drawRegion(context, this.backup, rect)
    context.globalCompositeOperation = this.style.mode === 'erase' ? 'destination-out' : 'source-over'
    context.globalAlpha = this.style.opacity
    drawRegion(context, this.buffer, rect)
    context.restore()
    return true
  }

  /** Finish the stroke: returns the changed region with its before/after pixels, or null when nothing changed. */
  finish() {
    this.traceTail()
    this.flush()
    const rect = this.touched ? clampRect(this.touched, this.layer.canvas.width, this.layer.canvas.height) : null
    if (!rect) {
      return null
    }
    return {
      rect,
      before: copyRegion(this.backup, rect),
      after: copyRegion(this.layer.canvas, rect),
    }
  }

  /** Drop the stroke and put the layer back as it was. */
  cancel() {
    const rect = this.touched ? clampRect(this.touched, this.layer.canvas.width, this.layer.canvas.height) : null
    if (!rect) return
    const context = this.layer.context
    context.clearRect(rect.x, rect.y, rect.width, rect.height)
    drawRegion(context, this.backup, rect)
  }

  /** Trace the newest piece of the stroke with midpoint smoothing so curves stay round at any speed. */
  private traceLastSegment() {
    const context = this.bufferContext
    const count = this.points.length
    const current = this.points[count - 1]
    if (!current) return

    if (count === 1) {
      context.beginPath()
      context.arc(current.x, current.y, this.widthAt(current.p) / 2, 0, Math.PI * 2)
      context.fill()
      this.markDirty(current, current)
      return
    }

    const previous = this.points[count - 2]!
    const beforePrevious = this.points[count - 3]
    const start = beforePrevious ? midpoint(beforePrevious, previous) : previous
    const end = midpoint(previous, current)
    context.lineWidth = this.widthAt((previous.p + current.p) / 2)
    context.beginPath()
    context.moveTo(start.x, start.y)
    context.quadraticCurveTo(previous.x, previous.y, end.x, end.y)
    context.stroke()
    this.markDirty(start, end, previous)
  }

  /** Midpoint smoothing stops half a segment short; close the gap to the last sample. */
  private traceTail() {
    const count = this.points.length
    if (count < 2) return
    const last = this.points[count - 1]!
    const start = midpoint(this.points[count - 2]!, last)
    this.bufferContext.lineWidth = this.widthAt(last.p)
    this.bufferContext.beginPath()
    this.bufferContext.moveTo(start.x, start.y)
    this.bufferContext.lineTo(last.x, last.y)
    this.bufferContext.stroke()
    this.markDirty(start, last)
  }

  private widthAt(pressure: number) {
    return this.style.pressure ? this.style.size * Math.max(MIN_PRESSURE_WIDTH, pressure) : this.style.size
  }

  private markDirty(...points: Array<{ x: number; y: number }>) {
    const pad = this.style.size / 2 + 2
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const point of points) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
    const rect = { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 }
    this.pending = unionRect(this.pending, rect)
    this.touched = unionRect(this.touched, rect)
  }
}

function drawRegion(context: CanvasRenderingContext2D, source: HTMLCanvasElement, rect: Rect) {
  context.drawImage(source, rect.x, rect.y, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height)
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, p: (a.p + b.p) / 2 }
}
