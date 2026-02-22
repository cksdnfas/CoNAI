import React from 'react';
import { Box, Typography } from '@mui/material';
import { InfoTooltip } from './InfoTooltip';

interface FormFieldProps {
  label: string;
  tooltip?: string;
  children: React.ReactNode;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  tooltip,
  children
}) => (
  <Box sx={{ mb: 2 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
      <Typography variant="subtitle2">{label}</Typography>
      {tooltip && <InfoTooltip title={tooltip} />}
    </Box>
    {children}
  </Box>
);

export default FormField;
