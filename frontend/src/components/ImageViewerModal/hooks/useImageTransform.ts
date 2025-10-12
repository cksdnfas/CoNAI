import { useState, useEffect, useCallback, useRef } from 'react';

interface ImagePosition {
  x: number;
  y: number;
}

interface UseImageTransformResult {
  scale: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  imagePosition: ImagePosition;
  isDragging: boolean;
  imageContainerRef: React.RefObject<HTMLDivElement | null>;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleRotateLeft: () => void;
  handleRotateRight: () => void;
  handleFlipHorizontal: () => void;
  handleFlipVertical: () => void;
  handleReset: () => void;
  handleMouseDown: (e: React.MouseEvent) => void;
}

/**
 * Custom hook for managing image transformations (zoom, rotation, flip, drag)
 */
export const useImageTransform = (imageId?: number, isOpen: boolean = false): UseImageTransformResult => {
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [flipX, setFlipX] = useState(false);
  const [flipY, setFlipY] = useState(false);
  const [imagePosition, setImagePosition] = useState<ImagePosition>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<ImagePosition>({ x: 0, y: 0 });
  const imageContainerRef = useRef<HTMLDivElement>(null);

  // Touch pinch zoom states
  const [touchStartDistance, setTouchStartDistance] = useState<number>(0);
  const [touchStartScale, setTouchStartScale] = useState<number>(1);

  // Reset all transformations when image changes
  useEffect(() => {
    setScale(1);
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
    setImagePosition({ x: 0, y: 0 });
    setIsDragging(false);
  }, [imageId]);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    setScale(prev => Math.min(prev * 1.2, 5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale(prev => {
      const newScale = Math.max(prev / 1.2, 0.1);
      // Reset position to center when zooming out to or below 100%
      if (newScale <= 1) {
        setImagePosition({ x: 0, y: 0 });
      }
      return newScale;
    });
  }, []);

  // Rotation handlers
  const handleRotateLeft = useCallback(() => {
    setRotation(prev => (prev - 90) % 360);
  }, []);

  const handleRotateRight = useCallback(() => {
    setRotation(prev => (prev + 90) % 360);
  }, []);

  // Flip handlers
  const handleFlipHorizontal = useCallback(() => {
    setFlipX(prev => !prev);
  }, []);

  const handleFlipVertical = useCallback(() => {
    setFlipY(prev => !prev);
  }, []);

  // Reset handler
  const handleReset = useCallback(() => {
    setScale(1);
    setRotation(0);
    setFlipX(false);
    setFlipY(false);
    setImagePosition({ x: 0, y: 0 });
  }, []);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scale > 1) {
      e.preventDefault();
      setIsDragging(true);
      setDragStart({
        x: e.clientX - imagePosition.x,
        y: e.clientY - imagePosition.y,
      });
    }
  }, [scale, imagePosition]);

  // Global mouse events for dragging
  useEffect(() => {
    if (!isDragging) return;

    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (scale > 1) {
        setImagePosition({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
      }
    };

    const handleGlobalMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleGlobalMouseMove);
    document.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, scale, dragStart]);

  // Wheel zoom handler
  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(() => {
      const container = imageContainerRef.current;
      if (!container) return;

      const wheelHandler = (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const delta = e.deltaY > 0 ? -1 : 1;
        const zoomFactor = 1 + (delta * 0.1);

        setScale(prev => {
          const newScale = Math.max(0.1, Math.min(5, prev * zoomFactor));
          // Reset position to center when zooming out to or below 100%
          if (newScale <= 1) {
            setImagePosition({ x: 0, y: 0 });
          }
          return newScale;
        });
      };

      container.addEventListener('wheel', wheelHandler, { passive: false });

      return () => {
        container.removeEventListener('wheel', wheelHandler);
      };
    }, 100);

    return () => {
      clearTimeout(timer);
    };
  }, [isOpen]);

  // Touch pinch zoom handler
  useEffect(() => {
    if (!isOpen) return;

    const container = imageContainerRef.current;
    if (!container) return;

    // Calculate distance between two touch points
    const getTouchDistance = (touches: TouchList): number => {
      if (touches.length < 2) return 0;
      const touch1 = touches[0];
      const touch2 = touches[1];
      const dx = touch1.clientX - touch2.clientX;
      const dy = touch1.clientY - touch2.clientY;
      return Math.sqrt(dx * dx + dy * dy);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const distance = getTouchDistance(e.touches);
        setTouchStartDistance(distance);
        setTouchStartScale(scale);
      } else if (e.touches.length === 1 && scale > 1) {
        // Single touch drag when zoomed in
        e.preventDefault();
        const touch = e.touches[0];
        setIsDragging(true);
        setDragStart({
          x: touch.clientX - imagePosition.x,
          y: touch.clientY - imagePosition.y,
        });
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const distance = getTouchDistance(e.touches);
        if (touchStartDistance > 0) {
          const scaleMultiplier = distance / touchStartDistance;
          const newScale = Math.max(0.1, Math.min(5, touchStartScale * scaleMultiplier));

          setScale(newScale);

          // Reset position to center when zooming out to or below 100%
          if (newScale <= 1) {
            setImagePosition({ x: 0, y: 0 });
          }
        }
      } else if (e.touches.length === 1 && scale > 1 && isDragging) {
        // Single touch drag when zoomed in
        e.preventDefault();
        const touch = e.touches[0];
        setImagePosition({
          x: touch.clientX - dragStart.x,
          y: touch.clientY - dragStart.y,
        });
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        setTouchStartDistance(0);
        setTouchStartScale(1);
      }
      if (e.touches.length === 0) {
        setIsDragging(false);
      }
    };

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd, { passive: false });

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isOpen, scale, touchStartDistance, touchStartScale, imagePosition, isDragging, dragStart]);

  return {
    scale,
    rotation,
    flipX,
    flipY,
    imagePosition,
    isDragging,
    imageContainerRef,
    handleZoomIn,
    handleZoomOut,
    handleRotateLeft,
    handleRotateRight,
    handleFlipHorizontal,
    handleFlipVertical,
    handleReset,
    handleMouseDown,
  };
};
