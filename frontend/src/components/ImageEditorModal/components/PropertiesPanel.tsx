/**
 * PropertiesPanel Component
 * Tool properties configuration
 */

import React, { useCallback } from 'react';
import {
  Box,
  Typography,
  Slider,
  TextField,
  Stack,
  Paper,
  ToggleButtonGroup,
  ToggleButton,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  FormatBold,
  FormatItalic,
} from '@mui/icons-material';
import { useEditorContext } from '../context/EditorContext';

export const PropertiesPanel: React.FC = React.memo(() => {
  const { state, updateToolProperties, canUndo, canRedo, undo, redo } = useEditorContext();
  const { tool, toolProperties } = state;

  const handlePropertyChange = useCallback(
    (property: string, value: any) => {
      updateToolProperties({ [property]: value });
    },
    [updateToolProperties]
  );

  return (
    <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
      <Stack spacing={2}>
        <Typography variant="h6">Properties</Typography>

        {/* Brush/Eraser Properties */}
        {(tool === 'brush' || tool === 'eraser') && (
          <Paper sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Typography variant="subtitle2">
                {tool === 'brush' ? 'Brush' : 'Eraser'} Size
              </Typography>
              <Slider
                value={toolProperties.brushSize}
                onChange={(_, value) => handlePropertyChange('brushSize', value)}
                min={1}
                max={50}
                valueLabelDisplay="auto"
              />

              {tool === 'brush' && (
                <>
                  <Typography variant="subtitle2">Color</Typography>
                  <TextField
                    type="color"
                    value={toolProperties.brushColor}
                    onChange={(e) => handlePropertyChange('brushColor', e.target.value)}
                    fullWidth
                  />

                  <Typography variant="subtitle2">Opacity</Typography>
                  <Slider
                    value={toolProperties.brushOpacity}
                    onChange={(_, value) => handlePropertyChange('brushOpacity', value)}
                    min={0}
                    max={1}
                    step={0.1}
                    valueLabelDisplay="auto"
                  />
                </>
              )}
            </Stack>
          </Paper>
        )}

        {/* Text Properties */}
        {tool === 'text' && (
          <Paper sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Typography variant="subtitle2">Font Size</Typography>
              <Slider
                value={toolProperties.fontSize}
                onChange={(_, value) => handlePropertyChange('fontSize', value)}
                min={8}
                max={72}
                valueLabelDisplay="auto"
              />

              <FormControl fullWidth>
                <InputLabel>Font Family</InputLabel>
                <Select
                  value={toolProperties.fontFamily}
                  onChange={(e) => handlePropertyChange('fontFamily', e.target.value)}
                  label="Font Family"
                >
                  <MenuItem value="Arial">Arial</MenuItem>
                  <MenuItem value="Times New Roman">Times New Roman</MenuItem>
                  <MenuItem value="Courier New">Courier New</MenuItem>
                  <MenuItem value="Georgia">Georgia</MenuItem>
                  <MenuItem value="Verdana">Verdana</MenuItem>
                </Select>
              </FormControl>

              <Typography variant="subtitle2">Text Color</Typography>
              <TextField
                type="color"
                value={toolProperties.textColor}
                onChange={(e) => handlePropertyChange('textColor', e.target.value)}
                fullWidth
              />

              <Typography variant="subtitle2">Font Style</Typography>
              <ToggleButtonGroup
                value={toolProperties.fontStyle}
                exclusive
                onChange={(_, value) => value && handlePropertyChange('fontStyle', value)}
                size="small"
              >
                <ToggleButton value="normal">Normal</ToggleButton>
                <ToggleButton value="bold">
                  <FormatBold />
                </ToggleButton>
                <ToggleButton value="italic">
                  <FormatItalic />
                </ToggleButton>
              </ToggleButtonGroup>
            </Stack>
          </Paper>
        )}

        {/* Shape Properties */}
        {(tool === 'rect' || tool === 'circle' || tool === 'line' || tool === 'arrow') && (
          <Paper sx={{ p: 2 }}>
            <Stack spacing={2}>
              <Typography variant="subtitle2">Stroke Color</Typography>
              <TextField
                type="color"
                value={toolProperties.strokeColor}
                onChange={(e) => handlePropertyChange('strokeColor', e.target.value)}
                fullWidth
              />

              {(tool === 'rect' || tool === 'circle') && (
                <>
                  <Typography variant="subtitle2">Fill Color</Typography>
                  <TextField
                    type="color"
                    value={toolProperties.fillColor}
                    onChange={(e) => handlePropertyChange('fillColor', e.target.value)}
                    fullWidth
                  />
                </>
              )}

              <Typography variant="subtitle2">Stroke Width</Typography>
              <Slider
                value={toolProperties.strokeWidth}
                onChange={(_, value) => handlePropertyChange('strokeWidth', value)}
                min={1}
                max={20}
                valueLabelDisplay="auto"
              />

              <Typography variant="subtitle2">Opacity</Typography>
              <Slider
                value={toolProperties.shapeOpacity}
                onChange={(_, value) => handlePropertyChange('shapeOpacity', value)}
                min={0}
                max={1}
                step={0.1}
                valueLabelDisplay="auto"
              />
            </Stack>
          </Paper>
        )}

        {/* History Controls */}
        <Paper sx={{ p: 2 }}>
          <Stack direction="row" spacing={1}>
            <button onClick={undo} disabled={!canUndo}>
              Undo
            </button>
            <button onClick={redo} disabled={!canRedo}>
              Redo
            </button>
          </Stack>
        </Paper>
      </Stack>
    </Box>
  );
});

PropertiesPanel.displayName = 'PropertiesPanel';
