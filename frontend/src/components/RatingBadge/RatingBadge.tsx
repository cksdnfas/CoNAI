import React, { memo } from 'react';
import { Chip, Tooltip } from '@mui/material';
import type { RatingTier } from '../../types/rating';

interface RatingBadgeProps {
  tier: RatingTier;
  score: number;
}

/**
 * Rating badge component
 * Displays tier name with tier color background
 * Shows exact score and tier range on hover
 */
const RatingBadge: React.FC<RatingBadgeProps> = ({ tier, score }) => {
  // Format the score range for tooltip
  const rangeText = tier.max_score !== null
    ? `${tier.min_score}점 ~ ${tier.max_score}점`
    : `${tier.min_score}점 이상`;

  const tooltipText = `${tier.tier_name}: ${score.toFixed(1)}점 (${rangeText})`;

  // Parse tier color or use default
  const backgroundColor = tier.color || '#757575';

  return (
    <Tooltip title={tooltipText} placement="top" arrow>
      <Chip
        label={tier.tier_name}
        size="small"
        sx={{
          fontSize: '0.7rem',
          height: '22px',
          fontWeight: 600,
          bgcolor: backgroundColor,
          color: '#ffffff',
          backdropFilter: 'blur(4px)',
          boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
          '&:hover': {
            bgcolor: backgroundColor,
            filter: 'brightness(1.1)',
          },
        }}
      />
    </Tooltip>
  );
};

export default memo(RatingBadge);
