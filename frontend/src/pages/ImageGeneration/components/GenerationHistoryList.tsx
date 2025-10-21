import React, { useState, useEffect, useCallback } from 'react';
import { Box, Typography, Button } from '@mui/material';
import { Refresh as RefreshIcon } from '@mui/icons-material';
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
        response = await generationHistoryApi.getRecent(
          ITEMS_PER_PAGE * currentPage
        );
      }

      // Filter by service type if specified (워크플로우 조회가 아닐 때만)
      let filteredRecords = response.records;
      if (serviceType && !workflowId) {
        filteredRecords = filteredRecords.filter(
          (r) => r.service_type === serviceType
        );
      }

      // 더 이상 불러올 데이터가 없으면 hasMore를 false로 설정
      setHasMore(filteredRecords.length >= ITEMS_PER_PAGE);

      setRecords(filteredRecords);

      // GenerationHistoryRecord를 ImageRecord로 변환
      const convertedRecords = convertHistoriesToImageRecords(filteredRecords);
      setImageRecords(convertedRecords);

      if (reset) {
        setPage(1);
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
          mb: 3,
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
      />
    </Box>
  );
};
