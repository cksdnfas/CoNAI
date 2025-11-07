import { useState, useEffect, useCallback } from 'react';
import type { ImageRecord, PageSize } from '../types/image';
import { imageApi } from '../services/api';

export const useImages = () => {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);

  const fetchImages = useCallback(async (page: number = currentPage, limit: number = pageSize) => {
    setLoading(true);
    setError(null);

    try {
      const response = await imageApi.getImages(page, limit);
      if (response.success && response.data) {
        setImages(response.data.images);
        setTotalPages(response.data.totalPages);
        setTotal(response.data.total);
        setCurrentPage(response.data.page);
      } else {
        setError(response.error || '이미지를 불러오는데 실패했습니다.');
      }
    } catch (err) {
      setError('이미지를 불러오는데 실패했습니다.');
      console.error('Error fetching images:', err);
    } finally {
      setLoading(false);
    }
  }, [currentPage, pageSize]);

  const changePage = useCallback((page: number) => {
    setCurrentPage(page);
    fetchImages(page, pageSize);
  }, [fetchImages, pageSize]);

  const changePageSize = useCallback((newPageSize: PageSize) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
    fetchImages(1, newPageSize);

    // 로컬 스토리지에 저장
    localStorage.setItem('imagePageSize', newPageSize.toString());
  }, [fetchImages]);

  // ✅ composite_hash 기반으로 변경 + 즉시 UI 업데이트
  const deleteImages = useCallback(async (compositeHashes: string[]) => {
    console.log('🗑️ [Frontend] Deleting images:', compositeHashes);

    try {
      // 즉시 UI에서 제거 (낙관적 업데이트)
      setImages(prevImages => {
        const filtered = prevImages.filter(
          img => img.composite_hash && !compositeHashes.includes(img.composite_hash)
        );
        console.log('🗑️ [Frontend] Images after optimistic update:', filtered.length);
        return filtered;
      });

      // 백엔드 삭제 요청
      const result = await imageApi.deleteImages(compositeHashes);

      if (!result.success) {
        throw new Error(result.error || 'Delete failed');
      }

      console.log('✅ [Frontend] Delete successful, refreshing data');

      // 성공 후 전체 데이터 새로고침 (페이지네이션 정보 업데이트)
      await fetchImages(currentPage, pageSize);
    } catch (err) {
      console.error('❌ [Frontend] Delete error:', err);
      setError('이미지 삭제에 실패했습니다.');

      // 에러 발생 시 서버 데이터로 복구
      await fetchImages(currentPage, pageSize);
    }
  }, [fetchImages, currentPage, pageSize]);

  const refreshImages = useCallback(() => {
    fetchImages(currentPage, pageSize);
  }, [fetchImages, currentPage, pageSize]);

  // 컴포넌트 마운트 시 로컬 스토리지에서 페이지 크기 복원
  useEffect(() => {
    const savedPageSize = localStorage.getItem('imagePageSize');
    if (savedPageSize) {
      const parsedPageSize = parseInt(savedPageSize) as PageSize;
      if ([25, 50, 100].includes(parsedPageSize)) {
        setPageSize(parsedPageSize);
      }
    }
  }, []);

  // 초기 로드 및 페이지 크기 변경 시 데이터 fetch
  useEffect(() => {
    fetchImages();
  }, [fetchImages]);

  return {
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
    fetchImages,
  };
};