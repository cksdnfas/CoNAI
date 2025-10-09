import React from 'react';
import { Box, Typography, useTheme } from '@mui/material';

const Footer: React.FC = () => {
  const theme = useTheme();

  return (
    <Box
      component="footer"
      sx={{
        backgroundColor: theme.palette.mode === 'dark'
          ? theme.palette.grey[900]
          : theme.palette.grey[100],
        py: 3,
        mt: 'auto',
        borderTop: 1,
        borderColor: 'divider',
        width: '100%',
        px: { xs: 2, sm: 3, md: 4 },
      }}
    >
      <Typography
        variant="body2"
        color="text.secondary"
        align="center"
        sx={{
          fontSize: { xs: '0.75rem', sm: '0.875rem' },
        }}
      >
        © 2024 ComfyUI Image Manager. All rights reserved.
      </Typography>
    </Box>
  );
};

export default Footer;