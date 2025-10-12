import React, { useState, useCallback } from 'react';
import type { ImageRecord, ImageSearchParams, AutoTagSearchParams, PageSize } from '../types/image';
import { imageApi } from '../services/api';

export const useSearch = () => {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [lastSearchParams, setLastSearchParams] = useState<ImageSearchParams | null>(null);
  const [lastAutoTagParams, setLastAutoTagParams] = useState<AutoTagSearchParams | null>(null);

  const searchImages = useCallback(async (params: ImageSearchParams, autoTagParams?: AutoTagSearchParams) => {
    setLoading(true);
    setError(null);

    const searchParams = {
      ...params,
      page: params.page || 1,
      limit: params.limit || pageSize,
    };

    try {
      let response;

      // AutoTag 검색이 활성화된 경우
      if (autoTagParams) {
        const autoTagSearchParams = {
          ...autoTagParams,
          page: searchParams.page,
          limit: searchParams.limit,
        };
        response = await imageApi.searchByAutoTags(autoTagSearchParams);
        setLastAutoTagParams(autoTagSearchParams);
      } else {
        // 일반 검색
        response = await imageApi.searchImages(searchParams);
        setLastAutoTagParams(null);
      }

      if (response.success && response.data) {
        setImages(response.data.images);
        setTotalPages(response.data.totalPages);
        setTotal(response.data.total);
        setCurrentPage(response.data.page);
        setLastSearchParams(searchParams);
      } else {
        setError(response.error || '검색에 실패했습니다.');
        setImages([]);
        setTotal(0);
        setTotalPages(0);
      }
    } catch (err) {
      setError('검색 중 오류가 발생했습니다.');
      setImages([]);
      setTotal(0);
      setTotalPages(0);
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  const changePage = useCallback((page: number) => {
    if (lastSearchParams) {
      const newParams = { ...lastSearchParams, page };
      searchImages(newParams, lastAutoTagParams || undefined);
    }
  }, [lastSearchParams, lastAutoTagParams, searchImages]);

  const changePageSize = useCallback((newPageSize: PageSize) => {
    setPageSize(newPageSize);
    if (lastSearchParams) {
      const newParams = { ...lastSearchParams, page: 1, limit: newPageSize };
      searchImages(newParams, lastAutoTagParams || undefined);
    }

    // 로컬 스토리지에 저장
    localStorage.setItem('searchPageSize', newPageSize.toString());
  }, [lastSearchParams, lastAutoTagParams, searchImages]);

  const deleteImages = useCallback(async (ids: number[]) => {
    setLoading(true);
    try {
      await imageApi.deleteImages(ids);
      // 삭제 후 검색 재실행
      if (lastSearchParams) {
        await searchImages(lastSearchParams, lastAutoTagParams || undefined);
      }
    } catch (err) {
      setError('이미지 삭제에 실패했습니다.');
      console.error('Error deleting images:', err);
    } finally {
      setLoading(false);
    }
  }, [lastSearchParams, lastAutoTagParams, searchImages]);

  const refreshSearch = useCallback(() => {
    if (lastSearchParams) {
      searchImages(lastSearchParams, lastAutoTagParams || undefined);
    }
  }, [lastSearchParams, lastAutoTagParams, searchImages]);

  const clearSearch = useCallback(() => {
    setImages([]);
    setTotal(0);
    setTotalPages(0);
    setCurrentPage(1);
    setLastSearchParams(null);
    setLastAutoTagParams(null);
    setError(null);
  }, []);

  // 컴포넌트 마운트 시 페이지 크기 복원
  React.useEffect(() => {
    const savedPageSize = localStorage.getItem('searchPageSize');
    if (savedPageSize) {
      const parsedPageSize = parseInt(savedPageSize) as PageSize;
      if ([25, 50, 100].includes(parsedPageSize)) {
        setPageSize(parsedPageSize);
      }
    }
  }, []);

  return {
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
  };
};