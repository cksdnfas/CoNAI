import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Delete as DeleteIcon,
  SelectAll as SelectAllIcon,
  Deselect as DeselectIcon,
} from '@mui/icons-material';
import Masonry from 'react-masonry-css';
import InfiniteScroll from 'react-infinite-scroll-component';
import { generationHistoryApi } from '../../../services/api';
import type {
  GenerationHistoryRecord,
  ServiceType,
} from '@comfyui-image-manager/shared';
import type { ImageRecord } from '../../../types/image';
import { convertHistoriesToImageRecords } from '../../../utils/generationHistoryAdapter';
import HistoryMasonryCard from './HistoryMasonryCard';
import ImageViewerModal from '../../../components/ImageViewerModal';
import { useTranslation } from 'react-i18next';
import '../../../components/ImageMasonry/ImageMasonry.css';

interface GenerationHistoryListProps {
  serviceType?: ServiceType;
  workflowId?: number; // ComfyUI 워크플로우별 필터링
  onRegenerate?: (record: GenerationHistoryRecord) => void;
}

export const GenerationHistoryList: React.FC<GenerationHistoryListProps> = ({
  serviceType,
  workflowId,
  // onRegenerate, // TODO: 재생성 기능 구현 예정
}) => {
  const { t } = useTranslation();
  const [records, setRecords] = useState<GenerationHistoryRecord[]>([]);
  const [imageRecords, setImageRecords] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // 선택 관련 상태 (항상 활성화)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const ITEMS_PER_PAGE = 50;

  // react-masonry-css breakpoint 설정
  const breakpointColumns = {
    default: 3, // xl
    1536: 3, // lg+
    1200: 3, // lg
    900: 2, // md
    600: 2, // sm
  };

  useEffect(() => {
    loadHistory(true);
  }, [serviceType, workflowId]);

  const loadHistory = async (reset: boolean = false) => {
    try {
      setLoading(true);
      const currentPage = reset ? 1 : page;

      // 워크플로우 ID가 있으면 워크플로우별 API 호출, 없으면 전체 조회
      let response;
      if (workflowId) {
        response = await generationHistoryApi.getByWorkflow(workflowId, {
          limit: ITEMS_PER_PAGE,
          offset: (currentPage - 1) * ITEMS_PER_PAGE
        });
      } else {
        // offset 기반 페이지네이션으로 변경 (무한 스크롤 지원)
        response = await generationHistoryApi.getAll({
          service_type: serviceType,
          limit: ITEMS_PER_PAGE,
          offset: (currentPage - 1) * ITEMS_PER_PAGE
        });
      }

      // 더 이상 불러올 데이터가 없으면 hasMore를 false로 설정
      const newRecords = response.records || [];
      setHasMore(newRecords.length >= ITEMS_PER_PAGE);

      // GenerationHistoryRecord를 ImageRecord로 변환
      const convertedRecords = convertHistoriesToImageRecords(newRecords);

      if (reset) {
        // 초기 로드 또는 새로고침: 데이터 교체
        setRecords(newRecords);
        setImageRecords(convertedRecords);
        setPage(1);
      } else {
        // 무한 스크롤: 기존 데이터에 추가
        setRecords(prev => [...prev, ...newRecords]);
        setImageRecords(prev => [...prev, ...convertedRecords]);
      }
    } catch (error) {
      console.error('Failed to load generation history:', error);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      setPage((prev) => prev + 1);
      loadHistory(false);
    }
  }, [loading, hasMore]);

  const handleRefresh = () => {
    setPage(1);
    setHasMore(true);
    loadHistory(true);
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('generationHistory:deleteConfirm'))) {
      return;
    }

    try {
      await generationHistoryApi.delete(id);
      handleRefresh();
    } catch (error) {
      console.error('Failed to delete history:', error);
      alert(t('generationHistory:deleteFailed'));
    }
  };

  const handleImageClick = (imageIndex: number) => {
    setCurrentImageIndex(imageIndex);
    setViewerOpen(true);
  };

  const handleImageChange = (newIndex: number) => {
    setCurrentImageIndex(newIndex);
  };

  // 전체 선택
  const handleSelectAll = () => {
    const allIds = new Set(records.map(r => r.id));
    setSelectedIds(allIds);
  };

  // 선택 해제
  const handleDeselectAll = () => {
    setSelectedIds(new Set());
    setLastSelectedIndex(null);
  };

  // 개별 선택/해제 (Ctrl/Shift 지원)
  const handleSelectionChange = (id: number, event?: React.MouseEvent) => {
    const currentIndex = records.findIndex(r => r.id === id);

    if (event?.shiftKey && lastSelectedIndex !== null) {
      // Shift + Click: 범위 선택
      const start = Math.min(lastSelectedIndex, currentIndex);
      const end = Math.max(lastSelectedIndex, currentIndex);
      const rangeIds = new Set(selectedIds);

      for (let i = start; i <= end; i++) {
        rangeIds.add(records[i].id);
      }

      setSelectedIds(rangeIds);
    } else if (event?.ctrlKey || event?.metaKey) {
      // Ctrl/Cmd + Click: 개별 토글
      const newSelectedIds = new Set(selectedIds);
      if (newSelectedIds.has(id)) {
        newSelectedIds.delete(id);
      } else {
        newSelectedIds.add(id);
      }
      setSelectedIds(newSelectedIds);
      setLastSelectedIndex(currentIndex);
    } else {
      // 일반 클릭: 단일 선택 토글
      const newSelectedIds = new Set(selectedIds);
      if (newSelectedIds.has(id)) {
        newSelectedIds.delete(id);
      } else {
        newSelectedIds.add(id);
      }
      setSelectedIds(newSelectedIds);
      setLastSelectedIndex(currentIndex);
    }
  };

  // 선택된 항목 일괄 삭제
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;

    try {
      // 각 히스토리 레코드 삭제
      await Promise.all(
        Array.from(selectedIds).map(id => generationHistoryApi.delete(id))
      );

      // 삭제 후 목록 새로고침
      setSelectedIds(new Set());
      setLastSelectedIndex(null);
      setDeleteDialogOpen(false);
      handleRefresh();
    } catch (error) {
      console.error('Failed to delete histories:', error);
      alert(t('generationHistory:bulkDeleteFailed'));
    }
  };

  const handleDeleteDialogOpen = () => {
    setDeleteDialogOpen(true);
  };

  const handleDeleteDialogClose = () => {
    setDeleteDialogOpen(false);
  };

  // 초기 로딩 중
  if (loading && imageRecords.length === 0) {
    return (
      <Box sx={{ width: '100%', p: 2 }}>
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography variant="h6" color="text.secondary">
            {t('generationHistory:loading')}
          </Typography>
        </Box>
      </Box>
    );
  }

  // 이미지가 없는 경우
  if (imageRecords.length === 0) {
    return (
      <Box sx={{ width: '100%', p: 2 }}>
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <Typography variant="h6" color="text.secondary">
            {t('generationHistory:noHistory')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('generationHistory:noHistoryDescription')}
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', p: 2 }}>
      {/* 헤더 */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2,
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {t('generationHistory:title')} ({imageRecords.length})
        </Typography>
        <Button
          variant="outlined"
          size="small"
          startIcon={<RefreshIcon />}
          onClick={handleRefresh}
          sx={{ textTransform: 'none' }}
        >
          {t('common:refresh')}
        </Button>
      </Box>

      {/* 선택 툴바 - 선택된 항목이 있을 때만 표시 */}
      {selectedIds.size > 0 && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mb: 2,
            p: 1.5,
            bgcolor: 'action.hover',
            borderRadius: 1,
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600, mr: 1 }}>
            {selectedIds.size}개 선택됨
          </Typography>
          <Button
            size="small"
            startIcon={<SelectAllIcon />}
            onClick={handleSelectAll}
            disabled={selectedIds.size === records.length}
          >
            전체 선택
          </Button>
          <Button
            size="small"
            startIcon={<DeselectIcon />}
            onClick={handleDeselectAll}
          >
            선택 해제
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            variant="contained"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={handleDeleteDialogOpen}
          >
            선택 삭제 ({selectedIds.size})
          </Button>
        </Box>
      )}

      {/* Masonry 그리드 with 무한 스크롤 */}
      <InfiniteScroll
        dataLength={imageRecords.length}
        next={loadMore}
        hasMore={hasMore}
        loader={
          <Box sx={{ mt: 2, width: '100%' }}>
            <Box sx={{ textAlign: 'center', py: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t('generationHistory:loadingMore')}
              </Typography>
            </Box>
          </Box>
        }
        endMessage={
          <Box sx={{ textAlign: 'center', py: 4, mt: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {t('generationHistory:allLoaded')}
            </Typography>
          </Box>
        }
        scrollThreshold={0.8}
        style={{ overflow: 'visible' }}
      >
        <Masonry
          breakpointCols={breakpointColumns}
          className="my-masonry-grid"
          columnClassName="my-masonry-grid_column"
        >
          {imageRecords.map((imageRecord, index) => {
            const historyRecord = records[index];
            return (
              <HistoryMasonryCard
                key={imageRecord.id}
                image={imageRecord}
                onClick={() => handleImageClick(index)}
                generationStatus={historyRecord.generation_status}
                serviceType={historyRecord.service_type}
                onDelete={() => handleDelete(historyRecord.id)}
                selectable={true}
                selected={selectedIds.has(historyRecord.id)}
                onSelectionChange={handleSelectionChange}
              />
            );
          })}
        </Masonry>
      </InfiniteScroll>

      {/* 이미지 뷰어 모달 */}
      <ImageViewerModal
        open={viewerOpen}
        onClose={() => setViewerOpen(false)}
        image={imageRecords[currentImageIndex] || null}
        images={imageRecords}
        currentIndex={currentImageIndex}
        onImageChange={handleImageChange}
        isHistoryContext={true}
        historyRecord={records[currentImageIndex]}
      />

      {/* 삭제 확인 다이얼로그 */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteDialogClose}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>선택된 항목 삭제</DialogTitle>
        <DialogContent>
          <DialogContentText>
            선택된 {selectedIds.size}개의 히스토리를 삭제하시겠습니까?
            <br />
            이 작업은 되돌릴 수 없습니다.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteDialogClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleBulkDelete} color="error" variant="contained">
            삭제
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
