import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import type { ImageRecord, PageSize } from '../types/image';
import { imageApi } from '../services/api';

const PAGE_SIZE: PageSize = 50;

export const useInfiniteImages = () => {
  const queryClient = useQueryClient();

  // React Query의 useInfiniteQuery 사용
  const {
    data,
    error,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['images', 'infinite'],
    queryFn: async ({ pageParam = 1 }) => {
      const response = await imageApi.getImages(pageParam, PAGE_SIZE);

      if (!response.success || !response.data) {
        throw new Error(response.error || '이미지를 불러오는데 실패했습니다.');
      }

      return response.data;
    },
    getNextPageParam: (lastPage) => {
      // 다음 페이지가 있으면 페이지 번호 반환, 없으면 undefined
      return lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined;
    },
    initialPageParam: 1,
    staleTime: 60000, // 1분 - 백엔드 캐시와 동기화
    gcTime: 300000, // 5분
  });

  // 모든 페이지의 이미지를 하나의 배열로 병합
  const images = useMemo(() => {
    const result = data?.pages.flatMap(page => page.images) ?? [];

    // 🔍 Debug: Log received data
    if (result.length > 0) {
      console.log('🔍 [useInfiniteImages] First 3 images received:');
      result.slice(0, 3).forEach((img, idx) => {
        console.log(`  [${idx}] id=${img.id}, hash=${img.composite_hash?.substring(0, 8)}, path=${img.original_file_path}`);
      });
    }

    return result;
  }, [data]);

  // 로딩 상태
  const loading = isFetching && !isFetchingNextPage;

  // 에러 메시지
  const errorMessage = error ? (error as Error).message : null;

  // 더 로드하기
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // 새로고침 (캐시 무효화 + 강제 재조회)
  const refreshImages = useCallback(async () => {
    console.log('🔄 [useInfiniteImages] Refreshing images...');
    // 1. 캐시 완전 초기화
    queryClient.removeQueries({ queryKey: ['images'] });
    // 2. 강제 재조회
    await refetch();
    console.log('✅ [useInfiniteImages] Refresh complete');
  }, [queryClient, refetch]);

  // 이미지 삭제
  const deleteImage = useCallback(async (compositeHash: string) => {
    try {
      await imageApi.deleteImage(compositeHash);

      // 캐시에서 삭제된 이미지 제거 (낙관적 업데이트)
      queryClient.setQueryData(['images', 'infinite'], (oldData: any) => {
        if (!oldData) return oldData;

        return {
          ...oldData,
          pages: oldData.pages.map((page: any) => ({
            ...page,
            images: page.images.filter((img: ImageRecord) => img.composite_hash !== compositeHash),
          })),
        };
      });

      // 이미지 목록 무효화 (서버와 동기화)
      queryClient.invalidateQueries({ queryKey: ['images'] });
    } catch (err) {
      console.error('Error deleting image:', err);
      throw new Error('이미지 삭제에 실패했습니다.');
    }
  }, [queryClient]);

  return {
    images,
    loading,
    error: errorMessage,
    hasMore: hasNextPage ?? false,
    loadMore,
    refreshImages,
    deleteImage,
  };
};
