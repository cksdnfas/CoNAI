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
    if (currentIndex < images.length - 1 && onImageChange) {
      onImageChange(currentIndex + 1);
      // 일반 네비게이션 시 랜덤 모드 해제
      if (onRandomModeChange) {
        onRandomModeChange(false);
      }
    }
  }, [currentIndex, images.length, onImageChange, onRandomModeChange]);

  const handleRandom = useCallback(async () => {
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
        const foundIndex = images.findIndex(img => img.id === result.data!.id);

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
    if (images.length <= 1 || !onImageChange) return;

    let randomIndex;
    do {
      randomIndex = Math.floor(Math.random() * images.length);
    } while (randomIndex === currentIndex);

    onImageChange(randomIndex);
    // In-memory random is normal mode
    if (onRandomModeChange) {
      onRandomModeChange(false);
    }
  }, [searchContext, searchParams, groupId, images, currentIndex, onImageChange, onRandomImageLoaded, onRandomModeChange]);

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
