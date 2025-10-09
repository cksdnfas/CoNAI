import React from 'react';
import {
  Box,
  Typography,
  Alert,
  Button,
  Stack,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import SearchBar from '../../components/SearchBar/SearchBar';
import ImageGrid from '../../components/ImageGrid/ImageGrid';
import BulkActionBar from '../../components/BulkActionBar/BulkActionBar';
import { useSearch } from '../../hooks/useSearch';
import { useSelection } from '../../hooks/useSelection';
import type { ImageSearchParams } from '../../types/image';

const SearchPage: React.FC = () => {
  const {
    images,
    loading,
    error,
    currentPage,
    pageSize,
    totalPages,
    total,
    lastSearchParams,
    searchImages,
    changePage,
    changePageSize,
    deleteImages,
    refreshSearch,
    clearSearch,
  } = useSearch();

  const {
    selectedIds,
    toggleSelection,
    selectAll,
    deselectAll,
    selectedCount,
  } = useSelection();

  const handleSearch = (params: ImageSearchParams) => {
    deselectAll(); // 새 검색 시 선택 해제
    searchImages(params);
  };

  const handleSelectionChange = (newSelectedIds: number[]) => {
    if (newSelectedIds.length === 0) {
      deselectAll();
    } else {
      if (newSelectedIds.length === images.length) {
        selectAll(newSelectedIds);
      } else {
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
    if (selectedIds.includes(id)) {
      toggleSelection(id);
    }
  };

  const handleBulkActionComplete = () => {
    deselectAll();
    refreshSearch();
  };

  const hasSearched = lastSearchParams !== null;
  const hasResults = images.length > 0;

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
          이미지 검색
        </Typography>
        <Typography
          variant="body1"
          color="text.secondary"
          sx={{
            fontSize: { xs: '0.875rem', sm: '1rem' },
          }}
        >
          프롬프트, AI 도구, 모델명 등으로 이미지를 검색할 수 있습니다.
        </Typography>
      </Box>

      {/* 검색 바 */}
      <Box sx={{ mb: { xs: 2, sm: 3 } }}>
        <SearchBar onSearch={handleSearch} loading={loading} />
      </Box>

      {/* 검색 결과 헤더 */}
      {hasSearched && (
        <Box sx={{ mb: { xs: 2, sm: 3 } }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'stretch', sm: 'center' }}
            spacing={2}
          >
            <Box>
              <Typography variant="h6">
                검색 결과
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {loading ? '검색 중...' : `총 ${total.toLocaleString()}개의 이미지를 찾았습니다.`}
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="outlined"
                size="small"
                onClick={clearSearch}
                startIcon={<ClearIcon />}
              >
                검색 초기화
              </Button>
              {hasResults && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={refreshSearch}
                  disabled={loading}
                  startIcon={<RefreshIcon />}
                >
                  새로고침
                </Button>
              )}
            </Box>
          </Stack>
        </Box>
      )}

      {/* 에러 메시지 */}
      {error && (
        <Alert
          severity="error"
          sx={{
            mb: { xs: 2, sm: 3 },
            borderRadius: 2,
          }}
        >
          {error}
        </Alert>
      )}

      {/* 검색 결과 또는 안내 메시지 */}
      {!hasSearched ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            검색어를 입력하여 이미지를 찾아보세요
          </Typography>
          <Typography variant="body2" color="text.secondary">
            프롬프트, AI 도구, 모델명, 날짜 등으로 검색할 수 있습니다.
          </Typography>
        </Box>
      ) : hasResults ? (
        <ImageGrid
          images={images}
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
      ) : !loading ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography variant="h6" color="text.secondary" gutterBottom>
            검색 결과가 없습니다
          </Typography>
          <Typography variant="body2" color="text.secondary">
            다른 검색어를 시도하거나 필터를 조정해보세요.
          </Typography>
        </Box>
      ) : null}

      {/* 벌크 액션 바 */}
      {hasResults && (
        <BulkActionBar
          selectedCount={selectedCount}
          selectedIds={selectedIds}
          onSelectionClear={deselectAll}
          onActionComplete={handleBulkActionComplete}
        />
      )}
    </Box>
  );
};

export default SearchPage;