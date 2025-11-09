export interface ImageEditorModalProps {
  open: boolean;
  imageId: number;
  imageUrl: string;
  onClose: () => void;
  onSaved?: () => void;
}

export interface DrawLine {
  tool: 'brush' | 'eraser';
  points: number[];
  color: string;
  strokeWidth: number;
}

export type Tool = 'pan' | 'brush' | 'eraser';

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
