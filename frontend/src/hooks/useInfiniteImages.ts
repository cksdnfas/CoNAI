import { useState, useCallback, useEffect } from 'react';
import type { ImageRecord, PageSize } from '../types/image';
import { imageApi } from '../services/api';

export const useInfiniteImages = () => {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [pageSize] = useState<PageSize>(50); // 무한스크롤이므로 한 번에 많이 로딩

  const loadImages = useCallback(async (page: number, shouldReplace = false) => {
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const response = await imageApi.getImages(page, pageSize);

      if (response.success && response.data) {
        const newImages = response.data.images;

        if (page === 1 || shouldReplace) {
          // 첫 페이지이거나 명시적으로 교체 요청 시
          // 부드러운 전환을 위해 약간의 딜레이 후 교체
          setImages(newImages);
        } else {
          // 다음 페이지는 기존 이미지에 추가
          setImages(prev => [...prev, ...newImages]);
        }

        // 더 이상 로딩할 이미지가 없으면 hasMore를 false로
        setHasMore(response.data.page < response.data.totalPages);
      } else {
        setError(response.error || '이미지를 불러오는데 실패했습니다.');
      }
    } catch (err) {
      setError('이미지를 불러오는 중 오류가 발생했습니다.');
      console.error('Load images error:', err);
    } finally {
      setLoading(false);
    }
  }, [loading, pageSize]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      const nextPage = currentPage + 1;
      setCurrentPage(nextPage);
      loadImages(nextPage);
    }
  }, [currentPage, hasMore, loading, loadImages]);

  const refreshImages = useCallback(() => {
    setCurrentPage(1);
    setHasMore(true);
    loadImages(1);
  }, [loadImages]);

  // ✅ composite_hash 기반으로 변경
  const deleteImage = useCallback(async (compositeHash: string) => {
    try {
      await imageApi.deleteImage(compositeHash);
      // 삭제된 이미지를 목록에서 제거
      setImages(prev => prev.filter(img => img.composite_hash !== compositeHash));
    } catch (err) {
      setError('이미지 삭제에 실패했습니다.');
      console.error('Error deleting image:', err);
    }
  }, []);

  // 초기 로딩
  useEffect(() => {
    loadImages(1);
  }, []);

  return {
    images,
    loading,
    error,
    hasMore,
    loadMore,
    refreshImages,
    deleteImage,
  };
};
