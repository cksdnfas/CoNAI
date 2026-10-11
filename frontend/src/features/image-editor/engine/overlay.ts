import type { TMat2D } from 'fabric'

/** Screen-space guides drawn above the stage: brush ring, selection outline, lasso trail, crop shade. */
export type OverlayScene = {
  brush: { x: number; y: number; size: number; tone: 'paint' | 'erase' | 'mask' | 'ai' } | null
  /** Region an AI erase is working on, in document pixels (dashed box). */
  busy: { x: number; y: number; width: number; height: number } | null
  /** Selection outline in document pixels (closed). */
  selection: Path2D | null
  /** Lasso trail while dragging, in document pixels. */
  lasso: Array<{ x: number; y: number }> | null
  /** Crop box in document pixels; everything outside is shaded. */
  crop: { x: number; y: number; width: number; height: number } | null
  documentSize: { width: number; height: number }
}

/** A canvas laid over Fabric's canvases that never takes pointer input. */
export class OverlayCanvas {
  readonly element: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private dashOffset = 0

  constructor(container: HTMLElement) {
    this.element = document.createElement('canvas')
    this.element.style.position = 'absolute'
    this.element.style.left = '0'
    this.element.style.top = '0'
    this.element.style.pointerEvents = 'none'
    container.appendChild(this.element)
    const context = this.element.getContext('2d')
    if (!context) throw new Error('2D canvas is not available')
    this.context = context
  }

  resize(width: number, height: number) {
    const ratio = window.devicePixelRatio || 1
    this.element.width = Math.round(width * ratio)
    this.element.height = Math.round(height * ratio)
    this.element.style.width = `${width}px`
    this.element.style.height = `${height}px`
  }

  /** Advance the marching-ants dash; returns true while something animated is on screen. */
  tick(scene: OverlayScene) {
    if (!scene.selection && !scene.busy) return false
    this.dashOffset = (this.dashOffset + 0.5) % 16
    return true
  }

  draw(scene: OverlayScene, vpt: TMat2D) {
    const ratio = window.devicePixelRatio || 1
    const context = this.context
    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, this.element.width, this.element.height)
    const zoom = vpt[0]
    const toScreen = (x: number, y: number) => ({ x: (x * vpt[0] + vpt[4]) * ratio, y: (y * vpt[3] + vpt[5]) * ratio })

    if (scene.crop) {
      const topLeft = toScreen(scene.crop.x, scene.crop.y)
      const bottomRight = toScreen(scene.crop.x + scene.crop.width, scene.crop.y + scene.crop.height)
      const docTopLeft = toScreen(0, 0)
      const docBottomRight = toScreen(scene.documentSize.width, scene.documentSize.height)
      context.save()
      context.fillStyle = 'rgba(0, 0, 0, 0.55)'
      context.beginPath()
      context.rect(docTopLeft.x, docTopLeft.y, docBottomRight.x - docTopLeft.x, docBottomRight.y - docTopLeft.y)
      context.rect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y)
      context.fill('evenodd')
      // Rule-of-thirds guides inside the kept area.
      context.strokeStyle = 'rgba(255, 255, 255, 0.35)'
      context.lineWidth = ratio
      context.beginPath()
      for (const step of [1 / 3, 2 / 3]) {
        const gx = topLeft.x + (bottomRight.x - topLeft.x) * step
        const gy = topLeft.y + (bottomRight.y - topLeft.y) * step
        context.moveTo(gx, topLeft.y)
        context.lineTo(gx, bottomRight.y)
        context.moveTo(topLeft.x, gy)
        context.lineTo(bottomRight.x, gy)
      }
      context.stroke()
      context.restore()
    }

    if (scene.selection) {
      context.save()
      context.setTransform(vpt[0] * ratio, 0, 0, vpt[3] * ratio, vpt[4] * ratio, vpt[5] * ratio)
      context.lineWidth = ratio / zoom
      context.setLineDash([4 / zoom, 4 / zoom])
      context.strokeStyle = '#000000'
      context.lineDashOffset = -this.dashOffset / zoom
      context.stroke(scene.selection)
      context.strokeStyle = '#ffffff'
      context.lineDashOffset = (-this.dashOffset + 4) / zoom
      context.stroke(scene.selection)
      context.restore()
    }

    if (scene.busy) {
      const topLeft = toScreen(scene.busy.x, scene.busy.y)
      const bottomRight = toScreen(scene.busy.x + scene.busy.width, scene.busy.y + scene.busy.height)
      context.save()
      context.lineWidth = ratio
      context.setLineDash([5 * ratio, 4 * ratio])
      context.lineDashOffset = -this.dashOffset * ratio
      context.strokeStyle = 'rgba(255, 255, 255, 0.75)'
      context.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y)
      context.restore()
    }

    if (scene.lasso && scene.lasso.length > 1) {
      context.save()
      context.lineWidth = ratio
      context.strokeStyle = '#ffffff'
      context.setLineDash([4 * ratio, 4 * ratio])
      context.beginPath()
      scene.lasso.forEach((point, index) => {
        const screen = toScreen(point.x, point.y)
        if (index === 0) context.moveTo(screen.x, screen.y)
        else context.lineTo(screen.x, screen.y)
      })
      context.stroke()
      context.restore()
    }

    if (scene.brush) {
      const center = toScreen(scene.brush.x, scene.brush.y)
      const radius = Math.max(1.5 * ratio, (scene.brush.size / 2) * zoom * ratio)
      const color = scene.brush.tone === 'mask' ? '#ff6b6b' : scene.brush.tone === 'ai' ? '#c4b5fd' : '#ffffff'
      context.save()
      context.lineWidth = 3 * ratio
      context.strokeStyle = 'rgba(0, 0, 0, 0.55)'
      context.beginPath()
      context.arc(center.x, center.y, radius, 0, Math.PI * 2)
      context.stroke()
      context.lineWidth = ratio
      context.strokeStyle = color
      if (scene.brush.tone === 'erase') context.setLineDash([4 * ratio, 3 * ratio])
      context.beginPath()
      context.arc(center.x, center.y, radius, 0, Math.PI * 2)
      context.stroke()
      context.restore()
    }

  }
}
