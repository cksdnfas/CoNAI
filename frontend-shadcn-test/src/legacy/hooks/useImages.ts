import { useState, useEffect, useCallback } from 'react';
import type { ImageRecord, PageSize } from '../types/image';
import { imageApi } from '../services/api';

type SortBy = 'first_seen_date' | 'file_size' | 'width' | 'height';
type SortOrder = 'ASC' | 'DESC';

interface UseImagesOptions {
  initialSortBy?: SortBy;
  initialSortOrder?: SortOrder;
  initialAiToolFilter?: string;
}

export const useImages = (options: UseImagesOptions = {}) => {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState<SortBy>(options.initialSortBy || 'first_seen_date');
  const [sortOrder, setSortOrder] = useState<SortOrder>(options.initialSortOrder || 'DESC');
  const [aiToolFilter, setAiToolFilter] = useState<string>(options.initialAiToolFilter || '');

  const fetchImages = useCallback(async (
    page: number = currentPage,
    limit: number = pageSize,
    sort: SortBy = sortBy,
    order: SortOrder = sortOrder,
    filter: string = aiToolFilter
  ) => {
    setLoading(true);
    setError(null);

    try {
      let response;
      if (filter) {
        // AI 도구 필터가 있으면 검색 API 사용
        response = await imageApi.searchImages({
          ai_tool: filter,
          page,
          limit,
          sortBy: sort,
          sortOrder: order
        });
      } else {
        // 필터 없으면 일반 목록 API 사용
        response = await imageApi.getImages(page, limit, sort, order);
      }

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
  }, [currentPage, pageSize, sortBy, sortOrder, aiToolFilter]);

  const changePage = useCallback((page: number) => {
    setCurrentPage(page);
    fetchImages(page, pageSize, sortBy, sortOrder, aiToolFilter);
  }, [fetchImages, pageSize, sortBy, sortOrder, aiToolFilter]);

  const changePageSize = useCallback((newPageSize: PageSize) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
    fetchImages(1, newPageSize, sortBy, sortOrder, aiToolFilter);

    // 로컬 스토리지에 저장
    localStorage.setItem('imagePageSize', newPageSize.toString());
  }, [fetchImages, sortBy, sortOrder, aiToolFilter]);

  const changeSorting = useCallback((newSortBy: SortBy, newSortOrder: SortOrder) => {
    setSortBy(newSortBy);
    setSortOrder(newSortOrder);
    setCurrentPage(1);
    fetchImages(1, pageSize, newSortBy, newSortOrder, aiToolFilter);
  }, [fetchImages, pageSize, aiToolFilter]);

  const changeAiToolFilter = useCallback((newFilter: string) => {
    setAiToolFilter(newFilter);
    setCurrentPage(1);
    fetchImages(1, pageSize, sortBy, sortOrder, newFilter);
  }, [fetchImages, pageSize, sortBy, sortOrder]);

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
      await fetchImages(currentPage, pageSize, sortBy, sortOrder, aiToolFilter);
    } catch (err) {
      console.error('❌ [Frontend] Delete error:', err);
      setError('이미지 삭제에 실패했습니다.');

      // 에러 발생 시 서버 데이터로 복구
      await fetchImages(currentPage, pageSize, sortBy, sortOrder, aiToolFilter);
    }
  }, [fetchImages, currentPage, pageSize, sortBy, sortOrder, aiToolFilter]);

  const refreshImages = useCallback(() => {
    fetchImages(currentPage, pageSize, sortBy, sortOrder, aiToolFilter);
  }, [fetchImages, currentPage, pageSize, sortBy, sortOrder, aiToolFilter]);

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
    sortBy,
    sortOrder,
    aiToolFilter,
    changePage,
    changePageSize,
    changeSorting,
    changeAiToolFilter,
    deleteImages,
    refreshImages,
    fetchImages,
  };
};