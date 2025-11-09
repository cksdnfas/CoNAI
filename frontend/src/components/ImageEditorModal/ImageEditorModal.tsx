import React, { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  ToggleButtonGroup,
  ToggleButton,
  Slider,
  Typography,
  Stack,
  Alert,
  CircularProgress,
  Snackbar
} from '@mui/material';
import {
  Crop as CropIcon,
  Brush as BrushIcon,
  Clear as ClearIcon,
  Undo as UndoIcon,
  Redo as RedoIcon
} from '@mui/icons-material';
import { imageEditorApi } from '../../services/imageEditorApi';

interface ImageEditorModalProps {
  open: boolean;
  onClose: () => void;
  imageId: number;
  imageUrl: string;
}

type Tool = 'crop' | 'brush' | 'eraser';

interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ImageEditorModal: React.FC<ImageEditorModalProps> = ({
  open,
  onClose,
  imageId,
  imageUrl
}) => {
  const [tool, setTool] = useState<Tool>('crop');
  const [brushSize, setBrushSize] = useState(20);
  const [brushColor, setBrushColor] = useState('#ffffff');
  const [brushOpacity, setBrushOpacity] = useState(0.7);
  const [isDrawing, setIsDrawing] = useState(false);
  const [cropArea, setCropArea] = useState<CropArea | null>(null);
  const [isCropping, setIsCropping] = useState(false);
  const [loading, setLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [savingStatus, setSavingStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const colorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [history, setHistory] = useState<ImageData[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Load image
  useEffect(() => {
    if (!open) {
      // Reset on close
      setError(null);
      setCropArea(null);
      setHistory([]);
      setHistoryIndex(-1);
      setImageLoading(true);
      return;
    }

    console.log('Loading image for editor:', imageUrl);
    setError(null);
    setImageLoading(true);

    const img = new Image();

    img.onload = () => {
      console.log('Image loaded successfully:', img.width, 'x', img.height);
      imageRef.current = img;
      initializeCanvases();
      setImageLoading(false);
    };

    img.onerror = (e) => {
      console.error('Failed to load image:', e, 'URL:', imageUrl);
      setError(`Failed to load image from: ${imageUrl}`);
      setImageLoading(false);
    };

    // Try without CORS first
    img.src = imageUrl;
  }, [open, imageUrl]);

  const initializeCanvases = () => {
    if (!canvasRef.current || !maskCanvasRef.current || !imageRef.current) {
      console.warn('Canvas refs not ready, will retry...');
      // Retry after a short delay
      setTimeout(initializeCanvases, 50);
      return;
    }

    const img = imageRef.current;
    const canvas = canvasRef.current;
    const maskCanvas = maskCanvasRef.current;

    console.log('Initializing canvases with image size:', img.width, 'x', img.height);

    // Set canvas size to image size
    canvas.width = img.width;
    canvas.height = img.height;
    maskCanvas.width = img.width;
    maskCanvas.height = img.height;

    // Draw image on main canvas
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      console.log('Image drawn on canvas');
    }

    // Initialize mask canvas (transparent black)
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (maskCtx) {
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      saveHistory();
      console.log('Mask canvas initialized');
    }
  };

  const saveHistory = () => {
    if (!maskCanvasRef.current) return;

    const ctx = maskCanvasRef.current.getContext('2d');
    if (!ctx) return;

    const imageData = ctx.getImageData(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height);
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(imageData);
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  const undo = () => {
    if (historyIndex <= 0 || !maskCanvasRef.current) return;

    const newIndex = historyIndex - 1;
    const ctx = maskCanvasRef.current.getContext('2d');
    if (ctx) {
      ctx.putImageData(history[newIndex], 0, 0);
      setHistoryIndex(newIndex);
    }
  };

  const redo = () => {
    if (historyIndex >= history.length - 1 || !maskCanvasRef.current) return;

    const newIndex = historyIndex + 1;
    const ctx = maskCanvasRef.current.getContext('2d');
    if (ctx) {
      ctx.putImageData(history[newIndex], 0, 0);
      setHistoryIndex(newIndex);
    }
  };

  const getCanvasCoordinates = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return { x: 0, y: 0 };

    const rect = canvasRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoordinates(e);

    if (tool === 'crop') {
      setIsCropping(true);
      setCropArea({ x, y, width: 0, height: 0 });
    } else {
      setIsDrawing(true);
      draw(x, y);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = getCanvasCoordinates(e);

    if (tool === 'crop' && isCropping && cropArea) {
      setCropArea({
        ...cropArea,
        width: x - cropArea.x,
        height: y - cropArea.y
      });
      drawCropOverlay();
    } else if (isDrawing) {
      draw(x, y);
    }
  };

  const handleMouseUp = () => {
    if (isDrawing) {
      saveHistory();
    }
    setIsDrawing(false);
    setIsCropping(false);
  };

  const draw = (x: number, y: number) => {
    if (!maskCanvasRef.current) return;

    const ctx = maskCanvasRef.current.getContext('2d');
    if (!ctx) return;

    ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';

    // Convert hex color to rgb
    const hexToRgb = (hex: string) => {
      const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      } : { r: 255, g: 255, b: 255 };
    };

    const rgb = hexToRgb(brushColor);
    // Use full opacity for actual mask data
    ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1.0)`;
    ctx.beginPath();
    ctx.arc(x, y, brushSize, 0, Math.PI * 2);
    ctx.fill();

    renderComposite();
  };

  const drawCropOverlay = () => {
    if (!canvasRef.current || !imageRef.current || !cropArea) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Normalize crop area for proper display
    const normalizedCrop = {
      x: Math.min(cropArea.x, cropArea.x + cropArea.width),
      y: Math.min(cropArea.y, cropArea.y + cropArea.height),
      width: Math.abs(cropArea.width),
      height: Math.abs(cropArea.height)
    };

    // Redraw image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imageRef.current, 0, 0);

    // Draw dark overlay on areas that will be cropped OUT
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Clear crop area to show what will be KEPT
    ctx.clearRect(normalizedCrop.x, normalizedCrop.y, normalizedCrop.width, normalizedCrop.height);
    ctx.drawImage(
      imageRef.current,
      normalizedCrop.x,
      normalizedCrop.y,
      normalizedCrop.width,
      normalizedCrop.height,
      normalizedCrop.x,
      normalizedCrop.y,
      normalizedCrop.width,
      normalizedCrop.height
    );

    // Draw bright green border around selection
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 3;
    ctx.strokeRect(normalizedCrop.x, normalizedCrop.y, normalizedCrop.width, normalizedCrop.height);

    // Draw corner handles
    const handleSize = 10;
    ctx.fillStyle = '#00ff00';
    const corners = [
      { x: normalizedCrop.x, y: normalizedCrop.y }, // Top-left
      { x: normalizedCrop.x + normalizedCrop.width, y: normalizedCrop.y }, // Top-right
      { x: normalizedCrop.x, y: normalizedCrop.y + normalizedCrop.height }, // Bottom-left
      { x: normalizedCrop.x + normalizedCrop.width, y: normalizedCrop.y + normalizedCrop.height } // Bottom-right
    ];

    corners.forEach(corner => {
      ctx.fillRect(corner.x - handleSize / 2, corner.y - handleSize / 2, handleSize, handleSize);
    });

    // Draw dimension text
    if (normalizedCrop.width > 50 && normalizedCrop.height > 30) {
      const dimensionText = `${Math.round(normalizedCrop.width)} × ${Math.round(normalizedCrop.height)}`;
      ctx.font = 'bold 16px Arial';
      ctx.fillStyle = '#00ff00';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 3;

      const textMetrics = ctx.measureText(dimensionText);
      const textX = normalizedCrop.x + (normalizedCrop.width - textMetrics.width) / 2;
      const textY = normalizedCrop.y + normalizedCrop.height / 2;

      // Draw text background
      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(textX - 5, textY - 20, textMetrics.width + 10, 28);

      // Draw text with stroke
      ctx.strokeText(dimensionText, textX, textY);
      ctx.fillStyle = '#00ff00';
      ctx.fillText(dimensionText, textX, textY);
    }
  };

  const renderComposite = () => {
    if (!canvasRef.current || !imageRef.current || !maskCanvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Redraw image
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imageRef.current, 0, 0);

    // Draw mask overlay with user-defined opacity for visualization
    ctx.globalAlpha = brushOpacity;
    ctx.drawImage(maskCanvasRef.current, 0, 0);
    ctx.globalAlpha = 1.0;
  };

  const handleSaveImage = async () => {
    try {
      setLoading(true);
      setError(null);
      setSavingStatus('saving');

      if (!canvasRef.current || !imageRef.current) {
        throw new Error('Canvas not ready');
      }

      // Create a temporary canvas for final output
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) throw new Error('Failed to create temp canvas');

      let sourceCanvas = canvasRef.current;
      let sourceWidth = sourceCanvas.width;
      let sourceHeight = sourceCanvas.height;

      // Apply crop if specified
      if (cropArea && cropArea.width > 0 && cropArea.height > 0) {
        const cropX = Math.min(cropArea.x, cropArea.x + cropArea.width);
        const cropY = Math.min(cropArea.y, cropArea.y + cropArea.height);
        const cropW = Math.abs(cropArea.width);
        const cropH = Math.abs(cropArea.height);

        tempCanvas.width = cropW;
        tempCanvas.height = cropH;

        // Draw cropped image (without mask overlay)
        tempCtx.drawImage(
          imageRef.current,
          cropX, cropY, cropW, cropH,
          0, 0, cropW, cropH
        );

        sourceCanvas = tempCanvas;
        sourceWidth = cropW;
        sourceHeight = cropH;
      } else {
        tempCanvas.width = sourceWidth;
        tempCanvas.height = sourceHeight;
        tempCtx.drawImage(imageRef.current, 0, 0);
        sourceCanvas = tempCanvas;
      }

      // Get final image as base64
      const imageData = sourceCanvas.toDataURL('image/png');

      // Get mask as base64 if exists
      let maskData: string | undefined;
      if (maskCanvasRef.current) {
        // Apply crop to mask if needed
        if (cropArea && cropArea.width > 0 && cropArea.height > 0) {
          const maskTempCanvas = document.createElement('canvas');
          const maskTempCtx = maskTempCanvas.getContext('2d');
          if (maskTempCtx) {
            const cropX = Math.min(cropArea.x, cropArea.x + cropArea.width);
            const cropY = Math.min(cropArea.y, cropArea.y + cropArea.height);
            const cropW = Math.abs(cropArea.width);
            const cropH = Math.abs(cropArea.height);

            maskTempCanvas.width = cropW;
            maskTempCanvas.height = cropH;
            maskTempCtx.drawImage(
              maskCanvasRef.current,
              cropX, cropY, cropW, cropH,
              0, 0, cropW, cropH
            );
            maskData = maskTempCanvas.toDataURL('image/png');
          }
        } else {
          maskData = maskCanvasRef.current.toDataURL('image/png');
        }
      }

      const response = await imageEditorApi.saveEditedImage(imageId, imageData, maskData);

      if (response.success && response.data) {
        setSavingStatus('success');
        const folderPath = response.data.message || 'uploads/temp/canvas/';
        setSuccessMessage(folderPath);
        setTimeout(() => {
          onClose();
        }, 2000);
      } else {
        setSavingStatus('error');
        setError(response.error || 'Failed to save image');
      }
    } catch (err) {
      setSavingStatus('error');
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      hideBackdrop={false}
      disablePortal={false}
      style={{ zIndex: 1400 }}
    >
      <DialogTitle>Edit Image for img2img</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          <Box>
            <Typography variant="subtitle2" gutterBottom>
              Tool
            </Typography>
            <ToggleButtonGroup
              value={tool}
              exclusive
              onChange={(_, value) => value && setTool(value)}
              size="small"
            >
              <ToggleButton value="crop">
                <CropIcon /> Crop
              </ToggleButton>
              <ToggleButton value="brush">
                <BrushIcon /> Brush (Mask)
              </ToggleButton>
              <ToggleButton value="eraser">
                <ClearIcon /> Eraser
              </ToggleButton>
            </ToggleButtonGroup>

            <Box sx={{ ml: 2, display: 'inline-flex', gap: 1 }}>
              <Button size="small" onClick={undo} disabled={historyIndex <= 0}>
                <UndoIcon /> Undo
              </Button>
              <Button size="small" onClick={redo} disabled={historyIndex >= history.length - 1}>
                <RedoIcon /> Redo
              </Button>
            </Box>
          </Box>

          {(tool === 'brush' || tool === 'eraser') && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Brush Size: {brushSize}px
              </Typography>
              <Slider
                value={brushSize}
                onChange={(_, value) => setBrushSize(value as number)}
                min={5}
                max={100}
                sx={{ maxWidth: 300 }}
              />
            </Box>
          )}

          {tool === 'brush' && (
            <>
              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Brush Color
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <input
                    type="color"
                    defaultValue={brushColor}
                    onInput={(e) => {
                      const newColor = (e.target as HTMLInputElement).value;
                      if (colorTimeoutRef.current) {
                        clearTimeout(colorTimeoutRef.current);
                      }
                      colorTimeoutRef.current = setTimeout(() => {
                        setBrushColor(newColor);
                      }, 50);
                    }}
                    style={{
                      width: '60px',
                      height: '40px',
                      border: '1px solid #ccc',
                      borderRadius: '4px',
                      cursor: 'pointer'
                    }}
                  />
                  <Typography variant="body2" color="text.secondary">
                    {brushColor.toUpperCase()}
                  </Typography>
                </Box>
              </Box>

              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Brush Opacity: {Math.round(brushOpacity * 100)}%
                </Typography>
                <Slider
                  value={brushOpacity}
                  onChange={(_, value) => setBrushOpacity(value as number)}
                  min={0.1}
                  max={1.0}
                  step={0.1}
                  sx={{ maxWidth: 300 }}
                />
              </Box>
            </>
          )}

          <Box
            ref={containerRef}
            sx={{
              border: '1px solid #ccc',
              borderRadius: 1,
              overflow: 'auto',
              maxHeight: '60vh',
              minHeight: '400px',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              bgcolor: '#f5f5f5',
              position: 'relative'
            }}
          >
            {imageLoading ? (
              <Typography variant="body2" color="text.secondary">
                Loading image...
              </Typography>
            ) : (
              <>
                <canvas
                  ref={canvasRef}
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '60vh',
                    cursor: tool === 'crop' ? 'crosshair' : 'pointer',
                    display: 'block'
                  }}
                />
                <canvas
                  ref={maskCanvasRef}
                  style={{ display: 'none' }}
                />
              </>
            )}
          </Box>

          <Typography variant="caption" color="text.secondary">
            💡 Tip: {tool === 'crop'
              ? 'The bright area will be kept, dark areas will be removed'
              : 'Use brush to mark regions for inpainting'}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSaveImage}
          disabled={loading}
          variant="contained"
          startIcon={loading && savingStatus === 'saving' ? <CircularProgress size={16} /> : null}
        >
          {loading && savingStatus === 'saving' ? 'Saving...' : 'Save Image'}
        </Button>
      </DialogActions>

      <Snackbar
        open={!!successMessage}
        autoHideDuration={3000}
        onClose={() => setSuccessMessage(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setSuccessMessage(null)} severity="success" sx={{ width: '100%' }}>
          {successMessage}
        </Alert>
      </Snackbar>
    </Dialog>
  );
};
