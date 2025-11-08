import { MediaMetadataModel } from './MediaMetadataModel';
import { ImageFileModel } from './ImageFileModel';
import { ImageSearchModel } from './ImageSearchModel';
import { ImageTaggingModel } from './ImageTaggingModel';
import { ImageStatsModel } from './ImageStatsModel';
import { ImageMetadataRecord } from '../../types/image';
import { AutoTagSearchParams, AutoTagStats } from '../../types/autoTag';

/**
 * 통합 이미지 모델 클래스 (Backward Compatibility Layer)
 *
 * ⚠️ DEPRECATED: 이 레이어는 레거시 호환성을 위해 유지됩니다.
 * 신규 코드는 ImageMetadataModel, ImageFileModel, ImageSearchModel을 직접 사용하세요.
 *
 * 새 구조로 완전히 전환되었으며, images 테이블을 사용하지 않습니다.
 */
export class ImageModel {
  // ==================== 기본 CRUD (ImageMetadataModel 기반) ====================

  /**
   * 이미지 생성 - 새 구조 사용 불가
   * @deprecated ImageUploadService.saveUploadedImage() 사용 권장
   */
  static async create(imageData: any): Promise<number> {
    throw new Error('ImageModel.create() is deprecated. Use ImageUploadService.saveUploadedImage()');
  }

  /**
   * ID로 이미지 조회 - composite_hash 사용으로 변경 필요
   * @deprecated MediaMetadataModel.findByHash() 사용 권장
   */
  static async findById(id: number): Promise<any | null> {
    throw new Error('ImageModel.findById(id) is deprecated. Use ImageMetadataModel.findByHash(compositeHash)');
  }

  /**
   * 전체 이미지 목록 조회
   */
  static async findAll(
    page: number = 1,
    limit: number = 20,
    sortBy: 'upload_date' | 'filename' | 'file_size' = 'upload_date',
    sortOrder: 'ASC' | 'DESC' = 'DESC'
  ): Promise<{ images: any[], total: number }> {
    // upload_date → first_seen_date 매핑
    const mappedSortBy = sortBy === 'upload_date' ? 'first_seen_date' : 'first_seen_date';

    const result = await MediaMetadataModel.findAllWithFiles({
      page,
      limit,
      sortBy: mappedSortBy as 'first_seen_date',
      sortOrder
    });

    return { images: result.items, total: result.total };
  }

  /**
   * 날짜 범위로 이미지 조회
   */
  static async findByDateRange(
    startDate: string,
    endDate: string,
    page?: number,
    limit?: number
  ): Promise<{ images: any[], total: number }> {
    const result = MediaMetadataModel.findByDateRange(startDate, endDate, page, limit);
    return { images: result.items, total: result.total };
  }

  /**
   * 이미지 삭제 - composite_hash 사용으로 변경 필요
   * @deprecated MediaMetadataModel.delete(compositeHash) 사용 권장
   */
  static async delete(id: number): Promise<boolean> {
    throw new Error('ImageModel.delete(id) is deprecated. Use ImageMetadataModel.delete(compositeHash)');
  }

  /**
   * 메타데이터 업데이트
   * @deprecated MediaMetadataModel.update() 사용 권장
   */
  static async updateMetadata(id: number, metadata: any): Promise<boolean> {
    throw new Error('ImageModel.updateMetadata(id) is deprecated. Use ImageMetadataModel.update(compositeHash)');
  }

  /**
   * 자동 태그 업데이트
   * @deprecated MediaMetadataModel.update() 사용 권장
   */
  static async updateAutoTags(id: number, autoTags: string | null): Promise<boolean> {
    throw new Error('ImageModel.updateAutoTags(id) is deprecated. Use ImageMetadataModel.update(compositeHash)');
  }

  /**
   * 랜덤 이미지 조회
   */
  static async getRandomImage(): Promise<any | null> {
    return MediaMetadataModel.getRandomImage();
  }

  /**
   * 검색 조건에 맞는 랜덤 이미지 조회
   */
  static async getRandomFromSearch(searchParams: any): Promise<any | null> {
    return ImageSearchModel.getRandomFromSearch(searchParams);
  }

  // ==================== 검색 (ImageSearchModel) ====================

  static advancedSearch(
    searchParams: {
      search_text?: string;
      negative_text?: string;
      ai_tool?: string;
      model_name?: string;
      min_width?: number;
      max_width?: number;
      min_height?: number;
      max_height?: number;
      min_file_size?: number;
      max_file_size?: number;
      start_date?: string;
      end_date?: string;
      group_id?: number;
    },
    page?: number,
    limit?: number,
    sortBy?: 'upload_date' | 'filename' | 'file_size' | 'width' | 'height',
    sortOrder?: 'ASC' | 'DESC'
  ): Promise<{ images: any[], total: number }> {
    return ImageSearchModel.advancedSearch(searchParams, page, limit, sortBy, sortOrder);
  }

  static findWithGroups(
    page?: number,
    limit?: number,
    sortBy?: 'upload_date' | 'filename' | 'file_size',
    sortOrder?: 'ASC' | 'DESC'
  ): Promise<{ images: any[], total: number }> {
    return ImageSearchModel.findWithGroups(page, limit, sortBy, sortOrder);
  }

  static searchByAutoTags(
    searchParams: AutoTagSearchParams,
    basicSearchParams?: {
      search_text?: string;
      negative_text?: string;
      ai_tool?: string;
      model_name?: string;
      start_date?: string;
      end_date?: string;
    }
  ): Promise<{ images: any[], total: number }> {
    return ImageSearchModel.searchByAutoTags(searchParams, basicSearchParams);
  }

  /**
   * 검색 조건에 맞는 이미지 composite_hash 목록 조회
   * ✅ 완전히 composite_hash 기반으로 전환됨 (string[] 반환)
   */
  static searchImageIds(
    searchParams: {
      search_text?: string;
      negative_text?: string;
      ai_tool?: string;
      model_name?: string;
      min_width?: number;
      max_width?: number;
      min_height?: number;
      max_height?: number;
      min_file_size?: number;
      max_file_size?: number;
      start_date?: string;
      end_date?: string;
      group_id?: number;
    }
  ): Promise<string[]> {
    return ImageSearchModel.searchImageIds(searchParams);
  }

  // ==================== 태깅 (ImageTaggingModel) ====================

  static findUntagged(limit?: number): Promise<any[]> {
    return ImageTaggingModel.findUntagged(limit);
  }

  static findAllIds(limit?: number): Promise<number[]> {
    // 레거시 호환성: composite_hash를 반환하지만 타입은 number[]로 유지
    throw new Error('ImageModel.findAllIds() is deprecated. Use MediaMetadataModel for composite_hash based queries');
  }

  static countUntagged(): Promise<number> {
    return ImageTaggingModel.countUntagged();
  }

  // ==================== 통계 (ImageStatsModel) ====================

  static getAutoTagStats(): Promise<AutoTagStats> {
    return ImageStatsModel.getAutoTagStats();
  }
}
