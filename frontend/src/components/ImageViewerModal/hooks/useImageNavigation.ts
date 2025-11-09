import { useEffect, useCallback } from 'react';
import type { ImageRecord, ImageSearchParams } from '../../../types/image';
import { imageApi, groupApi } from '../../../services/api';

interface UseImageNavigationProps {
  images: ImageRecord[];
  currentIndex: number;
  onImageChange?: (index: number) => void;
  isOpen: boolean;
  onClose: () => void;
  searchContext?: 'all' | 'search' | 'group';
  searchParams?: ImageSearchParams;
  groupId?: number;
  allImageIds?: number[]; // ✅ 전체 이미지 image_files.id 목록 (랜덤 선택용)
  onRandomImageLoaded?: (image: ImageRecord) => void;
  onRandomModeChange?: (isRandom: boolean) => void;
}

interface UseImageNavigationResult {
  handlePrevious: () => void;
  handleNext: () => void;
  handleRandom: () => void;
}

/**
 * Custom hook for managing image navigation and keyboard shortcuts
 */
export const useImageNavigation = ({
  images,
  currentIndex,
  onImageChange,
  isOpen,
  onClose,
  searchContext = 'all',
  searchParams,
  groupId,
  allImageIds = [],
  onRandomImageLoaded,
  onRandomModeChange,
}: UseImageNavigationProps): UseImageNavigationResult => {
  const handlePrevious = useCallback(() => {
    if (currentIndex > 0 && onImageChange) {
      onImageChange(currentIndex - 1);
      // 일반 네비게이션 시 랜덤 모드 해제
      if (onRandomModeChange) {
        onRandomModeChange(false);
      }
    }
  }, [currentIndex, onImageChange, onRandomModeChange]);

  const handleNext = useCallback(() => {
    const imagesLength = images?.length ?? 0;
    if (currentIndex < imagesLength - 1 && onImageChange) {
      onImageChange(currentIndex + 1);
      // 일반 네비게이션 시 랜덤 모드 해제
      if (onRandomModeChange) {
        onRandomModeChange(false);
      }
    }
  }, [currentIndex, images, onImageChange, onRandomModeChange]);

  const handleRandom = useCallback(async () => {
    // allImageIds가 있으면 메모리에서 랜덤 선택 (새로운 방식)
    if (allImageIds && allImageIds.length > 0) {
      try {
        // 메모리의 ID 목록에서 랜덤 선택
        const randomId = allImageIds[Math.floor(Math.random() * allImageIds.length)];

        // 현재 배열에 있는지 확인 (id 기반)
        const foundIndex = images?.findIndex(img => img.id === randomId) ?? -1;

        if (foundIndex >= 0 && onImageChange) {
          // 현재 페이지에 있음 - 바로 이동
          onImageChange(foundIndex);
          if (onRandomModeChange) {
            onRandomModeChange(false);
          }
        } else {
          // 현재 페이지에 없음 - 폴백으로 API 랜덤 조회 사용
          // ID 기반 직접 조회는 현재 지원하지 않으므로 폴백 로직으로 넘어감
          console.warn('Random image not in current page - falling back to API random');
        }
        return;
      } catch (error) {
        console.error('Failed to load random image:', error);
      }
    }

    // fallback: 기존 방식 (API 호출 또는 현재 페이지 내에서만 랜덤)
    try {
      let result: { success: boolean; data?: ImageRecord; error?: string } | null = null;

      // Try to fetch random image from full database based on context
      if (searchContext === 'all') {
        result = await imageApi.getRandomImage();
      } else if (searchContext === 'search' && searchParams) {
        result = await imageApi.getRandomFromSearch(searchParams);
      } else if (searchContext === 'group' && groupId !== undefined) {
        result = await groupApi.getRandomImageFromGroup(groupId);
      }

      // If API call succeeded and returned an image, use it
      if (result?.success && result.data) {
        // Check if this image exists in current array
        const foundIndex = images?.findIndex(img => img.composite_hash === result.data!.composite_hash) ?? -1;

        if (foundIndex >= 0 && onImageChange) {
          // Image found in array - navigate to it (normal mode)
          onImageChange(foundIndex);
          if (onRandomModeChange) {
            onRandomModeChange(false);
          }
        } else {
          // Image not in array - load as random mode
          if (onRandomImageLoaded) {
            onRandomImageLoaded(result.data);
          }
          if (onRandomModeChange) {
            onRandomModeChange(true);
          }
        }
        return;
      }
    } catch (error) {
      console.error('Failed to get random image from server:', error);
    }

    // Fallback to in-memory random if API fails or no context
    const imagesLength = images?.length ?? 0;
    if (imagesLength <= 1 || !onImageChange) return;

    let randomIndex;
    do {
      randomIndex = Math.floor(Math.random() * imagesLength);
    } while (randomIndex === currentIndex);

    onImageChange(randomIndex);
    // In-memory random is normal mode
    if (onRandomModeChange) {
      onRandomModeChange(false);
    }
  }, [allImageIds, images, currentIndex, onImageChange, onRandomImageLoaded, onRandomModeChange, searchContext, searchParams, groupId]);

  // Keyboard event handler
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      switch (event.key) {
        case 'ArrowLeft':
          event.preventDefault();
          handlePrevious();
          break;
        case 'ArrowRight':
          event.preventDefault();
          handleNext();
          break;
        case ' ':
          event.preventDefault();
          handleRandom();
          break;
        case 'Escape':
          event.preventDefault();
          onClose();
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handlePrevious, handleNext, handleRandom, onClose]);

  return {
    handlePrevious,
    handleNext,
    handleRandom,
  };
};
