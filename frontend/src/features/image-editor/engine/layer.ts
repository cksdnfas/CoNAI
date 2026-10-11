import { FabricImage } from 'fabric'
import { context2d, createCanvas } from './raster'
import type { TextSpec } from './text'

export type LayerKind = 'paint' | 'mask'

/** Mask pixels are stored in this colour; alpha is the mask strength. */
export const MASK_COLOR = '#ff3b3b'
/** How strongly the mask tint shows over the picture. */
export const MASK_DISPLAY_OPACITY = 0.5

let layerSequence = 0

/** One raster layer: a document-sized canvas shown on the stage through one non-interactive FabricImage. */
export class RasterLayer {
  readonly id: string
  readonly kind: LayerKind
  name: string
  canvas: HTMLCanvasElement
  readonly image: FabricImage
  visible = true
  locked = false
  opacity = 1
  /** Bumped whenever pixels change so panels know to redraw thumbnails. */
  version = 0
  /** Set while the layer is still editable text; its pixels are always the rendered text. Painting clears it. */
  text: TextSpec | null = null
  /** Created by AI erase: later AI erases paint into it while it stays the top layer. */
  aiErase = false

  constructor(options: { kind: LayerKind; name: string; canvas: HTMLCanvasElement }) {
    layerSequence += 1
    this.id = `layer-${layerSequence}`
    this.kind = options.kind
    this.name = options.name
    this.canvas = options.canvas
    this.image = new FabricImage(options.canvas, {
      left: 0,
      top: 0,
      originX: 'left',
      originY: 'top',
      selectable: false,
      evented: false,
      hasControls: false,
      hasBorders: false,
      objectCaching: false,
      excludeFromExport: true,
    })
    this.syncImage()
  }

  static blank(kind: LayerKind, name: string, width: number, height: number) {
    return new RasterLayer({ kind, name, canvas: createCanvas(width, height) })
  }

  static fromSource(kind: LayerKind, name: string, source: CanvasImageSource, width: number, height: number) {
    const canvas = createCanvas(width, height)
    context2d(canvas).drawImage(source, 0, 0, width, height)
    return new RasterLayer({ kind, name, canvas })
  }

  /** Swap the backing canvas (crop, rotate, undo of those). */
  replaceCanvas(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.image.setElement(canvas)
    this.syncImage()
    this.touch()
  }

  touch() {
    this.version += 1
  }

  get context() {
    return context2d(this.canvas)
  }

  syncImage() {
    this.image.set({
      width: this.canvas.width,
      height: this.canvas.height,
      visible: this.visible,
      opacity: this.kind === 'mask' ? MASK_DISPLAY_OPACITY * this.opacity : this.opacity,
    })
  }
}
