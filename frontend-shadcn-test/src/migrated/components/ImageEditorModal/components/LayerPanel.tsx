import React from 'react';
import {
  Box,
  Typography,
  IconButton,
  Slider,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Divider,
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
import type { Layer } from '../types/EditorTypes';

interface LayerPanelProps {
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

export const LayerPanel: React.FC<LayerPanelProps> = ({
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

  // Reverse layers for display (top layer first)
  const displayLayers = [...layers].reverse();

  return (
    <Box
      sx={{
        width: 220,
        borderLeft: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      {/* Header */}
      <Box
        sx={{
          p: 1,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
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
              <ListItemIcon sx={{ minWidth: 32 }}>
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

      <Divider />

      {/* Active Layer Controls */}
      {activeLayerId && (
        <Box sx={{ p: 1.5 }}>
          <Typography variant="caption" color="text.secondary" gutterBottom>
            {t('imageEditor.layers.opacity', 'Opacity')}
          </Typography>
          <Slider
            size="small"
            value={
              (layers.find((l) => l.id === activeLayerId)?.opacity ?? 1) * 100
            }
            onChange={(_, value) =>
              onSetOpacity(activeLayerId, (value as number) / 100)
            }
            min={0}
            max={100}
            valueLabelDisplay="auto"
            valueLabelFormat={(v) => `${v}%`}
          />

          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1, mt: 1 }}>
            <Tooltip title={t('imageEditor.layers.moveUp', 'Move Up')}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => onMoveLayer(activeLayerId, 'up')}
                  disabled={
                    layers.findIndex((l) => l.id === activeLayerId) ===
                    layers.length - 1
                  }
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
                  disabled={
                    layers.findIndex((l) => l.id === activeLayerId) <= 1
                  }
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
                  disabled={
                    layers.find((l) => l.id === activeLayerId)?.type === 'image'
                  }
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
  );
};
