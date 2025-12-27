/**
 * Query Cache Service
 *
 * LRU 캐시를 사용한 데이터베이스 쿼리 결과 캐싱 서비스
 * - 갤러리 페이지 조회 결과 캐싱 (60초 TTL)
 * - 이미지 메타데이터 캐싱 (300초 TTL)
 * - 이미지 업로드/삭제 시 캐시 무효화
 */

import LRU = require('lru-cache');
import { logger } from '../utils/logger';

interface CacheOptions {
  ttl: number; // Time to live in milliseconds
  max: number; // Maximum number of items
}

interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  maxSize: number;
}

/**
 * 쿼리 결과 캐시 서비스
 */
export class QueryCacheService {
  private static galleryCache: LRU<string, any>;
  private static metadataCache: LRU<string, any>;
  private static thumbnailCache: LRU<string, Buffer>;
  private static stats = {
    gallery: { hits: 0, misses: 0 },
    metadata: { hits: 0, misses: 0 },
    thumbnail: { hits: 0, misses: 0 },
  };

  /**
   * 캐시 초기화
   */
  static initialize(): void {
    // 갤러리 페이지 캐시: 60초 TTL, 최대 100개 페이지
    this.galleryCache = new LRU({
      max: 100,
      maxAge: 60 * 1000, // 60초 (v5에서는 maxAge 사용)
    });

    // 이미지 메타데이터 캐시: 5분 TTL, 최대 500개 이미지
    this.metadataCache = new LRU({
      max: 500,
      maxAge: 5 * 60 * 1000, // 5분
    });

    // 썸네일 이미지 캐시: 10분 TTL, 최대 100MB 메모리 제한
    // v5에서는 length 옵션으로 메모리 제한
    this.thumbnailCache = new LRU({
      max: 100 * 1024 * 1024, // 최대 100MB
      maxAge: 10 * 60 * 1000, // 10분
      length: (value: Buffer) => value.length,
    });

    logger.info('✅ Query cache service initialized');
  }

  /**
   * 갤러리 페이지 캐시 키 생성
   */
  private static getGalleryCacheKey(
    page: number,
    limit: number,
    sortBy: string,
    sortOrder: string
  ): string {
    return `gallery:${page}:${limit}:${sortBy}:${sortOrder}`;
  }

  /**
   * 갤러리 페이지 캐시 조회
   */
  static getGalleryCache(
    page: number,
    limit: number,
    sortBy: string,
    sortOrder: string
  ): any | null {
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

  /**
   * 갤러리 페이지 캐시 저장
   */
  static setGalleryCache(
    page: number,
    limit: number,
    sortBy: string,
    sortOrder: string,
    data: any
  ): void {
    try {
      const key = this.getGalleryCacheKey(page, limit, sortBy, sortOrder);
      this.galleryCache.set(key, data);
    } catch (error) {
      console.warn('⚠️ Gallery cache set error:', error instanceof Error ? error.message : error);
      // Graceful degradation - cache 실패해도 계속 진행
    }
  }

  /**
   * 갤러리 캐시 전체 무효화
   */
  static invalidateGalleryCache(): void {
    try {
      this.galleryCache.reset();
      logger.debug('🗑️ Gallery cache invalidated');
    } catch (error) {
      logger.warn('⚠️ Gallery cache invalidate error:', error instanceof Error ? error.message : error);
    }
  }

  /**
   * 이미지 메타데이터 캐시 조회
   */
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

  /**
   * 이미지 메타데이터 캐시 저장
   */
  static setMetadataCache(compositeHash: string, data: any): void {
    try {
      const key = `metadata:${compositeHash}`;
      this.metadataCache.set(key, data);
    } catch (error) {
      console.warn('⚠️ Metadata cache set error:', error instanceof Error ? error.message : error);
    }
  }

  /**
   * 특정 이미지 메타데이터 캐시 무효화
   */
  static invalidateMetadataCache(compositeHash: string): void {
    try {
      const key = `metadata:${compositeHash}`;
      this.metadataCache.delete(key);
    } catch (error) {
      console.warn('⚠️ Metadata cache invalidate error:', error instanceof Error ? error.message : error);
    }
  }

  /**
   * 썸네일 이미지 캐시 조회
   */
  static getThumbnailCache(compositeHash: string): Buffer | null {
    try {
      const key = `thumbnail:${compositeHash}`;
      const cached = this.thumbnailCache.get(key);

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

  /**
   * 썸네일 이미지 캐시 저장
   */
  static setThumbnailCache(compositeHash: string, data: Buffer): void {
    try {
      const key = `thumbnail:${compositeHash}`;
      this.thumbnailCache.set(key, data);
    } catch (error) {
      console.warn('⚠️ Thumbnail cache set error:', error instanceof Error ? error.message : error);
    }
  }

  /**
   * 특정 썸네일 캐시 무효화
   */
  static invalidateThumbnailCache(compositeHash: string): void {
    try {
      const key = `thumbnail:${compositeHash}`;
      this.thumbnailCache.delete(key);
    } catch (error) {
      console.warn('⚠️ Thumbnail cache invalidate error:', error instanceof Error ? error.message : error);
    }
  }

  /**
   * 이미지 관련 모든 캐시 무효화 (업로드/삭제 시 호출)
   *
   * 최적화된 무효화 전략:
   * - 단일 이미지 변경: 첫 페이지만 무효화 (새 이미지가 첫 페이지에 나타날 가능성 높음)
   * - 대량 작업: 전체 갤러리 캐시 무효화
   */
  static invalidateImageCache(compositeHash?: string, isBulkOperation = false): void {
    try {
      if (isBulkOperation || !compositeHash) {
        // 대량 작업이거나 composite_hash가 없는 경우 전체 무효화
        this.invalidateGalleryCache();
        this.metadataCache.reset();
        this.thumbnailCache.reset();
        logger.debug('🗑️ All image caches invalidated (bulk operation)');
      } else {
        // 단일 이미지 변경: 첫 페이지만 무효화 (성능 최적화)
        // 새로 업로드된 이미지는 first_seen_date DESC 정렬로 첫 페이지에 나타남
        // 주요 페이지 크기와 정렬 조합에 대한 첫 페이지만 무효화
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

        // 특정 이미지 캐시만 무효화
        this.invalidateMetadataCache(compositeHash);
        this.invalidateThumbnailCache(compositeHash);

        logger.debug(`🔄 First page cache invalidated for image: ${compositeHash}`);
      }
    } catch (error) {
      logger.warn('⚠️ Image cache invalidate error:', error instanceof Error ? error.message : error);
    }
  }

  /**
   * 캐시 통계 조회
   */
  static getStats(): {
    gallery: CacheStats;
    metadata: CacheStats;
    thumbnail: CacheStats;
  } {
    return {
      gallery: {
        hits: this.stats.gallery.hits,
        misses: this.stats.gallery.misses,
        size: this.galleryCache.size,
        maxSize: this.galleryCache.max,
      },
      metadata: {
        hits: this.stats.metadata.hits,
        misses: this.stats.metadata.misses,
        size: this.metadataCache.size,
        maxSize: this.metadataCache.max,
      },
      thumbnail: {
        hits: this.stats.thumbnail.hits,
        misses: this.stats.thumbnail.misses,
        size: this.thumbnailCache.size,
        maxSize: this.thumbnailCache.max,
      },
    };
  }

  /**
   * 캐시 히트율 계산
   */
  static getHitRate(): {
    gallery: number;
    metadata: number;
    thumbnail: number;
  } {
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

  /**
   * 캐시 통계 초기화
   */
  static resetStats(): void {
    this.stats = {
      gallery: { hits: 0, misses: 0 },
      metadata: { hits: 0, misses: 0 },
      thumbnail: { hits: 0, misses: 0 },
    };
  }
}
