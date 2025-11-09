import React from 'react';
import { Box, IconButton } from '@mui/material';
import {
  Brush,
  Delete,
  RotateRight,
  Flip,
  Crop,
  Layers,
  PanTool,
  Undo,
  Redo,
} from '@mui/icons-material';
import type { Tool } from '../types/EditorTypes';

interface LeftToolbarProps {
  tool: Tool;
  canUndo: boolean;
  canRedo: boolean;
  onToolChange: (tool: Tool) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onRotate: () => void;
  onFlip: () => void;
}

export const LeftToolbar: React.FC<LeftToolbarProps> = ({
  tool,
  canUndo,
  canRedo,
  onToolChange,
  onUndo,
  onRedo,
  onClear,
  onRotate,
  onFlip,
}) => {
  return (
    <Box
      sx={{
        width: 60,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.5,
        py: 2,
        borderRight: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <IconButton
        onClick={() => onToolChange('pan')}
        color={tool === 'pan' ? 'primary' : 'default'}
        size="medium"
      >
        <PanTool />
      </IconButton>

      <IconButton
        onClick={() => onToolChange('brush')}
        color={tool === 'brush' ? 'primary' : 'default'}
        size="medium"
      >
        <Brush />
      </IconButton>

      <IconButton
        onClick={() => onToolChange('eraser')}
        color={tool === 'eraser' ? 'primary' : 'default'}
        size="medium"
        sx={{ fontSize: 20 }}
      >
        🧹
      </IconButton>

      <Box sx={{ width: '80%', borderTop: 1, borderColor: 'divider', my: 1 }} />

      <IconButton onClick={onUndo} disabled={!canUndo} size="medium">
        <Undo />
      </IconButton>

      <IconButton onClick={onRedo} disabled={!canRedo} size="medium">
        <Redo />
      </IconButton>

      <IconButton onClick={onClear} size="medium">
        <Delete />
      </IconButton>

      <Box sx={{ width: '80%', borderTop: 1, borderColor: 'divider', my: 1 }} />

      <IconButton onClick={onRotate} size="medium">
        <RotateRight />
      </IconButton>

      <IconButton onClick={onFlip} size="medium">
        <Flip />
      </IconButton>

      <IconButton disabled size="medium" sx={{ opacity: 0.3 }}>
        <Crop />
      </IconButton>

      <IconButton disabled size="medium" sx={{ opacity: 0.3 }}>
        <Layers />
      </IconButton>
    </Box>
  );
};
