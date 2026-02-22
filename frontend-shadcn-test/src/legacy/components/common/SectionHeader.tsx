import React from 'react';
import { Box, Typography, Divider } from '@mui/material';
import { InfoTooltip } from './InfoTooltip';

interface SectionHeaderProps {
  title: string;
  tooltip?: string;
  divider?: boolean;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({
  title,
  tooltip,
  divider = true
}) => (
  <Box sx={{ mb: 2 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
      <Typography variant="h6">{title}</Typography>
      {tooltip && <InfoTooltip title={tooltip} />}
    </Box>
    {divider && <Divider sx={{ mt: 1 }} />}
  </Box>
);

export default SectionHeader;
