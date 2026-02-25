import React from 'react';
import { Tooltip } from '@mui/material';
import { InfoOutlined as InfoOutlinedIcon } from '@mui/icons-material';

interface InfoTooltipProps {
  title: string;
  placement?: 'top' | 'right' | 'bottom' | 'left';
}

export const InfoTooltip: React.FC<InfoTooltipProps> = ({
  title,
  placement = 'top'
}) => (
  <Tooltip title={title} arrow placement={placement}>
    <InfoOutlinedIcon
      fontSize="small"
      sx={{ ml: 1, color: 'text.secondary', cursor: 'help' }}
    />
  </Tooltip>
);

export default InfoTooltip;
