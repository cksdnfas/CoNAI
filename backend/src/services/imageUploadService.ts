import { ImageFileModel } from '../models/Image/ImageFileModel';

/** Active-file lookups for stored media. (The legacy upload path that lived here is gone; uploads go through the background media pipeline.) */
export class ImageUploadService {
  /**
   * composite_hash로 활성 파일 경로 조회
   */
  static getActiveFilePath(compositeHash: string): string | null {
    const files = ImageFileModel.findActiveByHash(compositeHash);
    return files.length > 0 ? files[0].original_file_path : null;
  }
}
