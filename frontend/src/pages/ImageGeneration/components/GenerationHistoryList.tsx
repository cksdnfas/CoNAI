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
  CleaningServices as CleaningServicesIcon,
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
  refreshKey?: number; // 히스토리 새로고침 트리거
}

export const GenerationHistoryList: React.FC<GenerationHistoryListProps> = ({
  serviceType,
  workflowId,
  refreshKey,
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
  const [cleanupDialogOpen, setCleanupDialogOpen] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);

  // 로컬 새로고침 트리거 (수동 새로고침 버튼용)
  const [localRefreshKey, setLocalRefreshKey] = useState(0);

  const ITEMS_PER_PAGE = 50;

  // react-masonry-css breakpoint 설정
  const breakpointColumns = {
    default: 3, // xl
    1536: 3, // lg+
    1200: 3, // lg
    900: 2, // md
    600: 2, // sm
  };

  // Initial load and refresh when dependencies change
  useEffect(() => {
    console.log('🔍 [GenerationHistory] useEffect triggered - refreshKey:', refreshKey, 'localRefreshKey:', localRefreshKey, 'serviceType:', serviceType, 'workflowId:', workflowId);

    const loadHistory = async () => {
      try {
        console.log('📡 [GenerationHistory] Loading history...');
        setLoading(true);
        setPage(1);

        // localRefreshKey 또는 refreshKey가 변경되었을 때 캐시 무효화
        const bustCache = localRefreshKey > 0 || (refreshKey !== undefined && refreshKey > 0);

        // 워크플로우 ID가 있으면 워크플로우별 API 호출, 없으면 전체 조회
        let response;
        if (workflowId) {
          console.log('📡 [GenerationHistory] Fetching by workflow:', workflowId, 'bustCache:', bustCache);
          response = await generationHistoryApi.getByWorkflow(workflowId, {
            limit: ITEMS_PER_PAGE,
            offset: 0,
            bustCache
          });
        } else {
          console.log('📡 [GenerationHistory] Fetching all for serviceType:', serviceType, 'bustCache:', bustCache);
          response = await generationHistoryApi.getAll({
            service_type: serviceType,
            limit: ITEMS_PER_PAGE,
            offset: 0,
            bustCache
          });
        }

        const newRecords = response.records || [];
        console.log('✅ [GenerationHistory] Fetched', newRecords.length, 'records');
        console.log('📋 [GenerationHistory] Record IDs:', newRecords.map(r => `${r.id}:${r.generation_status}`).join(', '));
        setHasMore(newRecords.length >= ITEMS_PER_PAGE);

        const convertedRecords = convertHistoriesToImageRecords(newRecords);

        // Force state update by creating new arrays
        setRecords([...newRecords]);
        setImageRecords([...convertedRecords]);

        console.log('✅ [GenerationHistory] State updated with new records');
        console.log('📊 [GenerationHistory] Component should re-render now with', convertedRecords.length, 'items');
      } catch (error) {
        console.error('❌ [GenerationHistory] Failed to load generation history:', error);
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    };

    loadHistory();
  }, [serviceType, workflowId, refreshKey, localRefreshKey]);

  // Load more when page changes (for infinite scroll)
  useEffect(() => {
    if (page <= 1) return;

    const loadMore = async () => {
      try {
        setLoading(true);

        let response;
        if (workflowId) {
          response = await generationHistoryApi.getByWorkflow(workflowId, {
            limit: ITEMS_PER_PAGE,
            offset: (page - 1) * ITEMS_PER_PAGE
          });
        } else {
          response = await generationHistoryApi.getAll({
            service_type: serviceType,
            limit: ITEMS_PER_PAGE,
            offset: (page - 1) * ITEMS_PER_PAGE
          });
        }

        const newRecords = response.records || [];
        setHasMore(newRecords.length >= ITEMS_PER_PAGE);

        const convertedRecords = convertHistoriesToImageRecords(newRecords);
        setRecords(prev => [...prev, ...newRecords]);
        setImageRecords(prev => [...prev, ...convertedRecords]);
      } catch (error) {
        console.error('Failed to load more generation history:', error);
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    };

    loadMore();
  }, [page, workflowId, serviceType]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      setPage((prev) => prev + 1);
    }
  }, [loading, hasMore]);

  const handleRefresh = () => {
    console.log('🔄 [GenerationHistory] MANUAL REFRESH CLICKED - Current localRefreshKey:', localRefreshKey);
    setSelectedIds(new Set());
    setLastSelectedIndex(null);
    setLocalRefreshKey(prev => {
      const newKey = prev + 1;
      console.log('🔄 [GenerationHistory] Setting new localRefreshKey:', newKey);
      return newKey;
    });
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

  // 실패 항목 정리
  const handleCleanupFailed = async () => {
    setCleanupLoading(true);
    try {
      const result = await generationHistoryApi.cleanupFailed(false);

      // 정리 후 목록 새로고침
      setCleanupDialogOpen(false);
      handleRefresh();

      // 성공 메시지 표시
      if (result.deleted > 0) {
        alert(t('generationHistory:cleanupSuccess', { count: result.deleted }));
      } else {
        alert(t('generationHistory:noFailedRecords'));
      }
    } catch (error) {
      console.error('Failed to cleanup failed records:', error);
      alert(t('generationHistory:cleanupFailed'));
    } finally {
      setCleanupLoading(false);
    }
  };

  const handleCleanupDialogOpen = () => {
    setCleanupDialogOpen(true);
  };

  const handleCleanupDialogClose = () => {
    setCleanupDialogOpen(false);
  };

  // 실패 항목 개수 계산
  const failedCount = records.filter(r => r.generation_status === 'failed').length;

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
        <Box sx={{ display: 'flex', gap: 1 }}>
          {failedCount > 0 && (
            <Button
              variant="outlined"
              size="small"
              color="warning"
              startIcon={<CleaningServicesIcon />}
              onClick={handleCleanupDialogOpen}
              sx={{ textTransform: 'none' }}
            >
              {t('generationHistory:cleanupFailed')} ({failedCount})
            </Button>
          )}
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
            {t('common:bulkActions.selectedCount', { count: selectedIds.size })}
          </Typography>
          <Button
            size="small"
            startIcon={<SelectAllIcon />}
            onClick={handleSelectAll}
            disabled={selectedIds.size === records.length}
          >
            {t('common:buttons.selectAll')}
          </Button>
          <Button
            size="small"
            startIcon={<DeselectIcon />}
            onClick={handleDeselectAll}
          >
            {t('common:buttons.deselectAll')}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            variant="contained"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={handleDeleteDialogOpen}
          >
            {t('generationHistory:deleteSelected', { count: selectedIds.size })}
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
                key={imageRecord.file_id ? `file-${imageRecord.file_id}-${refreshKey || 0}-${localRefreshKey}` : `hash-${imageRecord.composite_hash}-${index}-${refreshKey || 0}-${localRefreshKey}`}
                image={imageRecord}
                onClick={() => handleImageClick(index)}
                generationStatus={historyRecord.generation_status}
                serviceType={historyRecord.service_type}
                onDelete={() => handleDelete(historyRecord.id)}
                selectable={true}
                selected={selectedIds.has(historyRecord.id)}
                onSelectionChange={(_, event) => handleSelectionChange(historyRecord.id, event)}
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
        <DialogTitle>{t('generationHistory:deleteDialog.title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('generationHistory:deleteDialog.confirm', { count: selectedIds.size })}
            <br />
            {t('generationHistory:deleteDialog.warning')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteDialogClose}>
            {t('common:actions.cancel')}
          </Button>
          <Button onClick={handleBulkDelete} color="error" variant="contained">
            {t('common:actions.delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 실패 항목 정리 확인 다이얼로그 */}
      <Dialog
        open={cleanupDialogOpen}
        onClose={handleCleanupDialogClose}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t('generationHistory:cleanupFailedTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('generationHistory:cleanupFailedConfirm', { count: failedCount })}
            <br />
            <br />
            {t('generationHistory:cleanupFailedNote')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCleanupDialogClose} disabled={cleanupLoading}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            onClick={handleCleanupFailed}
            color="warning"
            variant="contained"
            disabled={cleanupLoading}
          >
            {cleanupLoading ? t('generationHistory:cleaning') : t('generationHistory:cleanup')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
