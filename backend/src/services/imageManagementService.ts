import { DeletionService } from './deletionService';
import { QueryCacheService } from './QueryCacheService';

export interface BulkDeleteImageFilesResult {
  deleted: number;
  failed: number;
  errors: string[];
}

export class ImageManagementService {
  /** Delete one image and invalidate dependent caches. */
  static async deleteImageByCompositeHash(compositeHash: string): Promise<{ message: string }> {
    await DeletionService.deleteImage(compositeHash);
    QueryCacheService.invalidateImageCache(compositeHash, true);
    console.log('🗑️ All caches invalidated for deleted image');

    return {
      message: 'Image deleted successfully',
    };
  }

  /** Delete multiple image files one by one and collect per-file failures. */
  static async deleteImageFilesBulk(fileIds: number[]): Promise<{ message: string; details: BulkDeleteImageFilesResult }> {
    console.log(`🗑️ Bulk file deletion requested: ${fileIds.length} files`);

    const results: BulkDeleteImageFilesResult = {
      deleted: 0,
      failed: 0,
      errors: [],
    };

    for (const fileId of fileIds) {
      try {
        const success = await DeletionService.deleteImageFile(fileId);
        if (success) {
          results.deleted += 1;
        } else {
          results.failed += 1;
          results.errors.push(`File ${fileId} not found`);
        }
      } catch (error) {
        results.failed += 1;
        results.errors.push(`File ${fileId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        console.error(`❌ Failed to delete file ${fileId}:`, error);
      }
    }

    QueryCacheService.invalidateImageCache(undefined, true);
    console.log('🗑️ All caches invalidated after bulk deletion');

    return {
      message: `Deleted ${results.deleted} file(s)`,
      details: results,
    };
  }
}
