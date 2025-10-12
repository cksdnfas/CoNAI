import React, { useState } from 'react';
import {
  Grid,
  Box,
  Typography,
  Pagination,
  Skeleton,
  FormControlLabel,
  Checkbox,
  Stack,
  Divider,
} from '@mui/material';
import type { ImageRecord, PageSize } from '../../types/image';
import ImageCard from '../ImageCard/ImageCard';
import PageSizeSelector from '../PageSizeSelector/PageSizeSelector';
import ImageViewerModal from '../ImageViewerModal';

export interface ImageGridProps {
  images: ImageRecord[];
  loading?: boolean;
  selectable?: boolean;
  selectedIds?: number[];
  onSelectionChange?: (selectedIds: number[]) => void;
  pageSize?: PageSize;
  onPageSizeChange?: (size: PageSize) => void;
  currentPage?: number;
  totalPages?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onImageDelete?: (id: number) => void;
  showCollectionType?: boolean;
  currentGroupId?: number;
}

const ImageGrid: React.FC<ImageGridProps> = ({
  images = [],
  loading = false,
  selectable = false,
  selectedIds = [],
  onSelectionChange,
  pageSize = 25,
  onPageSizeChange,
  currentPage = 1,
  totalPages = 1,
  total = 0,
  onPageChange,
  onImageDelete,
  showCollectionType = false,
  currentGroupId,
}) => {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // images가 undefined일 경우 방어
  const safeImages = images || [];

  const handleSelectionChange = (id: number) => {
    if (!onSelectionChange) return;

    const newSelectedIds = selectedIds.includes(id)
      ? selectedIds.filter(selectedId => selectedId !== id)
      : [...selectedIds, id];

    onSelectionChange(newSelectedIds);
  };

  const handleSelectAll = (checked: boolean) => {
    if (!onSelectionChange) return;

    if (checked) {
      const allIds = safeImages.map(image => image.id);
      onSelectionChange(allIds);
    } else {
      onSelectionChange([]);
    }
  };

  const isAllSelected = safeImages.length > 0 && selectedIds.length === safeImages.length;
  const isIndeterminate = selectedIds.length > 0 && selectedIds.length < safeImages.length;

  const handleImageClick = (imageIndex: number) => {
    setCurrentImageIndex(imageIndex);
    setViewerOpen(true);
  };

  const handleImageChange = (newIndex: number) => {
    setCurrentImageIndex(newIndex);
  };

  if (loading) {
    return (
      <Box>
        <Grid container spacing={2}>
          {Array.from({ length: pageSize }, (_, index) => (
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3, xl: 2 }} key={index}>
              <Skeleton variant="rectangular" height={200} />
              <Box sx={{ pt: 0.5 }}>
                <Skeleton />
                <Skeleton width="60%" />
              </Box>
            </Grid>
          ))}
        </Grid>
      </Box>
    );
  }

  if (safeImages.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <Typography variant="h6" color="text.secondary">
          이미지가 없습니다
        </Typography>
        <Typography variant="body2" color="text.secondary">
          이미지를 업로드하거나 검색 조건을 변경해보세요.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* 컨트롤 바 */}
      <Box sx={{ mb: 3 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', sm: 'center' }}
          spacing={2}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {selectable && (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={isAllSelected}
                    indeterminate={isIndeterminate}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                  />
                }
                label={`전체 선택 (${selectedIds.length}/${safeImages.length})`}
              />
            )}
            <Typography variant="body2" color="text.secondary">
              총 {total.toLocaleString()}개 이미지
            </Typography>
          </Box>

          {onPageSizeChange && (
            <PageSizeSelector
              value={pageSize}
              onChange={onPageSizeChange}
              disabled={loading}
            />
          )}
        </Stack>

        <Divider sx={{ mt: 2 }} />
      </Box>

      {/* 이미지 그리드 */}
      <Grid container spacing={2}>
        {safeImages.map((image, index) => (
          <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3, xl: 2 }} key={image.id}>
            <ImageCard
              image={image}
              selected={selectedIds.includes(image.id)}
              selectable={selectable}
              onSelectionChange={handleSelectionChange}
              onDelete={onImageDelete}
              onImageClick={() => handleImageClick(index)}
              showCollectionType={showCollectionType}
              currentGroupId={currentGroupId}
            />
          </Grid>
        ))}
      </Grid>

      {/* 페이지네이션 */}
      {totalPages > 1 && onPageChange && (
        <Box sx={{ display: 'flex', justifyContent: 'center', mt: 4 }}>
          <Pagination
            count={totalPages}
            page={currentPage}
            onChange={(_, page) => onPageChange(page)}
            color="primary"
            size="large"
            showFirstButton
            showLastButton
          />
        </Box>
      )}

      {/* 이미지 뷰어 모달 */}
      <ImageViewerModal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        image={safeImages[currentImageIndex] || null}
        images={safeImages}
        currentIndex={currentImageIndex}
        onImageChange={handleImageChange}
      />
    </Box>
  );
};

export default ImageGrid;