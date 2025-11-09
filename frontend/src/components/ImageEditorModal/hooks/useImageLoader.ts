/**
 * useImageLoader Hook
 * Optimized image loading with caching and preloading
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { loadImage } from '../utils/editorUtils';
import type { UseImageLoaderReturn } from '../types/EditorTypes';

// Simple in-memory cache for loaded images
const imageCache = new Map<string, HTMLImageElement>();

interface UseImageLoaderOptions {
  enableCache?: boolean;
  onLoad?: (image: HTMLImageElement) => void;
  onError?: (error: Error) => void;
}

/**
 * Custom hook for loading images with caching
 */
export function useImageLoader(
  options: UseImageLoaderOptions = {}
): UseImageLoaderReturn {
  const { enableCache = true, onLoad, onError } = options;

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep track of current loading request to prevent race conditions
  const currentLoadRef = useRef<string | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  /**
   * Load image from URL
   */
  const loadImageFromUrl = useCallback(
    async (url: string): Promise<void> => {
      // Prevent loading the same URL twice
      if (currentLoadRef.current === url) {
        return;
      }

      currentLoadRef.current = url;
      setIsLoading(true);
      setError(null);

      try {
        // Check cache first
        if (enableCache && imageCache.has(url)) {
          const cachedImage = imageCache.get(url)!;
          imageRef.current = cachedImage;
          setImage(cachedImage);
          setIsLoading(false);

          if (onLoad) {
            onLoad(cachedImage);
          }
          return;
        }

        // Load new image
        const loadedImage = await loadImage(url);

        // Check if this is still the current request
        if (currentLoadRef.current !== url) {
          return; // Ignore outdated requests
        }

        // Store in cache
        if (enableCache) {
          imageCache.set(url, loadedImage);
        }

        imageRef.current = loadedImage;
        setImage(loadedImage);
        setIsLoading(false);

        if (onLoad) {
          onLoad(loadedImage);
        }
      } catch (err) {
        // Check if this is still the current request
        if (currentLoadRef.current !== url) {
          return;
        }

        const errorMessage = err instanceof Error ? err.message : 'Failed to load image';
        setError(errorMessage);
        setIsLoading(false);

        if (onError) {
          onError(err instanceof Error ? err : new Error(errorMessage));
        }
      }
    },
    [enableCache, onLoad, onError]
  );

  /**
   * Clear current image
   */
  const clearImage = useCallback(() => {
    currentLoadRef.current = null;
    imageRef.current = null;
    setImage(null);
    setError(null);
    setIsLoading(false);
  }, []);

  /**
   * Cleanup on unmount
   */
  useEffect(() => {
    return () => {
      currentLoadRef.current = null;
      imageRef.current = null;
    };
  }, []);

  return {
    image,
    isLoading,
    error,
    loadImage: loadImageFromUrl,
    clearImage,
  };
}

/**
 * Preload multiple images
 */
export function preloadImages(urls: string[]): Promise<HTMLImageElement[]> {
  return Promise.all(urls.map(url => loadImage(url)));
}

/**
 * Clear image cache
 */
export function clearImageCache(): void {
  imageCache.clear();
}

/**
 * Get cache size
 */
export function getImageCacheSize(): number {
  return imageCache.size;
}
