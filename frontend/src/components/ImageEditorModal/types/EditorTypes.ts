/**
 * Image Editor TypeScript Type Definitions
 * Optimized for Konva.js + react-konva best practices
 */

import Konva from 'konva';

// ============================================================================
// Tool Types
// ============================================================================

export type EditorTool =
  | 'select'
  | 'pan'
  | 'brush'
  | 'eraser'
  | 'text'
  | 'rect'
  | 'circle'
  | 'line'
  | 'arrow'
  | 'crop';

export interface ToolProperties {
  // Brush/Eraser
  brushSize: number;
  brushColor: string;
  brushOpacity: number;

  // Text
  fontSize: number;
  fontFamily: string;
  textColor: string;
  fontStyle: 'normal' | 'bold' | 'italic';

  // Shapes
  strokeColor: string;
  fillColor: string;
  strokeWidth: number;
  shapeOpacity: number;
}

// ============================================================================
// Konva Node Types
// ============================================================================

export type KonvaNodeType =
  | 'image'
  | 'line'
  | 'rect'
  | 'circle'
  | 'text'
  | 'arrow';

export interface BaseNodeAttrs {
  x: number;
  y: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
  draggable?: boolean;
}

export interface ImageNodeAttrs extends BaseNodeAttrs {
  image: HTMLImageElement;
  width: number;
  height: number;
  filters?: Array<(imageData: ImageData) => void>;
  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface LineNodeAttrs extends BaseNodeAttrs {
  points: number[];
  stroke: string;
  strokeWidth: number;
  tension?: number;
  lineCap?: 'butt' | 'round' | 'square';
  lineJoin?: 'miter' | 'round' | 'bevel';
  globalCompositeOperation?: string;
}

export interface RectNodeAttrs extends BaseNodeAttrs {
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  cornerRadius?: number;
}

export interface CircleNodeAttrs extends BaseNodeAttrs {
  radius: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface TextNodeAttrs extends BaseNodeAttrs {
  text: string;
  fontSize: number;
  fontFamily: string;
  fill: string;
  fontStyle?: string;
  align?: 'left' | 'center' | 'right';
}

export interface ArrowNodeAttrs extends BaseNodeAttrs {
  points: number[];
  stroke: string;
  strokeWidth: number;
  pointerLength?: number;
  pointerWidth?: number;
}

export type NodeAttrs =
  | ImageNodeAttrs
  | LineNodeAttrs
  | RectNodeAttrs
  | CircleNodeAttrs
  | TextNodeAttrs
  | ArrowNodeAttrs;

export interface KonvaNode<T extends NodeAttrs = NodeAttrs> {
  id: string;
  type: KonvaNodeType;
  layerId: string;
  attrs: T;
  name?: string;
}

// ============================================================================
// Layer Types
// ============================================================================

export interface EditorLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
  order: number;
}

// ============================================================================
// Filter Types
// ============================================================================

export type FilterType =
  | 'Blur'
  | 'Brighten'
  | 'Contrast'
  | 'Grayscale'
  | 'Sepia'
  | 'Invert'
  | 'Pixelate';

export interface FilterConfig {
  name: FilterType;
  enabled: boolean;
  params: Record<string, number>;
}

export interface FilterParams {
  Blur: { blurRadius: number };
  Brighten: { brightness: number };
  Contrast: { contrast: number };
  Grayscale: Record<string, never>;
  Sepia: Record<string, never>;
  Invert: Record<string, never>;
  Pixelate: { pixelSize: number };
}

// ============================================================================
// History Types
// ============================================================================

export interface HistoryState {
  layers: EditorLayer[];
  nodes: KonvaNode[];
  stageAttrs: {
    scale: number;
    position: { x: number; y: number };
  };
  timestamp: number;
}

// ============================================================================
// Drawing State Types
// ============================================================================

export interface DrawingState {
  isDrawing: boolean;
  currentPoints: number[];
  startPos: { x: number; y: number } | null;
}

export interface CropState {
  isActive: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  isDragging: boolean;
}

// ============================================================================
// Stage Types
// ============================================================================

export interface StageConfig {
  width: number;
  height: number;
  scale: number;
  position: { x: number; y: number };
}

export interface StageTransform {
  scale: number;
  x: number;
  y: number;
}

// ============================================================================
// Image Loading Types
// ============================================================================

export interface ImageLoadState {
  image: HTMLImageElement | null;
  isLoading: boolean;
  error: string | null;
  originalDimensions: {
    width: number;
    height: number;
  } | null;
}

// ============================================================================
// Editor State Types (for Context/Reducer)
// ============================================================================

export interface EditorState {
  // Core
  tool: EditorTool;
  toolProperties: ToolProperties;

  // Layers & Nodes
  layers: EditorLayer[];
  nodes: KonvaNode[];
  activeLayerId: string;
  selectedNodeId: string | null;

  // Stage
  stageConfig: StageConfig;

  // Filters
  filters: FilterConfig[];

  // Drawing
  drawing: DrawingState;
  crop: CropState;

  // History
  history: HistoryState[];
  historyIndex: number;

  // Image
  imageLoad: ImageLoadState;

  // UI State
  isMobile: boolean;
}

// ============================================================================
// Action Types for Reducer
// ============================================================================

export type EditorAction =
  | { type: 'SET_TOOL'; payload: EditorTool }
  | { type: 'UPDATE_TOOL_PROPERTIES'; payload: Partial<ToolProperties> }
  | { type: 'ADD_LAYER'; payload: EditorLayer }
  | { type: 'UPDATE_LAYER'; payload: { id: string; updates: Partial<EditorLayer> } }
  | { type: 'DELETE_LAYER'; payload: string }
  | { type: 'REORDER_LAYERS'; payload: EditorLayer[] }
  | { type: 'SET_ACTIVE_LAYER'; payload: string }
  | { type: 'ADD_NODE'; payload: KonvaNode }
  | { type: 'UPDATE_NODE'; payload: { id: string; updates: Partial<KonvaNode> } }
  | { type: 'DELETE_NODE'; payload: string }
  | { type: 'SET_NODES'; payload: KonvaNode[] }
  | { type: 'SET_SELECTED_NODE'; payload: string | null }
  | { type: 'UPDATE_STAGE_CONFIG'; payload: Partial<StageConfig> }
  | { type: 'UPDATE_STAGE_TRANSFORM'; payload: StageTransform }
  | { type: 'UPDATE_FILTER'; payload: { index: number; updates: Partial<FilterConfig> } }
  | { type: 'START_DRAWING'; payload: { x: number; y: number } }
  | { type: 'UPDATE_DRAWING'; payload: number[] }
  | { type: 'END_DRAWING' }
  | { type: 'START_CROP'; payload: { x: number; y: number } }
  | { type: 'UPDATE_CROP'; payload: Partial<CropState> }
  | { type: 'END_CROP' }
  | { type: 'APPLY_CROP' }
  | { type: 'SAVE_HISTORY'; payload: HistoryState }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'SET_IMAGE'; payload: HTMLImageElement }
  | { type: 'SET_IMAGE_LOADING'; payload: boolean }
  | { type: 'SET_IMAGE_ERROR'; payload: string | null }
  | { type: 'RESET_EDITOR' };

// ============================================================================
// Component Props Types
// ============================================================================

export interface ImageEditorModalProps {
  open: boolean;
  onClose: () => void;
  imageUrl: string;
  onSave: (blob: Blob) => void;
}

export interface KonvaStageProps {
  stageRef: React.RefObject<Konva.Stage>;
  transformerRef: React.RefObject<Konva.Transformer>;
}

export interface LayerPanelProps {
  className?: string;
}

export interface ToolPaletteProps {
  className?: string;
}

export interface FilterPanelProps {
  className?: string;
}

export interface PropertiesPanelProps {
  className?: string;
}

// ============================================================================
// Utility Types
// ============================================================================

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ============================================================================
// Hook Return Types
// ============================================================================

export interface UseHistoryReturn {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  saveHistory: () => void;
  clearHistory: () => void;
}

export interface UseImageLoaderReturn {
  image: HTMLImageElement | null;
  isLoading: boolean;
  error: string | null;
  loadImage: (url: string) => Promise<void>;
  clearImage: () => void;
}

export interface UseDrawingReturn {
  isDrawing: boolean;
  currentPoints: number[];
  startDrawing: (point: Point) => void;
  updateDrawing: (point: Point) => void;
  endDrawing: () => KonvaNode | null;
}

export interface UseKonvaNodesReturn {
  nodes: KonvaNode[];
  addNode: (node: KonvaNode) => void;
  updateNode: (id: string, updates: Partial<KonvaNode>) => void;
  deleteNode: (id: string) => void;
  getNodesByLayer: (layerId: string) => KonvaNode[];
  selectedNode: KonvaNode | null;
}
