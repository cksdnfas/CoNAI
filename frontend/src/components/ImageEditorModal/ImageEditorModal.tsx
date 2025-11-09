import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Rect, Circle, Text, Transformer, Arrow } from 'react-konva';
import Konva from 'konva';
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
  Snackbar,
  Paper,
  IconButton,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Divider,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Tooltip,
  useMediaQuery,
  useTheme,
  Drawer
} from '@mui/material';
import {
  Crop as CropIcon,
  Brush as BrushIcon,
  FormatShapes as ShapesIcon,
  TextFields as TextIcon,
  Transform as TransformIcon,
  Undo as UndoIcon,
  Redo as RedoIcon,
  Layers as LayersIcon,
  FilterVintage as FilterIcon,
  Delete as DeleteIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  ArrowUpward as ArrowUpIcon,
  ArrowDownward as ArrowDownIcon,
  Add as AddIcon,
  ExpandMore as ExpandMoreIcon,
  Close as CloseIcon,
  FlipToFront as FlipToFrontIcon,
  FlipToBack as FlipToBackIcon,
  RotateRight as RotateRightIcon,
  RotateLeft as RotateLeftIcon,
  Flip as FlipIcon
} from '@mui/icons-material';
import { imageEditorApi } from '../../services/imageEditorApi';

interface ImageEditorModalProps {
  open: boolean;
  onClose: () => void;
  imageId: number;
  imageUrl: string;
}

type Tool = 'select' | 'crop' | 'brush' | 'eraser' | 'text' | 'rectangle' | 'circle' | 'line' | 'arrow';

interface KonvaNode {
  id: string;
  type: 'image' | 'line' | 'rect' | 'circle' | 'text' | 'arrow';
  layerId: string;
  attrs: any;
}

interface EditorLayer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
}

interface HistoryState {
  layers: EditorLayer[];
  nodes: KonvaNode[];
  stageAttrs: {
    scale: number;
    position: { x: number; y: number };
  };
}

interface FilterConfig {
  name: string;
  enabled: boolean;
  params: { [key: string]: number };
}

export const ImageEditorModal: React.FC<ImageEditorModalProps> = ({
  open,
  onClose,
  imageId,
  imageUrl
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // Tool state
  const [tool, setTool] = useState<Tool>('select');
  const [brushSize, setBrushSize] = useState(5);
  const [brushColor, setBrushColor] = useState('#000000');
  const [eraserSize, setEraserSize] = useState(20);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Layer management
  const [layers, setLayers] = useState<EditorLayer[]>([
    { id: 'image-layer', name: 'Image', visible: true, opacity: 1, locked: false },
    { id: 'drawing-layer', name: 'Drawing', visible: true, opacity: 1, locked: false }
  ]);
  const [activeLayerId, setActiveLayerId] = useState('drawing-layer');

  // Canvas state
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageLoading, setImageLoading] = useState(true);
  const [konvaNodes, setKonvaNodes] = useState<KonvaNode[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentLine, setCurrentLine] = useState<number[]>([]);

  // Transform state
  const [stageScale, setStageScale] = useState(1);
  const [stagePosition, setStagePosition] = useState({ x: 0, y: 0 });
  const [cropRect, setCropRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // History
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Filters
  const [filters, setFilters] = useState<FilterConfig[]>([
    { name: 'Blur', enabled: false, params: { blurRadius: 5 } },
    { name: 'Brighten', enabled: false, params: { brightness: 0.1 } },
    { name: 'Contrast', enabled: false, params: { contrast: 20 } },
    { name: 'Grayscale', enabled: false, params: {} },
    { name: 'Invert', enabled: false, params: {} },
    { name: 'HSL', enabled: false, params: { hue: 0, saturation: 0, luminance: 0 } }
  ]);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [layerPanelOpen, setLayerPanelOpen] = useState(!isMobile);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  // Text tool state
  const [textValue, setTextValue] = useState('');
  const [fontSize, setFontSize] = useState(24);
  const [fontFamily, setFontFamily] = useState('Arial');

  // Shape tool state
  const [fillColor, setFillColor] = useState('#ff0000');
  const [strokeColor, setStrokeColor] = useState('#000000');
  const [strokeWidth, setStrokeWidth] = useState(2);

  // Refs
  const stageRef = useRef<Konva.Stage>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const imageNodeRef = useRef<Konva.Image>(null);

  // Load image
  useEffect(() => {
    if (!open) {
      resetEditor();
      return;
    }

    setImageLoading(true);
    setError(null);

    const img = new window.Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      setImage(img);

      // Add image node
      const imageNode: KonvaNode = {
        id: 'main-image',
        type: 'image',
        layerId: 'image-layer',
        attrs: {
          x: 0,
          y: 0,
          image: img,
          width: img.width,
          height: img.height
        }
      };

      setKonvaNodes([imageNode]);
      setImageLoading(false);

      // Center stage
      if (stageRef.current) {
        const stage = stageRef.current;
        const scale = Math.min(
          (stage.width() - 100) / img.width,
          (stage.height() - 100) / img.height,
          1
        );
        setStageScale(scale);
        setStagePosition({
          x: (stage.width() - img.width * scale) / 2,
          y: (stage.height() - img.height * scale) / 2
        });
      }

      saveHistory();
    };

    img.onerror = () => {
      setError('Failed to load image');
      setImageLoading(false);
    };

    img.src = imageUrl;
  }, [open, imageUrl]);

  // Update transformer when selection changes
  useEffect(() => {
    if (transformerRef.current && selectedId) {
      const stage = stageRef.current;
      if (!stage) return;

      const selectedNode = stage.findOne(`#${selectedId}`);
      if (selectedNode) {
        transformerRef.current.nodes([selectedNode]);
        transformerRef.current.getLayer()?.batchDraw();
      }
    } else if (transformerRef.current) {
      transformerRef.current.nodes([]);
    }
  }, [selectedId]);

  const resetEditor = () => {
    setImage(null);
    setKonvaNodes([]);
    setSelectedId(null);
    setHistory([]);
    setHistoryIndex(-1);
    setImageLoading(true);
    setError(null);
    setCropRect(null);
    setStageScale(1);
    setStagePosition({ x: 0, y: 0 });
  };

  const saveHistory = useCallback(() => {
    const newState: HistoryState = {
      layers: JSON.parse(JSON.stringify(layers)),
      nodes: JSON.parse(JSON.stringify(konvaNodes)),
      stageAttrs: {
        scale: stageScale,
        position: { ...stagePosition }
      }
    };

    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(newState);

    // Limit history to 50 states
    if (newHistory.length > 50) {
      newHistory.shift();
    } else {
      setHistoryIndex(historyIndex + 1);
    }

    setHistory(newHistory);
  }, [layers, konvaNodes, stageScale, stagePosition, history, historyIndex]);

  const undo = () => {
    if (historyIndex <= 0) return;

    const newIndex = historyIndex - 1;
    const state = history[newIndex];

    setLayers(state.layers);
    setKonvaNodes(state.nodes);
    setStageScale(state.stageAttrs.scale);
    setStagePosition(state.stageAttrs.position);
    setHistoryIndex(newIndex);
  };

  const redo = () => {
    if (historyIndex >= history.length - 1) return;

    const newIndex = historyIndex + 1;
    const state = history[newIndex];

    setLayers(state.layers);
    setKonvaNodes(state.nodes);
    setStageScale(state.stageAttrs.scale);
    setStagePosition(state.stageAttrs.position);
    setHistoryIndex(newIndex);
  };

  // Mouse/Touch handlers
  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;

    // Click on stage background
    if (e.target === stage) {
      setSelectedId(null);
      return;
    }

    // Check if clicked on existing shape for Select tool only
    const clickedOnTransformer = e.target.getParent()?.className === 'Transformer';
    if (tool === 'select' && !clickedOnTransformer && e.target !== stage) {
      const id = e.target.id();
      // Don't select the main image
      if (id !== 'main-image') {
        setSelectedId(id);
      }
      return;
    }

    // For non-select tools, ignore clicks on existing objects (except background)
    if (tool !== 'select' && e.target !== stage && e.target.id() === 'main-image') {
      // Allow drawing on top of main image
    } else if (tool !== 'select' && e.target !== stage) {
      // Clicked on other objects, ignore
      return;
    }

    // Get pointer position
    const pos = stage.getPointerPosition();
    if (!pos) return;

    // Convert to layer coordinates
    const transform = stage.getAbsoluteTransform().copy().invert();
    const layerPos = transform.point(pos);

    const activeLayer = layers.find(l => l.id === activeLayerId);
    if (!activeLayer || activeLayer.locked) return;

    switch (tool) {
      case 'brush':
      case 'eraser':
        setIsDrawing(true);
        setCurrentLine([layerPos.x, layerPos.y]);
        break;

      case 'text':
        if (textValue.trim()) {
          const textNode: KonvaNode = {
            id: `text-${Date.now()}`,
            type: 'text',
            layerId: activeLayerId,
            attrs: {
              x: layerPos.x,
              y: layerPos.y,
              text: textValue,
              fontSize,
              fontFamily,
              fill: brushColor,
              draggable: true
            }
          };
          setKonvaNodes([...konvaNodes, textNode]);
          setTextValue('');
          saveHistory();
        }
        break;

      case 'rectangle':
        const rectNode: KonvaNode = {
          id: `rect-${Date.now()}`,
          type: 'rect',
          layerId: activeLayerId,
          attrs: {
            x: layerPos.x,
            y: layerPos.y,
            width: 100,
            height: 100,
            fill: fillColor,
            stroke: strokeColor,
            strokeWidth,
            draggable: true
          }
        };
        setKonvaNodes([...konvaNodes, rectNode]);
        saveHistory();
        break;

      case 'circle':
        const circleNode: KonvaNode = {
          id: `circle-${Date.now()}`,
          type: 'circle',
          layerId: activeLayerId,
          attrs: {
            x: layerPos.x,
            y: layerPos.y,
            radius: 50,
            fill: fillColor,
            stroke: strokeColor,
            strokeWidth,
            draggable: true
          }
        };
        setKonvaNodes([...konvaNodes, circleNode]);
        saveHistory();
        break;

      case 'line':
      case 'arrow':
        setIsDrawing(true);
        setCurrentLine([layerPos.x, layerPos.y, layerPos.x, layerPos.y]);
        break;

      case 'crop':
        setCropRect({
          x: layerPos.x,
          y: layerPos.y,
          width: 0,
          height: 0
        });
        setIsDrawing(true);
        break;
    }
  };

  const handleStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (!isDrawing) return;

    const stage = e.target.getStage();
    if (!stage) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    const transform = stage.getAbsoluteTransform().copy().invert();
    const layerPos = transform.point(pos);

    switch (tool) {
      case 'brush':
      case 'eraser':
        setCurrentLine([...currentLine, layerPos.x, layerPos.y]);
        break;

      case 'line':
      case 'arrow':
        setCurrentLine([currentLine[0], currentLine[1], layerPos.x, layerPos.y]);
        break;

      case 'crop':
        if (cropRect) {
          setCropRect({
            ...cropRect,
            width: layerPos.x - cropRect.x,
            height: layerPos.y - cropRect.y
          });
        }
        break;
    }
  };

  const handleStageMouseUp = () => {
    if (!isDrawing) return;

    const activeLayer = layers.find(l => l.id === activeLayerId);
    if (!activeLayer || activeLayer.locked) {
      setIsDrawing(false);
      setCurrentLine([]);
      return;
    }

    switch (tool) {
      case 'brush':
        if (currentLine.length > 2) {
          const lineNode: KonvaNode = {
            id: `line-${Date.now()}`,
            type: 'line',
            layerId: activeLayerId,
            attrs: {
              points: currentLine,
              stroke: brushColor,
              strokeWidth: brushSize,
              tension: 0.5,
              lineCap: 'round',
              lineJoin: 'round',
              globalCompositeOperation: 'source-over'
            }
          };
          setKonvaNodes([...konvaNodes, lineNode]);
          saveHistory();
        }
        break;

      case 'eraser':
        if (currentLine.length > 2) {
          const eraserNode: KonvaNode = {
            id: `eraser-${Date.now()}`,
            type: 'line',
            layerId: activeLayerId,
            attrs: {
              points: currentLine,
              stroke: '#ffffff',
              strokeWidth: eraserSize,
              tension: 0.5,
              lineCap: 'round',
              lineJoin: 'round',
              globalCompositeOperation: 'destination-out'
            }
          };
          setKonvaNodes([...konvaNodes, eraserNode]);
          saveHistory();
        }
        break;

      case 'line':
        if (currentLine.length === 4) {
          const lineNode: KonvaNode = {
            id: `line-${Date.now()}`,
            type: 'line',
            layerId: activeLayerId,
            attrs: {
              points: currentLine,
              stroke: strokeColor,
              strokeWidth,
              draggable: true
            }
          };
          setKonvaNodes([...konvaNodes, lineNode]);
          saveHistory();
        }
        break;

      case 'arrow':
        if (currentLine.length === 4) {
          const arrowNode: KonvaNode = {
            id: `arrow-${Date.now()}`,
            type: 'arrow',
            layerId: activeLayerId,
            attrs: {
              points: currentLine,
              stroke: strokeColor,
              strokeWidth,
              fill: strokeColor,
              pointerLength: 10,
              pointerWidth: 10,
              draggable: true
            }
          };
          setKonvaNodes([...konvaNodes, arrowNode]);
          saveHistory();
        }
        break;

      case 'crop':
        // Crop will be applied on save
        break;
    }

    setIsDrawing(false);
    setCurrentLine([]);
  };

  // Wheel zoom
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();

    const stage = stageRef.current;
    if (!stage) return;

    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale
    };

    const newScale = e.evt.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
    const clampedScale = Math.max(0.1, Math.min(5, newScale));

    setStageScale(clampedScale);
    setStagePosition({
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale
    });
  };

  // Layer management
  const addLayer = () => {
    const newLayer: EditorLayer = {
      id: `layer-${Date.now()}`,
      name: `Layer ${layers.length + 1}`,
      visible: true,
      opacity: 1,
      locked: false
    };
    setLayers([...layers, newLayer]);
    setActiveLayerId(newLayer.id);
  };

  const deleteLayer = (layerId: string) => {
    if (layers.length <= 1) return;

    setLayers(layers.filter(l => l.id !== layerId));
    setKonvaNodes(konvaNodes.filter(n => n.layerId !== layerId));

    if (activeLayerId === layerId) {
      setActiveLayerId(layers[0].id);
    }

    saveHistory();
  };

  const toggleLayerVisibility = (layerId: string) => {
    setLayers(layers.map(l =>
      l.id === layerId ? { ...l, visible: !l.visible } : l
    ));
  };

  const toggleLayerLock = (layerId: string) => {
    setLayers(layers.map(l =>
      l.id === layerId ? { ...l, locked: !l.locked } : l
    ));
  };

  const moveLayer = (layerId: string, direction: 'up' | 'down') => {
    const index = layers.findIndex(l => l.id === layerId);
    if (
      (direction === 'up' && index >= layers.length - 1) ||
      (direction === 'down' && index <= 0)
    ) {
      return;
    }

    const newLayers = [...layers];
    const targetIndex = direction === 'up' ? index + 1 : index - 1;
    [newLayers[index], newLayers[targetIndex]] = [newLayers[targetIndex], newLayers[index]];
    setLayers(newLayers);
  };

  const updateLayerOpacity = (layerId: string, opacity: number) => {
    setLayers(layers.map(l =>
      l.id === layerId ? { ...l, opacity } : l
    ));
  };

  const renameLayer = (layerId: string, name: string) => {
    setLayers(layers.map(l =>
      l.id === layerId ? { ...l, name } : l
    ));
  };

  // Delete selected object
  const deleteSelected = () => {
    if (!selectedId) return;

    setKonvaNodes(konvaNodes.filter(n => n.id !== selectedId));
    setSelectedId(null);
    saveHistory();
  };

  // Transform operations
  const rotateImage = (degrees: number) => {
    if (!image) return;

    const imageNode = konvaNodes.find(n => n.id === 'main-image');
    if (imageNode) {
      const currentRotation = imageNode.attrs.rotation || 0;
      imageNode.attrs.rotation = currentRotation + degrees;
      setKonvaNodes([...konvaNodes]);
      saveHistory();
    }
  };

  const flipImage = (direction: 'horizontal' | 'vertical') => {
    if (!image) return;

    const imageNode = konvaNodes.find(n => n.id === 'main-image');
    if (imageNode) {
      if (direction === 'horizontal') {
        imageNode.attrs.scaleX = (imageNode.attrs.scaleX || 1) * -1;
      } else {
        imageNode.attrs.scaleY = (imageNode.attrs.scaleY || 1) * -1;
      }
      setKonvaNodes([...konvaNodes]);
      saveHistory();
    }
  };

  // Apply filters to image node
  const toggleFilter = (filterName: string) => {
    setFilters(filters.map(f =>
      f.name === filterName ? { ...f, enabled: !f.enabled } : f
    ));
  };

  const updateFilterParam = (filterName: string, paramName: string, value: number) => {
    setFilters(filters.map(f =>
      f.name === filterName
        ? { ...f, params: { ...f.params, [paramName]: value } }
        : f
    ));
  };

  const getActiveFilters = () => {
    const activeFilters: any[] = [];

    filters.forEach(filter => {
      if (!filter.enabled) return;

      switch (filter.name) {
        case 'Blur':
          activeFilters.push(Konva.Filters.Blur);
          break;
        case 'Brighten':
          activeFilters.push(Konva.Filters.Brighten);
          break;
        case 'Contrast':
          activeFilters.push(Konva.Filters.Contrast);
          break;
        case 'Grayscale':
          activeFilters.push(Konva.Filters.Grayscale);
          break;
        case 'Invert':
          activeFilters.push(Konva.Filters.Invert);
          break;
        case 'HSL':
          activeFilters.push(Konva.Filters.HSL);
          break;
      }
    });

    return activeFilters;
  };

  const applyFiltersToNode = (node: Konva.Node) => {
    const imageNode = konvaNodes.find(n => n.id === 'main-image');
    if (!imageNode || node.id() !== 'main-image') return;

    filters.forEach(filter => {
      if (!filter.enabled) return;

      switch (filter.name) {
        case 'Blur':
          (node as any).blurRadius(filter.params.blurRadius);
          break;
        case 'Brighten':
          (node as any).brightness(filter.params.brightness);
          break;
        case 'Contrast':
          (node as any).contrast(filter.params.contrast);
          break;
        case 'HSL':
          (node as any).hue(filter.params.hue);
          (node as any).saturation(filter.params.saturation);
          (node as any).luminance(filter.params.luminance);
          break;
      }
    });
  };

  // Save image
  const handleSaveImage = async () => {
    try {
      setLoading(true);
      setError(null);

      const stage = stageRef.current;
      if (!stage) {
        throw new Error('Stage not ready');
      }

      // Apply crop if needed
      let exportStage = stage;
      if (cropRect && cropRect.width > 0 && cropRect.height > 0) {
        const normalizedCrop = {
          x: Math.min(cropRect.x, cropRect.x + cropRect.width),
          y: Math.min(cropRect.y, cropRect.y + cropRect.height),
          width: Math.abs(cropRect.width),
          height: Math.abs(cropRect.height)
        };

        // Create temporary stage for cropped output
        const tempStage = new Konva.Stage({
          container: document.createElement('div'),
          width: normalizedCrop.width,
          height: normalizedCrop.height
        });

        // Clone all layers with offset
        stage.getLayers().forEach(layer => {
          const clonedLayer = layer.clone();
          clonedLayer.x(-normalizedCrop.x);
          clonedLayer.y(-normalizedCrop.y);
          tempStage.add(clonedLayer);
        });

        exportStage = tempStage;
      }

      // Export as base64
      const dataURL = exportStage.toDataURL({ pixelRatio: 1 });

      // Extract mask layer if exists
      let maskData: string | undefined;
      const drawingLayer = exportStage.findOne(`#drawing-layer-konva`);
      if (drawingLayer) {
        // Create mask-only stage
        const maskStage = new Konva.Stage({
          container: document.createElement('div'),
          width: exportStage.width(),
          height: exportStage.height()
        });

        const maskLayer = drawingLayer.clone();
        maskStage.add(maskLayer);
        maskData = maskStage.toDataURL({ pixelRatio: 1 });
        maskStage.destroy();
      }

      // Clean up temporary stage
      if (exportStage !== stage) {
        exportStage.destroy();
      }

      // Send to backend
      const response = await imageEditorApi.saveEditedImage(imageId, dataURL, maskData);

      if (response.success && response.data) {
        const folderPath = response.data.message || 'uploads/temp/canvas/';
        setSuccessMessage(`Image saved to ${folderPath}`);
        setTimeout(() => {
          onClose();
        }, 2000);
      } else {
        setError(response.error || 'Failed to save image');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  // Handle drag end for draggable objects
  const handleDragEnd = (nodeId: string, e: any) => {
    const updatedNodes = konvaNodes.map(n => {
      if (n.id === nodeId) {
        return {
          ...n,
          attrs: {
            ...n.attrs,
            x: e.target.x(),
            y: e.target.y()
          }
        };
      }
      return n;
    });
    setKonvaNodes(updatedNodes);
    saveHistory();
  };

  // Render Konva nodes for a specific layer
  const renderNodesForLayer = (layerId: string) => {
    return konvaNodes
      .filter(node => node.layerId === layerId)
      .map((node) => {
        // For main image, make it non-interactive for drawing tools
        const isMainImage = node.id === 'main-image';
        const commonProps = {
          id: node.id,
          listening: tool === 'select' || !isMainImage, // Only listen to events in select mode or for non-image objects
          onClick: () => {
            if (tool === 'select' && !isMainImage) {
              setSelectedId(node.id);
            }
          },
          onTap: () => {
            if (tool === 'select' && !isMainImage) {
              setSelectedId(node.id);
            }
          },
          onDragEnd: (e: any) => handleDragEnd(node.id, e)
        };

        switch (node.type) {
          case 'image':
            return (
              <KonvaImage
                key={node.id}
                {...commonProps}
                {...node.attrs}
                ref={node.id === 'main-image' ? imageNodeRef : undefined}
                filters={node.id === 'main-image' ? getActiveFilters() : undefined}
                onTransform={(e) => {
                  if (node.id === 'main-image') {
                    applyFiltersToNode(e.target);
                  }
                }}
              />
            );

          case 'line':
            return <Line key={node.id} {...commonProps} {...node.attrs} />;

          case 'rect':
            return <Rect key={node.id} {...commonProps} {...node.attrs} />;

          case 'circle':
            return <Circle key={node.id} {...commonProps} {...node.attrs} />;

          case 'text':
            return <Text key={node.id} {...commonProps} {...node.attrs} />;

          case 'arrow':
            return <Arrow key={node.id} {...commonProps} {...node.attrs} />;

          default:
            return null;
        }
      });
  };

  // Render current drawing line
  const renderCurrentLine = () => {
    if (!isDrawing || currentLine.length < 2) return null;

    switch (tool) {
      case 'brush':
        return (
          <Line
            points={currentLine}
            stroke={brushColor}
            strokeWidth={brushSize}
            tension={0.5}
            lineCap="round"
            lineJoin="round"
            globalCompositeOperation="source-over"
          />
        );

      case 'eraser':
        return (
          <Line
            points={currentLine}
            stroke="#ffffff"
            strokeWidth={eraserSize}
            tension={0.5}
            lineCap="round"
            lineJoin="round"
            globalCompositeOperation="destination-out"
          />
        );

      case 'line':
        return (
          <Line
            points={currentLine}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
          />
        );

      case 'arrow':
        return (
          <Arrow
            points={currentLine}
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            fill={strokeColor}
            pointerLength={10}
            pointerWidth={10}
          />
        );

      default:
        return null;
    }
  };

  // Render crop rectangle
  const renderCropRect = () => {
    if (!cropRect || tool !== 'crop') return null;

    const normalized = {
      x: Math.min(cropRect.x, cropRect.x + cropRect.width),
      y: Math.min(cropRect.y, cropRect.y + cropRect.height),
      width: Math.abs(cropRect.width),
      height: Math.abs(cropRect.height)
    };

    return (
      <>
        <Rect
          x={0}
          y={0}
          width={image?.width || 0}
          height={image?.height || 0}
          fill="black"
          opacity={0.6}
        />
        <Rect
          {...normalized}
          stroke="#00ff00"
          strokeWidth={2}
          dash={[10, 5]}
        />
      </>
    );
  };

  // Tool palette
  const renderToolPalette = () => (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle2" gutterBottom>Tools</Typography>
      <ToggleButtonGroup
        value={tool}
        exclusive
        onChange={(_, value) => value && setTool(value)}
        size="small"
        fullWidth
        orientation="vertical"
        sx={{ mb: 2 }}
      >
        <ToggleButton value="select" sx={{ justifyContent: 'flex-start', gap: 1 }}>
          <TransformIcon fontSize="small" /> Select
        </ToggleButton>
        <ToggleButton value="crop" sx={{ justifyContent: 'flex-start', gap: 1 }}>
          <CropIcon fontSize="small" /> Crop
        </ToggleButton>
        <ToggleButton value="brush" sx={{ justifyContent: 'flex-start', gap: 1 }}>
          <BrushIcon fontSize="small" /> Brush
        </ToggleButton>
        <ToggleButton value="eraser" sx={{ justifyContent: 'flex-start', gap: 1 }}>
          <DeleteIcon fontSize="small" /> Eraser
        </ToggleButton>
        <ToggleButton value="text" sx={{ justifyContent: 'flex-start', gap: 1 }}>
          <TextIcon fontSize="small" /> Text
        </ToggleButton>
        <ToggleButton value="rectangle" sx={{ justifyContent: 'flex-start', gap: 1 }}>
          <ShapesIcon fontSize="small" /> Rectangle
        </ToggleButton>
        <ToggleButton value="circle" sx={{ justifyContent: 'flex-start', gap: 1 }}>
          <ShapesIcon fontSize="small" /> Circle
        </ToggleButton>
        <ToggleButton value="line" sx={{ justifyContent: 'flex-start', gap: 1 }}>
          <ShapesIcon fontSize="small" /> Line
        </ToggleButton>
        <ToggleButton value="arrow" sx={{ justifyContent: 'flex-start', gap: 1 }}>
          <ShapesIcon fontSize="small" /> Arrow
        </ToggleButton>
      </ToggleButtonGroup>

      <Typography variant="caption" sx={{ display: 'block', mb: 1, fontWeight: 'bold' }}>
        Actions
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        <Tooltip title="Undo">
          <span>
            <IconButton size="small" onClick={undo} disabled={historyIndex <= 0}>
              <UndoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Redo">
          <span>
            <IconButton size="small" onClick={redo} disabled={historyIndex >= history.length - 1}>
              <RedoIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Delete Selected">
          <span>
            <IconButton size="small" onClick={deleteSelected} disabled={!selectedId}>
              <DeleteIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      <Typography variant="caption" sx={{ display: 'block', mt: 2, mb: 1, fontWeight: 'bold' }}>
        Transform
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        <Tooltip title="Rotate Left">
          <IconButton size="small" onClick={() => rotateImage(-90)}>
            <RotateLeftIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Rotate Right">
          <IconButton size="small" onClick={() => rotateImage(90)}>
            <RotateRightIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Flip Horizontal">
          <IconButton size="small" onClick={() => flipImage('horizontal')}>
            <FlipIcon fontSize="small" style={{ transform: 'rotate(90deg)' }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Flip Vertical">
          <IconButton size="small" onClick={() => flipImage('vertical')}>
            <FlipIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </Paper>
  );

  // Tool properties
  const renderToolProperties = () => (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Typography variant="subtitle2" gutterBottom>Properties</Typography>

      {tool === 'brush' && (
        <Stack spacing={2}>
          <Box>
            <Typography variant="caption">Brush Size: {brushSize}px</Typography>
            <Slider
              value={brushSize}
              onChange={(_, value) => setBrushSize(value as number)}
              min={1}
              max={50}
            />
          </Box>
          <Box>
            <Typography variant="caption">Color</Typography>
            <input
              type="color"
              value={brushColor}
              onChange={(e) => setBrushColor(e.target.value)}
              style={{ width: '100%', height: 40, cursor: 'pointer' }}
            />
          </Box>
        </Stack>
      )}

      {tool === 'eraser' && (
        <Box>
          <Typography variant="caption">Eraser Size: {eraserSize}px</Typography>
          <Slider
            value={eraserSize}
            onChange={(_, value) => setEraserSize(value as number)}
            min={5}
            max={100}
          />
        </Box>
      )}

      {tool === 'text' && (
        <Stack spacing={2}>
          <TextField
            label="Text"
            value={textValue}
            onChange={(e) => setTextValue(e.target.value)}
            size="small"
            fullWidth
          />
          <Box>
            <Typography variant="caption">Font Size: {fontSize}px</Typography>
            <Slider
              value={fontSize}
              onChange={(_, value) => setFontSize(value as number)}
              min={12}
              max={72}
            />
          </Box>
          <FormControl size="small" fullWidth>
            <InputLabel>Font Family</InputLabel>
            <Select
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              label="Font Family"
            >
              <MenuItem value="Arial">Arial</MenuItem>
              <MenuItem value="Helvetica">Helvetica</MenuItem>
              <MenuItem value="Times New Roman">Times New Roman</MenuItem>
              <MenuItem value="Courier New">Courier New</MenuItem>
              <MenuItem value="Georgia">Georgia</MenuItem>
              <MenuItem value="Verdana">Verdana</MenuItem>
            </Select>
          </FormControl>
          <Box>
            <Typography variant="caption">Text Color</Typography>
            <input
              type="color"
              value={brushColor}
              onChange={(e) => setBrushColor(e.target.value)}
              style={{ width: '100%', height: 40, cursor: 'pointer' }}
            />
          </Box>
        </Stack>
      )}

      {(tool === 'rectangle' || tool === 'circle' || tool === 'line' || tool === 'arrow') && (
        <Stack spacing={2}>
          <Box>
            <Typography variant="caption">Fill Color</Typography>
            <input
              type="color"
              value={fillColor}
              onChange={(e) => setFillColor(e.target.value)}
              style={{ width: '100%', height: 40, cursor: 'pointer' }}
            />
          </Box>
          <Box>
            <Typography variant="caption">Stroke Color</Typography>
            <input
              type="color"
              value={strokeColor}
              onChange={(e) => setStrokeColor(e.target.value)}
              style={{ width: '100%', height: 40, cursor: 'pointer' }}
            />
          </Box>
          <Box>
            <Typography variant="caption">Stroke Width: {strokeWidth}px</Typography>
            <Slider
              value={strokeWidth}
              onChange={(_, value) => setStrokeWidth(value as number)}
              min={1}
              max={20}
            />
          </Box>
        </Stack>
      )}
    </Paper>
  );

  // Layer panel
  const renderLayerPanel = () => (
    <Paper sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="subtitle2">Layers</Typography>
        <IconButton size="small" onClick={addLayer}>
          <AddIcon />
        </IconButton>
      </Box>

      <Stack spacing={1}>
        {[...layers].reverse().map((layer) => (
          <Paper
            key={layer.id}
            elevation={activeLayerId === layer.id ? 3 : 1}
            onClick={() => setActiveLayerId(layer.id)}
            sx={{
              p: 1.5,
              cursor: 'pointer',
              border: 2,
              borderColor: activeLayerId === layer.id ? 'primary.main' : 'transparent',
              '&:hover': {
                borderColor: 'primary.light'
              }
            }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="body2" fontWeight={activeLayerId === layer.id ? 'bold' : 'normal'}>
                {layer.name}
              </Typography>
              <Stack direction="row" spacing={0.5}>
                <Tooltip title={layer.visible ? "Hide" : "Show"}>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLayerVisibility(layer.id);
                    }}
                  >
                    {layer.visible ? <VisibilityIcon fontSize="small" /> : <VisibilityOffIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
                <Tooltip title="Move Up">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveLayer(layer.id, 'up');
                    }}
                  >
                    <ArrowUpIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Move Down">
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      moveLayer(layer.id, 'down');
                    }}
                  >
                    <ArrowDownIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                {layers.length > 1 && (
                  <Tooltip title="Delete">
                    <IconButton
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteLayer(layer.id);
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            </Box>
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.5 }}>
              Opacity: {Math.round(layer.opacity * 100)}%
            </Typography>
            <Slider
              size="small"
              value={layer.opacity}
              onChange={(_, value) => updateLayerOpacity(layer.id, value as number)}
              min={0}
              max={1}
              step={0.1}
              onClick={(e) => e.stopPropagation()}
            />
          </Paper>
        ))}
      </Stack>
    </Paper>
  );

  // Filter panel
  const renderFilterPanel = () => (
    <Paper sx={{ p: 2 }}>
      <Typography variant="subtitle2" gutterBottom>Filters & Effects</Typography>

      {filters.map((filter) => (
        <Accordion key={filter.name}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <Typography sx={{ flexGrow: 1 }}>{filter.name}</Typography>
              <Chip
                label={filter.enabled ? 'ON' : 'OFF'}
                size="small"
                color={filter.enabled ? 'success' : 'default'}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFilter(filter.name);
                }}
              />
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              {Object.entries(filter.params).map(([param, value]) => (
                <Box key={param}>
                  <Typography variant="caption">
                    {param}: {value}
                  </Typography>
                  <Slider
                    value={value}
                    onChange={(_, newValue) => updateFilterParam(filter.name, param, newValue as number)}
                    min={param === 'hue' ? -180 : param.includes('saturation') || param.includes('luminance') ? -1 : 0}
                    max={param === 'hue' ? 180 : param.includes('saturation') || param.includes('luminance') ? 1 : param === 'contrast' ? 100 : param === 'brightness' ? 1 : 20}
                    step={param === 'hue' ? 1 : 0.1}
                  />
                </Box>
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
      ))}
    </Paper>
  );

  // Calculate stage size to fill the entire container
  const calculateStageSize = () => {
    if (isMobile) {
      return {
        width: window.innerWidth - 32,
        height: window.innerHeight - 300
      };
    }

    // Desktop: calculate available space
    // Total width - left sidebar (250) - right sidebar (280) - gaps (2 * 16)
    const sidebarWidths = 250 + 280 + 32; // left + right + gaps
    const availableWidth = window.innerWidth - sidebarWidths - 100; // extra padding

    // Height: total height - dialog chrome (title, actions, padding)
    const dialogChrome = 200; // approximate height of title, actions, padding
    const availableHeight = window.innerHeight - dialogChrome;

    return {
      width: Math.max(600, availableWidth),
      height: Math.max(400, availableHeight)
    };
  };

  const stageSize = calculateStageSize();
  const stageWidth = stageSize.width;
  const stageHeight = stageSize.height;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      fullScreen={isMobile}
      style={{ zIndex: 1400 }}
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Advanced Image Editor</span>
          <Box>
            {isMobile && (
              <>
                <IconButton onClick={() => setLayerPanelOpen(!layerPanelOpen)}>
                  <LayersIcon />
                </IconButton>
                <IconButton onClick={() => setFilterPanelOpen(!filterPanelOpen)}>
                  <FilterIcon />
                </IconButton>
              </>
            )}
            <IconButton onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Box sx={{ display: 'flex', gap: 2, flexDirection: isMobile ? 'column' : 'row', height: isMobile ? 'auto' : 'calc(100vh - 200px)' }}>
          {/* Left sidebar - Tools & Properties */}
          <Box sx={{ width: isMobile ? '100%' : 250, flexShrink: 0, overflowY: 'auto' }}>
            {renderToolPalette()}
            {renderToolProperties()}
          </Box>

          {/* Center - Canvas */}
          <Box sx={{
            flexGrow: 1,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            overflow: 'hidden',
            bgcolor: '#2a2a2a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative'
          }}>
            {imageLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <CircularProgress />
              </Box>
            ) : (
              <Stage
                ref={stageRef}
                width={stageWidth}
                height={stageHeight}
                scaleX={stageScale}
                scaleY={stageScale}
                x={stagePosition.x}
                y={stagePosition.y}
                draggable={false}
                onMouseDown={handleStageMouseDown}
                onMouseMove={handleStageMouseMove}
                onMouseUp={handleStageMouseUp}
                onTouchStart={handleStageMouseDown}
                onTouchMove={handleStageMouseMove}
                onTouchEnd={handleStageMouseUp}
                onWheel={handleWheel}
                style={{ display: 'block' }}
              >
                {layers.map((layer) => (
                  <Layer
                    key={layer.id}
                    id={`${layer.id}-konva`}
                    visible={layer.visible}
                    opacity={layer.opacity}
                  >
                    {renderNodesForLayer(layer.id)}
                    {layer.id === activeLayerId && renderCurrentLine()}
                    {layer.id === activeLayerId && renderCropRect()}
                    {layer.id === activeLayerId && tool === 'select' && (
                      <Transformer ref={transformerRef} />
                    )}
                  </Layer>
                ))}
              </Stage>
            )}
          </Box>

          {/* Right sidebar - Layers & Filters (Desktop) */}
          {!isMobile && (
            <Box sx={{ width: 280, flexShrink: 0, overflowY: 'auto' }}>
              {renderLayerPanel()}
              <Box sx={{ mt: 2 }}>
                {renderFilterPanel()}
              </Box>
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleSaveImage}
          disabled={loading || imageLoading}
          variant="contained"
          startIcon={loading ? <CircularProgress size={16} /> : null}
        >
          {loading ? 'Saving...' : 'Save to uploads/temp/canvas/'}
        </Button>
      </DialogActions>

      {/* Mobile Layer Panel Drawer */}
      {isMobile && (
        <Drawer
          anchor="bottom"
          open={layerPanelOpen}
          onClose={() => setLayerPanelOpen(false)}
        >
          <Box sx={{ p: 2, maxHeight: '50vh', overflow: 'auto' }}>
            {renderLayerPanel()}
          </Box>
        </Drawer>
      )}

      {/* Mobile Filter Panel Drawer */}
      {isMobile && (
        <Drawer
          anchor="bottom"
          open={filterPanelOpen}
          onClose={() => setFilterPanelOpen(false)}
        >
          <Box sx={{ p: 2, maxHeight: '50vh', overflow: 'auto' }}>
            {renderFilterPanel()}
          </Box>
        </Drawer>
      )}

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
