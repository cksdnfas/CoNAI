import React from 'react';
import { FormControl, Select, MenuItem, Box, Typography } from '@mui/material';
import type { PageSize } from '../../types/image';

interface PageSizeSelectorProps {
  value: PageSize;
  onChange: (size: PageSize) => void;
  disabled?: boolean;
}

const PageSizeSelector: React.FC<PageSizeSelectorProps> = ({ value, onChange, disabled = false }) => {
  const handleChange = (event: any) => {
    onChange(event.target.value as PageSize);
  };

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography variant="body2" color="text.secondary">
        페이지당
      </Typography>
      <FormControl size="small" sx={{ minWidth: 80 }}>
        <Select
          value={value}
          onChange={handleChange}
          disabled={disabled}
          variant="outlined"
        >
          <MenuItem value={25}>25</MenuItem>
          <MenuItem value={50}>50</MenuItem>
          <MenuItem value={100}>100</MenuItem>
        </Select>
      </FormControl>
      <Typography variant="body2" color="text.secondary">
        개
      </Typography>
    </Box>
  );
};

export default PageSizeSelector;