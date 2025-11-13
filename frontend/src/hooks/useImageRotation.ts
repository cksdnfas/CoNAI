import { useState, useEffect, useRef } from 'react';
import { ImageMetadataRecord } from '@comfyui-image-manager/shared';

interface UseImageRotationOptions {
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
 * 그룹 카드 이미지 회전을 위한 커스텀 훅
 * - 지정된 간격으로 자동 이미지 전환
 * - API에서 N개 이미지 미리 로드
 * - 빈 부모 그룹은 자식 그룹 이미지 표시 가능
 *
 * @param fetchImages - 이미지 목록을 가져오는 비동기 함수
 * @param options - 회전 옵션
 * @returns 현재 이미지, 제어 함수, 상태
 */
export function useImageRotation(
  fetchImages: (count: number, includeChildren: boolean) => Promise<ImageMetadataRecord[]>,
  options: UseImageRotationOptions = {}
): UseImageRotationResult {
  const {
    interval = 3000,
    preloadCount = 8,
    includeChildren = true,
    enabled = true
  } = options;

  const [images, setImages] = useState<ImageMetadataRecord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 이미지 로드
  useEffect(() => {
    let isMounted = true;

    const loadImages = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const loadedImages = await fetchImages(preloadCount, includeChildren);

        if (isMounted) {
          setImages(loadedImages);
          setCurrentIndex(0);
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error('Failed to load images'));
          setImages([]);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadImages();

    return () => {
      isMounted = false;
    };
  }, [fetchImages, preloadCount, includeChildren]);

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
