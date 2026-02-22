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
  Tooltip,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  CleaningServices as CleaningServicesIcon,
} from '@mui/icons-material';
import { generationHistoryApi } from '../../../services/api';
import type {
  GenerationHistoryRecord,
  ServiceType,
} from '@comfyui-image-manager/shared';
import type { ImageRecord } from '../../../types/image';
import { convertHistoriesToImageRecords } from '../../../utils/generationHistoryAdapter';
import ImageList from '../../../components/ImageList/ImageList';
import { useTranslation } from 'react-i18next';

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

  // 통합 ImageList를 위한 선택 상태
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [cleanupDialogOpen, setCleanupDialogOpen] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);

  // 로컬 새로고침 트리거 (수동 새로고침 버튼용)
  const [localRefreshKey, setLocalRefreshKey] = useState(0);

  const ITEMS_PER_PAGE = 50;

  // Initial load and refresh when dependencies change
  useEffect(() => {
    // console.log('🔍 [GenerationHistory] useEffect triggered - refreshKey:', refreshKey, 'localRefreshKey:', localRefreshKey, 'serviceType:', serviceType, 'workflowId:', workflowId);

    const loadHistory = async () => {
      try {
        // console.log('📡 [GenerationHistory] Loading history...');
        setLoading(true);
        setPage(1);

        // localRefreshKey 또는 refreshKey가 변경되었을 때 캐시 무효화
        const bustCache = localRefreshKey > 0 || (refreshKey !== undefined && refreshKey > 0);

        // 워크플로우 ID가 있으면 워크플로우별 API 호출, 없으면 전체 조회
        let response;
        if (workflowId) {
          // console.log('📡 [GenerationHistory] Fetching by workflow:', workflowId, 'bustCache:', bustCache);
          response = await generationHistoryApi.getByWorkflow(workflowId, {
            limit: ITEMS_PER_PAGE,
            offset: 0,
            bustCache
          });
        } else {
          // console.log('📡 [GenerationHistory] Fetching all for serviceType:', serviceType, 'bustCache:', bustCache);
          response = await generationHistoryApi.getAll({
            service_type: serviceType,
            limit: ITEMS_PER_PAGE,
            offset: 0,
            bustCache
          });
        }

        const newRecords = response.records || [];
        // console.log('✅ [GenerationHistory] Fetched', newRecords.length, 'records');
        setHasMore(newRecords.length >= ITEMS_PER_PAGE);

        const convertedRecords = convertHistoriesToImageRecords(newRecords);

        // Force state update by creating new arrays
        setRecords([...newRecords]);
        setImageRecords([...convertedRecords]);

        // console.log('✅ [GenerationHistory] State updated with new records');
      } catch (error) {
        console.error('❌ [GenerationHistory] Failed to load generation history:', error);
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    };

    loadHistory();
  }, [serviceType, workflowId, refreshKey, localRefreshKey]);

  // Load more function
  const loadMoreData = useCallback(async () => {
    try {
      // setLoading(true); // Don't set full loading for infinite scroll, just load more
      const nextPage = page + 1;

      let response;
      if (workflowId) {
        response = await generationHistoryApi.getByWorkflow(workflowId, {
          limit: ITEMS_PER_PAGE,
          offset: (nextPage - 1) * ITEMS_PER_PAGE
        });
      } else {
        response = await generationHistoryApi.getAll({
          service_type: serviceType,
          limit: ITEMS_PER_PAGE,
          offset: (nextPage - 1) * ITEMS_PER_PAGE
        });
      }

      const newRecords = response.records || [];
      setHasMore(newRecords.length >= ITEMS_PER_PAGE);

      const convertedRecords = convertHistoriesToImageRecords(newRecords);
      setRecords(prev => [...prev, ...newRecords]);
      setImageRecords(prev => [...prev, ...convertedRecords]);
      setPage(nextPage);
    } catch (error) {
      console.error('Failed to load more generation history:', error);
      setHasMore(false);
    }
  }, [page, workflowId, serviceType]);


  const handleRefresh = () => {
    // console.log('🔄 [GenerationHistory] MANUAL REFRESH CLICKED - Current localRefreshKey:', localRefreshKey);
    setSelectedIds([]);
    setLocalRefreshKey(prev => prev + 1);
  };

  const handleSelectionChange = (newSelectedIds: number[]) => {
    setSelectedIds(newSelectedIds);
  };

  const handleSelectionClear = () => {
    setSelectedIds([]);
  };

  // 삭제 완료 후 호출
  const handleActionComplete = async (deletedHashes?: string[]) => {
    // 로컬 상태 업데이트 (삭제된 항목 제거)
    if (deletedHashes && deletedHashes.length > 0) {
      // Note: GenerationHistory uses ID, but deletedHashes are composite_hashes.
      // However, we can just refresh everything or try to filter.
      // For accurate synching, we'll confirm via composite_hash
      // But GenerationHistory records might not have comp_hash fully populated in Phase 1?
      // Let's just refresh.
      handleRefresh();
    }
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

  return (
    <Box sx={{ width: '100%', p: 2, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* 헤더 */}
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2,
          flexShrink: 0,
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
          <Tooltip title={t('common:refresh')}>
            <Button
              variant="outlined"
              size="small"
              sx={{
                minWidth: '40px',
                width: '40px',
                height: '32px',
                padding: 0
              }}
              onClick={handleRefresh}
            >
              <RefreshIcon fontSize="small" />
            </Button>
          </Tooltip>
        </Box>
      </Box>

      {/* Unified Image List */}
      <Box sx={{ flexGrow: 1, minHeight: 0 }}>
        <ImageList
          images={imageRecords}
          loading={loading}
          selectable={true}
          selection={{
            selectedIds,
            onSelectionChange: handleSelectionChange
          }}
          contextId="history"
          mode="infinite"
          infiniteScroll={{
            hasMore,
            loadMore: loadMoreData
          }}
          total={imageRecords.length}
        // Note: total is approximate here as we don't have total count from API easily for infinite scroll sometimes
        />
      </Box>

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

export default GenerationHistoryList;
