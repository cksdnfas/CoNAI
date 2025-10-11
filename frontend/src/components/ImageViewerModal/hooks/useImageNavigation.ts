import { useEffect, useCallback } from 'react';
import type { ImageRecord } from '../../../types/image';

interface UseImageNavigationProps {
  images: ImageRecord[];
  currentIndex: number;
  onImageChange?: (index: number) => void;
  isOpen: boolean;
  onClose: () => void;
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
}: UseImageNavigationProps): UseImageNavigationResult => {
  const handlePrevious = useCallback(() => {
    if (currentIndex > 0 && onImageChange) {
      onImageChange(currentIndex - 1);
    }
  }, [currentIndex, onImageChange]);

  const handleNext = useCallback(() => {
    if (currentIndex < images.length - 1 && onImageChange) {
      onImageChange(currentIndex + 1);
    }
  }, [currentIndex, images.length, onImageChange]);

  const handleRandom = useCallback(() => {
    if (images.length <= 1 || !onImageChange) return;

    let randomIndex;
    do {
      randomIndex = Math.floor(Math.random() * images.length);
    } while (randomIndex === currentIndex);

    onImageChange(randomIndex);
  }, [currentIndex, images.length, onImageChange]);

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
