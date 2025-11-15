import { useState, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ImageRecord } from '../types/image';

interface UseImageRotationOptions {
  /** 그룹 ID (캐시 키로 사용) */
  groupId: number | string;
  /** 그룹 타입 (캐시 키로 사용) */
  groupType?: string;
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
  currentImage: ImageRecord | null;
  /** 다음 이미지 (슬라이드 전환용) */
  nextImage: ImageRecord | null;
  /** 로드된 모든 이미지 배열 */
  images: ImageRecord[];
  /** 현재 인덱스 */
  currentIndex: number;
  /** 전환 애니메이션 진행 중 여부 */
  isTransitioning: boolean;
  /** 누적 이동 offset (%) - 항상 왼쪽 방향 슬라이드용 */
  offset: number;
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
  fetchImages: (count: number, includeChildren: boolean) => Promise<ImageRecord[]>,
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
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [offset, setOffset] = useState(0); // 누적 이동 offset (항상 왼쪽으로)
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const transitionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // React Query로 이미지 캐싱
  const { data: rawImages = [], isLoading, error: queryError } = useQuery<ImageRecord[]>({
    queryKey: ['groupPreviewImages', groupType, groupId, preloadCount, includeChildren],
    queryFn: () => fetchImages(preloadCount, includeChildren),
    staleTime: 5 * 60 * 1000, // 5분 동안 fresh 상태 유지
    gcTime: 10 * 60 * 1000, // 10분 동안 캐시 보관 (cacheTime은 v5에서 gcTime으로 변경)
    enabled: enabled,
    retry: 1, // 실패 시 1번만 재시도
  });

  // composite_hash 기준 중복 제거 (같은 해시의 여러 파일 중 1개만 선택)
  const images = useMemo(() => {
    const seen = new Set<string>();
    return rawImages.filter(img => {
      if (!img.composite_hash || seen.has(img.composite_hash)) {
        return false;
      }
      seen.add(img.composite_hash);
      return true;
    });
  }, [rawImages]);

  const error = useMemo(() =>
    queryError instanceof Error ? queryError : null,
    [queryError]
  );

  // 자동 회전 타이머 (2~6초 랜덤 간격)
  useEffect(() => {
    // 이미지가 없거나, 1개만 있거나, 비활성화된 경우 회전하지 않음
    if (!enabled || images.length <= 1) {
      return;
    }

    const scheduleNext = () => {
      // 2000~6000ms 사이의 랜덤 간격
      const randomInterval = 2000 + Math.random() * 4000;

      timerRef.current = setTimeout(() => {
        setIsTransitioning(true);
        setOffset(-100);

        // 슬라이드 애니메이션 완료 후 인덱스 변경 및 offset 리셋 (600ms 후)
        transitionTimeoutRef.current = setTimeout(() => {
          setCurrentIndex(prev => (prev + 1) % images.length);
          setOffset(0);
          setIsTransitioning(false);

          // 다음 전환 예약
          scheduleNext();
        }, 600); // CSS 애니메이션 시간과 동기화
      }, randomInterval);
    };

    scheduleNext();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = null;
      }
    };
  }, [enabled, images.length]);

  // 수동 전환 함수
  const next = () => {
    if (images.length > 0) {
      setIsTransitioning(true);
      setOffset(-100);
      setTimeout(() => {
        setCurrentIndex(prev => (prev + 1) % images.length);
        setOffset(0);
        setIsTransitioning(false);
      }, 600);
    }
  };

  const previous = () => {
    if (images.length > 0) {
      setIsTransitioning(true);
      setOffset(100); // 이전 이미지는 오른쪽으로
      setTimeout(() => {
        setCurrentIndex(prev => (prev - 1 + images.length) % images.length);
        setOffset(0);
        setIsTransitioning(false);
      }, 600);
    }
  };

  // 다음 이미지 계산 (슬라이드 애니메이션용)
  const nextIndex = images.length > 0 ? (currentIndex + 1) % images.length : 0;

  return {
    currentImage: images[currentIndex] || null,
    nextImage: images[nextIndex] || null,
    images,
    currentIndex,
    isTransitioning,
    offset,
    isLoading,
    error,
    next,
    previous
  };
}
