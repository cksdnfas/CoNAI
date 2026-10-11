import { Canvas, FabricImage, IText, Pattern, Point, Rect as FabricRect } from 'fabric'
import { isNeutralAdjustment, NEUTRAL_ADJUSTMENTS, renderAdjusted, type Adjustments } from './adjust'
import { EditorHistory } from './history'
import { MASK_COLOR, RasterLayer } from './layer'
import { OverlayCanvas, type OverlayScene } from './overlay'
import {
  canvasBytes,
  canvasToBlob,
  clampRect,
  cloneCanvas,
  context2d,
  copyRegion,
  createCanvas,
  flipCanvas,
  loadImage,
  normalizeRect,
  putRegion,
  rotateCanvasQuarter,
  unionRect,
  type Rect,
} from './raster'
import { StrokeSession, type StrokeMode, type StrokePoint } from './stroke'
import {
  createTextObject,
  DEFAULT_TEXT_STYLE,
  ensureFont,
  fontCovers,
  renderTextSpec,
  specFromObject,
  textBounds,
  textLayerName,
  textObjectOptions,
  type TextSpec,
  type TextStyle,
} from './text'

export type EditorTool =
  | 'hand'
  | 'select'
  | 'lasso'
  | 'brush'
  | 'eraser'
  | 'ai-erase'
  | 'eyedropper'
  | 'text'
  | 'mask'
  | 'mask-eraser'
  | 'crop'

/** Runs AI erase on the server: image and mask crops in, the filled crop out. */
export type InpaintHandler = (image: Blob, mask: Blob, signal: AbortSignal) => Promise<Blob>

export type EditorNotice = 'locked' | 'no-selection' | 'empty' | 'ai-busy' | 'ai-failed'

export type CropRatio = 'free' | 'original' | '1:1' | '2:3' | '3:2' | '3:4' | '4:3' | '9:16' | '16:9'

export type EditorLayerInfo = {
  id: string
  name: string
  kind: 'paint' | 'mask' | 'floating'
  visible: boolean
  locked: boolean
  opacity: number
  version: number
  /** Still editable text. */
  text: boolean
}

export type EditorSnapshot = {
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  width: number
  height: number
  tool: EditorTool
  brushSize: number
  brushOpacity: number
  brushColor: string
  /** Paint layers and the floating piece, top first. */
  layers: EditorLayerInfo[]
  mask: EditorLayerInfo | null
  activeLayerId: string | null
  zoom: number
  canUndo: boolean
  canRedo: boolean
  dirty: boolean
  hasSelection: boolean
  floating: boolean
  cropRatio: CropRatio
  cropping: boolean
  /** Pen pressure changes the brush width. */
  pressure: boolean
  /** Text options (fill is the brush colour). */
  textStyle: TextStyle
  textEditing: boolean
  aiEraseAvailable: boolean
  aiErasing: boolean
  /** The colour adjustment being previewed, and on which layer. */
  adjust: { layerId: string; value: Adjustments } | null
}

export type EditorLoadInput = {
  sourceUrl: string
  maskUrl?: string | null
  maskEnabled: boolean
  /** Names for created layers (already translated). */
  names: { original: string; layer: string; paste: string; aiErase: string }
}

export type EditorExport = { source: Blob; mask?: Blob }

type DocPoint = { x: number; y: number }

type Selection = { path: Path2D; bounds: Rect }

type Floating = { image: FabricImage; name: string }

type TextEdit = { object: IText; layer: RasterLayer | null; previous: TextSpec | null; base: TextSpec }

type AdjustSession = { layer: RasterLayer; source: HTMLCanvasElement; rect: Rect; clip: Path2D | null; value: Adjustments; comparing: boolean }

type AiJob = { controller: AbortController; region: Rect }

/** Colour of the AI erase strokes (shown at half strength like the mask). */
const AI_MASK_COLOR = '#8b5cf6'
/** Longest side of the crop sent to AI erase; bigger areas are scaled down and back up. */
const AI_MAX_SIDE = 2048

const HISTORY_BUDGET_BYTES = 512 * 1024 * 1024
const MIN_ZOOM = 0.02
const MAX_ZOOM = 32
const CONTROL_STYLE = {
  borderColor: '#f95e14',
  cornerColor: '#ffffff',
  cornerStrokeColor: '#f95e14',
  cornerStyle: 'rect' as const,
  transparentCorners: false,
  cornerSize: 10,
  borderScaleFactor: 1.5,
  padding: 0,
}
const CROP_RATIOS: Record<Exclude<CropRatio, 'free' | 'original'>, number> = {
  '1:1': 1,
  '2:3': 2 / 3,
  '3:2': 3 / 2,
  '3:4': 3 / 4,
  '4:3': 4 / 3,
  '9:16': 9 / 16,
  '16:9': 16 / 9,
}

/**
 * The image editor document and stage. Lives outside React: pointer input never touches React state, the UI subscribes
 * to coarse snapshots (`subscribe`/`getSnapshot`) that change only on discrete edits.
 */
export class EditorEngine {
  private readonly host: HTMLElement
  private readonly canvasElement: HTMLCanvasElement
  private readonly canvas: Canvas
  private readonly overlay: OverlayCanvas
  private readonly resizeObserver: ResizeObserver
  private readonly history = new EditorHistory(HISTORY_BUDGET_BYTES)
  private readonly listeners = new Set<() => void>()
  private readonly cursorListeners = new Set<(point: DocPoint | null) => void>()
  private readonly frameListeners = new Set<() => void>()
  private readonly backdrop: FabricRect
  private snapshot: EditorSnapshot

  private width = 0
  private height = 0
  private layers: RasterLayer[] = []
  private maskLayer: RasterLayer | null = null
  private activeLayerId: string | null = null
  private tool: EditorTool = 'brush'
  private brushSize = 24
  private brushOpacity = 1
  private brushColor = '#ffffff'
  private names = { original: 'Original', layer: 'Layer', paste: 'Paste', aiErase: 'AI erase' }
  private pressureEnabled = true
  private textStyle: TextStyle = { ...DEFAULT_TEXT_STYLE }
  private textEdit: TextEdit | null = null
  private adjust: AdjustSession | null = null
  private adjustDirty = false
  private inpaintHandler: InpaintHandler | null = null
  private aiMask: RasterLayer | null = null
  private aiJob: AiJob | null = null
  private status: EditorSnapshot['status'] = 'idle'
  private error: string | null = null
  private loadToken = 0

  // Shared scratch canvases for strokes, sized to the document.
  private strokeBackup: HTMLCanvasElement | null = null
  private strokeBuffer: HTMLCanvasElement | null = null
  private stroke: { session: StrokeSession; layer: RasterLayer; pointerId: number } | null = null

  private selection: Selection | null = null
  private lassoTrail: DocPoint[] | null = null
  private dragStart: DocPoint | null = null
  private dragPointerId: number | null = null
  private floating: Floating | null = null
  private clipboard: { canvas: HTMLCanvasElement; x: number; y: number } | null = null
  private cropBox: FabricRect | null = null
  private cropRatio: CropRatio = 'free'

  private hover: DocPoint | null = null
  private spacePan = false
  private panning: { pointerId: number; last: { x: number; y: number } } | null = null
  private readonly touches = new Map<number, { x: number; y: number }>()
  private pinch: { distance: number; center: { x: number; y: number } } | null = null

  private frameRequested = false
  private stageDirty = false
  private overlayDirty = false
  private snapshotDirty = false
  private disposed = false

  constructor(host: HTMLElement) {
    this.host = host
    this.canvasElement = document.createElement('canvas')
    host.appendChild(this.canvasElement)
    const { width, height } = this.measureHost()
    this.canvas = new Canvas(this.canvasElement, {
      width,
      height,
      selection: false,
      preserveObjectStacking: true,
      enablePointerEvents: true,
      stopContextMenu: true,
      fireMiddleClick: true,
      skipTargetFind: true,
      renderOnAddRemove: false,
      backgroundColor: '#0e0e0e',
      uniformScaling: true,
    })
    this.canvas.upperCanvasEl.style.touchAction = 'none'
    this.overlay = new OverlayCanvas(this.canvas.wrapperEl)
    this.overlay.resize(width, height)

    this.backdrop = new FabricRect({
      left: 0,
      top: 0,
      originX: 'left',
      originY: 'top',
      width: 1,
      height: 1,
      selectable: false,
      evented: false,
      objectCaching: false,
      strokeWidth: 0,
      fill: new Pattern({ source: createCheckerTile(), repeat: 'repeat' }),
    })

    this.snapshot = this.buildSnapshot()
    this.attachInput()
    this.canvas.on('text:changed', () => {
      const edit = this.textEdit
      if (edit && !fontCovers(edit.base.fontFamily, edit.object.text)) this.whenFontReady(edit.base.fontFamily, edit.object.text)
      this.handleObjectMoving()
    })
    this.resizeObserver = new ResizeObserver(() => this.handleResize())
    this.resizeObserver.observe(host)
    this.applyToolCursor()
  }

  // ---------------------------------------------------------------- subscription

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.snapshot

  /** Cursor position in document pixels, throttled to frames; for the status bar only. */
  subscribeCursor(listener: (point: DocPoint | null) => void) {
    this.cursorListeners.add(listener)
    return () => {
      this.cursorListeners.delete(listener)
    }
  }

  /** Called after every redraw of the stage or overlay; for UI pinned to stage objects (floating piece actions). */
  subscribeFrame(listener: () => void) {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  /** Bounds of the floating piece or the text being edited, in stage (CSS pixel) coordinates. */
  floatingScreenBox() {
    const object = this.floating?.image ?? this.textEdit?.object
    if (!object) return null
    const box = object.getBoundingRect()
    return this.toScreenBox({ x: box.left, y: box.top, width: box.width, height: box.height })
  }

  /** The area an AI erase is working on, in stage coordinates. */
  aiEraseScreenBox() {
    return this.aiJob ? this.toScreenBox(this.aiJob.region) : null
  }

  private toScreenBox(rect: Rect) {
    const vpt = this.canvas.viewportTransform
    return {
      left: rect.x * vpt[0] + vpt[4],
      top: rect.y * vpt[3] + vpt[5],
      right: (rect.x + rect.width) * vpt[0] + vpt[4],
      bottom: (rect.y + rect.height) * vpt[3] + vpt[5],
    }
  }

  private buildSnapshot(): EditorSnapshot {
    const info = (layer: RasterLayer): EditorLayerInfo => ({
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      version: layer.version,
      text: Boolean(layer.text),
    })
    const layers = [...this.layers].reverse().map(info)
    if (this.floating) {
      layers.unshift({ id: 'floating', name: this.floating.name, kind: 'floating', visible: true, locked: false, opacity: 1, version: 0, text: false })
    }
    const style = this.textEdit?.base ?? this.textStyle
    return {
      status: this.status,
      error: this.error,
      width: this.width,
      height: this.height,
      tool: this.tool,
      brushSize: this.brushSize,
      brushOpacity: this.brushOpacity,
      brushColor: this.brushColor,
      layers,
      mask: this.maskLayer ? info(this.maskLayer) : null,
      activeLayerId: this.activeLayerId,
      zoom: this.zoom,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      dirty: this.history.dirty,
      hasSelection: Boolean(this.selection),
      floating: Boolean(this.floating),
      cropRatio: this.cropRatio,
      cropping: Boolean(this.cropBox),
      pressure: this.pressureEnabled,
      textStyle: {
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,
        bold: style.bold,
        italic: style.italic,
        align: style.align,
        strokeWidth: style.strokeWidth,
        stroke: style.stroke,
      },
      textEditing: Boolean(this.textEdit),
      aiEraseAvailable: Boolean(this.inpaintHandler),
      aiErasing: Boolean(this.aiJob),
      adjust: this.adjust ? { layerId: this.adjust.layer.id, value: this.adjust.value } : null,
    }
  }

  private emit() {
    this.snapshotDirty = true
    this.requestFrame()
  }

  // ---------------------------------------------------------------- lifecycle

  async load(input: EditorLoadInput) {
    const token = ++this.loadToken
    this.names = input.names
    this.status = 'loading'
    this.error = null
    this.emit()
    try {
      const source = await loadImage(input.sourceUrl)
      const maskSource = input.maskEnabled && input.maskUrl ? await loadImage(input.maskUrl) : null
      if (token !== this.loadToken || this.disposed) return

      const width = source.naturalWidth
      const height = source.naturalHeight
      this.resetDocument(width, height)
      const original = RasterLayer.fromSource('paint', this.names.original, source, width, height)
      original.locked = true
      original.syncImage()
      const first = RasterLayer.blank('paint', `${this.names.layer} 1`, width, height)
      this.layers = [original, first]
      this.activeLayerId = first.id
      this.maskLayer = input.maskEnabled ? createMaskLayer(width, height, maskSource) : null
      this.restack()
      this.fitToView()
      this.status = 'ready'
    } catch (error) {
      if (token !== this.loadToken) return
      this.status = 'error'
      this.error = error instanceof Error ? error.message : String(error)
    }
    this.emit()
  }

  dispose() {
    this.disposed = true
    this.aiJob?.controller.abort()
    this.aiJob = null
    this.resizeObserver.disconnect()
    this.detachInput()
    void this.canvas.dispose()
    this.overlay.element.remove()
    this.listeners.clear()
    this.cursorListeners.clear()
    this.frameListeners.clear()
  }

  private resetDocument(width: number, height: number) {
    this.cancelStroke()
    this.discardFloating()
    this.cancelTextEdit()
    this.cancelAiErase()
    this.cancelAdjust()
    this.dropAiMask()
    this.endCrop()
    this.selection = null
    this.history.clear()
    this.width = width
    this.height = height
    this.strokeBackup = createCanvas(width, height)
    this.strokeBuffer = createCanvas(width, height)
    this.backdrop.set({ width, height })
  }

  // ---------------------------------------------------------------- tools and brush

  setTool(tool: EditorTool) {
    if (tool === this.tool) return
    if ((tool === 'mask' || tool === 'mask-eraser') && !this.maskLayer) return
    if (tool === 'ai-erase' && !this.inpaintHandler) return
    if (tool !== 'crop') this.endCrop()
    this.commitFloating()
    this.commitTextEdit()
    this.commitAdjust()
    this.tool = tool
    if (tool === 'crop') this.beginCrop()
    this.applyToolCursor()
    this.overlayDirty = true
    this.emit()
  }

  setBrushSize(size: number) {
    this.brushSize = Math.max(1, Math.min(1000, Math.round(size)))
    this.overlayDirty = true
    this.emit()
  }

  setBrushOpacity(opacity: number) {
    this.brushOpacity = Math.max(0.01, Math.min(1, opacity))
    this.emit()
  }

  setBrushColor(color: string) {
    this.brushColor = color
    const edit = this.textEdit
    if (edit) {
      edit.base = { ...edit.base, fill: color }
      this.applyTextBase(edit)
    }
    this.emit()
  }

  setPressure(enabled: boolean) {
    this.pressureEnabled = enabled
    this.emit()
  }

  /** AI erase becomes available once a handler is set (the caller decides who may use it). */
  setInpaintHandler(handler: InpaintHandler | null) {
    this.inpaintHandler = handler
    if (!handler && this.tool === 'ai-erase') this.setTool('brush')
    this.emit()
  }

  /** Change text options; the text being edited follows. */
  setTextStyle(patch: Partial<TextStyle>) {
    this.textStyle = { ...this.textStyle, ...patch }
    const edit = this.textEdit
    if (edit) {
      edit.base = { ...edit.base, ...patch }
      this.applyTextBase(edit)
    }
    if (patch.fontFamily) this.whenFontReady(patch.fontFamily, this.textEdit?.object.text)
    this.emit()
  }

  /** Space held: drag pans whatever the tool is. */
  setSpacePan(active: boolean) {
    if (this.spacePan === active) return
    this.spacePan = active
    this.applyToolCursor()
  }

  private get isBrushTool() {
    return this.tool === 'brush' || this.tool === 'eraser' || this.tool === 'ai-erase' || this.tool === 'mask' || this.tool === 'mask-eraser'
  }

  private applyToolCursor() {
    const element = this.canvas.upperCanvasEl
    let cursor = 'default'
    if (this.spacePan || this.tool === 'hand') cursor = this.panning ? 'grabbing' : 'grab'
    else if (this.isBrushTool) cursor = 'none'
    else if (this.tool === 'eyedropper' || this.tool === 'select' || this.tool === 'lasso' || this.tool === 'crop') cursor = 'crosshair'
    else if (this.tool === 'text') cursor = 'text'
    element.style.cursor = cursor
    this.canvas.defaultCursor = cursor
    this.canvas.hoverCursor = this.floating || this.cropBox || this.textEdit ? 'move' : cursor
    // Fabric only looks for targets while a floating piece, the crop box or edited text is on stage.
    this.canvas.skipTargetFind = !(this.floating || this.cropBox || this.textEdit)
  }

  // ---------------------------------------------------------------- viewport

  get zoom() {
    return this.canvas.viewportTransform[0]
  }

  fitToView() {
    if (!this.width || !this.height) return
    const { width, height } = this.measureHost()
    const zoom = clampZoom(Math.min((width * 0.9) / this.width, (height * 0.9) / this.height))
    this.canvas.setViewportTransform([zoom, 0, 0, zoom, (width - this.width * zoom) / 2, (height - this.height * zoom) / 2])
    this.afterViewportChange()
  }

  zoomTo(zoom: number, around?: { x: number; y: number }) {
    const { width, height } = this.measureHost()
    const point = around ?? { x: width / 2, y: height / 2 }
    this.canvas.zoomToPoint(new Point(point.x, point.y), clampZoom(zoom))
    this.afterViewportChange()
  }

  zoomBy(factor: number, around?: { x: number; y: number }) {
    this.zoomTo(this.zoom * factor, around)
  }

  private panBy(dx: number, dy: number) {
    this.canvas.relativePan(new Point(dx, dy))
    this.afterViewportChange()
  }

  private afterViewportChange() {
    const zoom = this.zoom
    const fill = this.backdrop.fill
    if (fill instanceof Pattern) {
      fill.patternTransform = [1 / zoom, 0, 0, 1 / zoom, 0, 0]
    }
    const smooth = zoom < 2
    for (const layer of this.allLayers()) {
      layer.image.imageSmoothing = smooth
    }
    if (this.floating) this.floating.image.imageSmoothing = smooth
    if (this.aiMask) this.aiMask.image.imageSmoothing = smooth
    this.stageDirty = true
    this.overlayDirty = true
    this.emit()
  }

  private measureHost() {
    return { width: Math.max(1, this.host.clientWidth), height: Math.max(1, this.host.clientHeight) }
  }

  private handleResize() {
    const { width, height } = this.measureHost()
    const previous = { width: this.canvas.width, height: this.canvas.height }
    this.canvas.setDimensions({ width, height })
    this.overlay.resize(width, height)
    // Keep the picture centred where it was.
    this.canvas.relativePan(new Point((width - previous.width) / 2, (height - previous.height) / 2))
    this.afterViewportChange()
  }

  // ---------------------------------------------------------------- frame loop

  private requestFrame() {
    if (this.frameRequested || this.disposed) return
    this.frameRequested = true
    requestAnimationFrame(() => this.frame())
  }

  private frame() {
    this.frameRequested = false
    if (this.disposed) return
    if (this.stroke && this.stroke.session.flush()) {
      this.stageDirty = true
    }
    if (this.adjustDirty) {
      this.adjustDirty = false
      this.renderAdjustPreview()
    }
    let redrawn = false
    if (this.stageDirty) {
      this.stageDirty = false
      this.canvas.renderAll()
      redrawn = true
    }
    const scene = this.overlayScene()
    if (this.overlay.tick(scene)) {
      this.overlayDirty = true
      this.requestFrame()
    }
    if (this.overlayDirty) {
      this.overlayDirty = false
      this.overlay.draw(scene, this.canvas.viewportTransform)
      for (const listener of this.cursorListeners) listener(this.hover)
      redrawn = true
    }
    if (redrawn) {
      for (const listener of this.frameListeners) listener()
    }
    if (this.snapshotDirty) {
      this.snapshotDirty = false
      this.snapshot = this.buildSnapshot()
      for (const listener of this.listeners) listener()
    }
  }

  private overlayScene(): OverlayScene {
    const showBrush = this.hover && this.isBrushTool && !this.spacePan && !this.panning && !this.pinch
    return {
      brush: showBrush && this.hover
        ? {
            x: this.hover.x,
            y: this.hover.y,
            size: this.brushSize,
            tone: this.tool === 'mask' || this.tool === 'mask-eraser' ? 'mask' : this.tool === 'ai-erase' ? 'ai' : this.tool === 'eraser' ? 'erase' : 'paint',
          }
        : null,
      busy: this.aiJob?.region ?? null,
      selection: this.selection?.path ?? null,
      lasso: this.lassoTrail,
      crop: this.cropBox ? this.cropRect() : null,
      documentSize: { width: this.width, height: this.height },
    }
  }

  // ---------------------------------------------------------------- input

  private readonly onPointerDown = (event: PointerEvent) => this.handlePointerDown(event)
  private readonly onPointerMove = (event: PointerEvent) => this.handlePointerMove(event)
  private readonly onPointerUp = (event: PointerEvent) => this.handlePointerUp(event, false)
  private readonly onPointerCancel = (event: PointerEvent) => this.handlePointerUp(event, true)
  private readonly onPointerLeave = () => {
    this.hover = null
    this.overlayDirty = true
    this.requestFrame()
  }
  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault()
    const point = this.viewportPoint(event)
    if (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      this.panBy(-event.deltaX, 0)
      return
    }
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY
    this.zoomBy(Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.0015)), point)
  }

  private attachInput() {
    const element = this.canvas.upperCanvasEl
    element.addEventListener('pointerdown', this.onPointerDown)
    element.addEventListener('pointermove', this.onPointerMove)
    element.addEventListener('pointerup', this.onPointerUp)
    element.addEventListener('pointercancel', this.onPointerCancel)
    element.addEventListener('pointerleave', this.onPointerLeave)
    element.addEventListener('wheel', this.onWheel, { passive: false })
    this.canvas.on('object:modified', () => this.handleObjectModified())
    this.canvas.on('object:moving', () => this.handleObjectMoving())
    this.canvas.on('object:scaling', () => this.handleObjectMoving())
    this.canvas.on('object:rotating', () => this.handleObjectMoving())
    // Clicking beside the floating piece or crop box must not hide its handles.
    this.canvas.on('selection:cleared', () => {
      const keep = this.floating?.image ?? this.cropBox
      if (!keep) return
      this.canvas.setActiveObject(keep)
      this.stageDirty = true
      this.requestFrame()
    })
  }

  private detachInput() {
    const element = this.canvas.upperCanvasEl
    element.removeEventListener('pointerdown', this.onPointerDown)
    element.removeEventListener('pointermove', this.onPointerMove)
    element.removeEventListener('pointerup', this.onPointerUp)
    element.removeEventListener('pointercancel', this.onPointerCancel)
    element.removeEventListener('pointerleave', this.onPointerLeave)
    element.removeEventListener('wheel', this.onWheel)
  }

  private viewportPoint(event: MouseEvent) {
    const bounds = this.canvas.upperCanvasEl.getBoundingClientRect()
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
  }

  private docPoint(event: MouseEvent): DocPoint {
    const point = this.viewportPoint(event)
    const vpt = this.canvas.viewportTransform
    return { x: (point.x - vpt[4]) / vpt[0], y: (point.y - vpt[5]) / vpt[3] }
  }

  /** Stroke sample: document point plus pen pressure (mouse and touch press at full strength). */
  private strokePoint(event: PointerEvent): StrokePoint {
    const point = this.docPoint(event)
    return { ...point, p: event.pointerType === 'pen' ? event.pressure : 1 }
  }

  private handlePointerDown(event: PointerEvent) {
    if (this.status !== 'ready') return
    if (event.pointerType === 'touch') {
      this.touches.set(event.pointerId, this.viewportPoint(event))
      if (this.touches.size >= 2) {
        // A second finger turns whatever started into a pinch.
        this.cancelStroke()
        this.cancelDrag()
        this.startPinch()
        return
      }
    }

    const wantsPan = event.button === 1 || this.spacePan || this.tool === 'hand'
    if (wantsPan) {
      event.preventDefault()
      this.capture(event)
      this.panning = { pointerId: event.pointerId, last: this.viewportPoint(event) }
      this.applyToolCursor()
      return
    }
    if (event.button !== 0 && event.pointerType === 'mouse') return

    // Fabric owns pointer input on the floating piece, the crop box and the text being edited.
    // (Fabric's own listener ran first: a started transform or a hit on the object means it is Fabric's drag.)
    if ((this.floating || this.cropBox || this.textEdit) && (this.canvas._currentTransform || this.canvas.findTarget(event).target)) return

    const point = this.docPoint(event)
    if (this.tool === 'text') {
      this.handleTextPointer(point)
      return
    }
    if (this.textEdit) {
      this.commitTextEdit()
    }
    if (this.tool === 'eyedropper' || (event.altKey && (this.tool === 'brush' || this.tool === 'eraser'))) {
      this.pickColor(point)
      return
    }
    if (this.isBrushTool) {
      this.beginStroke(event)
      return
    }
    if (this.tool === 'select' || this.tool === 'lasso' || this.tool === 'crop') {
      this.capture(event)
      this.dragStart = point
      this.dragPointerId = event.pointerId
      if (this.tool === 'lasso') this.lassoTrail = [point]
    }
  }

  private handlePointerMove(event: PointerEvent) {
    if (event.pointerType === 'touch' && this.touches.has(event.pointerId)) {
      this.touches.set(event.pointerId, this.viewportPoint(event))
      if (this.pinch) {
        this.updatePinch()
        return
      }
    }
    if (this.panning && this.panning.pointerId === event.pointerId) {
      const point = this.viewportPoint(event)
      this.panBy(point.x - this.panning.last.x, point.y - this.panning.last.y)
      this.panning.last = point
      return
    }

    this.hover = this.docPoint(event)
    this.overlayDirty = true

    if (this.stroke && this.stroke.pointerId === event.pointerId) {
      const samples = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : []
      this.stroke.session.addPoints((samples.length > 0 ? samples : [event]).map((sample) => this.strokePoint(sample)))
    } else if (this.dragStart && this.dragPointerId === event.pointerId) {
      this.updateDrag(this.hover, event.shiftKey)
    }
    this.requestFrame()
  }

  private handlePointerUp(event: PointerEvent, cancelled: boolean) {
    if (event.pointerType === 'touch') {
      this.touches.delete(event.pointerId)
      if (this.pinch) {
        if (this.touches.size < 2) this.pinch = null
        return
      }
    }
    if (this.panning && this.panning.pointerId === event.pointerId) {
      this.panning = null
      this.applyToolCursor()
      return
    }
    if (this.stroke && this.stroke.pointerId === event.pointerId) {
      if (cancelled) this.cancelStroke()
      else this.endStroke()
      return
    }
    if (this.dragStart && this.dragPointerId === event.pointerId) {
      if (cancelled) this.cancelDrag()
      else this.endDrag(this.docPoint(event), event.shiftKey)
    }
  }

  private capture(event: PointerEvent) {
    try {
      this.canvas.upperCanvasEl.setPointerCapture(event.pointerId)
    } catch {
      // The pointer can already be gone on a very short tap.
    }
  }

  private startPinch() {
    const [a, b] = [...this.touches.values()]
    if (!a || !b) return
    this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } }
  }

  private updatePinch() {
    const [a, b] = [...this.touches.values()]
    if (!a || !b || !this.pinch) return
    const distance = Math.hypot(a.x - b.x, a.y - b.y)
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    this.canvas.relativePan(new Point(center.x - this.pinch.center.x, center.y - this.pinch.center.y))
    if (this.pinch.distance > 0) {
      this.canvas.zoomToPoint(new Point(center.x, center.y), clampZoom(this.zoom * (distance / this.pinch.distance)))
    }
    this.pinch = { distance, center }
    this.afterViewportChange()
  }

  // ---------------------------------------------------------------- strokes

  private strokeTarget(): RasterLayer | null {
    if (this.tool === 'mask' || this.tool === 'mask-eraser') return this.maskLayer
    if (this.tool === 'ai-erase') return this.ensureAiMask()
    const layer = this.activeLayer()
    if (!layer || layer.locked || !layer.visible) return null
    return layer
  }

  private beginStroke(event: PointerEvent) {
    if (this.tool === 'ai-erase' && this.aiJob) {
      this.emitNotice('ai-busy')
      return
    }
    this.commitAdjust()
    const layer = this.strokeTarget()
    if (!layer || !this.strokeBackup || !this.strokeBuffer) {
      this.emitNotice('locked')
      return
    }
    this.rasterizeText(layer)
    this.capture(event)
    const mode: StrokeMode = this.tool === 'eraser' || this.tool === 'mask-eraser' ? 'erase' : 'paint'
    const aiErase = layer === this.aiMask
    const session = new StrokeSession(
      layer,
      {
        mode,
        color: aiErase ? AI_MASK_COLOR : layer.kind === 'mask' ? MASK_COLOR : this.brushColor,
        size: this.brushSize,
        opacity: aiErase ? 1 : this.brushOpacity,
        pressure: this.pressureEnabled && !aiErase,
      },
      this.strokeBackup,
      this.strokeBuffer,
    )
    session.addPoints([this.strokePoint(event)])
    this.stroke = { session, layer, pointerId: event.pointerId }
    this.requestFrame()
  }

  private endStroke() {
    const stroke = this.stroke
    if (!stroke) return
    this.stroke = null
    const result = stroke.session.finish()
    this.stageDirty = true
    if (stroke.layer === this.aiMask) {
      // AI erase strokes are a request, not an edit: they leave no history and clear when the result lands.
      stroke.layer.touch()
      if (result) void this.runAiErase(result.rect)
    } else if (result) {
      this.pushRasterPatch(stroke.layer, result.rect, result.before, result.after)
    }
    this.requestFrame()
  }

  private cancelStroke() {
    if (!this.stroke) return
    this.stroke.session.cancel()
    this.stroke = null
    this.stageDirty = true
    this.requestFrame()
  }

  private pushRasterPatch(layer: RasterLayer, rect: Rect, before: HTMLCanvasElement, after: HTMLCanvasElement) {
    layer.touch()
    this.history.push({
      bytes: canvasBytes(before) + canvasBytes(after),
      undo: () => {
        putRegion(layer.canvas, before, rect)
        layer.touch()
      },
      redo: () => {
        putRegion(layer.canvas, after, rect)
        layer.touch()
      },
    })
    this.emit()
  }

  /** Record an edit whose pixels were already changed in `rect`, given the region's previous pixels. */
  private commitRegionEdit(layer: RasterLayer, rect: Rect, before: HTMLCanvasElement) {
    this.pushRasterPatch(layer, rect, before, copyRegion(layer.canvas, rect))
    this.stageDirty = true
  }

  // ---------------------------------------------------------------- notices

  private readonly noticeListeners = new Set<(notice: EditorNotice, detail?: string) => void>()

  onNotice(listener: (notice: EditorNotice, detail?: string) => void) {
    this.noticeListeners.add(listener)
    return () => {
      this.noticeListeners.delete(listener)
    }
  }

  private emitNotice(notice: EditorNotice, detail?: string) {
    for (const listener of this.noticeListeners) listener(notice, detail)
  }

  // ---------------------------------------------------------------- eyedropper

  private pickColor(point: DocPoint) {
    const x = Math.floor(point.x)
    const y = Math.floor(point.y)
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return
    const probe = createCanvas(1, 1)
    const context = probe.getContext('2d', { willReadFrequently: true })
    if (!context) return
    for (const layer of this.layers) {
      if (!layer.visible) continue
      context.globalAlpha = layer.opacity
      context.drawImage(layer.canvas, x, y, 1, 1, 0, 0, 1, 1)
    }
    const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data
    if (a === 0) return
    this.setBrushColor(`#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`)
  }

  // ---------------------------------------------------------------- drag tools (select, lasso, crop)

  private updateDrag(point: DocPoint, constrain: boolean) {
    if (!this.dragStart) return
    if (this.tool === 'lasso' && this.lassoTrail) {
      this.lassoTrail.push(point)
      return
    }
    const rect = this.dragRect(this.dragStart, point, constrain)
    if (this.tool === 'select') {
      this.setSelectionRect(rect, false)
    } else if (this.tool === 'crop' && this.cropBox) {
      this.setCropRect(rect)
    }
  }

  private endDrag(point: DocPoint, constrain: boolean) {
    const start = this.dragStart
    this.dragStart = null
    this.dragPointerId = null
    if (!start) return
    const moved = Math.hypot(point.x - start.x, point.y - start.y) * this.zoom > 3
    if (this.tool === 'lasso') {
      const trail = this.lassoTrail ?? []
      this.lassoTrail = null
      if (moved && trail.length > 2) this.setSelectionPath(trail)
      else this.clearSelection()
    } else if (this.tool === 'select') {
      if (moved) this.setSelectionRect(this.dragRect(start, point, constrain), true)
      else this.clearSelection()
    } else if (this.tool === 'crop' && this.cropBox) {
      if (moved) this.setCropRect(this.dragRect(start, point, constrain))
    }
    this.overlayDirty = true
    this.emit()
  }

  private cancelDrag() {
    this.dragStart = null
    this.dragPointerId = null
    this.lassoTrail = null
    this.overlayDirty = true
    this.requestFrame()
  }

  private dragRect(start: DocPoint, end: DocPoint, constrain: boolean): Rect {
    let width = end.x - start.x
    let height = end.y - start.y
    const ratio = this.tool === 'crop' ? this.cropAspect() : constrain ? 1 : null
    if (ratio) {
      if (Math.abs(width) / ratio > Math.abs(height)) height = Math.sign(height || 1) * Math.abs(width) / ratio
      else width = Math.sign(width || 1) * Math.abs(height) * ratio
    }
    const rect = normalizeRect({ x: start.x, y: start.y, width, height })
    return clampRect(rect, this.width, this.height) ?? { x: 0, y: 0, width: 0, height: 0 }
  }

  // ---------------------------------------------------------------- selection

  private setSelectionRect(rect: Rect, final: boolean) {
    const clamped = clampRect(rect, this.width, this.height)
    if (!clamped || (final && (clamped.width < 1 || clamped.height < 1))) {
      if (final) this.selection = null
      this.overlayDirty = true
      return
    }
    const path = new Path2D()
    path.rect(clamped.x, clamped.y, clamped.width, clamped.height)
    this.selection = { path, bounds: clamped }
    this.overlayDirty = true
    if (final) this.emit()
  }

  private setSelectionPath(points: DocPoint[]) {
    const path = new Path2D()
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    points.forEach((point, index) => {
      if (index === 0) path.moveTo(point.x, point.y)
      else path.lineTo(point.x, point.y)
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    })
    path.closePath()
    const bounds = clampRect({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, this.width, this.height)
    this.selection = bounds ? { path, bounds } : null
    this.emit()
  }

  selectAll() {
    if (this.status !== 'ready') return
    this.setSelectionRect({ x: 0, y: 0, width: this.width, height: this.height }, true)
  }

  clearSelection() {
    if (!this.selection) return
    this.selection = null
    this.overlayDirty = true
    this.emit()
  }

  /** The layer selection commands act on: the mask while a mask tool is active, else the active paint layer. */
  private selectionTarget() {
    if ((this.tool === 'mask' || this.tool === 'mask-eraser') && this.maskLayer) return this.maskLayer
    return this.activeLayer()
  }

  /** Erase the selected pixels of the target layer. */
  deleteSelection() {
    const selection = this.selection
    const layer = this.selectionTarget()
    if (!selection) return this.emitNotice('no-selection')
    if (!layer || layer.locked) return this.emitNotice('locked')
    this.commitAdjust()
    this.rasterizeText(layer)
    const before = copyRegion(layer.canvas, selection.bounds)
    const context = layer.context
    context.save()
    context.globalCompositeOperation = 'destination-out'
    context.fill(selection.path)
    context.restore()
    this.commitRegionEdit(layer, selection.bounds, before)
  }

  /** Paint the selection into the mask (or clear it from the mask). */
  fillMaskFromSelection(clear = false) {
    const selection = this.selection
    const mask = this.maskLayer
    if (!selection) return this.emitNotice('no-selection')
    if (!mask) return
    const before = copyRegion(mask.canvas, selection.bounds)
    const context = mask.context
    context.save()
    context.globalCompositeOperation = clear ? 'destination-out' : 'source-over'
    context.fillStyle = MASK_COLOR
    context.fill(selection.path)
    context.restore()
    this.commitRegionEdit(mask, selection.bounds, before)
  }

  invertMask() {
    const mask = this.maskLayer
    if (!mask) return
    const before = cloneCanvas(mask.canvas)
    const inverted = createCanvas(this.width, this.height)
    const context = context2d(inverted)
    context.fillStyle = MASK_COLOR
    context.fillRect(0, 0, this.width, this.height)
    context.globalCompositeOperation = 'destination-out'
    context.drawImage(mask.canvas, 0, 0)
    putRegion(mask.canvas, inverted, { x: 0, y: 0, width: this.width, height: this.height })
    this.commitRegionEdit(mask, { x: 0, y: 0, width: this.width, height: this.height }, before)
  }

  clearMask() {
    const mask = this.maskLayer
    if (!mask) return
    const rect = { x: 0, y: 0, width: this.width, height: this.height }
    const before = cloneCanvas(mask.canvas)
    mask.context.clearRect(0, 0, this.width, this.height)
    this.commitRegionEdit(mask, rect, before)
  }

  /** Copy the selected pixels of the active layer (or the whole layer without a selection). */
  copySelection() {
    const layer = this.activeLayer()
    if (!layer) return null
    const bounds = this.selection?.bounds ?? { x: 0, y: 0, width: this.width, height: this.height }
    const piece = createCanvas(bounds.width, bounds.height)
    const context = context2d(piece)
    if (this.selection) {
      context.translate(-bounds.x, -bounds.y)
      context.clip(this.selection.path)
      context.drawImage(layer.canvas, 0, 0)
    } else {
      context.drawImage(layer.canvas, 0, 0)
    }
    this.clipboard = { canvas: piece, x: bounds.x, y: bounds.y }
    return piece
  }

  cutSelection() {
    if (!this.selection) {
      this.emitNotice('no-selection')
      return null
    }
    const layer = this.activeLayer()
    if (!layer || layer.locked) {
      this.emitNotice('locked')
      return null
    }
    const piece = this.copySelection()
    this.deleteSelection()
    return piece
  }

  /** Paste what this editor copied last, at the place it came from. */
  pasteInternal() {
    if (!this.clipboard) return false
    this.startFloating(this.clipboard.canvas, { x: this.clipboard.x, y: this.clipboard.y })
    return true
  }

  /** Paste an outside image (clipboard file, drop) as a floating piece fitted inside the document. */
  async pasteImage(source: Blob | string) {
    if (this.status !== 'ready') return
    const url = typeof source === 'string' ? source : URL.createObjectURL(source)
    try {
      const image = await loadImage(url)
      const scale = Math.min(1, (this.width * 0.9) / image.naturalWidth, (this.height * 0.9) / image.naturalHeight)
      const piece = createCanvas(image.naturalWidth * scale, image.naturalHeight * scale)
      const context = context2d(piece)
      context.imageSmoothingQuality = 'high'
      context.drawImage(image, 0, 0, piece.width, piece.height)
      this.startFloating(piece, { x: (this.width - piece.width) / 2, y: (this.height - piece.height) / 2 })
    } finally {
      if (typeof source !== 'string') URL.revokeObjectURL(url)
    }
  }

  // ---------------------------------------------------------------- floating piece

  private startFloating(piece: HTMLCanvasElement, at: DocPoint) {
    this.commitFloating()
    this.commitTextEdit()
    this.commitAdjust()
    this.endCrop()
    const pasteCount = this.layers.filter((layer) => layer.name.startsWith(this.names.paste)).length + 1
    const image = new FabricImage(piece, {
      left: at.x + piece.width / 2,
      top: at.y + piece.height / 2,
      originX: 'center',
      originY: 'center',
      objectCaching: false,
      lockScalingFlip: true,
      imageSmoothing: this.zoom < 2,
      ...CONTROL_STYLE,
    })
    image.setControlVisible('mtr', true)
    this.floating = { image, name: `${this.names.paste} ${pasteCount}` }
    this.canvas.add(image)
    this.canvas.setActiveObject(image)
    this.applyToolCursor()
    this.stageDirty = true
    this.emit()
  }

  /** Bake the floating piece into a new layer above the active one. */
  commitFloating() {
    const floating = this.floating
    if (!floating) return
    this.floating = null
    this.canvas.discardActiveObject()
    this.canvas.remove(floating.image)
    const layer = RasterLayer.blank('paint', floating.name, this.width, this.height)
    const context = layer.context
    const [a, b, c, d, e, f] = floating.image.calcTransformMatrix()
    context.setTransform(a, b, c, d, e, f)
    context.imageSmoothingQuality = 'high'
    const element = floating.image.getElement()
    context.drawImage(element, -element.width / 2, -element.height / 2)
    context.setTransform(1, 0, 0, 1, 0, 0)
    this.insertLayer(layer, this.activeIndex() + 1)
    this.applyToolCursor()
  }

  discardFloating() {
    const floating = this.floating
    if (!floating) return
    this.floating = null
    this.canvas.discardActiveObject()
    this.canvas.remove(floating.image)
    this.applyToolCursor()
    this.stageDirty = true
    this.emit()
  }

  private handleObjectMoving() {
    this.overlayDirty = true
    this.requestFrame()
  }

  private handleObjectModified() {
    if (this.cropBox) this.normalizeCropBox()
    this.overlayDirty = true
    this.emit()
  }

  // ---------------------------------------------------------------- crop

  private beginCrop() {
    const initial = this.selection?.bounds ?? { x: 0, y: 0, width: this.width, height: this.height }
    this.cropBox = new FabricRect({
      left: initial.x,
      top: initial.y,
      width: initial.width,
      height: initial.height,
      originX: 'left',
      originY: 'top',
      fill: 'rgba(0,0,0,0)',
      stroke: '#ffffff',
      strokeWidth: 0,
      lockRotation: true,
      lockScalingFlip: true,
      objectCaching: false,
      ...CONTROL_STYLE,
      borderColor: '#ffffff',
      cornerStrokeColor: '#ffffff',
      cornerColor: '#ffffff',
    })
    this.cropBox.setControlVisible('mtr', false)
    this.canvas.add(this.cropBox)
    this.canvas.setActiveObject(this.cropBox)
    this.applyCropRatioToBox()
    this.applyToolCursor()
    this.stageDirty = true
    this.overlayDirty = true
  }

  private endCrop() {
    const box = this.cropBox
    if (!box) return
    this.cropBox = null
    this.canvas.discardActiveObject()
    this.canvas.remove(box)
    this.applyToolCursor()
    this.stageDirty = true
    this.overlayDirty = true
    this.emit()
  }

  setCropRatio(ratio: CropRatio) {
    this.cropRatio = ratio
    this.applyCropRatioToBox()
    this.emit()
  }

  private cropAspect() {
    if (this.cropRatio === 'free') return null
    if (this.cropRatio === 'original') return this.width / this.height
    return CROP_RATIOS[this.cropRatio]
  }

  private cropRect(): Rect {
    const box = this.cropBox
    if (!box) return { x: 0, y: 0, width: this.width, height: this.height }
    return {
      x: box.left,
      y: box.top,
      width: box.width * box.scaleX,
      height: box.height * box.scaleY,
    }
  }

  private setCropRect(rect: Rect) {
    if (!this.cropBox || rect.width < 1 || rect.height < 1) return
    this.cropBox.set({ left: rect.x, top: rect.y, width: rect.width, height: rect.height, scaleX: 1, scaleY: 1 })
    this.cropBox.setCoords()
    this.stageDirty = true
    this.overlayDirty = true
  }

  /** Fold scaling into width/height and keep the box inside the document. */
  private normalizeCropBox() {
    const rect = clampRect(this.cropRect(), this.width, this.height)
    if (rect) this.setCropRect(rect)
  }

  private applyCropRatioToBox() {
    const box = this.cropBox
    if (!box) return
    const aspect = this.cropAspect()
    const sides = aspect === null
    box.setControlsVisibility({ mt: sides, mb: sides, ml: sides, mr: sides })
    if (aspect === null) {
      this.stageDirty = true
      this.requestFrame()
      return
    }
    const current = this.cropRect()
    let width = current.width
    let height = width / aspect
    if (height > current.height) {
      height = current.height
      width = height * aspect
    }
    this.setCropRect({ x: current.x + (current.width - width) / 2, y: current.y + (current.height - height) / 2, width, height })
    this.requestFrame()
  }

  applyCrop() {
    const rect = this.cropBox ? clampRect(this.cropRect(), this.width, this.height) : null
    if (!rect) return
    this.endCrop()
    this.transformDocument(rect.width, rect.height, (canvas) => copyRegion(canvas, rect))
    this.tool = 'brush'
    this.applyToolCursor()
    this.emit()
  }

  cancelCrop() {
    this.endCrop()
    this.tool = 'brush'
    this.applyToolCursor()
    this.emit()
  }

  // ---------------------------------------------------------------- whole-document transforms

  rotate(clockwise = true) {
    this.transformDocument(this.height, this.width, (canvas) => rotateCanvasQuarter(canvas, clockwise))
  }

  flip(axis: 'x' | 'y') {
    this.transformDocument(this.width, this.height, (canvas) => flipCanvas(canvas, axis))
  }

  /** Replace every layer's pixels through `map`; one undo step restores all of them. */
  private transformDocument(nextWidth: number, nextHeight: number, map: (canvas: HTMLCanvasElement) => HTMLCanvasElement) {
    if (this.status !== 'ready') return
    this.commitFloating()
    this.commitTextEdit()
    this.commitAdjust()
    this.cancelAiErase()
    this.cancelStroke()
    this.selection = null
    const targets = this.allLayers()
    const before = targets.map((layer) => layer.canvas)
    const after = targets.map((layer) => map(layer.canvas))
    // Text moves with the pixels, so it stops being editable text (undo brings it back).
    const texts = targets.map((layer) => layer.text)
    const previous = { width: this.width, height: this.height }
    const apply = (canvases: HTMLCanvasElement[], size: { width: number; height: number }, keepText: boolean) => {
      targets.forEach((layer, index) => {
        layer.replaceCanvas(canvases[index]!)
        layer.text = keepText ? texts[index]! : null
      })
      this.setDocumentSize(size.width, size.height)
    }
    apply(after, { width: nextWidth, height: nextHeight }, false)
    this.history.push({
      bytes: after.reduce((sum, canvas) => sum + canvasBytes(canvas), 0),
      undo: () => apply(before, previous, true),
      redo: () => apply(after, { width: nextWidth, height: nextHeight }, false),
    })
    this.fitToView()
    this.emit()
  }

  private setDocumentSize(width: number, height: number) {
    const resized = width !== this.width || height !== this.height
    this.width = width
    this.height = height
    this.backdrop.set({ width, height })
    if (resized) {
      this.strokeBackup = createCanvas(width, height)
      this.strokeBuffer = createCanvas(width, height)
      this.dropAiMask()
    }
    this.selection = null
    this.stageDirty = true
    this.overlayDirty = true
  }

  // ---------------------------------------------------------------- layers

  private allLayers() {
    return this.maskLayer ? [...this.layers, this.maskLayer] : [...this.layers]
  }

  private activeLayer() {
    return this.layers.find((layer) => layer.id === this.activeLayerId) ?? null
  }

  private activeIndex() {
    const index = this.layers.findIndex((layer) => layer.id === this.activeLayerId)
    return index < 0 ? this.layers.length - 1 : index
  }

  private findLayer(id: string) {
    if (this.maskLayer?.id === id) return this.maskLayer
    return this.layers.find((layer) => layer.id === id) ?? null
  }

  /** Put Fabric's object list in document order: backdrop, paint layers, mask, then interactive objects. */
  private restack() {
    const interactive = [this.floating?.image, this.cropBox, this.textEdit?.object].filter(
      (object): object is FabricImage | FabricRect | IText => Boolean(object),
    )
    this.canvas.remove(...this.canvas.getObjects())
    this.canvas.add(this.backdrop, ...this.layers.map((layer) => layer.image))
    if (this.maskLayer) this.canvas.add(this.maskLayer.image)
    if (this.aiMask) this.canvas.add(this.aiMask.image)
    if (interactive.length > 0) this.canvas.add(...interactive)
    this.stageDirty = true
    this.requestFrame()
  }

  setActiveLayer(id: string) {
    if (id === 'floating') return
    if (this.maskLayer?.id === id) {
      this.setTool('mask')
      return
    }
    if (!this.layers.some((layer) => layer.id === id)) return
    if (id !== this.activeLayerId) {
      this.commitTextEdit()
      this.commitAdjust()
    }
    this.activeLayerId = id
    if (this.tool === 'mask' || this.tool === 'mask-eraser') this.setTool('brush')
    this.emit()
  }

  addLayer() {
    if (this.status !== 'ready') return
    this.commitFloating()
    const count = this.layers.length
    const layer = RasterLayer.blank('paint', `${this.names.layer} ${count}`, this.width, this.height)
    this.insertLayer(layer, this.activeIndex() + 1)
  }

  private insertLayer(layer: RasterLayer, index: number) {
    this.commitAdjust()
    const previousActive = this.activeLayerId
    const insert = () => {
      this.layers.splice(index, 0, layer)
      this.activeLayerId = layer.id
      this.restack()
    }
    const remove = () => {
      this.layers = this.layers.filter((item) => item !== layer)
      this.activeLayerId = previousActive
      this.restack()
    }
    insert()
    this.history.push({ bytes: canvasBytes(layer.canvas), undo: remove, redo: insert })
    this.emit()
  }

  duplicateLayer(id: string) {
    const source = this.layers.find((layer) => layer.id === id)
    if (!source) return
    const copy = new RasterLayer({ kind: 'paint', name: `${source.name} 2`, canvas: cloneCanvas(source.canvas) })
    copy.opacity = source.opacity
    copy.text = source.text ? { ...source.text } : null
    copy.syncImage()
    this.insertLayer(copy, this.layers.indexOf(source) + 1)
  }

  removeLayer(id: string) {
    const index = this.layers.findIndex((layer) => layer.id === id)
    if (index < 0 || this.layers.length <= 1) return
    this.commitAdjust()
    const layer = this.layers[index]!
    const previousActive = this.activeLayerId
    const remove = () => {
      this.layers.splice(index, 1)
      if (this.activeLayerId === layer.id) this.activeLayerId = this.layers[Math.max(0, index - 1)]?.id ?? null
      this.restack()
    }
    const restore = () => {
      this.layers.splice(index, 0, layer)
      this.activeLayerId = previousActive
      this.restack()
    }
    remove()
    this.history.push({ bytes: 64, undo: restore, redo: remove })
    this.emit()
  }

  /** Move a paint layer to a new position (index counted from the bottom). */
  moveLayer(id: string, toIndex: number) {
    const from = this.layers.findIndex((layer) => layer.id === id)
    const to = Math.max(0, Math.min(this.layers.length - 1, toIndex))
    if (from < 0 || from === to) return
    const move = (a: number, b: number) => () => {
      const [layer] = this.layers.splice(a, 1)
      if (layer) this.layers.splice(b, 0, layer)
      this.restack()
    }
    move(from, to)()
    this.history.push({ bytes: 64, undo: move(to, from), redo: move(from, to) })
    this.emit()
  }

  renameLayer(id: string, name: string) {
    const layer = this.findLayer(id)
    const trimmed = name.trim()
    if (!layer || !trimmed) return
    layer.name = trimmed
    this.emit()
  }

  setLayerVisible(id: string, visible: boolean) {
    const layer = this.findLayer(id)
    if (!layer || layer.visible === visible) return
    const apply = (value: boolean) => () => {
      layer.visible = value
      layer.syncImage()
      this.stageDirty = true
      this.requestFrame()
    }
    apply(visible)()
    this.history.push({ bytes: 64, undo: apply(!visible), redo: apply(visible) })
    this.emit()
  }

  setLayerLocked(id: string, locked: boolean) {
    const layer = this.findLayer(id)
    if (!layer) return
    layer.locked = locked
    this.emit()
  }

  /** Live opacity change while a slider moves; call `commitLayerOpacity` when it settles. */
  previewLayerOpacity(id: string, opacity: number) {
    const layer = this.findLayer(id)
    if (!layer) return
    layer.opacity = Math.max(0, Math.min(1, opacity))
    layer.syncImage()
    this.stageDirty = true
    this.emit()
  }

  commitLayerOpacity(id: string, from: number) {
    const layer = this.findLayer(id)
    if (!layer || layer.opacity === from) return
    const to = layer.opacity
    const apply = (value: number) => () => {
      layer.opacity = value
      layer.syncImage()
      this.stageDirty = true
      this.requestFrame()
    }
    this.history.push({ bytes: 64, undo: apply(from), redo: apply(to) })
    this.emit()
  }

  /** Merge the active layer into the one below it. */
  mergeDown() {
    const index = this.activeIndex()
    const upper = this.layers[index]
    const lower = this.layers[index - 1]
    if (!upper || !lower) return
    this.commitTextEdit()
    this.commitAdjust()
    this.rasterizeText(lower)
    const rect = { x: 0, y: 0, width: this.width, height: this.height }
    const before = cloneCanvas(lower.canvas)
    const context = lower.context
    context.save()
    context.globalAlpha = upper.visible ? upper.opacity : 0
    context.drawImage(upper.canvas, 0, 0)
    context.restore()
    const after = cloneCanvas(lower.canvas)
    const previousActive = this.activeLayerId
    const merge = () => {
      putRegion(lower.canvas, after, rect)
      lower.touch()
      this.layers = this.layers.filter((layer) => layer !== upper)
      this.activeLayerId = lower.id
      this.restack()
    }
    const unmerge = () => {
      putRegion(lower.canvas, before, rect)
      lower.touch()
      this.layers.splice(index, 0, upper)
      this.activeLayerId = previousActive
      this.restack()
    }
    merge()
    this.history.push({ bytes: canvasBytes(before) * 2, undo: unmerge, redo: merge })
    this.emit()
  }

  /** Flatten every visible paint layer into one. */
  flatten() {
    if (this.layers.length <= 1) return
    this.commitFloating()
    this.commitTextEdit()
    this.commitAdjust()
    const flat = new RasterLayer({ kind: 'paint', name: this.names.original, canvas: this.composite() })
    const previous = [...this.layers]
    const previousActive = this.activeLayerId
    const apply = () => {
      this.layers = [flat]
      this.activeLayerId = flat.id
      this.restack()
    }
    const revert = () => {
      this.layers = [...previous]
      this.activeLayerId = previousActive
      this.restack()
    }
    apply()
    this.history.push({ bytes: canvasBytes(flat.canvas), undo: revert, redo: apply })
    this.emit()
  }

  /** Draw a layer (or the floating piece) into a thumbnail canvas. */
  drawThumbnail(id: string, target: HTMLCanvasElement) {
    const context = target.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, target.width, target.height)
    const source = id === 'floating' ? this.floating?.image.getElement() : this.findLayer(id)?.canvas
    if (!source || !source.width || !source.height) return
    const scale = Math.min(target.width / source.width, target.height / source.height)
    const width = source.width * scale
    const height = source.height * scale
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, (target.width - width) / 2, (target.height - height) / 2, width, height)
  }

  // ---------------------------------------------------------------- history

  undo() {
    if (this.stroke) return
    this.discardFloating()
    this.commitTextEdit()
    this.commitAdjust()
    if (this.history.undo()) {
      this.stageDirty = true
      this.overlayDirty = true
      this.emit()
    }
  }

  redo() {
    if (this.stroke) return
    this.discardFloating()
    this.commitTextEdit()
    this.commitAdjust()
    if (this.history.redo()) {
      this.stageDirty = true
      this.overlayDirty = true
      this.emit()
    }
  }

  /** Enter key: confirm whatever is pending (floating piece, crop). */
  confirmPending() {
    if (this.textEdit) {
      this.commitTextEdit()
      return true
    }
    if (this.floating) {
      this.commitFloating()
      return true
    }
    if (this.cropBox) {
      this.applyCrop()
      return true
    }
    return false
  }

  /** Escape key: drop whatever is pending; returns false when nothing was. */
  cancelPending() {
    if (this.stroke) {
      this.cancelStroke()
      return true
    }
    if (this.textEdit) {
      // Esc leaves text editing and keeps what was typed.
      this.commitTextEdit()
      return true
    }
    if (this.aiJob) {
      this.cancelAiErase()
      return true
    }
    if (this.floating) {
      this.discardFloating()
      return true
    }
    if (this.cropBox) {
      this.cancelCrop()
      return true
    }
    if (this.selection) {
      this.clearSelection()
      return true
    }
    return false
  }

  // ---------------------------------------------------------------- export

  /** All visible paint layers merged at document size. */
  private composite() {
    const output = createCanvas(this.width, this.height)
    const context = context2d(output)
    for (const layer of this.layers) {
      if (!layer.visible) continue
      context.globalAlpha = layer.opacity
      context.drawImage(layer.canvas, 0, 0)
    }
    return output
  }

  /** Mask as black background with white where painted (the shape NovelAI expects). */
  private maskImage() {
    const mask = this.maskLayer
    if (!mask) return null
    const white = cloneCanvas(mask.canvas)
    const whiteContext = context2d(white)
    whiteContext.globalCompositeOperation = 'source-in'
    whiteContext.fillStyle = '#ffffff'
    whiteContext.fillRect(0, 0, white.width, white.height)
    const output = createCanvas(this.width, this.height)
    const context = context2d(output)
    context.fillStyle = '#000000'
    context.fillRect(0, 0, output.width, output.height)
    context.drawImage(white, 0, 0)
    return output
  }

  async export(): Promise<EditorExport> {
    this.commitFloating()
    this.commitTextEdit()
    this.commitAdjust()
    this.endCrop()
    const source = await canvasToBlob(this.composite())
    const maskCanvas = this.maskImage()
    const mask = maskCanvas ? await canvasToBlob(maskCanvas) : undefined
    return { source, mask }
  }

  get isDirty() {
    return this.history.dirty || Boolean(this.floating || this.textEdit || this.adjust)
  }

  // ---------------------------------------------------------------- text

  /** Text tool click: finish the current text, else edit the text layer under the point, else start new text there. */
  private handleTextPointer(point: DocPoint) {
    if (this.textEdit) {
      this.commitTextEdit()
      return
    }
    const hit = [...this.layers].reverse().find((layer) => {
      if (!layer.text || !layer.visible || layer.locked) return false
      const box = textBounds(layer.text)
      return point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height
    })
    if (hit) this.beginTextEdit(hit)
    else this.beginTextEdit(null, point)
  }

  /** Open a text layer (or the selected one) for editing. */
  editTextLayer(id: string) {
    const layer = this.layers.find((item) => item.id === id)
    if (!layer?.text || layer.locked) return
    if (this.textEdit?.layer === layer) return
    this.commitTextEdit()
    if (this.tool !== 'text') {
      this.endCrop()
      this.tool = 'text'
    }
    this.activeLayerId = layer.id
    this.beginTextEdit(layer)
  }

  private beginTextEdit(layer: RasterLayer | null, at?: DocPoint) {
    this.commitFloating()
    this.commitAdjust()
    this.endCrop()
    const spec: TextSpec = layer?.text
      ? { ...layer.text }
      : {
          content: '',
          ...this.textStyle,
          fill: this.brushColor,
          left: at?.x ?? this.width / 2,
          top: (at?.y ?? this.height / 2) - this.textStyle.fontSize / 2,
          angle: 0,
          scaleX: 1,
          scaleY: 1,
        }
    const object = createTextObject(spec)
    // The hidden textarea lives in the stage (not <body>) so typing stays inside the editor's focus and key handling.
    object.set({ ...CONTROL_STYLE, editingBorderColor: '#f95e14', cursorColor: '#f95e14', cursorWidth: 2, hiddenTextareaContainer: this.canvas.wrapperEl })
    object.setControlVisible('mtr', true)
    if (layer) {
      layer.image.visible = false
      this.activeLayerId = layer.id
    }
    this.textEdit = { object, layer, previous: layer?.text ?? null, base: spec }
    this.canvas.add(object)
    this.canvas.setActiveObject(object)
    object.enterEditing()
    if (layer) object.selectAll()
    this.whenFontReady(spec.fontFamily, spec.content)
    this.applyToolCursor()
    this.stageDirty = true
    this.overlayDirty = true
    this.emit()
  }

  /** Re-apply the edit's style (font, size, colour, outline) to the object, keeping where the user put it. */
  private applyTextBase(edit: TextEdit) {
    const object = edit.object
    const options = textObjectOptions({ ...edit.base, left: object.left, top: object.top, angle: object.angle, scaleX: object.scaleX, scaleY: object.scaleY })
    object.set(options)
    object.setCoords()
    this.stageDirty = true
    this.overlayDirty = true
    this.requestFrame()
  }

  /** Once a web font arrives, redraw whatever uses it: the text being edited and text layers set in it. */
  private whenFontReady(family: string, sample?: string) {
    void ensureFont(family, sample).then(() => {
      if (this.disposed) return
      const edit = this.textEdit
      if (edit && edit.base.fontFamily === family) {
        edit.object.initDimensions()
        edit.object.setCoords()
      }
      for (const layer of this.layers) {
        if (layer.text?.fontFamily === family) {
          renderTextSpec(layer.text, layer.canvas)
          layer.touch()
        }
      }
      this.stageDirty = true
      this.overlayDirty = true
      this.emit()
    })
  }

  /** Finish editing: new text becomes a text layer, an edited layer is redrawn (one undo step either way). */
  commitTextEdit() {
    const edit = this.textEdit
    if (!edit) return
    this.textEdit = null
    if (edit.object.isEditing) edit.object.exitEditing()
    this.canvas.discardActiveObject()
    this.canvas.remove(edit.object)
    const spec = specFromObject(edit.object, edit.base)
    const empty = !spec.content.trim()
    const layer = edit.layer
    this.applyToolCursor()
    this.stageDirty = true
    this.overlayDirty = true
    if (layer) {
      layer.syncImage()
      if (empty) this.removeLayer(layer.id)
      else if (edit.previous && !sameTextSpec(edit.previous, spec)) this.replaceTextLayer(layer, edit.previous, spec)
      this.emit()
      return
    }
    if (!empty) {
      const created = RasterLayer.blank('paint', textLayerName(spec.content), this.width, this.height)
      created.text = spec
      renderTextSpec(spec, created.canvas)
      this.insertLayer(created, this.activeIndex() + 1)
    }
    this.emit()
  }

  /** Leave text editing without changing anything. */
  cancelTextEdit() {
    const edit = this.textEdit
    if (!edit) return
    this.textEdit = null
    if (edit.object.isEditing) edit.object.exitEditing()
    this.canvas.discardActiveObject()
    this.canvas.remove(edit.object)
    edit.layer?.syncImage()
    this.applyToolCursor()
    this.stageDirty = true
    this.overlayDirty = true
    this.emit()
  }

  private replaceTextLayer(layer: RasterLayer, previous: TextSpec, next: TextSpec) {
    const rect = clampRect(unionRect(textBounds(previous), textBounds(next))!, this.width, this.height)
    const nameBefore = layer.name
    const nameAfter = nameBefore === textLayerName(previous.content) ? textLayerName(next.content) : nameBefore
    const region = rect ?? { x: 0, y: 0, width: this.width, height: this.height }
    const before = copyRegion(layer.canvas, region)
    renderTextSpec(next, layer.canvas)
    const after = copyRegion(layer.canvas, region)
    const apply = (pixels: HTMLCanvasElement, spec: TextSpec, name: string) => () => {
      putRegion(layer.canvas, pixels, region)
      layer.text = spec
      layer.name = name
      layer.touch()
    }
    apply(after, next, nameAfter)()
    this.history.push({ bytes: canvasBytes(before) + canvasBytes(after), undo: apply(before, previous, nameBefore), redo: apply(after, next, nameAfter) })
  }

  /** Painting into a text layer turns it into plain pixels (an undo step of its own brings the text back). */
  private rasterizeText(layer: RasterLayer) {
    const spec = layer.text
    if (!spec) return
    layer.text = null
    this.history.push({
      bytes: 64,
      undo: () => {
        layer.text = spec
      },
      redo: () => {
        layer.text = null
      },
    })
    this.emit()
  }

  // ---------------------------------------------------------------- colour adjustment

  /**
   * Preview adjustments on the active layer (inside the selection, if any). `patch` merges into what is previewed now,
   * not into the last snapshot, so quick changes in one frame don't undo each other. Returns false when the layer can't take them.
   */
  previewAdjust(patch: Partial<Adjustments>) {
    if (this.status !== 'ready') return false
    const value = { ...(this.adjust?.value ?? NEUTRAL_ADJUSTMENTS), ...patch }
    if (!this.adjust) {
      const layer = this.activeLayer()
      if (!layer || layer.locked || !layer.visible) {
        this.emitNotice('locked')
        return false
      }
      this.commitFloating()
      this.commitTextEdit()
      this.cancelStroke()
      this.rasterizeText(layer)
      const full = { x: 0, y: 0, width: this.width, height: this.height }
      this.adjust = {
        layer,
        source: cloneCanvas(layer.canvas),
        rect: this.selection?.bounds ?? full,
        clip: this.selection?.path ?? null,
        value,
        comparing: false,
      }
      this.emit()
    }
    this.adjust.value = value
    this.adjustDirty = true
    this.emit()
    return true
  }

  private renderAdjustPreview() {
    const session = this.adjust
    if (!session) return
    renderAdjusted(session.source, session.layer.canvas, session.rect, session.value, session.clip)
    this.stageDirty = true
  }

  /** While held, show the layer without the adjustment. */
  setAdjustCompare(comparing: boolean) {
    const session = this.adjust
    if (!session || session.comparing === comparing) return
    session.comparing = comparing
    session.layer.image.setElement(comparing ? session.source : session.layer.canvas)
    session.layer.syncImage()
    this.stageDirty = true
    this.requestFrame()
  }

  /** Keep the previewed adjustment as one undo step. */
  commitAdjust() {
    const session = this.adjust
    if (!session) return
    this.setAdjustCompare(false)
    if (isNeutralAdjustment(session.value)) {
      this.cancelAdjust()
      return
    }
    if (this.adjustDirty) {
      this.adjustDirty = false
      this.renderAdjustPreview()
    }
    this.adjust = null
    this.pushRasterPatch(session.layer, session.rect, copyRegion(session.source, session.rect), copyRegion(session.layer.canvas, session.rect))
    this.stageDirty = true
  }

  /** Drop the previewed adjustment. */
  cancelAdjust() {
    const session = this.adjust
    if (!session) return
    this.setAdjustCompare(false)
    this.adjust = null
    this.adjustDirty = false
    putRegion(session.layer.canvas, copyRegion(session.source, session.rect), session.rect)
    session.layer.touch()
    this.stageDirty = true
    this.emit()
  }

  // ---------------------------------------------------------------- AI erase

  /** The scratch layer AI erase strokes go into (document-sized, shown tinted above everything). */
  private ensureAiMask() {
    if (!this.aiMask) {
      const layer = RasterLayer.blank('mask', 'ai-erase', this.width, this.height)
      layer.image.imageSmoothing = this.zoom < 2
      this.aiMask = layer
      this.restack()
    }
    return this.aiMask
  }

  private dropAiMask() {
    if (!this.aiMask) return
    this.canvas.remove(this.aiMask.image)
    this.aiMask = null
    this.stageDirty = true
  }

  private clearAiMask() {
    const mask = this.aiMask
    if (!mask) return
    mask.context.clearRect(0, 0, mask.canvas.width, mask.canvas.height)
    mask.touch()
    this.stageDirty = true
  }

  /** Send the painted area (with surroundings) to the server and lay the filled pixels on the AI erase layer. */
  private async runAiErase(painted: Rect) {
    const handler = this.inpaintHandler
    const mask = this.aiMask
    if (!handler || !mask) return
    const pad = Math.max(48, Math.round(Math.max(painted.width, painted.height) * 0.6))
    const region = clampRect({ x: painted.x - pad, y: painted.y - pad, width: painted.width + pad * 2, height: painted.height + pad * 2 }, this.width, this.height)
    if (!region) {
      this.clearAiMask()
      return
    }
    const scale = Math.min(1, AI_MAX_SIDE / Math.max(region.width, region.height))
    const width = Math.max(8, Math.round(region.width * scale))
    const height = Math.max(8, Math.round(region.height * scale))

    // What the user sees in that area (all visible layers), and the painted strokes as white on black.
    const imageCanvas = createCanvas(width, height)
    const imageContext = context2d(imageCanvas)
    imageContext.imageSmoothingQuality = 'high'
    for (const layer of this.layers) {
      if (!layer.visible) continue
      imageContext.globalAlpha = layer.opacity
      imageContext.drawImage(layer.canvas, region.x, region.y, region.width, region.height, 0, 0, width, height)
    }
    const strokes = copyRegion(mask.canvas, region)
    const strokesContext = context2d(strokes)
    strokesContext.globalCompositeOperation = 'source-in'
    strokesContext.fillStyle = '#ffffff'
    strokesContext.fillRect(0, 0, strokes.width, strokes.height)
    const maskCanvas = createCanvas(width, height)
    const maskContext = context2d(maskCanvas)
    maskContext.fillStyle = '#000000'
    maskContext.fillRect(0, 0, width, height)
    maskContext.drawImage(strokes, 0, 0, width, height)

    const controller = new AbortController()
    this.aiJob = { controller, region }
    this.overlayDirty = true
    this.emit()
    try {
      const [imageBlob, maskBlob] = await Promise.all([canvasToBlob(imageCanvas), canvasToBlob(maskCanvas)])
      const resultBlob = await handler(imageBlob, maskBlob, controller.signal)
      if (this.aiJob?.controller !== controller || this.disposed) return
      const url = URL.createObjectURL(resultBlob)
      let result: HTMLImageElement
      try {
        result = await loadImage(url)
      } finally {
        URL.revokeObjectURL(url)
      }
      if (this.aiJob?.controller !== controller || this.disposed) return

      // Keep only the painted area, with a soft edge that reaches a little past the strokes.
      const patch = createCanvas(region.width, region.height)
      const patchContext = context2d(patch)
      patchContext.imageSmoothingQuality = 'high'
      patchContext.drawImage(result, 0, 0, region.width, region.height)
      const edge = createCanvas(region.width, region.height)
      const edgeContext = context2d(edge)
      edgeContext.filter = `blur(${Math.max(2, Math.round(Math.max(region.width, region.height) / 256))}px)`
      edgeContext.drawImage(strokes, 0, 0)
      edgeContext.filter = 'none'
      edgeContext.drawImage(strokes, 0, 0)
      patchContext.globalCompositeOperation = 'destination-in'
      patchContext.drawImage(edge, 0, 0)
      this.applyAiPatch(patch, region)
    } catch (error) {
      if (controller.signal.aborted || this.disposed) return
      this.emitNotice('ai-failed', error instanceof Error ? error.message : String(error))
    } finally {
      if (this.aiJob?.controller === controller) {
        this.aiJob = null
        this.clearAiMask()
        this.overlayDirty = true
        this.emit()
      }
    }
  }

  /** Paint into the AI erase layer while it is on top, else start a new one there. */
  private applyAiPatch(patch: HTMLCanvasElement, region: Rect) {
    const top = this.layers[this.layers.length - 1]
    if (top && top.aiErase && top.visible && !top.locked && !top.text) {
      const before = copyRegion(top.canvas, region)
      top.context.drawImage(patch, region.x, region.y)
      this.commitRegionEdit(top, region, before)
      return
    }
    const count = this.layers.filter((layer) => layer.aiErase).length + 1
    const layer = RasterLayer.blank('paint', `${this.names.aiErase} ${count}`, this.width, this.height)
    layer.aiErase = true
    layer.context.drawImage(patch, region.x, region.y)
    this.insertLayer(layer, this.layers.length)
  }

  /** Stop the running AI erase and drop its strokes. */
  cancelAiErase() {
    const job = this.aiJob
    if (!job) return
    this.aiJob = null
    job.controller.abort()
    this.clearAiMask()
    this.overlayDirty = true
    this.emit()
  }
}

function sameTextSpec(a: TextSpec, b: TextSpec) {
  return (Object.keys(a) as Array<keyof TextSpec>).every((key) => a[key] === b[key])
}

function clampZoom(zoom: number) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom))
}

function createCheckerTile() {
  const tile = createCanvas(16, 16)
  const context = context2d(tile)
  context.fillStyle = '#2a2a2a'
  context.fillRect(0, 0, 16, 16)
  context.fillStyle = '#353534'
  context.fillRect(0, 0, 8, 8)
  context.fillRect(8, 8, 8, 8)
  return tile
}

/** Turn a black/white mask picture into mask-layer pixels (mask colour, alpha = brightness). */
function createMaskLayer(width: number, height: number, source: HTMLImageElement | null) {
  const layer = RasterLayer.blank('mask', 'mask', width, height)
  if (!source) return layer
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return layer
  context.drawImage(source, 0, 0, width, height)
  const pixels = context.getImageData(0, 0, width, height)
  const data = pixels.data
  const red = parseInt(MASK_COLOR.slice(1, 3), 16)
  const green = parseInt(MASK_COLOR.slice(3, 5), 16)
  const blue = parseInt(MASK_COLOR.slice(5, 7), 16)
  for (let index = 0; index < data.length; index += 4) {
    const strength = Math.round(((data[index] ?? 0) + (data[index + 1] ?? 0) + (data[index + 2] ?? 0)) / 3 * ((data[index + 3] ?? 255) / 255))
    data[index] = red
    data[index + 1] = green
    data[index + 2] = blue
    data[index + 3] = strength
  }
  layer.context.putImageData(pixels, 0, 0)
  return layer
}

