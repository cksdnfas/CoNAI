export interface ImageEditorModalProps {
  open: boolean;
  imageId?: number;  // DB image ID (for editing original images)
  canvasFilename?: string;  // Canvas filename (for editing canvas images)
  onClose: () => void;
  onSaved?: () => void;
}

export interface DrawLine {
  tool: 'brush' | 'eraser';
  points: number[];
  color: string;
  strokeWidth: number;
}

export type Tool = 'pan' | 'brush' | 'eraser' | 'select' | 'lasso' | 'crop';

export interface CanvasSize {
  width: number;
  height: number;
}

export interface Position {
  x: number;
  y: number;
}

export interface ImageTransform {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Selection types
export interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LassoSelection {
  points: number[]; // [x1, y1, x2, y2, ...]
}

export type Selection = {
  type: 'rect' | 'lasso';
  rect?: SelectionRect;
  lasso?: LassoSelection;
} | null;

// Layer types
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  type: 'image' | 'drawing' | 'paste';
  // For image layer
  imageData?: HTMLImageElement;
  // For drawing layer
  lines?: DrawLine[];
  // For paste layer (floating selection)
  pasteData?: {
    imageData: ImageData;
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

// Clipboard types
export interface ClipboardData {
  imageData: ImageData;
  width: number;
  height: number;
}

export interface EditorState {
  image: HTMLImageElement | null;
  tool: Tool;
  lines: DrawLine[];
  rotation: number;
  scaleX: number;
  zoom: number;
  stagePos: Position;
  brushSize: number;
  brushColor: string;
  eraserSize: number;
  canvasSize: CanvasSize;
  error: string | null;
  saving: boolean;
}

// History types for undo/redo with layer support
export interface HistoryState {
  layers: Layer[];
  selection: Selection;
}
