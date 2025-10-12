import { ImageModel as BaseImageModel } from './ImageModel';
import { ImageSearchModel } from './ImageSearchModel';
import { ImageTaggingModel } from './ImageTaggingModel';
import { ImageStatsModel } from './ImageStatsModel';
import { ImageRecord, ImageMetadata } from '../../types/image';
import { AutoTagSearchParams, AutoTagStats } from '../../types/autoTag';

/**
 * 통합 이미지 모델 클래스
 * 기존 API 호환성을 유지하면서 책임별로 분리된 모델들을 통합
 */
export class ImageModel {
  // ==================== 기본 CRUD (ImageModel) ====================

  static create(imageData: Omit<ImageRecord, 'id' | 'upload_date'>): Promise<number> {
    return BaseImageModel.create(imageData);
  }

  static findById(id: number): Promise<ImageRecord | null> {
    return BaseImageModel.findById(id);
  }

  static findAll(
    page?: number,
    limit?: number,
    sortBy?: 'upload_date' | 'filename' | 'file_size',
    sortOrder?: 'ASC' | 'DESC'
  ): Promise<{ images: ImageRecord[], total: number }> {
    return BaseImageModel.findAll(page, limit, sortBy, sortOrder);
  }

  static findByDateRange(
    startDate: string,
    endDate: string,
    page?: number,
    limit?: number
  ): Promise<{ images: ImageRecord[], total: number }> {
    return BaseImageModel.findByDateRange(startDate, endDate, page, limit);
  }

  static delete(id: number): Promise<boolean> {
    return BaseImageModel.delete(id);
  }

  static updateMetadata(id: number, metadata: ImageMetadata): Promise<boolean> {
    return BaseImageModel.updateMetadata(id, metadata);
  }

  static updateAutoTags(id: number, autoTags: string | null): Promise<boolean> {
    return BaseImageModel.updateAutoTags(id, autoTags);
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
    searchParams: AutoTagSearchParams
  ): Promise<{ images: any[], total: number }> {
    return ImageSearchModel.searchByAutoTags(searchParams);
  }

  // ==================== 태깅 (ImageTaggingModel) ====================

  static findUntagged(limit?: number): Promise<ImageRecord[]> {
    return ImageTaggingModel.findUntagged(limit);
  }

  static findAllIds(limit?: number): Promise<number[]> {
    return ImageTaggingModel.findAllIds(limit);
  }

  static countUntagged(): Promise<number> {
    return ImageTaggingModel.countUntagged();
  }

  // ==================== 통계 (ImageStatsModel) ====================

  static getAutoTagStats(): Promise<AutoTagStats> {
    return ImageStatsModel.getAutoTagStats();
  }
}
