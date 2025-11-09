import React from 'react';
import { Box, Typography, Divider, Slider } from '@mui/material';
import type { Tool, CanvasSize } from '../types/EditorTypes';

interface RightPanelProps {
  tool: Tool;
  canvasSize: CanvasSize;
  brushSize: number;
  brushColor: string;
  eraserSize: number;
  onBrushSizeChange: (size: number) => void;
  onBrushColorChange: (color: string) => void;
  onEraserSizeChange: (size: number) => void;
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

export const RightPanel: React.FC<RightPanelProps> = ({
  tool,
  canvasSize,
  brushSize,
  brushColor,
  eraserSize,
  onBrushSizeChange,
  onBrushColorChange,
  onEraserSizeChange,
}) => {
  return (
    <Box
      sx={{
        width: 250,
        borderLeft: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        p: 2,
        overflowY: 'auto',
      }}
    >
      <Typography variant="subtitle2" gutterBottom>
        Canvas Info
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        Size: {canvasSize.width} x {canvasSize.height} px
      </Typography>
      <Divider sx={{ my: 2 }} />

      <Typography variant="subtitle2" gutterBottom>
        Tool Properties
      </Typography>

      {tool === 'brush' && (
        <>
          <Typography variant="body2" gutterBottom sx={{ mt: 2 }}>
            Brush Size: {brushSize}px
          </Typography>
          <Slider
            value={brushSize}
            onChangeCommitted={(_, value) => onBrushSizeChange(value as number)}
            min={1}
            max={50}
            sx={{ mb: 3 }}
          />

          <Typography variant="body2" gutterBottom>
            Brush Color
          </Typography>
          <Box
            sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseMove={(e) => e.stopPropagation()}
          >
            {COLOR_PALETTE.map((color) => (
              <Box
                key={color}
                onClick={() => onBrushColorChange(color)}
                sx={{
                  width: 32,
                  height: 32,
                  bgcolor: color,
                  border: brushColor === color ? 3 : 1,
                  borderColor: brushColor === color ? 'primary.main' : 'divider',
                  borderRadius: 1,
                  cursor: 'pointer',
                }}
              />
            ))}
          </Box>
          <input
            type="color"
            value={brushColor}
            onChange={(e) => onBrushColorChange(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseMove={(e) => e.stopPropagation()}
            style={{ width: '100%', height: 40 }}
          />
        </>
      )}

      {tool === 'eraser' && (
        <>
          <Typography variant="body2" gutterBottom sx={{ mt: 2 }}>
            Eraser Size: {eraserSize}px
          </Typography>
          <Slider
            value={eraserSize}
            onChangeCommitted={(_, value) => onEraserSizeChange(value as number)}
            min={5}
            max={100}
            sx={{ mb: 3 }}
          />
        </>
      )}

      {tool === 'pan' && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          Click and drag to move the canvas. Use mouse wheel to zoom in/out.
        </Typography>
      )}
    </Box>
  );
};
