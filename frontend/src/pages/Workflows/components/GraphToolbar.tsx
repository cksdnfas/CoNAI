import React, { useState } from 'react';
import {
  Box,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  IconButton,
  Tooltip,
  Paper,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import {
  Search as SearchIcon,
  ViewModule as ViewModuleIcon,
  ViewList as ViewListIcon,
  UnfoldMore as ExpandAllIcon,
  UnfoldLess as CollapseAllIcon,
} from '@mui/icons-material';

interface GraphToolbarProps {
  onSearchChange: (search: string) => void;
  onFilterChange: (filters: string[]) => void;
  onLayoutChange: (layout: 'LR' | 'TB') => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  nodeTypes: string[];
  layout: 'LR' | 'TB';
}

const GraphToolbar: React.FC<GraphToolbarProps> = ({
  onSearchChange,
  onFilterChange,
  onLayoutChange,
  onExpandAll,
  onCollapseAll,
  nodeTypes,
  layout,
}) => {
  const [search, setSearch] = useState('');
  const [selectedFilters, setSelectedFilters] = useState<string[]>([]);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setSearch(value);
    onSearchChange(value);
  };

  const handleFilterChange = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value as string[];
    setSelectedFilters(value);
    onFilterChange(value);
  };

  const handleLayoutToggle = () => {
    onLayoutChange(layout === 'LR' ? 'TB' : 'LR');
  };

  return (
    <Paper
      elevation={1}
      sx={{
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 5,
        p: 1.5,
        display: 'flex',
        gap: 1.5,
        alignItems: 'center',
        bgcolor: 'rgba(42, 42, 42, 0.95)',
        borderRadius: 2,
        maxWidth: '600px',
        flexWrap: 'wrap',
        border: '1px solid rgba(64, 64, 64, 0.5)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
        '& .MuiTextField-root': {
          '& .MuiInputBase-root': {
            bgcolor: 'rgba(26, 26, 26, 0.8)',
            color: '#ffffff',
          },
          '& .MuiInputLabel-root': {
            color: 'rgba(255, 255, 255, 0.7)',
          },
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(64, 64, 64, 0.5)',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(255, 255, 255, 0.3)',
          },
        },
        '& .MuiFormControl-root': {
          '& .MuiInputBase-root': {
            bgcolor: 'rgba(26, 26, 26, 0.8)',
            color: '#ffffff',
          },
          '& .MuiInputLabel-root': {
            color: 'rgba(255, 255, 255, 0.7)',
          },
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: 'rgba(64, 64, 64, 0.5)',
          },
        },
        '& .MuiIconButton-root': {
          color: 'rgba(255, 255, 255, 0.8)',
          '&:hover': {
            bgcolor: 'rgba(255, 255, 255, 0.1)',
          },
        },
        '& .MuiSvgIcon-root': {
          color: 'rgba(255, 255, 255, 0.6)',
        },
      }}
    >
      {/* Search */}
      <TextField
        size="small"
        placeholder="Search nodes..."
        value={search}
        onChange={handleSearchChange}
        InputProps={{
          startAdornment: <SearchIcon fontSize="small" sx={{ mr: 0.5, color: 'text.secondary' }} />,
        }}
        sx={{ minWidth: 180 }}
      />

      {/* Filter by node type */}
      <FormControl size="small" sx={{ minWidth: 150 }}>
        <InputLabel>Filter Types</InputLabel>
        <Select
          multiple
          value={selectedFilters}
          onChange={handleFilterChange}
          label="Filter Types"
          renderValue={(selected) => (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {selected.map((value) => (
                <Chip
                  key={value}
                  label={value}
                  size="small"
                  sx={{
                    bgcolor: 'rgba(76, 175, 80, 0.2)',
                    color: '#4CAF50',
                    border: '1px solid rgba(76, 175, 80, 0.4)',
                  }}
                />
              ))}
            </Box>
          )}
          MenuProps={{
            PaperProps: {
              sx: {
                bgcolor: '#2a2a2a',
                border: '1px solid rgba(64, 64, 64, 0.5)',
                '& .MuiMenuItem-root': {
                  color: '#ffffff',
                  '&:hover': {
                    bgcolor: 'rgba(255, 255, 255, 0.1)',
                  },
                  '&.Mui-selected': {
                    bgcolor: 'rgba(76, 175, 80, 0.2)',
                    '&:hover': {
                      bgcolor: 'rgba(76, 175, 80, 0.3)',
                    },
                  },
                },
              },
            },
          }}
        >
          {nodeTypes.map((type) => (
            <MenuItem key={type} value={type}>
              {type}
            </MenuItem>
          ))}
        </Select>
      </FormControl>

      {/* Layout toggle */}
      <Tooltip title={`Switch to ${layout === 'LR' ? 'Top-Bottom' : 'Left-Right'} layout`}>
        <IconButton size="small" onClick={handleLayoutToggle}>
          {layout === 'LR' ? <ViewListIcon /> : <ViewModuleIcon />}
        </IconButton>
      </Tooltip>

      {/* Expand/Collapse all */}
      {onExpandAll && (
        <Tooltip title="Expand all nodes">
          <IconButton size="small" onClick={onExpandAll}>
            <ExpandAllIcon />
          </IconButton>
        </Tooltip>
      )}

      {onCollapseAll && (
        <Tooltip title="Collapse all nodes">
          <IconButton size="small" onClick={onCollapseAll}>
            <CollapseAllIcon />
          </IconButton>
        </Tooltip>
      )}
    </Paper>
  );
};

export default GraphToolbar;
