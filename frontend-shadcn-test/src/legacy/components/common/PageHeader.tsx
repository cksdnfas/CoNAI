import React from 'react';
import { Box, Typography } from '@mui/material';
import { InfoTooltip } from './InfoTooltip';

interface PageHeaderProps {
  title: string;
  description?: string;
  tooltip?: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  tooltip
}) => (
  <Box sx={{ mb: 2 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Typography
        variant="h4"
        component="h1"
        sx={{
          fontSize: { xs: '1.75rem', sm: '2rem', md: '2.25rem' },
          fontWeight: 600,
        }}
      >
        {title}
      </Typography>
      {tooltip && <InfoTooltip title={tooltip} />}
    </Box>
    {description && (
      <Typography
        variant="body1"
        color="text.secondary"
        sx={{
          mt: 0.5,
          fontSize: { xs: '0.875rem', sm: '1rem' },
        }}
      >
        {description}
      </Typography>
    )}
  </Box>
);

export default PageHeader;
