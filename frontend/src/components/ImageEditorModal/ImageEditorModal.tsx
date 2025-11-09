import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Dialog, DialogContent } from '@mui/material';
import type { ImageEditorModalProps, Tool, CanvasSize } from './types/EditorTypes';
import { useHistory } from './hooks/useHistory';
import { useZoomPan } from './hooks/useZoomPan';
import { useDrawing } from './hooks/useDrawing';
import { getImageTransform, calculateInitialZoom } from './utils/imageTransform';
import { exportAndSaveCanvas } from './utils/canvasExport';
import { TopBar } from './components/TopBar';
import { LeftToolbar } from './components/LeftToolbar';
import { EditorCanvas } from './components/EditorCanvas';
import { RightPanel } from './components/RightPanel';
import { BottomActions } from './components/BottomActions';

const ImageEditorModal: React.FC<ImageEditorModalProps> = ({
  open,
  imageId,
  imageUrl,
  onClose,
  onSaved,
}) => {
  // Image state
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Tool state
  const [tool, setTool] = useState<Tool>('brush');
  const [brushSize, setBrushSize] = useState(5);
  const [brushColor, setBrushColor] = useState('#ff0000');
  const [eraserSize, setEraserSize] = useState(20);

  // Refs
  const stageRef = useRef<any>(null);
  const layerRef = useRef<any>(null);

  // Custom hooks
  const history = useHistory();
  const zoomPan = useZoomPan();
  const drawing = useDrawing({
    tool,
    brushSize,
    brushColor,
    eraserSize,
    zoom: zoomPan.zoom,
    stagePos: zoomPan.stagePos,
    onDrawingComplete: history.saveToHistory,
  });

  // Handle viewport resize
  const handleViewportResize = useCallback((width: number, height: number) => {
    setViewportSize({ width, height });
  }, []);

  // Load image and auto-fit to viewport
  useEffect(() => {
    if (!open) return;

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImage(img);
      setCanvasSize({ width: img.width, height: img.height });

      // Auto-fit image to viewport (standard image editor behavior)
      const initialZoom = calculateInitialZoom(
        img.width,
        img.height,
        viewportSize.width,
        viewportSize.height
      );
      zoomPan.setInitialZoom(initialZoom);
    };
    img.onerror = () => {
      setError('Failed to load image');
    };
    img.src = imageUrl;

    return () => {
      setImage(null);
      setCanvasSize({ width: 0, height: 0 });
      setError(null);
      history.reset();
      zoomPan.reset();
      drawing.reset();
    };
  }, [open, imageUrl, viewportSize.width, viewportSize.height]);

  // Calculate image transform
  const imageTransform = getImageTransform(
    image,
    canvasSize,
    zoomPan.rotation,
    viewportSize.width,
    viewportSize.height
  );

  // Event handlers
  const handleMouseDown = (e: any) => {
    if (tool === 'pan') {
      const pos = e.target.getStage().getPointerPosition();
      zoomPan.startPan(pos);
      return;
    }

    if (tool === 'brush' || tool === 'eraser') {
      const pos = e.target.getStage().getPointerPosition();
      drawing.startDrawing(pos);
    }
  };

  const handleMouseMove = (e: any) => {
    const stage = e.target.getStage();
    const point = stage.getPointerPosition();

    if (tool === 'pan') {
      zoomPan.movePan(point);
      return;
    }

    if (drawing.isDrawing) {
      drawing.continueDrawing(point);
    }
  };

  const handleMouseUp = () => {
    if (tool === 'pan') {
      zoomPan.endPan();
    }
    if (drawing.isDrawing) {
      drawing.endDrawing();
    }
  };

  const handleUndo = () => {
    const newLines = history.undo();
    if (newLines !== null) {
      drawing.setLinesFromHistory(newLines);
    }
  };

  const handleRedo = () => {
    const newLines = history.redo();
    if (newLines !== null) {
      drawing.setLinesFromHistory(newLines);
    }
  };

  const handleClear = () => {
    drawing.clearLines();
  };

  const handleSave = async () => {
    if (!layerRef.current) return;

    try {
      setSaving(true);
      setError(null);
      // Pass current zoom to ensure export at original resolution
      await exportAndSaveCanvas(layerRef.current, imageTransform, imageId, zoomPan.zoom);
      setSaving(false);
      onSaved?.();
      onClose();
    } catch (err: any) {
      console.error('Failed to save edited image:', err);
      setError(err.response?.data?.error || 'Failed to save image');
      setSaving(false);
    }
  };

  const getCursor = () => {
    if (tool === 'pan') return zoomPan.isPanning ? 'grabbing' : 'grab';
    if (tool === 'brush' || tool === 'eraser') return 'crosshair';
    return 'default';
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      PaperProps={{
        sx: {
          width: '95vw',
          height: '95vh',
          maxWidth: 'none',
          bgcolor: 'background.paper',
        },
      }}
    >
      <TopBar
        zoom={zoomPan.zoom}
        onZoomIn={zoomPan.handleZoomIn}
        onZoomOut={zoomPan.handleZoomOut}
        onFitScreen={zoomPan.handleFitScreen}
        onClose={onClose}
      />

      <DialogContent sx={{ p: 0, display: 'flex', height: '100%', overflow: 'hidden' }}>
        <LeftToolbar
          tool={tool}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          onToolChange={setTool}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onClear={handleClear}
          onRotate={zoomPan.handleRotate}
          onFlip={zoomPan.handleFlip}
        />

        <EditorCanvas
          image={image}
          error={error}
          lines={drawing.lines}
          imageTransform={imageTransform}
          rotation={zoomPan.rotation}
          scaleX={zoomPan.scaleX}
          zoom={zoomPan.zoom}
          stagePos={zoomPan.stagePos}
          cursor={getCursor()}
          stageRef={stageRef}
          layerRef={layerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={(e) => zoomPan.handleWheel(e, stageRef)}
          onViewportResize={handleViewportResize}
        />

        <RightPanel
          tool={tool}
          canvasSize={canvasSize}
          brushSize={brushSize}
          brushColor={brushColor}
          eraserSize={eraserSize}
          onBrushSizeChange={setBrushSize}
          onBrushColorChange={setBrushColor}
          onEraserSizeChange={setEraserSize}
        />
      </DialogContent>

      <BottomActions
        saving={saving}
        imageLoaded={!!image}
        onSave={handleSave}
        onCancel={onClose}
      />
    </Dialog>
  );
};

export default ImageEditorModal;
