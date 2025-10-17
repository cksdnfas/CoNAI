import React from 'react';
import {
  Box,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  NavigateBefore as PrevIcon,
  NavigateNext as NextIcon,
  Shuffle as RandomIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

interface ImageNavigationProps {
  currentIndex: number;
  totalCount: number;
  onPrevious: () => void;
  onNext: () => void;
  onRandom: () => void;
  disabled?: boolean;
}

const ImageNavigation: React.FC<ImageNavigationProps> = ({
  currentIndex,
  totalCount,
  onPrevious,
  onNext,
  onRandom,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < totalCount - 1;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <Tooltip title={t('imageDetail:navigation.previous')}>
        <span>
          <IconButton
            onClick={onPrevious}
            disabled={disabled || !hasPrevious}
            size="small"
          >
            <PrevIcon />
          </IconButton>
        </span>
      </Tooltip>

      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          minWidth: '80px',
          textAlign: 'center',
          fontSize: '0.875rem'
        }}
      >
        {totalCount > 0 ? `${currentIndex + 1} / ${totalCount}` : '0 / 0'}
      </Typography>

      <Tooltip title={t('imageDetail:navigation.next')}>
        <span>
          <IconButton
            onClick={onNext}
            disabled={disabled || !hasNext}
            size="small"
          >
            <NextIcon />
          </IconButton>
        </span>
      </Tooltip>

      <Tooltip title={t('imageDetail:navigation.random')}>
        <span>
          <IconButton
            onClick={onRandom}
            disabled={disabled || totalCount <= 1}
            size="small"
            color="primary"
          >
            <RandomIcon />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
};

export default ImageNavigation;