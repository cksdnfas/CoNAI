import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ImageMetadataRecord } from '@comfyui-image-manager/shared';

interface UseImageRotationOptions {
  /** 그룹 ID (캐시 키로 사용) */
  groupId: number;
  /** 그룹 타입 (캐시 키로 사용) */
  groupType?: 'group' | 'auto-folder';
  /** 이미지 전환 간격 (밀리초), 기본값 3000ms (3초) */
  interval?: number;
  /** 미리 로드할 이미지 개수, 기본값 8 */
  preloadCount?: number;
  /** 자식 그룹 이미지 포함 여부, 기본값 true */
  includeChildren?: boolean;
  /** 회전 활성화 여부, 기본값 true */
  enabled?: boolean;
}

interface UseImageRotationResult {
  /** 현재 표시할 이미지 */
  currentImage: ImageMetadataRecord | null;
  /** 로드된 모든 이미지 배열 */
  images: ImageMetadataRecord[];
  /** 현재 인덱스 */
  currentIndex: number;
  /** 로딩 상태 */
  isLoading: boolean;
  /** 에러 상태 */
  error: Error | null;
  /** 수동으로 다음 이미지로 전환 */
  next: () => void;
  /** 수동으로 이전 이미지로 전환 */
  previous: () => void;
}

/**
 * 그룹 카드 이미지 회전을 위한 커스텀 훅 (React Query 캐싱 포함)
 * - 지정된 간격으로 자동 이미지 전환
 * - API에서 N개 이미지 미리 로드
 * - 빈 부모 그룹은 자식 그룹 이미지 표시 가능
 * - 5분 TTL 캐싱으로 중복 요청 방지
 *
 * @param fetchImages - 이미지 목록을 가져오는 비동기 함수
 * @param options - 회전 옵션
 * @returns 현재 이미지, 제어 함수, 상태
 */
export function useImageRotation(
  fetchImages: (count: number, includeChildren: boolean) => Promise<ImageMetadataRecord[]>,
  options: UseImageRotationOptions
): UseImageRotationResult {
  const {
    groupId,
    groupType = 'group',
    interval = 3000,
    preloadCount = 8,
    includeChildren = true,
    enabled = true
  } = options;

  const [currentIndex, setCurrentIndex] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // React Query로 이미지 캐싱
  const { data: images = [], isLoading, error: queryError } = useQuery({
    queryKey: ['groupPreviewImages', groupType, groupId, preloadCount, includeChildren],
    queryFn: () => fetchImages(preloadCount, includeChildren),
    staleTime: 5 * 60 * 1000, // 5분 동안 fresh 상태 유지
    cacheTime: 10 * 60 * 1000, // 10분 동안 캐시 보관
    enabled: enabled,
    retry: 1, // 실패 시 1번만 재시도
  });

  const error = useMemo(() =>
    queryError instanceof Error ? queryError : null,
    [queryError]
  );

  // 자동 회전 타이머
  useEffect(() => {
    // 이미지가 없거나, 1개만 있거나, 비활성화된 경우 회전하지 않음
    if (!enabled || images.length <= 1) {
      return;
    }

    timerRef.current = setInterval(() => {
      setCurrentIndex(prev => (prev + 1) % images.length);
    }, interval);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [enabled, images.length, interval]);

  // 수동 전환 함수
  const next = () => {
    if (images.length > 0) {
      setCurrentIndex(prev => (prev + 1) % images.length);
    }
  };

  const previous = () => {
    if (images.length > 0) {
      setCurrentIndex(prev => (prev - 1 + images.length) % images.length);
    }
  };

  return {
    currentImage: images[currentIndex] || null,
    images,
    currentIndex,
    isLoading,
    error,
    next,
    previous
  };
}
