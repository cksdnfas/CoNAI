/**
 * Query Cache Service
 *
 * LRU 캐시를 사용한 데이터베이스 쿼리 결과 캐싱 서비스
 * - 갤러리 페이지 조회 결과 캐싱 (60초 TTL)
 * - 이미지 메타데이터 캐싱 (300초 TTL)
 * - 이미지 업로드/삭제 시 캐시 무효화
 */

const { LRUCache } = require('lru-cache') as {
  LRUCache: new <K, V>(options: Record<string, unknown>) => {
    get(key: K): V | undefined;
    set(key: K, value: V): void;
    delete(key: K): void;
    clear(): void;
    size: number;
    max?: number;
    maxSize?: number;
  };
};

import { logger } from '../utils/logger';

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
}

export class QueryCacheService {
  private static galleryCache: InstanceType<typeof LRUCache>;
  private static metadataCache: InstanceType<typeof LRUCache>;
  private static thumbnailCache: InstanceType<typeof LRUCache>;
  private static galleryInvalidationTimer: NodeJS.Timeout | null = null;
  private static stats = {
    gallery: { hits: 0, misses: 0 },
    metadata: { hits: 0, misses: 0 },
    thumbnail: { hits: 0, misses: 0 },
  };

  static initialize(): void {
    this.galleryCache = new LRUCache<string, any>({
      max: 100,
      ttl: 60 * 1000,
    });

    this.metadataCache = new LRUCache<string, any>({
      max: 500,
      ttl: 5 * 60 * 1000,
    });

    this.thumbnailCache = new LRUCache<string, Buffer>({
      maxSize: 100 * 1024 * 1024,
      ttl: 10 * 60 * 1000,
      sizeCalculation: (value: Buffer) => value.length,
    });

    logger.info('✅ Query cache service initialized');
  }

  private static getGalleryCacheKey(page: number, limit: number, sortBy: string, sortOrder: string): string {
    return `gallery:${page}:${limit}:${sortBy}:${sortOrder}`;
  }

  static getGalleryCache(page: number, limit: number, sortBy: string, sortOrder: string): any | null {
    try {
      const key = this.getGalleryCacheKey(page, limit, sortBy, sortOrder);
      const cached = this.galleryCache.get(key);

      if (cached) {
        this.stats.gallery.hits++;
        return cached;
      }

      this.stats.gallery.misses++;
      return null;
    } catch (error) {
      logger.warn('⚠️ Gallery cache get error:', error instanceof Error ? error.message : error);
      this.stats.gallery.misses++;
      return null;
    }
  }

  static setGalleryCache(page: number, limit: number, sortBy: string, sortOrder: string, data: any): void {
    try {
      const key = this.getGalleryCacheKey(page, limit, sortBy, sortOrder);
      this.galleryCache.set(key, data);
    } catch (error) {
      console.warn('⚠️ Gallery cache set error:', error instanceof Error ? error.message : error);
    }
  }

  static invalidateGalleryCache(): void {
    try {
      if (this.galleryInvalidationTimer) {
        clearTimeout(this.galleryInvalidationTimer);
        this.galleryInvalidationTimer = null;
      }

      if (!this.galleryCache) {
        return;
      }

      this.galleryCache.clear();
      logger.debug('🗑️ Gallery cache invalidated');
    } catch (error) {
      logger.warn('⚠️ Gallery cache invalidate error:', error instanceof Error ? error.message : error);
    }
  }

  static scheduleGalleryCacheInvalidation(delayMs = 250): void {
    try {
      if (this.galleryInvalidationTimer) {
        clearTimeout(this.galleryInvalidationTimer);
      }

      const normalizedDelayMs = Number.isFinite(delayMs)
        ? Math.max(0, Math.floor(delayMs))
        : 250;

      this.galleryInvalidationTimer = setTimeout(() => {
        this.galleryInvalidationTimer = null;
        this.invalidateGalleryCache();
      }, normalizedDelayMs);
    } catch (error) {
      logger.warn('⚠️ Gallery cache scheduled invalidate error:', error instanceof Error ? error.message : error);
    }
  }

  static getMetadataCache(compositeHash: string): any | null {
    try {
      const key = `metadata:${compositeHash}`;
      const cached = this.metadataCache.get(key);

      if (cached) {
        this.stats.metadata.hits++;
        return cached;
      }

      this.stats.metadata.misses++;
      return null;
    } catch (error) {
      console.warn('⚠️ Metadata cache get error:', error instanceof Error ? error.message : error);
      this.stats.metadata.misses++;
      return null;
    }
  }

  static setMetadataCache(compositeHash: string, data: any): void {
    try {
      const key = `metadata:${compositeHash}`;
      this.metadataCache.set(key, data);
    } catch (error) {
      console.warn('⚠️ Metadata cache set error:', error instanceof Error ? error.message : error);
    }
  }

  static invalidateMetadataCache(compositeHash: string): void {
    try {
      if (!this.metadataCache) {
        return;
      }

      const key = `metadata:${compositeHash}`;
      this.metadataCache.delete(key);
    } catch (error) {
      console.warn('⚠️ Metadata cache invalidate error:', error instanceof Error ? error.message : error);
    }
  }

  static getThumbnailCache(compositeHash: string): Buffer | null {
    try {
      const key = `thumbnail:${compositeHash}`;
      const cached = this.thumbnailCache.get(key) as Buffer | undefined;

      if (cached) {
        this.stats.thumbnail.hits++;
        return cached;
      }

      this.stats.thumbnail.misses++;
      return null;
    } catch (error) {
      console.warn('⚠️ Thumbnail cache get error:', error instanceof Error ? error.message : error);
      this.stats.thumbnail.misses++;
      return null;
    }
  }

  static setThumbnailCache(compositeHash: string, data: Buffer): void {
    try {
      const key = `thumbnail:${compositeHash}`;
      this.thumbnailCache.set(key, data);
    } catch (error) {
      console.warn('⚠️ Thumbnail cache set error:', error instanceof Error ? error.message : error);
    }
  }

  static invalidateThumbnailCache(compositeHash: string): void {
    try {
      if (!this.thumbnailCache) {
        return;
      }

      const key = `thumbnail:${compositeHash}`;
      this.thumbnailCache.delete(key);
    } catch (error) {
      console.warn('⚠️ Thumbnail cache invalidate error:', error instanceof Error ? error.message : error);
    }
  }

  static invalidateImageCache(compositeHash?: string, isBulkOperation = false): void {
    try {
      if (isBulkOperation || !compositeHash) {
        this.invalidateGalleryCache();
        this.metadataCache.clear();
        this.thumbnailCache.clear();
        logger.debug('🗑️ All image caches invalidated (bulk operation)');
      } else {
        const commonPageSizes = [25, 50, 100];
        const sortOptions = [
          { sortBy: 'first_seen_date', sortOrder: 'DESC' },
          { sortBy: 'first_seen_date', sortOrder: 'ASC' },
        ];

        commonPageSizes.forEach(limit => {
          sortOptions.forEach(({ sortBy, sortOrder }) => {
            const key = this.getGalleryCacheKey(1, limit, sortBy, sortOrder);
            this.galleryCache.delete(key);
          });
        });

        this.invalidateMetadataCache(compositeHash);
        this.invalidateThumbnailCache(compositeHash);

        logger.debug(`🔄 First page cache invalidated for image: ${compositeHash}`);
      }
    } catch (error) {
      logger.warn('⚠️ Image cache invalidate error:', error instanceof Error ? error.message : error);
    }
  }

  static getStats(): { gallery: CacheStats; metadata: CacheStats; thumbnail: CacheStats } {
    return {
      gallery: {
        hits: this.stats.gallery.hits,
        misses: this.stats.gallery.misses,
        size: this.galleryCache.size,
        maxSize: this.galleryCache.max ?? 0,
      },
      metadata: {
        hits: this.stats.metadata.hits,
        misses: this.stats.metadata.misses,
        size: this.metadataCache.size,
        maxSize: this.metadataCache.max ?? 0,
      },
      thumbnail: {
        hits: this.stats.thumbnail.hits,
        misses: this.stats.thumbnail.misses,
        size: this.thumbnailCache.size,
        maxSize: this.thumbnailCache.maxSize ?? 0,
      },
    };
  }

  static getHitRate(): { gallery: number; metadata: number; thumbnail: number } {
    const calcRate = (hits: number, misses: number): number => {
      const total = hits + misses;
      return total > 0 ? (hits / total) * 100 : 0;
    };

    return {
      gallery: calcRate(this.stats.gallery.hits, this.stats.gallery.misses),
      metadata: calcRate(this.stats.metadata.hits, this.stats.metadata.misses),
      thumbnail: calcRate(this.stats.thumbnail.hits, this.stats.thumbnail.misses),
    };
  }

  static resetStats(): void {
    this.stats = {
      gallery: { hits: 0, misses: 0 },
      metadata: { hits: 0, misses: 0 },
      thumbnail: { hits: 0, misses: 0 },
    };
  }
}
