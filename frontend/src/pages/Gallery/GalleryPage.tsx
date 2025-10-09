import React, { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Stack,
  Chip,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  FilterAlt as FilterIcon,
} from '@mui/icons-material';
import ImageGrid from '../../components/ImageGrid/ImageGrid';
import BulkActionBar from '../../components/BulkActionBar/BulkActionBar';
import { useImages } from '../../hooks/useImages';
import { useSelection } from '../../hooks/useSelection';

type SortBy = 'upload_date' | 'filename' | 'file_size' | 'width' | 'height';
type SortOrder = 'asc' | 'desc';

const GalleryPage: React.FC = () => {
  const {
    images,
    loading,
    error,
    currentPage,
    pageSize,
    totalPages,
    total,
    changePage,
    changePageSize,
    deleteImages,
    refreshImages,
  } = useImages();

  const {
    selectedIds,
    toggleSelection,
    selectAll,
    deselectAll,
    selectedCount,
  } = useSelection();

  const [sortBy, setSortBy] = useState<SortBy>('upload_date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [filterAiTool, setFilterAiTool] = useState<string>('');

  const handleSelectionChange = (newSelectedIds: number[]) => {
    if (newSelectedIds.length === 0) {
      deselectAll();
    } else {
      // 개별 선택의 경우 useSelection의 toggleSelection 사용
      // 전체 선택의 경우 selectAll 사용
      if (newSelectedIds.length === images.length) {
        selectAll(newSelectedIds);
      } else {
        // 새로 추가된 ID나 제거된 ID를 찾아서 토글
        const lastSelected = newSelectedIds.find(id => !selectedIds.includes(id));
        const lastDeselected = selectedIds.find(id => !newSelectedIds.includes(id));

        if (lastSelected) {
          toggleSelection(lastSelected);
        } else if (lastDeselected) {
          toggleSelection(lastDeselected);
        }
      }
    }
  };

  const handleImageDelete = async (id: number) => {
    await deleteImages([id]);
    // 선택 목록에서도 제거
    if (selectedIds.includes(id)) {
      toggleSelection(id);
    }
  };

  const handleBulkActionComplete = () => {
    deselectAll();
    refreshImages();
  };

  // 정렬된 이미지 목록 (클라이언트 정렬)
  const sortedImages = [...images].sort((a, b) => {
    let aValue: any = a[sortBy];
    let bValue: any = b[sortBy];

    // 날짜 정렬의 경우
    if (sortBy === 'upload_date') {
      aValue = new Date(aValue).getTime();
      bValue = new Date(bValue).getTime();
    }

    // 문자열 정렬의 경우
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      aValue = aValue.toLowerCase();
      bValue = bValue.toLowerCase();
    }

    if (sortOrder === 'asc') {
      return aValue > bValue ? 1 : -1;
    } else {
      return aValue < bValue ? 1 : -1;
    }
  });

  // AI 도구별 필터링
  const filteredImages = filterAiTool
    ? sortedImages.filter(image => image.ai_tool === filterAiTool)
    : sortedImages;

  // 고유한 AI 도구 목록 추출
  const aiTools = Array.from(new Set(images.map(image => image.ai_tool).filter(Boolean)));

  const clearFilters = () => {
    setFilterAiTool('');
    setSortBy('upload_date');
    setSortOrder('desc');
  };

  const hasActiveFilters = filterAiTool !== '';

  return (
    <Box sx={{ width: '100%' }}>
      {/* 헤더 */}
      <Box sx={{ mb: { xs: 2, sm: 3 } }}>
        <Typography
          variant="h4"
          component="h1"
          gutterBottom
          sx={{
            fontSize: { xs: '1.75rem', sm: '2rem', md: '2.25rem' },
            fontWeight: 600,
          }}
        >
          이미지 갤러리
        </Typography>
        <Typography
          variant="body1"
          color="text.secondary"
          sx={{
            fontSize: { xs: '0.875rem', sm: '1rem' },
          }}
        >
          업로드된 모든 이미지를 확인하고 관리할 수 있습니다.
        </Typography>
      </Box>

      {/* 필터 및 정렬 컨트롤 */}
      <Paper
        elevation={1}
        sx={{
          p: { xs: 2, sm: 3 },
          mb: { xs: 2, sm: 3 },
          borderRadius: 2,
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          alignItems={{ xs: 'stretch', sm: 'center' }}
        >
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', flex: 1 }}>
            {/* AI 도구 필터 */}
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>AI 도구</InputLabel>
              <Select
                value={filterAiTool}
                label="AI 도구"
                onChange={(e) => setFilterAiTool(e.target.value)}
              >
                <MenuItem value="">전체</MenuItem>
                {aiTools.map((tool) => tool && (
                  <MenuItem key={tool} value={tool}>
                    {tool}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {/* 정렬 기준 */}
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>정렬 기준</InputLabel>
              <Select
                value={sortBy}
                label="정렬 기준"
                onChange={(e) => setSortBy(e.target.value as SortBy)}
              >
                <MenuItem value="upload_date">업로드 날짜</MenuItem>
                <MenuItem value="filename">파일명</MenuItem>
                <MenuItem value="file_size">파일 크기</MenuItem>
                <MenuItem value="width">가로 크기</MenuItem>
                <MenuItem value="height">세로 크기</MenuItem>
              </Select>
            </FormControl>

            {/* 정렬 순서 */}
            <FormControl size="small" sx={{ minWidth: 100 }}>
              <InputLabel>순서</InputLabel>
              <Select
                value={sortOrder}
                label="순서"
                onChange={(e) => setSortOrder(e.target.value as SortOrder)}
              >
                <MenuItem value="desc">내림차순</MenuItem>
                <MenuItem value="asc">오름차순</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            {hasActiveFilters && (
              <Button
                variant="outlined"
                size="small"
                onClick={clearFilters}
                startIcon={<FilterIcon />}
              >
                필터 초기화
              </Button>
            )}

            <Tooltip title="새로고침">
              <span>
                <IconButton onClick={refreshImages} disabled={loading}>
                  <RefreshIcon />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Stack>

        {/* 활성 필터 표시 */}
        {hasActiveFilters && (
          <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {filterAiTool && (
              <Chip
                label={`AI 도구: ${filterAiTool}`}
                onDelete={() => setFilterAiTool('')}
                size="small"
                variant="outlined"
              />
            )}
          </Box>
        )}
      </Paper>

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

      {/* 이미지 그리드 */}
      <ImageGrid
        images={filteredImages}
        loading={loading}
        selectable={true}
        selectedIds={selectedIds}
        onSelectionChange={handleSelectionChange}
        pageSize={pageSize}
        onPageSizeChange={changePageSize}
        currentPage={currentPage}
        totalPages={totalPages}
        total={total}
        onPageChange={changePage}
        onImageDelete={handleImageDelete}
      />

      {/* 벌크 액션 바 */}
      <BulkActionBar
        selectedCount={selectedCount}
        selectedIds={selectedIds}
        onSelectionClear={deselectAll}
        onActionComplete={handleBulkActionComplete}
      />
    </Box>
  );
};

export default GalleryPage;