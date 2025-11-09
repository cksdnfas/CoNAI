/**
 * ToolPalette Component
 * Tool selection UI with optimized rendering
 */

import React, { useCallback } from 'react';
import { Box, ToggleButtonGroup, ToggleButton, Tooltip, Stack } from '@mui/material';
import {
  PanTool,
  Crop as CropIcon,
  Brush as BrushIcon,
  FormatShapes as ShapesIcon,
  TextFields as TextIcon,
  TouchApp as SelectIcon,
  Circle,
  Square,
  ArrowForward,
  Remove,
} from '@mui/icons-material';
import { useEditorContext } from '../context/EditorContext';
import type { EditorTool } from '../types/EditorTypes';

export const ToolPalette: React.FC = React.memo(() => {
  const { state, setTool } = useEditorContext();
  const { tool } = state;

  const handleToolChange = useCallback(
    (event: React.MouseEvent<HTMLElement>, newTool: EditorTool | null) => {
      if (newTool !== null) {
        setTool(newTool);
      }
    },
    [setTool]
  );

  return (
    <Box sx={{ p: 2 }}>
      <Stack spacing={1}>
        <ToggleButtonGroup
          value={tool}
          exclusive
          onChange={handleToolChange}
          orientation="vertical"
          fullWidth
          size="small"
        >
          <ToggleButton value="select">
            <Tooltip title="Select" placement="right">
              <SelectIcon />
            </Tooltip>
          </ToggleButton>

          <ToggleButton value="pan">
            <Tooltip title="Pan" placement="right">
              <PanTool />
            </Tooltip>
          </ToggleButton>

          <ToggleButton value="brush">
            <Tooltip title="Brush" placement="right">
              <BrushIcon />
            </Tooltip>
          </ToggleButton>

          <ToggleButton value="eraser">
            <Tooltip title="Eraser" placement="right">
              <BrushIcon style={{ opacity: 0.5 }} />
            </Tooltip>
          </ToggleButton>

          <ToggleButton value="text">
            <Tooltip title="Text" placement="right">
              <TextIcon />
            </Tooltip>
          </ToggleButton>

          <ToggleButton value="rect">
            <Tooltip title="Rectangle" placement="right">
              <Square />
            </Tooltip>
          </ToggleButton>

          <ToggleButton value="circle">
            <Tooltip title="Circle" placement="right">
              <Circle />
            </Tooltip>
          </ToggleButton>

          <ToggleButton value="line">
            <Tooltip title="Line" placement="right">
              <Remove />
            </Tooltip>
          </ToggleButton>

          <ToggleButton value="arrow">
            <Tooltip title="Arrow" placement="right">
              <ArrowForward />
            </Tooltip>
          </ToggleButton>

          <ToggleButton value="crop">
            <Tooltip title="Crop" placement="right">
              <CropIcon />
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>
    </Box>
  );
});

ToolPalette.displayName = 'ToolPalette';
