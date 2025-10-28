import React, { useState } from 'react';
import { Box, Typography, IconButton, Tooltip } from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
import { ImageMasonry } from '../../components/ImageMasonry';
import BulkActionBar from '../../components/BulkActionBar/BulkActionBar';
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

  // ✅ 선택 상태 관리 (상시 선택모드) - composite_hash 기반
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const handleSelectionChange = (newSelectedIds: string[]) => {
    setSelectedIds(newSelectedIds);
  };

  const handleSelectionClear = () => {
    setSelectedIds([]);
  };

  const handleActionComplete = async (deletedIds?: string[]) => {
    // 삭제된 이미지가 있으면 선택에서 제거
    if (deletedIds && deletedIds.length > 0) {
      setSelectedIds(prev => prev.filter(id => !deletedIds.includes(id)));
    }
    // 이미지 목록 새로고침
    await refreshImages();
  };

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
            Home
          </Typography>
          {/* <Typography
            variant="body1"
            color="text.secondary"
            sx={{
              fontSize: { xs: '0.875rem', sm: '1rem' },
            }}
          >
            최근 업로드된 이미지를 확인하세요.
          </Typography> */}
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

      {/* 이미지 Masonry 그리드 (상시 선택모드) */}
      <ImageMasonry
        images={images}
        loading={loading}
        hasMore={hasMore}
        onLoadMore={loadMore}
        selectable={true}
        selectedIds={selectedIds}
        onSelectionChange={handleSelectionChange}
      />

      {/* 일괄 작업 바 */}
      <BulkActionBar
        selectedCount={selectedIds.length}
        selectedIds={selectedIds}
        selectedImages={images.filter(img => selectedIds.includes(img.composite_hash))}
        onSelectionClear={handleSelectionClear}
        onActionComplete={handleActionComplete}
      />
    </Box>
  );
};

export default HomePage;
