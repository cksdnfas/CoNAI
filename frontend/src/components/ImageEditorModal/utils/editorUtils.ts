/**
 * Editor Utility Functions
 * Optimized helpers for image editor operations
 */

import Konva from 'konva';
import type {
  EditorLayer,
  KonvaNode,
  HistoryState,
  Point,
  Rect,
  StageConfig,
} from '../types/EditorTypes';

// ============================================================================
// Deep Cloning (Optimized - No JSON.parse/stringify!)
// ============================================================================

/**
 * Deep clone using structuredClone (modern browsers)
 * Fallback to manual cloning for compatibility
 * Special handling for HTMLImageElement which cannot be cloned
 */
export function deepClone<T>(obj: T): T {
  // Check for DOM elements first (cannot be cloned)
  if (obj instanceof HTMLImageElement || obj instanceof HTMLElement) {
    return obj; // Return original reference
  }

  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(obj);
    } catch (e) {
      // If structuredClone fails (e.g., contains HTMLImageElement deep inside)
      // Fall back to manual clone which handles special cases
      return deepCloneManual(obj);
    }
  }

  // Fallback for older browsers
  return deepCloneManual(obj);
}

function deepCloneManual<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T;
  }

  if (obj instanceof Array) {
    return obj.map(item => deepCloneManual(item)) as T;
  }

  if (obj instanceof HTMLImageElement || obj instanceof HTMLElement) {
    // Don't clone DOM elements - keep reference
    return obj;
  }

  const cloned = {} as T;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepCloneManual(obj[key]);
    }
  }
  return cloned;
}

// ============================================================================
// Coordinate Transformations
// ============================================================================

/**
 * Get pointer position relative to stage with transform applied
 */
export function getRelativePointerPosition(
  stage: Konva.Stage
): Point | null {
  const pointerPos = stage.getPointerPosition();
  if (!pointerPos) return null;

  const transform = stage.getAbsoluteTransform().copy().invert();
  return transform.point(pointerPos);
}

/**
 * Transform point from stage coordinates to layer coordinates
 */
export function stageToLayerPoint(
  point: Point,
  stage: Konva.Stage
): Point {
  const transform = stage.getAbsoluteTransform().copy().invert();
  return transform.point(point);
}

/**
 * Transform point from layer coordinates to stage coordinates
 */
export function layerToStagePoint(
  point: Point,
  stage: Konva.Stage
): Point {
  const transform = stage.getAbsoluteTransform();
  return transform.point(point);
}

// ============================================================================
// Geometry Utilities
// ============================================================================

/**
 * Normalize rectangle coordinates (handle negative width/height)
 */
export function normalizeRect(rect: Rect): Rect {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}

/**
 * Check if two rectangles intersect
 */
export function rectsIntersect(rect1: Rect, rect2: Rect): boolean {
  return !(
    rect2.x > rect1.x + rect1.width ||
    rect2.x + rect2.width < rect1.x ||
    rect2.y > rect1.y + rect1.height ||
    rect2.y + rect2.height < rect1.y
  );
}

/**
 * Calculate distance between two points
 */
export function distance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate unique ID for nodes and layers
 */
export function generateId(prefix: string = 'item'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ============================================================================
// Layer Utilities
// ============================================================================

/**
 * Create a new layer with default properties
 */
export function createLayer(name: string, order: number): EditorLayer {
  return {
    id: generateId('layer'),
    name,
    visible: true,
    opacity: 1,
    locked: false,
    order,
  };
}

/**
 * Sort layers by order
 */
export function sortLayersByOrder(layers: EditorLayer[]): EditorLayer[] {
  return [...layers].sort((a, b) => a.order - b.order);
}

/**
 * Reorder layers (update order property)
 */
export function reorderLayers(
  layers: EditorLayer[],
  fromIndex: number,
  toIndex: number
): EditorLayer[] {
  const result = [...layers];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);

  // Update order property
  return result.map((layer, index) => ({
    ...layer,
    order: index,
  }));
}

// ============================================================================
// Node Utilities
// ============================================================================

/**
 * Filter nodes by layer ID
 */
export function getNodesByLayer(
  nodes: KonvaNode[],
  layerId: string
): KonvaNode[] {
  return nodes.filter(node => node.layerId === layerId);
}

/**
 * Find node by ID
 */
export function findNodeById(
  nodes: KonvaNode[],
  nodeId: string
): KonvaNode | null {
  return nodes.find(node => node.id === nodeId) || null;
}

/**
 * Update node in array
 */
export function updateNodeInArray(
  nodes: KonvaNode[],
  nodeId: string,
  updates: Partial<KonvaNode>
): KonvaNode[] {
  return nodes.map(node =>
    node.id === nodeId ? { ...node, ...updates } : node
  );
}

/**
 * Remove node from array
 */
export function removeNodeFromArray(
  nodes: KonvaNode[],
  nodeId: string
): KonvaNode[] {
  return nodes.filter(node => node.id !== nodeId);
}

// ============================================================================
// Stage Utilities
// ============================================================================

/**
 * Calculate optimal stage size for container
 */
export function calculateStageSize(
  isMobile: boolean,
  containerWidth?: number,
  containerHeight?: number
): { width: number; height: number } {
  if (isMobile) {
    return {
      width: Math.min(window.innerWidth - 32, containerWidth || Infinity),
      height: window.innerHeight - 300,
    };
  }

  const sidebarWidths = 250 + 280 + 32;
  const availableWidth = (containerWidth || window.innerWidth) - sidebarWidths - 100;
  const dialogChrome = 200;
  const availableHeight = (containerHeight || window.innerHeight) - dialogChrome;

  return {
    width: Math.max(600, Math.min(availableWidth, 1920)),
    height: Math.max(400, Math.min(availableHeight, 1080)),
  };
}

/**
 * Fit image to stage while maintaining aspect ratio
 */
export function fitImageToStage(
  imageWidth: number,
  imageHeight: number,
  stageWidth: number,
  stageHeight: number,
  padding: number = 40
): { scale: number; x: number; y: number } {
  const availableWidth = stageWidth - padding * 2;
  const availableHeight = stageHeight - padding * 2;

  const scaleX = availableWidth / imageWidth;
  const scaleY = availableHeight / imageHeight;
  const scale = Math.min(scaleX, scaleY, 1); // Don't scale up

  const scaledWidth = imageWidth * scale;
  const scaledHeight = imageHeight * scale;

  return {
    scale,
    x: (stageWidth - scaledWidth) / 2,
    y: (stageHeight - scaledHeight) / 2,
  };
}

/**
 * Clamp zoom level
 */
export function clampZoom(zoom: number, min = 0.1, max = 5): number {
  return Math.max(min, Math.min(max, zoom));
}

// ============================================================================
// History Utilities
// ============================================================================

/**
 * Create history snapshot
 */
export function createHistorySnapshot(
  layers: EditorLayer[],
  nodes: KonvaNode[],
  stageConfig: StageConfig
): HistoryState {
  return {
    layers: deepClone(layers),
    nodes: deepClone(nodes),
    stageAttrs: {
      scale: stageConfig.scale,
      position: { ...stageConfig.position },
    },
    timestamp: Date.now(),
  };
}

/**
 * Check if two history states are equal (avoid duplicate saves)
 */
export function historyStatesEqual(
  state1: HistoryState | null,
  state2: HistoryState | null
): boolean {
  if (!state1 || !state2) return false;

  // Quick timestamp check (if within 100ms, likely duplicate)
  if (Math.abs(state1.timestamp - state2.timestamp) < 100) {
    return true;
  }

  // Deep equality check
  return (
    state1.layers.length === state2.layers.length &&
    state1.nodes.length === state2.nodes.length &&
    state1.stageAttrs.scale === state2.stageAttrs.scale
  );
}

// ============================================================================
// Image Utilities
// ============================================================================

/**
 * Load image from URL with caching
 */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${url}`));

    img.src = url;
  });
}

/**
 * Create data URL from stage
 */
export function stageToDataURL(
  stage: Konva.Stage,
  mimeType: string = 'image/png',
  quality: number = 1.0
): string {
  return stage.toDataURL({
    mimeType,
    quality,
    pixelRatio: 2, // Higher quality export
  });
}

/**
 * Create blob from stage
 */
export function stageToBlob(
  stage: Konva.Stage,
  mimeType: string = 'image/png',
  quality: number = 1.0
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    stage.toBlob({
      mimeType,
      quality,
      pixelRatio: 2,
      callback: (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create blob from stage'));
        }
      },
    });
  });
}

/**
 * Convert data URL to blob
 */
export function dataURLToBlob(dataURL: string): Blob {
  const parts = dataURL.split(',');
  const mimeMatch = parts[0].match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'image/png';
  const bstr = atob(parts[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);

  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }

  return new Blob([u8arr], { type: mime });
}

// ============================================================================
// Throttle / Debounce (for performance)
// ============================================================================

/**
 * Request animation frame throttle
 */
export function rafThrottle<T extends (...args: any[]) => void>(
  callback: T
): (...args: Parameters<T>) => void {
  let rafId: number | null = null;

  return (...args: Parameters<T>) => {
    if (rafId !== null) return;

    rafId = requestAnimationFrame(() => {
      callback(...args);
      rafId = null;
    });
  };
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: unknown[]) => void>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      callback(...args);
      timeoutId = null;
    }, delay);
  };
}

// ============================================================================
// Touch/Mobile Utilities
// ============================================================================

/**
 * Check if device is mobile
 */
export function isMobileDevice(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );
}

/**
 * Get touch position from touch event
 */
export function getTouchPosition(
  e: TouchEvent,
  stage: Konva.Stage
): Point | null {
  const touch = e.touches[0];
  if (!touch) return null;

  const rect = stage.container().getBoundingClientRect();
  return {
    x: touch.clientX - rect.left,
    y: touch.clientY - rect.top,
  };
}

/**
 * Calculate distance between two touches (for pinch zoom)
 */
export function getTouchDistance(e: TouchEvent): number {
  if (e.touches.length < 2) return 0;

  const touch1 = e.touches[0];
  const touch2 = e.touches[1];

  return distance(
    { x: touch1.clientX, y: touch1.clientY },
    { x: touch2.clientX, y: touch2.clientY }
  );
}

/**
 * Calculate center point between two touches
 */
export function getTouchCenter(e: TouchEvent): Point | null {
  if (e.touches.length < 2) return null;

  const touch1 = e.touches[0];
  const touch2 = e.touches[1];

  return {
    x: (touch1.clientX + touch2.clientX) / 2,
    y: (touch1.clientY + touch2.clientY) / 2,
  };
}
