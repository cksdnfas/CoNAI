import React, { useState, useCallback } from 'react';
import type { ImageRecord, ImageSearchParams, AutoTagSearchParams, PageSize } from '../types/image';
import type { ComplexSearchRequest } from '@comfyui-image-manager/shared';
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
  const [lastComplexRequest, setLastComplexRequest] = useState<ComplexSearchRequest | null>(null);

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

  const searchComplex = useCallback(async (request: ComplexSearchRequest) => {
    setLoading(true);
    setError(null);

    const searchRequest = {
      ...request,
      page: request.page || 1,
      limit: request.limit || pageSize,
    };

    try {
      const response = await imageApi.searchComplex(searchRequest);

      if (response.success && response.data) {
        setImages(response.data.images);
        setTotalPages(response.data.totalPages);
        setTotal(response.data.total);
        setCurrentPage(response.data.page);
        setLastComplexRequest(searchRequest);
        setLastSearchParams(null);
        setLastAutoTagParams(null);
      } else {
        setError(response.error || '검색에 실패했습니다.');
        setImages([]);
        setTotal(0);
        setTotalPages(0);
      }
    } catch (err: any) {
      // Extract detailed error message from backend response
      const errorMessage = err.response?.data?.error ||
                          err.message ||
                          '검색 중 오류가 발생했습니다.';
      setError(errorMessage);
      setImages([]);
      setTotal(0);
      setTotalPages(0);
      console.error('Complex search error:', {
        message: err.message,
        response: err.response?.data,
        request: searchRequest
      });
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  const changePage = useCallback((page: number) => {
    if (lastComplexRequest) {
      const newRequest = { ...lastComplexRequest, page };
      searchComplex(newRequest);
    } else if (lastSearchParams) {
      const newParams = { ...lastSearchParams, page };
      searchImages(newParams, lastAutoTagParams || undefined);
    }
  }, [lastComplexRequest, lastSearchParams, lastAutoTagParams, searchComplex, searchImages]);

  const changePageSize = useCallback((newPageSize: PageSize) => {
    setPageSize(newPageSize);
    if (lastComplexRequest) {
      const newRequest = { ...lastComplexRequest, page: 1, limit: newPageSize };
      searchComplex(newRequest);
    } else if (lastSearchParams) {
      const newParams = { ...lastSearchParams, page: 1, limit: newPageSize };
      searchImages(newParams, lastAutoTagParams || undefined);
    }

    // 로컬 스토리지에 저장
    localStorage.setItem('searchPageSize', newPageSize.toString());
  }, [lastComplexRequest, lastSearchParams, lastAutoTagParams, searchComplex, searchImages]);

  const deleteImages = useCallback(async (ids: number[]) => {
    setLoading(true);
    try {
      await imageApi.deleteImages(ids);
      // 삭제 후 검색 재실행
      if (lastComplexRequest) {
        await searchComplex(lastComplexRequest);
      } else if (lastSearchParams) {
        await searchImages(lastSearchParams, lastAutoTagParams || undefined);
      }
    } catch (err) {
      setError('이미지 삭제에 실패했습니다.');
      console.error('Error deleting images:', err);
    } finally {
      setLoading(false);
    }
  }, [lastComplexRequest, lastSearchParams, lastAutoTagParams, searchComplex, searchImages]);

  const refreshSearch = useCallback(() => {
    if (lastComplexRequest) {
      searchComplex(lastComplexRequest);
    } else if (lastSearchParams) {
      searchImages(lastSearchParams, lastAutoTagParams || undefined);
    }
  }, [lastComplexRequest, lastSearchParams, lastAutoTagParams, searchComplex, searchImages]);

  const clearSearch = useCallback(() => {
    setImages([]);
    setTotal(0);
    setTotalPages(0);
    setCurrentPage(1);
    setLastSearchParams(null);
    setLastAutoTagParams(null);
    setLastComplexRequest(null);
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
    lastComplexRequest,
    searchImages,
    searchComplex,
    changePage,
    changePageSize,
    deleteImages,
    refreshSearch,
    clearSearch,
  };
};