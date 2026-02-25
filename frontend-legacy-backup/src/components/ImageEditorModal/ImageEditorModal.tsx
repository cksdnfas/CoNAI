import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, CircularProgress, Box, Typography } from '@mui/material';
import type { ImageEditorModalProps, Tool, CanvasSize, DrawLine } from './types/EditorTypes';
import { useHistory } from './hooks/useHistory';
import { useZoomPan } from './hooks/useZoomPan';
import { useDrawing } from './hooks/useDrawing';
import { useLayer } from './hooks/useLayer';
import { useSelection } from './hooks/useSelection';
import { useClipboard } from './hooks/useClipboard';
import { useCrop } from './hooks/useCrop';
import { getImageTransform, calculateInitialZoom } from './utils/imageTransform';
import { exportCanvasToDataURL } from './utils/canvasExport';
import { TopBar } from './components/TopBar';
import { LeftToolbar } from './components/LeftToolbar';
import { EditorCanvas } from './components/EditorCanvas';
import { RightPanel } from './components/RightPanel';
import { BottomActions } from './components/BottomActions';
import axios from 'axios';

const ImageEditorModal: React.FC<ImageEditorModalProps> = ({
  open,
  imageId,
  canvasFilename,
  onClose,
  onSaved,
}) => {
  // Determine if editing a canvas image
  const isCanvasMode = !!canvasFilename && !imageId;
  // Image state
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = useState({ width: 800, height: 600 });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  // Tool state
  const [tool, setTool] = useState<Tool>('brush');
  const [previousTool, setPreviousTool] = useState<Tool>('brush');
  const [brushSize, setBrushSize] = useState(30);
  const [brushColor, setBrushColor] = useState('#ff0000');
  const [eraserSize, setEraserSize] = useState(30);

  // UI state
  const [isMiddleMousePanning, setIsMiddleMousePanning] = useState(false);
  const [isSpacebarPanning, setIsSpacebarPanning] = useState(false);

  // Refs
  const stageRef = useRef<any>(null);
  const layerRef = useRef<any>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Refs for stable coordinates (updated via useEffect)
  const zoomRef = useRef(1);
  const stagePosRef = useRef({ x: 0, y: 0 });
  const rotationRef = useRef(0);
  const scaleXRef = useRef(1);
  const canvasSizeRef = useRef<CanvasSize>({ width: 0, height: 0 });
  const viewportSizeRef = useRef({ width: 800, height: 600 });

  // Custom hooks
  const history = useHistory();
  const zoomPan = useZoomPan();
  const layerManager = useLayer();

  // Update refs when values change
  useEffect(() => {
    zoomRef.current = zoomPan.zoom;
    stagePosRef.current = zoomPan.stagePos;
    rotationRef.current = zoomPan.rotation;
    scaleXRef.current = zoomPan.scaleX;
  }, [zoomPan.zoom, zoomPan.stagePos, zoomPan.rotation, zoomPan.scaleX]);

  useEffect(() => {
    canvasSizeRef.current = canvasSize;
  }, [canvasSize]);

  useEffect(() => {
    viewportSizeRef.current = viewportSize;
  }, [viewportSize]);

  // Drawing hook
  const drawing = useDrawing({
    tool,
    brushSize,
    brushColor,
    eraserSize,
    zoomRef,
    stagePosRef,
    rotationRef,
    scaleXRef,
    canvasSizeRef,
    viewportSizeRef,
    onDrawingComplete: (lines: DrawLine[]) => {
      history.saveToHistory(lines);
      layerManager.updateActiveLayerLines(lines);
    },
  });

  // Selection hook
  const selection = useSelection({
    zoomRef,
    stagePosRef,
    rotationRef,
    scaleXRef,
    canvasSizeRef,
    viewportSizeRef,
  });

  // Clipboard hook
  const clipboard = useClipboard({
    canvasSizeRef,
  });

  // Crop hook
  const crop = useCrop({
    zoomRef,
    stagePosRef,
    rotationRef,
    scaleXRef,
    canvasSizeRef,
    viewportSizeRef,
  });

  // Handle viewport resize
  const handleViewportResize = useCallback((width: number, height: number) => {
    setViewportSize({ width, height });
  }, []);

  // Calculate centered stage position for initial load
  const calculateCenteredPosition = useCallback((
    imgWidth: number,
    imgHeight: number,
    vpWidth: number,
    vpHeight: number,
    zoom: number
  ) => {
    const stageX = (vpWidth - vpWidth * zoom) / 2;
    const stageY = (vpHeight - vpHeight * zoom) / 2;
    return { x: stageX, y: stageY };
  }, []);

  // Load image as WebP from backend
  useEffect(() => {
    if (!open) return;
    if (!imageId && !canvasFilename) return;

    setLoading(true);
    setError(null);

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setImage(img);
      setCanvasSize({ width: img.width, height: img.height });

      // Initialize layers
      layerManager.initializeLayers(img);

      const initialZoom = calculateInitialZoom(
        img.width,
        img.height,
        viewportSize.width,
        viewportSize.height
      );

      const centeredPos = calculateCenteredPosition(
        img.width,
        img.height,
        viewportSize.width,
        viewportSize.height,
        initialZoom
      );

      zoomPan.setInitialZoomAndPosition(initialZoom, centeredPos);
      setLoading(false);
    };
    img.onerror = () => {
      setError('Failed to load image');
      setLoading(false);
    };

    // Use appropriate endpoint based on mode
    if (isCanvasMode && canvasFilename) {
      img.src = `/api/image-editor/canvas/${encodeURIComponent(canvasFilename)}/webp`;
    } else if (imageId) {
      img.src = `/api/image-editor/${imageId}/webp`;
    }

    return () => {
      setImage(null);
      setCanvasSize({ width: 0, height: 0 });
      setError(null);
      history.reset();
      zoomPan.reset();
      drawing.reset();
      layerManager.reset();
      selection.reset();
      clipboard.reset();
      crop.reset();
    };
  }, [open, imageId, canvasFilename, isCanvasMode]);

  // Recalculate zoom when viewport size changes
  useEffect(() => {
    if (image && viewportSize.width > 0 && viewportSize.height > 0) {
      const initialZoom = calculateInitialZoom(
        image.width,
        image.height,
        viewportSize.width,
        viewportSize.height
      );

      const centeredPos = calculateCenteredPosition(
        image.width,
        image.height,
        viewportSize.width,
        viewportSize.height,
        initialZoom
      );

      zoomPan.setInitialZoomAndPosition(initialZoom, centeredPos);
    }
  }, [viewportSize.width, viewportSize.height]);

  // Apply (confirm) paste layer - merge it into the base image
  // Defined before keyboard shortcuts useEffect to avoid reference error
  const handleApplyPaste = useCallback(() => {
    const activePasteLayer = layerManager.getActivePasteLayer();
    if (!activePasteLayer || !image) return;

    const pasteData = layerManager.applyPasteLayer(activePasteLayer.id);
    if (!pasteData) return;

    // Create a canvas to composite the paste layer onto the image
    const canvas = document.createElement('canvas');
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw original image
    ctx.drawImage(image, 0, 0, canvasSize.width, canvasSize.height);

    // Draw all existing drawing layer lines
    const allLines = layerManager.getAllVisibleLines();
    for (const line of allLines) {
      if (line.points.length < 4) continue;

      ctx.beginPath();
      ctx.strokeStyle = line.color;
      ctx.lineWidth = line.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalCompositeOperation = line.tool === 'eraser' ? 'destination-out' : 'source-over';

      ctx.moveTo(line.points[0], line.points[1]);
      for (let i = 2; i < line.points.length; i += 2) {
        ctx.lineTo(line.points[i], line.points[i + 1]);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // Draw paste layer image data
    const pasteCanvas = document.createElement('canvas');
    pasteCanvas.width = pasteData.width;
    pasteCanvas.height = pasteData.height;
    const pasteCtx = pasteCanvas.getContext('2d');
    if (pasteCtx) {
      pasteCtx.putImageData(pasteData.imageData, 0, 0);
      ctx.drawImage(pasteCanvas, pasteData.x, pasteData.y);
    }

    // Create new image from composited canvas
    const newImage = new window.Image();
    newImage.onload = () => {
      setImage(newImage);
      drawing.clearLines();
      layerManager.initializeLayers(newImage);
      history.reset();
    };
    newImage.src = canvas.toDataURL('image/png');
  }, [image, canvasSize, layerManager, drawing, history]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Stop propagation to prevent ImageViewer from receiving keyboard events
      e.stopPropagation();

      // Prevent default for our shortcuts
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;

      // Spacebar pan mode
      if (e.code === 'Space' && !isSpacebarPanning) {
        e.preventDefault();
        setIsSpacebarPanning(true);
        setPreviousTool(tool);
        return;
      }

      // Ctrl+Z: Undo
      if (ctrl && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Ctrl+Y or Ctrl+Shift+Z: Redo
      if ((ctrl && key === 'y') || (ctrl && e.shiftKey && key === 'z')) {
        e.preventDefault();
        handleRedo();
        return;
      }

      // Ctrl+A: Select All
      if (ctrl && key === 'a') {
        e.preventDefault();
        selection.selectAll();
        setTool('select');
        return;
      }

      // Ctrl+C: Copy
      if (ctrl && key === 'c' && selection.selection) {
        e.preventDefault();
        handleCopy();
        return;
      }

      // Ctrl+X: Cut
      if (ctrl && key === 'x' && selection.selection) {
        e.preventDefault();
        handleCut();
        return;
      }

      // Ctrl+V: Paste
      if (ctrl && key === 'v') {
        e.preventDefault();
        handlePaste();
        return;
      }

      // Enter: Apply crop or confirm paste
      if (key === 'enter') {
        e.preventDefault();
        // Priority: crop > paste layer
        if (tool === 'crop' && crop.cropRect) {
          handleApplyCrop();
          return;
        }
        // Confirm paste layer if active
        if (layerManager.getActivePasteLayer()) {
          handleApplyPaste();
          return;
        }
        return;
      }

      // Escape: Clear selection or crop
      if (key === 'escape') {
        e.preventDefault();
        if (tool === 'crop') {
          crop.clearCrop();
        } else {
          selection.clearSelection();
        }
        return;
      }

      // Delete/Backspace: Delete selection
      if ((key === 'delete' || key === 'backspace') && selection.selection) {
        e.preventDefault();
        // TODO: Implement delete selection
        selection.clearSelection();
        return;
      }

      // Tool shortcuts (only when not pressing Ctrl)
      if (!ctrl) {
        switch (key) {
          case 'v':
          case 'h':
            setTool('pan');
            break;
          case 'b':
            setTool('brush');
            break;
          case 'e':
            setTool('eraser');
            break;
          case 'm':
            setTool('select');
            break;
          case 'l':
            setTool('lasso');
            break;
          case 'c':
            setTool('crop');
            break;
          case 'r':
            zoomPan.handleRotate();
            break;
          case 'f':
            zoomPan.handleFlip();
            break;
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Stop propagation to prevent ImageViewer from receiving keyboard events
      e.stopPropagation();

      if (e.code === 'Space' && isSpacebarPanning) {
        setIsSpacebarPanning(false);
        setTool(previousTool);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [open, tool, previousTool, isSpacebarPanning, selection.selection, crop.cropRect, handleApplyPaste, layerManager]);

  // Calculate image transform for display
  const imageTransform = getImageTransform(
    image,
    canvasSize,
    zoomPan.rotation,
    zoomPan.scaleX,
    viewportSize.width,
    viewportSize.height
  );

  // Event handlers
  const handleMouseDown = (e: any) => {
    const evt = e.evt;
    const stage = e.target.getStage();
    const pos = stage.getPointerPosition();

    // Middle mouse button for temporary pan
    if (evt.button === 1) {
      evt.preventDefault();
      setIsMiddleMousePanning(true);
      setPreviousTool(tool);
      zoomPan.startPan(pos);
      return;
    }

    // Left mouse button
    if (evt.button === 0) {
      // Pan mode (including spacebar pan)
      if (tool === 'pan' || isSpacebarPanning) {
        zoomPan.startPan(pos);
        return;
      }

      // Selection tools
      if (tool === 'select') {
        selection.startRectSelection(pos);
        return;
      }

      if (tool === 'lasso') {
        selection.startLassoSelection(pos);
        return;
      }

      // Crop tool
      if (tool === 'crop') {
        crop.startCrop(pos);
        return;
      }

      // Drawing tools
      if (tool === 'brush' || tool === 'eraser') {
        drawing.startDrawing(pos);
      }
    }
  };

  const handleMouseMove = (e: any) => {
    const stage = e.target.getStage();
    const point = stage.getPointerPosition();

    // Middle mouse pan
    if (isMiddleMousePanning) {
      zoomPan.movePan(point);
      return;
    }

    // Pan mode
    if (tool === 'pan' || isSpacebarPanning) {
      zoomPan.movePan(point);
      return;
    }

    // Selection
    if (selection.isSelecting) {
      selection.continueSelection(point);
      return;
    }

    // Crop
    if (crop.isCropping) {
      crop.continueCrop(point);
      return;
    }

    if (crop.isResizing) {
      crop.continueResize(point);
      return;
    }

    // Drawing
    if (drawing.isDrawing) {
      drawing.continueDrawing(point);
    }
  };

  const handleMouseUp = (e?: any) => {
    const evt = e?.evt;

    // Middle mouse pan end
    if (isMiddleMousePanning && (!evt || evt.button === 1)) {
      setIsMiddleMousePanning(false);
      zoomPan.endPan();
      return;
    }

    // Pan mode
    if (tool === 'pan' || isSpacebarPanning) {
      zoomPan.endPan();
    }

    // Selection
    if (selection.isSelecting) {
      selection.endSelection();
    }

    // Crop
    if (crop.isCropping) {
      crop.endCrop();
    }

    if (crop.isResizing) {
      crop.endResize();
    }

    // Drawing
    if (drawing.isDrawing) {
      drawing.endDrawing();
    }
  };

  const handleUndo = () => {
    const newLines = history.undo();
    if (newLines !== null) {
      drawing.setLinesFromHistory(newLines);
      layerManager.updateActiveLayerLines(newLines);
    }
  };

  const handleRedo = () => {
    const newLines = history.redo();
    if (newLines !== null) {
      drawing.setLinesFromHistory(newLines);
      layerManager.updateActiveLayerLines(newLines);
    }
  };

  const handleClear = () => {
    drawing.clearLines();
    layerManager.updateActiveLayerLines([]);
  };

  const handleCopy = () => {
    if (!image || !selection.selection) return;
    clipboard.copy(image, layerManager.layers, selection.selection);
  };

  const handleCut = () => {
    if (!image || !selection.selection) return;
    const result = clipboard.cut(image, layerManager.layers, selection.selection);
    if (result.success) {
      // Clear selection area - for now just clear selection
      selection.clearSelection();
    }
  };

  const handlePaste = async () => {
    const pasteData = await clipboard.pasteFromSystem();
    if (pasteData) {
      layerManager.addPasteLayer(pasteData.imageData, pasteData.x, pasteData.y);
    }
  };

  const handleApplyCrop = () => {
    if (!image || !crop.cropRect) return;

    const result = crop.applyCrop(
      image,
      drawing.lines,
      zoomPan.rotation,
      zoomPan.scaleX
    );

    if (result) {
      // Create new image from cropped canvas
      const croppedImage = new window.Image();
      croppedImage.onload = () => {
        setImage(croppedImage);
        setCanvasSize(result.newCanvasSize);
        drawing.clearLines();
        history.reset();
        layerManager.initializeLayers(croppedImage);

        // Reset rotation/flip
        zoomPan.reset();

        // Recenter
        const initialZoom = calculateInitialZoom(
          result.newCanvasSize.width,
          result.newCanvasSize.height,
          viewportSize.width,
          viewportSize.height
        );
        const centeredPos = calculateCenteredPosition(
          result.newCanvasSize.width,
          result.newCanvasSize.height,
          viewportSize.width,
          viewportSize.height,
          initialZoom
        );
        zoomPan.setInitialZoomAndPosition(initialZoom, centeredPos);
      };
      croppedImage.src = result.croppedImage.toDataURL('image/png');
    }

    crop.clearCrop();
    setTool('brush');
  };

  const handleSelectAll = () => {
    selection.selectAll();
    setTool('select');
  };

  const handleSave = async () => {
    if (!image) return;

    try {
      setSaving(true);
      setError(null);

      // Get all lines from visible layers
      const allLines = layerManager.getAllVisibleLines();

      // Export using offscreen canvas at original resolution
      const dataURL = exportCanvasToDataURL(
        image,
        allLines,
        canvasSize,
        zoomPan.rotation,
        zoomPan.scaleX
      );

      // Use appropriate endpoint based on mode
      if (isCanvasMode && canvasFilename) {
        await axios.post(`/api/image-editor/canvas/${encodeURIComponent(canvasFilename)}/save-webp`, {
          imageData: dataURL,
          quality: 90,
          createNew: false, // Overwrite existing canvas image
        });
      } else if (imageId) {
        await axios.post(`/api/image-editor/${imageId}/save-webp`, {
          imageData: dataURL,
          quality: 90,
        });
      }

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
    if (isMiddleMousePanning || isSpacebarPanning) return 'grabbing';
    if (tool === 'pan') return zoomPan.isPanning ? 'grabbing' : 'grab';
    if (tool === 'brush' || tool === 'eraser') return 'crosshair';
    if (tool === 'select' || tool === 'lasso') return 'crosshair';
    if (tool === 'crop') return crop.isCropping ? 'crosshair' : 'crosshair';
    return 'default';
  };

  return (
    <Dialog
      ref={dialogRef}
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
        onFitScreen={() => {
          if (image) {
            const fitZoom = calculateInitialZoom(
              image.width,
              image.height,
              viewportSize.width,
              viewportSize.height
            );
            const centeredPos = calculateCenteredPosition(
              image.width,
              image.height,
              viewportSize.width,
              viewportSize.height,
              fitZoom
            );
            zoomPan.setInitialZoomAndPosition(fitZoom, centeredPos);
          }
        }}
        onClose={onClose}
      />

      <DialogContent sx={{ p: 0, display: 'flex', height: '100%', overflow: 'hidden' }}>
        <LeftToolbar
          tool={tool}
          canUndo={history.canUndo}
          canRedo={history.canRedo}
          hasSelection={!!selection.selection}
          hasClipboard={clipboard.hasClipboardData()}
          hasPasteLayer={!!layerManager.getActivePasteLayer()}
          onToolChange={setTool}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onClear={handleClear}
          onRotate={zoomPan.handleRotate}
          onFlip={zoomPan.handleFlip}
          onSelectAll={handleSelectAll}
          onCut={handleCut}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onApplyCrop={handleApplyCrop}
          onApplyPaste={handleApplyPaste}
        />

        {loading ? (
          <Box
            sx={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              bgcolor: '#2a2a2a',
            }}
          >
            <CircularProgress size={48} />
            <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
              Loading image...
            </Typography>
          </Box>
        ) : (
          <EditorCanvas
            image={image}
            error={error}
            layers={layerManager.layers}
            activeLayerId={layerManager.activeLayerId}
            imageTransform={imageTransform}
            canvasSize={canvasSize}
            rotation={zoomPan.rotation}
            scaleX={zoomPan.scaleX}
            zoom={zoomPan.zoom}
            stagePos={zoomPan.stagePos}
            cursor={getCursor()}
            stageRef={stageRef}
            layerRef={layerRef}
            selection={selection.selection}
            cropRect={crop.cropRect}
            isCropMode={tool === 'crop'}
            currentDrawingLines={drawing.lines}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onWheel={(e) => zoomPan.handleWheel(e, stageRef)}
            onViewportResize={handleViewportResize}
            onPasteLayerDrag={layerManager.movePasteLayer}
          />
        )}

        <RightPanel
          tool={tool}
          canvasSize={canvasSize}
          brushSize={brushSize}
          brushColor={brushColor}
          eraserSize={eraserSize}
          onBrushSizeChange={setBrushSize}
          onBrushColorChange={setBrushColor}
          onEraserSizeChange={setEraserSize}
          layers={layerManager.layers}
          activeLayerId={layerManager.activeLayerId}
          onSelectLayer={layerManager.setActiveLayerId}
          onToggleVisibility={layerManager.toggleLayerVisibility}
          onToggleLock={layerManager.toggleLayerLock}
          onSetOpacity={layerManager.setLayerOpacity}
          onMoveLayer={layerManager.moveLayer}
          onDeleteLayer={layerManager.removeLayer}
          onAddLayer={() => layerManager.addLayer()}
          onFlattenLayers={layerManager.flattenLayers}
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
