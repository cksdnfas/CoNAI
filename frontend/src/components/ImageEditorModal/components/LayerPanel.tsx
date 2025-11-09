/**
 * LayerPanel Component
 * Layer management UI
 */

import React, { useCallback } from 'react';
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  IconButton,
  Stack,
  Chip,
} from '@mui/material';
import {
  Visibility,
  VisibilityOff,
  Delete,
  Add,
  Lock,
  LockOpen,
} from '@mui/icons-material';
import { useEditorContext } from '../context/EditorContext';
import { createLayer } from '../utils/editorUtils';

export const LayerPanel: React.FC = React.memo(() => {
  const { state, addLayer, updateLayer, deleteLayer, setActiveLayer } = useEditorContext();
  const { layers, activeLayerId } = state;

  const handleAddLayer = useCallback(() => {
    const newLayer = createLayer(`Layer ${layers.length + 1}`, layers.length);
    addLayer(newLayer);
  }, [layers, addLayer]);

  const handleToggleVisibility = useCallback(
    (layerId: string, currentVisibility: boolean) => {
      updateLayer(layerId, { visible: !currentVisibility });
    },
    [updateLayer]
  );

  const handleToggleLock = useCallback(
    (layerId: string, currentLocked: boolean) => {
      updateLayer(layerId, { locked: !currentLocked });
    },
    [updateLayer]
  );

  const handleDeleteLayer = useCallback(
    (layerId: string) => {
      if (layers.length > 1) {
        deleteLayer(layerId);
      }
    },
    [layers, deleteLayer]
  );

  return (
    <Box sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">Layers</Typography>
        <IconButton size="small" onClick={handleAddLayer}>
          <Add />
        </IconButton>
      </Stack>

      <List sx={{ flexGrow: 1, overflow: 'auto' }}>
        {[...layers].reverse().map((layer) => (
          <ListItem
            key={layer.id}
            disablePadding
            secondaryAction={
              <Stack direction="row" spacing={0.5}>
                <IconButton
                  size="small"
                  onClick={() => handleToggleVisibility(layer.id, layer.visible)}
                >
                  {layer.visible ? <Visibility fontSize="small" /> : <VisibilityOff fontSize="small" />}
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => handleToggleLock(layer.id, layer.locked)}
                >
                  {layer.locked ? <Lock fontSize="small" /> : <LockOpen fontSize="small" />}
                </IconButton>
                {layers.length > 1 && (
                  <IconButton
                    size="small"
                    onClick={() => handleDeleteLayer(layer.id)}
                  >
                    <Delete fontSize="small" />
                  </IconButton>
                )}
              </Stack>
            }
          >
            <ListItemButton
              selected={layer.id === activeLayerId}
              onClick={() => setActiveLayer(layer.id)}
            >
              <ListItemText
                primary={layer.name}
                secondary={`Opacity: ${Math.round(layer.opacity * 100)}%`}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );
});

LayerPanel.displayName = 'LayerPanel';
