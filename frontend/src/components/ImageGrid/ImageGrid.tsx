import React, { useState, useEffect } from 'react';
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
import { useTranslation } from 'react-i18next';
import type { ImageRecord, PageSize, ImageSearchParams } from '../../types/image';
import ImageCard from '../ImageCard/ImageCard';
import PageSizeSelector from '../PageSizeSelector/PageSizeSelector';
import ImageViewerModal from '../ImageViewerModal';
import { imageApi, groupApi } from '../../services/api';
import './ImageGrid.css';

// ✅ composite_hash 기반으로 변경
export interface ImageGridProps {
  images: ImageRecord[];
  loading?: boolean;
  selectable?: boolean;
  selectedIds?: string[];  // composite_hash[]
  onSelectionChange?: (selectedIds: string[]) => void;
  pageSize?: PageSize;
  onPageSizeChange?: (size: PageSize) => void;
  currentPage?: number;
  totalPages?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onImageDelete?: (compositeHash: string) => void;  // composite_hash
  showCollectionType?: boolean;
  currentGroupId?: number;
  searchParams?: ImageSearchParams;
  allImageIds?: string[]; // ✅ 외부에서 전달된 전체 이미지 composite_hash 목록 (우선순위)
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
  searchParams,
  allImageIds: externalAllImageIds,
}) => {
  const { t } = useTranslation(['common', 'gallery']);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [lastClickedIndex, setLastClickedIndex] = useState<number>(-1);
  const [internalAllImageIds, setInternalAllImageIds] = useState<string[]>([]);  // ✅ composite_hash[]

  // images가 undefined일 경우 방어
  const safeImages = images || [];

  // 외부에서 전달된 ID 목록이 있으면 우선 사용, 없으면 내부적으로 조회
  const allImageIds = externalAllImageIds || internalAllImageIds;

  // ✅ 그룹/검색 컨텍스트에서 전체 이미지 composite_hash 목록 조회
  useEffect(() => {
    // 외부에서 이미 전달된 경우 조회하지 않음
    if (externalAllImageIds && externalAllImageIds.length > 0) {
      return;
    }

    const fetchAllImageIds = async () => {
      try {
        if (currentGroupId) {
          // 그룹 모드: 그룹 전체 이미지 composite_hash 조회
          const result = await groupApi.getImageIdsForGroup(currentGroupId);
          if (result.success && result.data) {
            setInternalAllImageIds(result.data.composite_hashes);
          }
        } else if (searchParams) {
          // 검색 모드: 검색 결과 전체 이미지 composite_hash 조회
          const result = await imageApi.searchImageIds(searchParams);
          if (result.success && result.data) {
            setInternalAllImageIds(result.data.composite_hashes);
          }
        } else {
          // 전체 모드: ID 목록 없음 (기존 방식 사용)
          setInternalAllImageIds([]);
        }
      } catch (error) {
        console.error('Failed to fetch all image IDs:', error);
        setInternalAllImageIds([]);
      }
    };

    fetchAllImageIds();
  }, [currentGroupId, searchParams, externalAllImageIds]);

  // ✅ composite_hash 기반으로 변경
  const handleSelectionChange = (compositeHash: string, event?: React.MouseEvent) => {
    if (!onSelectionChange) return;

    const imageIndex = safeImages.findIndex(img => img.composite_hash === compositeHash);

    // Ctrl/Cmd + Click: 토글 선택
    if (event && (event.ctrlKey || event.metaKey)) {
      const newSelectedIds = selectedIds.includes(compositeHash)
        ? selectedIds.filter(selectedId => selectedId !== compositeHash)
        : [...selectedIds, compositeHash];
      onSelectionChange(newSelectedIds);
      setLastClickedIndex(imageIndex);
      return;
    }

    // Shift + Click: 범위 선택
    if (event && event.shiftKey && lastClickedIndex >= 0) {
      const start = Math.min(lastClickedIndex, imageIndex);
      const end = Math.max(lastClickedIndex, imageIndex);
      const rangeIds = safeImages.slice(start, end + 1).map(img => img.composite_hash);
      const newSelectedIds = Array.from(new Set([...selectedIds, ...rangeIds]));
      onSelectionChange(newSelectedIds);
      return;
    }

    // 일반 클릭: 토글 선택
    const newSelectedIds = selectedIds.includes(compositeHash)
      ? selectedIds.filter(selectedId => selectedId !== compositeHash)
      : [...selectedIds, compositeHash];
    onSelectionChange(newSelectedIds);
    setLastClickedIndex(imageIndex);
  };

  const handleSelectAll = (checked: boolean) => {
    if (!onSelectionChange) return;

    if (checked) {
      const allIds = safeImages.map(image => image.composite_hash);
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

  // 컨테이너 클릭 핸들러 (빈 공간 클릭 시 선택 해제)
  const handleContainerClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isImageCard = target.closest('.MuiCard-root');
    const isCheckbox = target.closest('.image-card-actions');
    const isBulkActionBar = target.closest('.no-drag-select');
    const isPagination = target.closest('.MuiPagination-root');

    // 빈 공간 클릭인 경우에만 선택 해제
    if (!isImageCard && !isCheckbox && !isBulkActionBar && !isPagination && onSelectionChange && selectedIds.length > 0) {
      onSelectionChange([]);
      setLastClickedIndex(-1);
    }
  };

  // 키보드 단축키 핸들러
  useEffect(() => {
    if (!selectable || !onSelectionChange) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl/Cmd + A: 전체 선택
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault();
        const allIds = safeImages.map(img => img.composite_hash);
        onSelectionChange(allIds);
      }

      // ESC: 선택 해제
      if (e.key === 'Escape') {
        e.preventDefault();
        onSelectionChange([]);
        setLastClickedIndex(-1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [selectable, onSelectionChange, safeImages]);


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
          {t('gallery:status.noImages')}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('gallery:status.uploadPrompt', '이미지를 업로드하거나 검색 조건을 변경해보세요.')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      onClick={handleContainerClick}
      sx={{ position: 'relative' }}
    >
      {/* 컨트롤 바 */}
      <Box sx={{ mb: 3 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          justifyContent="space-between"
          alignItems={{ xs: 'stretch', sm: 'center' }}
          spacing={2}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={isAllSelected}
                  indeterminate={isIndeterminate}
                  onChange={(e) => handleSelectAll(e.target.checked)}
                  disabled={!selectable}
                />
              }
              label={t('gallery:selectAllLabel', {
                selected: selectedIds.length,
                total: safeImages.length,
                defaultValue: `전체 선택 (${selectedIds.length}/${safeImages.length})`
              })}
            />
            <Typography variant="body2" color="text.secondary">
              {t('gallery:totalImages', {
                count: total,
                defaultValue: `총 ${total.toLocaleString()}개 이미지`
              })}
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
          <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3, xl: 2 }} key={image.file_id ? `file-${image.file_id}` : `hash-${image.composite_hash}-${index}`}>
            <ImageCard
              image={image}
              selected={selectedIds.includes(image.composite_hash)}
              selectable={selectable}
              onSelectionChange={(hash, event) => handleSelectionChange(hash, event)}
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
        onImageDeleted={onImageDelete}
        searchContext={searchParams ? 'search' : currentGroupId ? 'group' : 'all'}
        searchParams={searchParams}
        groupId={currentGroupId}
        allImageIds={allImageIds}
      />
    </Box>
  );
};

export default ImageGrid;