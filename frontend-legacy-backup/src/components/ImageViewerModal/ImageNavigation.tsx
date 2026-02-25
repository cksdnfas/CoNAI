import React from 'react';
import {
  Box,
  IconButton,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material';
import {
  NavigateBefore as PrevIcon,
  NavigateNext as NextIcon,
  Shuffle as RandomIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import type { ImageRecord } from '../../types/image';

interface ImageNavigationProps {
  currentIndex: number;
  totalCount: number;
  onPrevious: () => void;
  onNext: () => void;
  onRandom?: () => void; // Optional: 히스토리 모드에서는 undefined
  disabled?: boolean;
  isRandomMode?: boolean;
  currentImage?: ImageRecord | null;
}

const ImageNavigation: React.FC<ImageNavigationProps> = ({
  currentIndex,
  totalCount,
  onPrevious,
  onNext,
  onRandom,
  disabled = false,
  isRandomMode = false,
}) => {
  const { t } = useTranslation();
  const isNarrow = useMediaQuery('(max-width:420px)');
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < totalCount - 1;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: isNarrow ? 0.25 : 1 }}>
      <Tooltip title={t('imageDetail:viewer.navigation.previous')}>
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
          minWidth: isNarrow ? '60px' : '80px',
          textAlign: 'center',
          fontSize: isNarrow ? '0.75rem' : '0.875rem'
        }}
      >
        {isRandomMode
          ? 'Random'
          : totalCount > 0
            ? `${currentIndex + 1} / ${totalCount}`
            : '0 / 0'
        }
      </Typography>

      <Tooltip title={t('imageDetail:viewer.navigation.next')}>
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

      {onRandom && (
        <Tooltip title={t('imageDetail:viewer.navigation.random')}>
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
      )}
    </Box>
  );
};

export default ImageNavigation;