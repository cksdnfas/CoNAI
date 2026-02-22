import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Box,
  Typography,
  Divider,
  Slider,
  IconButton,
  Tooltip,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  Lock,
  LockOpen,
  Delete,
  Add,
  ArrowUpward,
  ArrowDownward,
  Image as ImageIcon,
  Brush,
  ContentPaste,
  MergeType,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { Tool, CanvasSize, Layer } from '../types/EditorTypes';

interface RightPanelProps {
  tool: Tool;
  canvasSize: CanvasSize;
  brushSize: number;
  brushColor: string;
  eraserSize: number;
  onBrushSizeChange: (size: number) => void;
  onBrushColorChange: (color: string) => void;
  onEraserSizeChange: (size: number) => void;
  // Layer props
  layers: Layer[];
  activeLayerId: string | null;
  onSelectLayer: (layerId: string) => void;
  onToggleVisibility: (layerId: string) => void;
  onToggleLock: (layerId: string) => void;
  onSetOpacity: (layerId: string, opacity: number) => void;
  onMoveLayer: (layerId: string, direction: 'up' | 'down') => void;
  onDeleteLayer: (layerId: string) => void;
  onAddLayer: () => void;
  onFlattenLayers: () => void;
}

const COLOR_PALETTE = [
  '#ff0000',
  '#00ff00',
  '#0000ff',
  '#ffff00',
  '#ff00ff',
  '#00ffff',
  '#ffffff',
  '#000000',
];

const getLayerIcon = (type: Layer['type']) => {
  switch (type) {
    case 'image':
      return <ImageIcon fontSize="small" />;
    case 'drawing':
      return <Brush fontSize="small" />;
    case 'paste':
      return <ContentPaste fontSize="small" />;
    default:
      return <Brush fontSize="small" />;
  }
};

export const RightPanel: React.FC<RightPanelProps> = ({
  tool,
  canvasSize,
  brushSize,
  brushColor,
  eraserSize,
  onBrushSizeChange,
  onBrushColorChange,
  onEraserSizeChange,
  // Layer props
  layers,
  activeLayerId,
  onSelectLayer,
  onToggleVisibility,
  onToggleLock,
  onSetOpacity,
  onMoveLayer,
  onDeleteLayer,
  onAddLayer,
  onFlattenLayers,
}) => {
  const { t } = useTranslation('common');

  // Local state for color picker to prevent lag
  const [localColor, setLocalColor] = useState(brushColor);
  const colorChangeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync local color when brushColor prop changes from outside
  useEffect(() => {
    setLocalColor(brushColor);
  }, [brushColor]);

  // Debounced color change handler
  const handleColorChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    setLocalColor(newColor);

    if (colorChangeTimeoutRef.current) {
      clearTimeout(colorChangeTimeoutRef.current);
    }
    colorChangeTimeoutRef.current = setTimeout(() => {
      onBrushColorChange(newColor);
    }, 50);
  }, [onBrushColorChange]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (colorChangeTimeoutRef.current) {
        clearTimeout(colorChangeTimeoutRef.current);
      }
    };
  }, []);

  // Handle palette color click
  const handlePaletteColorClick = useCallback((color: string) => {
    setLocalColor(color);
    onBrushColorChange(color);
  }, [onBrushColorChange]);

  // Reverse layers for display (top layer first)
  const displayLayers = [...layers].reverse();

  return (
    <Box
      sx={{
        width: 250,
        borderLeft: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Tool Properties Section */}
      <Box sx={{ p: 2, flexShrink: 0 }}>
        <Typography variant="subtitle2" gutterBottom>
          {t('imageEditor.canvasInfo', 'Canvas Info')}
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {t('imageEditor.canvasSize', { width: canvasSize.width, height: canvasSize.height, defaultValue: `Size: ${canvasSize.width} x ${canvasSize.height} px` })}
        </Typography>
        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" gutterBottom>
          {t('imageEditor.toolProperties', 'Tool Properties')}
        </Typography>

        {tool === 'brush' && (
          <>
            <Typography variant="body2" gutterBottom sx={{ mt: 2 }}>
              {t('imageEditor.brushSize', { size: brushSize, defaultValue: `Brush Size: ${brushSize}px` })}
            </Typography>
            <Slider
              value={brushSize}
              onChange={(_, value) => onBrushSizeChange(value as number)}
              min={1}
              max={200}
              sx={{ mb: 2 }}
            />

            <Typography variant="body2" gutterBottom>
              {t('imageEditor.brushColor', 'Brush Color')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
              {COLOR_PALETTE.map((color) => (
                <Box
                  key={color}
                  onClick={() => handlePaletteColorClick(color)}
                  sx={{
                    width: 28,
                    height: 28,
                    bgcolor: color,
                    border: localColor === color ? 3 : 1,
                    borderColor: localColor === color ? 'primary.main' : 'divider',
                    borderRadius: 1,
                    cursor: 'pointer',
                    '&:hover': { opacity: 0.8 },
                  }}
                />
              ))}
            </Box>
            <input
              type="color"
              value={localColor}
              onChange={handleColorChange}
              style={{ width: '100%', height: 36, cursor: 'pointer' }}
            />
          </>
        )}

        {tool === 'eraser' && (
          <>
            <Typography variant="body2" gutterBottom sx={{ mt: 2 }}>
              {t('imageEditor.eraserSize', { size: eraserSize, defaultValue: `Eraser Size: ${eraserSize}px` })}
            </Typography>
            <Slider
              value={eraserSize}
              onChange={(_, value) => onEraserSizeChange(value as number)}
              min={1}
              max={200}
            />
          </>
        )}

        {(tool === 'pan' || tool === 'select' || tool === 'lasso' || tool === 'crop') && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            {tool === 'pan' && t('imageEditor.panHelp', 'Drag to pan the canvas')}
            {tool === 'select' && t('imageEditor.selectHelp', 'Drag to select a rectangular area')}
            {tool === 'lasso' && t('imageEditor.lassoHelp', 'Draw to select a free-form area')}
            {tool === 'crop' && t('imageEditor.cropHelp', 'Drag to define crop area, press Enter to apply')}
          </Typography>
        )}
      </Box>

      <Divider />

      {/* Layers Section */}
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {/* Layer Header */}
        <Box
          sx={{
            p: 1,
            px: 2,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <Typography variant="subtitle2">
            {t('imageEditor.layers.title', 'Layers')}
          </Typography>
          <Box>
            <Tooltip title={t('imageEditor.layers.add', 'Add Layer')}>
              <IconButton size="small" onClick={onAddLayer}>
                <Add fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('imageEditor.layers.flatten', 'Flatten')}>
              <IconButton size="small" onClick={onFlattenLayers}>
                <MergeType fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Layer List */}
        <List dense sx={{ flex: 1, overflowY: 'auto', p: 0 }}>
          {displayLayers.map((layer) => (
            <ListItem
              key={layer.id}
              disablePadding
              secondaryAction={
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  <IconButton
                    edge="end"
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleVisibility(layer.id);
                    }}
                  >
                    {layer.visible ? (
                      <Visibility fontSize="small" />
                    ) : (
                      <VisibilityOff fontSize="small" sx={{ opacity: 0.5 }} />
                    )}
                  </IconButton>
                  <IconButton
                    edge="end"
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleLock(layer.id);
                    }}
                    disabled={layer.type === 'image'}
                  >
                    {layer.locked ? (
                      <Lock fontSize="small" />
                    ) : (
                      <LockOpen fontSize="small" sx={{ opacity: 0.5 }} />
                    )}
                  </IconButton>
                </Box>
              }
              sx={{
                bgcolor: activeLayerId === layer.id ? 'action.selected' : 'transparent',
                '&:hover': {
                  bgcolor: activeLayerId === layer.id ? 'action.selected' : 'action.hover',
                },
              }}
            >
              <ListItemButton
                onClick={() => onSelectLayer(layer.id)}
                sx={{ pr: 10 }}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  {getLayerIcon(layer.type)}
                </ListItemIcon>
                <ListItemText
                  primary={layer.name}
                  primaryTypographyProps={{
                    variant: 'body2',
                    noWrap: true,
                    sx: { opacity: layer.visible ? 1 : 0.5 },
                  }}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>

        {/* Active Layer Controls */}
        {activeLayerId && (
          <Box sx={{ p: 1.5, borderTop: 1, borderColor: 'divider', flexShrink: 0 }}>
            <Typography variant="caption" color="text.secondary">
              {t('imageEditor.layers.opacity', 'Opacity')}
            </Typography>
            <Slider
              size="small"
              value={(layers.find((l) => l.id === activeLayerId)?.opacity ?? 1) * 100}
              onChange={(_, value) => onSetOpacity(activeLayerId, (value as number) / 100)}
              min={0}
              max={100}
              valueLabelDisplay="auto"
              valueLabelFormat={(v) => `${v}%`}
            />

            <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1 }}>
              <Tooltip title={t('imageEditor.layers.moveUp', 'Move Up')}>
                <span>
                  <IconButton
                    size="small"
                    onClick={() => onMoveLayer(activeLayerId, 'up')}
                    disabled={layers.findIndex((l) => l.id === activeLayerId) === layers.length - 1}
                  >
                    <ArrowUpward fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('imageEditor.layers.moveDown', 'Move Down')}>
                <span>
                  <IconButton
                    size="small"
                    onClick={() => onMoveLayer(activeLayerId, 'down')}
                    disabled={layers.findIndex((l) => l.id === activeLayerId) <= 1}
                  >
                    <ArrowDownward fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title={t('imageEditor.layers.delete', 'Delete')}>
                <span>
                  <IconButton
                    size="small"
                    onClick={() => onDeleteLayer(activeLayerId)}
                    disabled={layers.find((l) => l.id === activeLayerId)?.type === 'image'}
                    color="error"
                  >
                    <Delete fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};
