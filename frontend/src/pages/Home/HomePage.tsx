import React from 'react';
import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import { ImageMasonry } from '../../components/ImageMasonry';
import { useInfiniteImages } from '../../hooks/useInfiniteImages';

const HomePage: React.FC = () => {
  const {
    images,
    loading,
    error,
    hasMore,
    loadMore,
    refreshImages,
  } = useInfiniteImages();

  return (
    <Box sx={{ width: '100%' }}>
      {/* 헤더 */}
      <Box
        sx={{
          mb: { xs: 2, sm: 3 },
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Box>
          <Typography
            variant="h4"
            component="h1"
            gutterBottom
            sx={{
              fontSize: { xs: '1.75rem', sm: '2rem', md: '2.25rem' },
              fontWeight: 600,
            }}
          >
            홈
          </Typography>
          <Typography
            variant="body1"
            color="text.secondary"
            sx={{
              fontSize: { xs: '0.875rem', sm: '1rem' },
            }}
          >
            최근 업로드된 이미지를 확인하세요.
          </Typography>
        </Box>

        <Tooltip title="새로고침">
          <span>
            <IconButton onClick={refreshImages} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* 에러 메시지 */}
      {error && (
        <Box
          sx={{
            mb: { xs: 2, sm: 3 },
            p: 2,
            bgcolor: 'error.light',
            color: 'error.contrastText',
            borderRadius: 2,
          }}
        >
          <Typography variant="body2">{error}</Typography>
        </Box>
      )}

      {/* 이미지 Masonry 그리드 */}
      <ImageMasonry
        images={images}
        loading={loading}
        hasMore={hasMore}
        onLoadMore={loadMore}
      />
    </Box>
  );
};

export default HomePage;
