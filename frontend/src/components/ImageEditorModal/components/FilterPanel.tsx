/**
 * FilterPanel Component
 * Image filter controls
 */

import React, { useCallback } from 'react';
import {
  Box,
  Typography,
  Stack,
  Switch,
  Slider,
  FormControlLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from '@mui/material';
import { ExpandMore } from '@mui/icons-material';
import { useEditorContext } from '../context/EditorContext';

export const FilterPanel: React.FC = React.memo(() => {
  const { state, updateFilter } = useEditorContext();
  const { filters } = state;

  const handleToggleFilter = useCallback(
    (index: number, enabled: boolean) => {
      updateFilter(index, { enabled });
    },
    [updateFilter]
  );

  const handleParamChange = useCallback(
    (index: number, paramName: string, value: number) => {
      const filter = filters[index];
      updateFilter(index, {
        params: {
          ...filter.params,
          [paramName]: value,
        },
      });
    },
    [filters, updateFilter]
  );

  return (
    <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
      <Typography variant="h6" mb={2}>
        Filters
      </Typography>

      <Stack spacing={1}>
        {filters.map((filter, index) => (
          <Accordion key={filter.name}>
            <AccordionSummary expandIcon={<ExpandMore />}>
              <FormControlLabel
                control={
                  <Switch
                    checked={filter.enabled}
                    onChange={(e) => handleToggleFilter(index, e.target.checked)}
                    onClick={(e) => e.stopPropagation()}
                  />
                }
                label={filter.name}
                onClick={(e) => e.stopPropagation()}
              />
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                {filter.name === 'Blur' && (
                  <>
                    <Typography variant="caption">Blur Radius</Typography>
                    <Slider
                      value={filter.params.blurRadius}
                      onChange={(_, value) => handleParamChange(index, 'blurRadius', value as number)}
                      min={0}
                      max={50}
                      valueLabelDisplay="auto"
                      disabled={!filter.enabled}
                    />
                  </>
                )}

                {filter.name === 'Brighten' && (
                  <>
                    <Typography variant="caption">Brightness</Typography>
                    <Slider
                      value={filter.params.brightness}
                      onChange={(_, value) => handleParamChange(index, 'brightness', value as number)}
                      min={-1}
                      max={1}
                      step={0.1}
                      valueLabelDisplay="auto"
                      disabled={!filter.enabled}
                    />
                  </>
                )}

                {filter.name === 'Contrast' && (
                  <>
                    <Typography variant="caption">Contrast</Typography>
                    <Slider
                      value={filter.params.contrast}
                      onChange={(_, value) => handleParamChange(index, 'contrast', value as number)}
                      min={-100}
                      max={100}
                      valueLabelDisplay="auto"
                      disabled={!filter.enabled}
                    />
                  </>
                )}

                {filter.name === 'Pixelate' && (
                  <>
                    <Typography variant="caption">Pixel Size</Typography>
                    <Slider
                      value={filter.params.pixelSize}
                      onChange={(_, value) => handleParamChange(index, 'pixelSize', value as number)}
                      min={1}
                      max={50}
                      valueLabelDisplay="auto"
                      disabled={!filter.enabled}
                    />
                  </>
                )}

                {(filter.name === 'Grayscale' || filter.name === 'Sepia' || filter.name === 'Invert') && (
                  <Typography variant="caption">No parameters</Typography>
                )}
              </Stack>
            </AccordionDetails>
          </Accordion>
        ))}
      </Stack>
    </Box>
  );
});

FilterPanel.displayName = 'FilterPanel';
