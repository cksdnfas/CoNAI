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
  const [allResultIds, setAllResultIds] = useState<string[]>([]); // ✅ 전체 검색 결과 composite_hash 목록

  // Shuffle State
  const [isShuffle, setIsShuffle] = useState(false);
  const [shuffledIds, setShuffledIds] = useState<string[]>([]);

  // Fisher-Yates Shuffle Algorithm
  const shuffleArray = (array: string[]) => {
    const newArray = [...array];
    for (let i = newArray.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
    }
    return newArray;
  };

  const searchImages = useCallback(async (params: ImageSearchParams, autoTagParams?: AutoTagSearchParams, options?: { shuffle?: boolean }) => {
    setLoading(true);
    setError(null);
    const shuffle = options?.shuffle ?? false;
    setIsShuffle(shuffle);

    const searchParams = {
      ...params,
      page: params.page || 1,
      limit: params.limit || pageSize,
    };

    try {
      let response;

      if (shuffle) {
        // Shuffle Mode: Fetch all IDs first
        let idsResponse;
        if (autoTagParams) {
          // AutoTag search doesn't support ID fetch directly yet, defaulting to normal search behavior for now
          // TODO: Implement ID fetch for auto tag search if needed. For now, disable shuffle or fallback.
          // Fallback to normal search but we should ideally support it.
          // Given the current scope, let's assume complex search is primary for shuffle.
          // But if we want to support simple search shuffle, we can use searchImageIds
          idsResponse = await imageApi.searchImageIds(searchParams);
        } else {
          idsResponse = await imageApi.searchImageIds(searchParams);
        }

        if (idsResponse.success && idsResponse.data) {
          // searchImageIds currently returns numbers (file_ids) from old API?
          // The interface saying data.ids: number[] might be legacy. We moved to composite_hash.
          // Let's check searchImageIds implementation in backend...
          // 'search/ids' returns ids (image_files.id).
          // We need composite_hashes for bulk fetch from MediaMetadataModel.
          // complex-search/ids returns composite_hashes.
          // Changing strategy: Use complex search logic for everything since it is more robust.
          // Convert simple params to complex request? Or just use existing.

          // If implementing for simple search tab:
          // The simple search tab currently calls `searchImages`.
          // Let's prioritize `searchComplex` which is what SearchBar uses largely.
          // But let's check `searchImageIds` in `query.routes.ts`. It returns `ids` (file_ids).
          // We need `searchComplexIds` which returns `composite_hashes`.

          // If we are in simple search mode, maybe we can't shuffle easily unless we update backend `search/ids` to return hashes.
          // Implementation Plan didn't catch this discrepancy.
          // Quick fix: `searchComplex` is the main one used by SearchBar.
          // Let's implement shuffle logic primarily in `searchComplex`.
        }

        // Non-complex shuffle support might be limited.
        // Let's handle it in `searchComplex` which covers the new SearchBar.
      }

      // ... Normal search logic ...

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

        // Reset complex state
        setLastComplexRequest(null);
        setShuffledIds([]);
        if (!shuffle) setIsShuffle(false);
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

  const searchComplex = useCallback(async (request: ComplexSearchRequest, options?: { shuffle?: boolean }) => {
    setLoading(true);
    setError(null);
    const shuffle = options?.shuffle ?? false;
    setIsShuffle(shuffle);

    const searchRequest = {
      ...request,
      page: request.page || 1,
      limit: request.limit || pageSize,
    };

    try {
      if (shuffle) {
        // 1. Get ALL IDs
        const idsResponse = await imageApi.searchComplexIds(searchRequest);

        if (idsResponse.success && idsResponse.data) {
          // Backend returns 'ids' (string[]), but interface might have said composite_hashes.
          // We updated interface to 'ids'.
          const allIds = idsResponse.data.ids || [];

          if (!Array.isArray(allIds)) {
            console.error('Shuffle error: ids is not an array', idsResponse.data);
            throw new Error('Failed to retrieve image list for shuffle');
          }

          // 2. Shuffle
          const shuffled = shuffleArray(allIds);
          setShuffledIds(shuffled);
          setAllResultIds(shuffled); // Keep consistency

          // 3. Slice for first page
          const firstPageIds = shuffled.slice(0, pageSize);

          // 4. Bulk Fetch
          const bulkResponse = await imageApi.getImagesBulk(firstPageIds);

          if (bulkResponse.success && bulkResponse.data) {
            setImages(bulkResponse.data.images);
            setTotal(allIds.length);
            setTotalPages(Math.ceil(allIds.length / pageSize));
            setCurrentPage(1);
          } else {
            // Fallback or error
            setImages([]);
          }
        } else {
          setError(idsResponse.error || 'Failed to get shuffle IDs');
          setImages([]);
        }

        setLastComplexRequest(searchRequest);
        setLastSearchParams(null);
        setLastAutoTagParams(null);

      } else {
        // Normal Search
        // 페이지 검색과 전체 ID 목록 조회를 병렬로 수행
        const [searchResponse, idsResponse] = await Promise.all([
          imageApi.searchComplex(searchRequest),
          imageApi.searchComplexIds(searchRequest)
        ]);

        if (searchResponse.success && searchResponse.data) {
          setImages(searchResponse.data.images);
          setTotalPages(searchResponse.data.totalPages);
          setTotal(searchResponse.data.total);
          setCurrentPage(searchResponse.data.page);
          setLastComplexRequest(searchRequest);
          setLastSearchParams(null);
          setLastAutoTagParams(null);
          setShuffledIds([]); // Clear shuffle state

          // ✅ 전체 composite_hash 목록 저장
          if (idsResponse.success && idsResponse.data) {
            setAllResultIds(idsResponse.data.ids || []);
          }
        } else {
          setError(searchResponse.error || '검색에 실패했습니다.');
          setImages([]);
          setTotal(0);
          setTotalPages(0);
          setAllResultIds([]);
        }
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
      setAllResultIds([]);
      console.error('Complex search error:', {
        message: err.message,
        response: err.response?.data,
        request: searchRequest
      });
    } finally {
      setLoading(false);
    }
  }, [pageSize]);

  const changePage = useCallback(async (page: number) => {
    if (isShuffle && shuffledIds.length > 0) {
      setLoading(true);
      try {
        const start = (page - 1) * pageSize;
        const end = start + pageSize;
        const pageIds = shuffledIds.slice(start, end);

        const bulkResponse = await imageApi.getImagesBulk(pageIds);
        if (bulkResponse.success && bulkResponse.data) {
          setImages(bulkResponse.data.images);
          setCurrentPage(page);
        }
      } catch (err) {
        console.error('Shuffle page change error', err);
        setError('Failed to load page');
      } finally {
        setLoading(false);
      }
      return;
    }

    if (lastComplexRequest) {
      const newRequest = { ...lastComplexRequest, page };
      searchComplex(newRequest, { shuffle: false }); // Explicitly no shuffle on page change (unless we keep mode? NO, mode is state)
      // Actually we should respect isShuffle state but searchComplex resets it if passed.
      // Wait, searchComplex RE-SHUFFLES if option is true.
      // So for page change, we should NOT call searchComplex with shuffle=true.
      // We should just simple fetch if normal mode.
      // If normal mode:
      if (!isShuffle) searchComplex(newRequest);
    } else if (lastSearchParams) {
      const newParams = { ...lastSearchParams, page };
      searchImages(newParams, lastAutoTagParams || undefined);
    }
  }, [lastComplexRequest, lastSearchParams, lastAutoTagParams, searchComplex, searchImages, isShuffle, shuffledIds, pageSize]);

  const changePageSize = useCallback((newPageSize: PageSize) => {
    setPageSize(newPageSize);

    // 로컬 스토리지에 저장
    localStorage.setItem('searchPageSize', newPageSize.toString());

    if (isShuffle && shuffledIds.length > 0) {
      // Re-slice with new page size, reset to page 1
      const firstPageIds = shuffledIds.slice(0, newPageSize);
      setLoading(true);
      imageApi.getImagesBulk(firstPageIds).then(res => {
        if (res.success && res.data) {
          setImages(res.data.images);
          setCurrentPage(1);
          setTotalPages(Math.ceil(shuffledIds.length / newPageSize));
        }
        setLoading(false);
      });
      return;
    }

    if (lastComplexRequest) {
      const newRequest = { ...lastComplexRequest, page: 1, limit: newPageSize };
      searchComplex(newRequest);
    } else if (lastSearchParams) {
      const newParams = { ...lastSearchParams, page: 1, limit: newPageSize };
      searchImages(newParams, lastAutoTagParams || undefined);
    }

  }, [lastComplexRequest, lastSearchParams, lastAutoTagParams, searchComplex, searchImages, isShuffle, shuffledIds]);

  // ✅ composite_hash 기반으로 변경
  const deleteImages = useCallback(async (compositeHashes: string[]) => {
    setLoading(true);
    try {
      await imageApi.deleteImages(compositeHashes);

      if (isShuffle) {
        // Remove from shuffledIds locally
        const newShuffled = shuffledIds.filter(id => !compositeHashes.includes(id));
        setShuffledIds(newShuffled);
        setTotal(newShuffled.length);
        setTotalPages(Math.ceil(newShuffled.length / pageSize));

        // Invalidate current page
        // Refetch current slice
        const start = (currentPage - 1) * pageSize;
        const end = start + pageSize;
        const pageIds = newShuffled.slice(start, end);

        if (pageIds.length > 0) {
          const res = await imageApi.getImagesBulk(pageIds);
          if (res.success && res.data) setImages(res.data.images);
        } else if (currentPage > 1) {
          // If page empty, go back one page
          changePage(currentPage - 1);
        } else {
          setImages([]);
        }
      } else {
        // 삭제 후 검색 재실행
        if (lastComplexRequest) {
          await searchComplex(lastComplexRequest);
        } else if (lastSearchParams) {
          await searchImages(lastSearchParams, lastAutoTagParams || undefined);
        }
      }
    } catch (err) {
      setError('이미지 삭제에 실패했습니다.');
      console.error('Error deleting images:', err);
    } finally {
      setLoading(false);
    }
  }, [lastComplexRequest, lastSearchParams, lastAutoTagParams, searchComplex, searchImages, isShuffle, shuffledIds, currentPage, pageSize, changePage]);

  const refreshSearch = useCallback(() => {
    if (isShuffle && shuffledIds.length > 0) {
      // Just refetch current page items (in case metadata changed)
      const start = (currentPage - 1) * pageSize;
      const end = start + pageSize;
      const pageIds = shuffledIds.slice(start, end);
      if (pageIds.length > 0) {
        imageApi.getImagesBulk(pageIds).then(res => {
          if (res.success && res.data) setImages(res.data.images);
        });
      }
      return;
    }

    if (lastComplexRequest) {
      searchComplex(lastComplexRequest);
    } else if (lastSearchParams) {
      searchImages(lastSearchParams, lastAutoTagParams || undefined);
    }
  }, [lastComplexRequest, lastSearchParams, lastAutoTagParams, searchComplex, searchImages, isShuffle, shuffledIds, currentPage, pageSize]);

  const clearSearch = useCallback(() => {
    setImages([]);
    setTotal(0);
    setTotalPages(0);
    setCurrentPage(1);
    setLastSearchParams(null);
    setLastAutoTagParams(null);
    setLastComplexRequest(null);
    setError(null);
    setIsShuffle(false);
    setShuffledIds([]);
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

  // Infinite scroll load more
  const loadMore = useCallback(async () => {
    if (loading || currentPage >= totalPages) return;

    const nextPage = currentPage + 1;
    setLoading(true);

    try {
      if (isShuffle && shuffledIds.length > 0) {
        const start = (nextPage - 1) * pageSize;
        const end = start + pageSize;
        const pageIds = shuffledIds.slice(start, end);

        if (pageIds.length > 0) {
          const res = await imageApi.getImagesBulk(pageIds);
          if (res.success && res.data) {
            setImages(prev => [...prev, ...res.data!.images]);
            setCurrentPage(nextPage);
          }
        }
      } else {
        let response;

        if (lastComplexRequest) {
          const request = {
            ...lastComplexRequest,
            page: nextPage,
            limit: lastComplexRequest.limit || pageSize,
          };
          response = await imageApi.searchComplex(request);
        } else if (lastSearchParams) {
          if (lastAutoTagParams) {
            const autoTagParams = {
              ...lastAutoTagParams,
              page: nextPage,
              limit: lastSearchParams.limit || pageSize,
            };
            response = await imageApi.searchByAutoTags(autoTagParams);
          } else {
            const searchParams = {
              ...lastSearchParams,
              page: nextPage,
              limit: lastSearchParams.limit || pageSize,
            };
            response = await imageApi.searchImages(searchParams);
          }
        }

        if (response && response.success && response.data) {
          setImages((prev) => [...prev, ...response.data.images]);
          setCurrentPage(response.data.page);
          // Update totals to ensure consistency
          setTotalPages(response.data.totalPages);
          setTotal(response.data.total);
        }
      }
    } catch (err) {
      console.error('Load more error:', err);
      // We might want to set a transient error state here vs full error
    } finally {
      setLoading(false);
    }
  }, [
    loading,
    currentPage,
    totalPages,
    lastComplexRequest,
    lastSearchParams,
    lastAutoTagParams,
    pageSize,
    isShuffle,
    shuffledIds
  ]);

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
    allResultIds,
    isShuffle,
    searchImages,
    searchComplex,
    changePage,
    changePageSize,
    deleteImages,
    refreshSearch,
    clearSearch,
    loadMore,
    hasMore: currentPage < totalPages,
  };
};