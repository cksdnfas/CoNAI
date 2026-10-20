import { DeletionService } from './deletionService';
import { QueryCacheService } from './QueryCacheService';
import { SystemFolderService, parseNames } from './systemFolderService';

export interface BulkDeleteImageFilesResult {
  deleted: number;
  failed: number;
  errors: string[];
}

export interface BulkDeleteImagesResult {
  deleted: number;
  failed: number;
  errors: string[];
  recycleBinEntries: string[];
}

export class ImageManagementService {
  /** Delete one image and invalidate dependent caches. */
  static async deleteImageByCompositeHash(compositeHash: string): Promise<{ message: string; recycleBinEntries: string[] }> {
    const recycleBinEntries = await DeletionService.deleteImageWithRestoreEntries(compositeHash);
    QueryCacheService.invalidateImageCache(compositeHash, true);
    console.log('🗑️ All caches invalidated for deleted image');

    return {
      message: 'Image deleted successfully',
      recycleBinEntries,
    };
  }

  /** Delete multiple image hashes in one batch while reusing the shared deletion service. */
  static async deleteImagesBulk(compositeHashes: string[]): Promise<{ message: string; details: BulkDeleteImagesResult }> {
    console.log(`🗑️ Bulk image deletion requested: ${compositeHashes.length} images`);

    const batchResult = await DeletionService.deleteMultipleImages(compositeHashes);

    QueryCacheService.invalidateImageCache(undefined, true);
    console.log('🗑️ All caches invalidated after bulk image deletion');

    return {
      message: `Deleted ${batchResult.success} image(s)`,
      details: {
        deleted: batchResult.success,
        failed: batchResult.failed,
        errors: batchResult.errors.map((entry) => `Image ${entry.hash}: ${entry.error}`),
        recycleBinEntries: batchResult.recycleBinEntries,
      },
    };
  }

  /** Same restore engine as the admin RecycleBin, restricted to library-deletion entries. */
  static async restoreDeletedImages(names: unknown) {
    const result = await SystemFolderService.restore(parseNames(names), 'fail', true);
    return { done: result.done.map(({ name }) => ({ name })), failed: result.failed };
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
