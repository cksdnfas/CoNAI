import fs from 'fs';
import path from 'path';
import { db } from '../../database/init';
import { MetadataExtractionError } from '../../types/errors';
import { checkFileAccess } from '../../utils/fileAccess';
import { ImageMediaProcessor } from './imageMediaProcessor';
import { markFileAsProcessingFailed } from './mediaProcessingSupport';
import {
  failedStage,
  skippedStage,
  stoppedFileProcessing,
  type MediaFileProcessingResult,
  type ProcessFileOptions,
  type UnhashedMediaFile,
} from './mediaProcessingTypes';
import { VideoMediaProcessor } from './videoMediaProcessor';

/** Preflight one media row, then dispatch it to the file-type processor. */
export async function processMediaFile(
  file: UnhashedMediaFile,
  options: ProcessFileOptions = {},
): Promise<MediaFileProcessingResult> {
  const fileName = path.basename(file.original_file_path);
  const access = await checkFileAccess(file.original_file_path);

  // Only a real ENOENT deletes the DB row. Transient SMB/permission failures retry.
  if (!access.exists) {
    console.log(`  ⚠️  File not found, deleting DB record: ${fileName}`);
    db.prepare('DELETE FROM image_files WHERE id = ?').run(file.id);
    return stoppedFileProcessing(skippedStage('file-access', 'file not found'), []);
  }

  if (!access.readable) {
    const errorMsg = access.errorCode === 'EACCES'
      ? `Permission denied (read): ${fileName}`
      : `Cannot read file: ${fileName}`;
    console.error(`  ❌ ${errorMsg}`);

    const cause = MetadataExtractionError.fromNodeError(
      file.original_file_path,
      { code: access.errorCode, message: access.error } as NodeJS.ErrnoException,
    );
    return stoppedFileProcessing(failedStage('file-access', cause, true), [], { cause });
  }

  let fileSize: number;
  try {
    fileSize = (await fs.promises.stat(file.original_file_path)).size;
  } catch (error) {
    return stoppedFileProcessing(failedStage('file-stat', error, true), [], { cause: error });
  }

  if (fileSize <= 0) {
    markFileAsProcessingFailed(file.id, file.original_file_path, 'empty file');
    return stoppedFileProcessing(failedStage('file-stat', 'empty file', false), []);
  }

  if (file.file_type === 'video' || file.file_type === 'animated') {
    return VideoMediaProcessor.process(file);
  }

  return ImageMediaProcessor.process(file, options, fileSize);
}
