import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import verifyHelpers from '../../../scripts/verify-helpers';

const { createSourceReader, reportVerificationSuccess } = verifyHelpers;
const source = createSourceReader(process.cwd());

async function main() {
  const tempBasePath = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-invalid-media-'));
  process.env.RUNTIME_BASE_PATH = tempBasePath;

  let closeMainDatabase: (() => void) | null = null;
  let closeUserSettingsDatabase: (() => void) | null = null;
  try {
    const { ensureRuntimeDirectories } = await import('../config/runtimePaths');
    const mainDatabase = await import('../database/init');
    const userSettingsDatabase = await import('../database/userSettingsDb');
    const apiGenerationDatabase = await import('../database/apiGenerationDb');
    const {
      BackgroundProcessorService,
      resolveBackgroundMediaConcurrency,
      resolveFailedBatchDelayMs,
    } = await import('../services/backgroundProcessorService');
    const { processMediaFile } = await import('../services/background-media/mediaFileProcessor');
    const { MediaPostprocessCoordinator } = await import('../services/background-media/mediaPostprocessCoordinator');
    const { MediaProcessingDiagnostics } = await import('../services/background-media/mediaProcessingDiagnostics');
    const { generateVideoPosterFrame } = await import('../services/background-media/videoMediaProcessor');
    const { MediaPostprocessVisibilityService } = await import('../services/mediaPostprocessVisibilityService');
    const {
      failedStage,
      stoppedFileProcessing,
      throwIfRetryableMediaFailure,
    } = await import('../services/background-media/mediaProcessingTypes');

    closeMainDatabase = mainDatabase.closeDatabase;
    closeUserSettingsDatabase = userSettingsDatabase.closeUserSettingsDb;
    ensureRuntimeDirectories();
    await mainDatabase.initializeDatabase();
    userSettingsDatabase.initializeUserSettingsDb();
    apiGenerationDatabase.initializeApiGenerationDb();

    const database = mainDatabase.db;
    const folder = database.prepare('SELECT id FROM watched_folders ORDER BY id ASC LIMIT 1')
      .get() as { id: number };

    function insertUnhashed(
      filePath: string,
      fileSize: number,
      fileType = 'image',
      mimeType = 'image/png',
    ) {
      return Number(database.prepare(`
        INSERT INTO image_files (
          composite_hash, file_type, original_file_path, folder_id,
          file_status, file_size, mime_type, scan_date
        ) VALUES (NULL, ?, ?, ?, 'active', ?, ?, CURRENT_TIMESTAMP)
      `).run(fileType, filePath, folder.id, fileSize, mimeType).lastInsertRowid);
    }

    const missingPath = path.join(tempBasePath, 'missing.png');
    const emptyPath = path.join(tempBasePath, 'empty.png');
    const invalidPath = path.join(tempBasePath, 'invalid.png');
    fs.writeFileSync(emptyPath, Buffer.alloc(0));
    fs.writeFileSync(invalidPath, Buffer.from('not an image'));

    const missingId = insertUnhashed(missingPath, 1);
    const emptyId = insertUnhashed(emptyPath, 0);
    const invalidId = insertUnhashed(invalidPath, fs.statSync(invalidPath).size);

    const batch = await BackgroundProcessorService.processUnhashedImages({ quietIfIdle: true });
    assert.deepEqual(
      batch,
      { processed: 3, duplicates: 0, errors: 0, unique: 0 },
      'missing, empty, and unsupported media must keep resolving as processed rather than retryable errors',
    );
    assert.equal(
      database.prepare('SELECT id FROM image_files WHERE id = ?').get(missingId),
      undefined,
      'a true missing file must delete its stale DB row',
    );
    assert.equal(
      (database.prepare('SELECT file_status FROM image_files WHERE id = ?').get(emptyId) as { file_status: string }).file_status,
      'failed',
      'an empty file must leave the active unhashed queue',
    );
    assert.equal(
      (database.prepare('SELECT file_status FROM image_files WHERE id = ?').get(invalidId) as { file_status: string }).file_status,
      'failed',
      'an unsupported image must leave the active unhashed queue',
    );
    assert.equal(BackgroundProcessorService.getUnprocessedCount(), 0);
    assert.equal(resolveBackgroundMediaConcurrency('20', 32), 8);
    assert.equal(resolveBackgroundMediaConcurrency('', 16), 2);
    assert.equal(resolveBackgroundMediaConcurrency('', 1), 1);
    assert.deepEqual(
      [0, 1, 2, 6].map((failures) => resolveFailedBatchDelayMs(failures)),
      [1_000, 2_000, 4_000, 60_000],
      'failed-batch backoff must remain exponential and capped',
    );

    const directInvalidPath = path.join(tempBasePath, 'direct-invalid.png');
    fs.writeFileSync(directInvalidPath, Buffer.from('still not an image'));
    const directInvalidId = insertUnhashed(directInvalidPath, fs.statSync(directInvalidPath).size);
    const directResult = await processMediaFile({
      id: directInvalidId,
      original_file_path: directInvalidPath,
      folder_id: folder.id,
      mime_type: 'image/png',
      file_type: 'image',
    });
    assert.deepEqual(
      {
        stage: directResult.stage,
        status: directResult.status,
        retryable: directResult.retryable,
        error: directResult.error,
      },
      {
        stage: 'image-hash',
        status: 'failed',
        retryable: false,
        error: 'unsupported image format',
      },
      'the extracted image processor must return the explicit terminal stage result',
    );

    const originalError = new Error('temporary network failure');
    const retryableResult = stoppedFileProcessing(
      failedStage('file-access', originalError, true),
      [],
      { cause: originalError },
    );
    assert.throws(
      () => throwIfRetryableMediaFailure(retryableResult),
      (error) => error === originalError,
      'retryable stage failures must preserve the original thrown error object',
    );
    assert.equal(
      (originalError as Error & { mediaProcessingResult?: typeof retryableResult }).mediaProcessingResult,
      retryableResult,
      'retryable errors must retain their explicit stage result for orchestrator diagnostics',
    );

    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    );
    const gifBytes = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
    const uniqueImagePath = path.join(tempBasePath, 'valid-image.png');
    const duplicateImagePath = path.join(tempBasePath, 'valid-image-copy.png');
    fs.writeFileSync(uniqueImagePath, pngBytes);
    fs.writeFileSync(duplicateImagePath, pngBytes);
    const uniqueImageId = insertUnhashed(uniqueImagePath, pngBytes.length);
    const duplicateImageId = insertUnhashed(duplicateImagePath, pngBytes.length);
    const uniqueImageResult = await processMediaFile({
      id: uniqueImageId, original_file_path: uniqueImagePath, folder_id: folder.id,
      mime_type: 'image/png', file_type: 'image',
    }, { metadataMode: 'background' });
    assert.equal(uniqueImageResult.status, 'completed');
    assert.equal(uniqueImageResult.duplicate, false);
    assert.ok(uniqueImageResult.compositeHash);
    const duplicateImageResult = await processMediaFile({
      id: duplicateImageId, original_file_path: duplicateImagePath, folder_id: folder.id,
      mime_type: 'image/png', file_type: 'image',
    }, { metadataMode: 'background' });
    assert.equal(duplicateImageResult.status, 'completed');
    assert.equal(duplicateImageResult.duplicate, true);
    assert.equal(duplicateImageResult.compositeHash, uniqueImageResult.compositeHash);

    const uniqueAnimatedPath = path.join(tempBasePath, 'valid-animated.gif');
    const duplicateAnimatedPath = path.join(tempBasePath, 'valid-animated-copy.gif');
    fs.writeFileSync(uniqueAnimatedPath, gifBytes);
    fs.writeFileSync(duplicateAnimatedPath, gifBytes);
    const uniqueAnimatedId = insertUnhashed(uniqueAnimatedPath, gifBytes.length, 'animated', 'image/gif');
    const duplicateAnimatedId = insertUnhashed(duplicateAnimatedPath, gifBytes.length, 'animated', 'image/gif');
    const uniqueAnimatedResult = await processMediaFile({
      id: uniqueAnimatedId, original_file_path: uniqueAnimatedPath, folder_id: folder.id,
      mime_type: 'image/gif', file_type: 'animated',
    });
    assert.equal(uniqueAnimatedResult.status, 'completed');
    assert.equal(uniqueAnimatedResult.duplicate, false);
    assert.ok(uniqueAnimatedResult.compositeHash);
    const duplicateAnimatedResult = await processMediaFile({
      id: duplicateAnimatedId, original_file_path: duplicateAnimatedPath, folder_id: folder.id,
      mime_type: 'image/gif', file_type: 'animated',
    });
    assert.equal(duplicateAnimatedResult.status, 'completed');
    assert.equal(duplicateAnimatedResult.duplicate, true);
    assert.equal(duplicateAnimatedResult.compositeHash, uniqueAnimatedResult.compositeHash);
    assert.equal(
      (await generateVideoPosterFrame(
        uniqueAnimatedResult.compositeHash!,
        uniqueAnimatedPath,
        'animated',
        { skipIfPresent: true },
      )).status,
      'skipped',
      'an existing poster must produce an explicit skipped stage',
    );

    const originalVisibilityRelease = MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork;
    MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork = () => false;
    try {
      assert.equal(
        MediaPostprocessCoordinator.releaseVisibilityIfReady(uniqueAnimatedResult.compositeHash!).status,
        'deferred',
        'visibility that still has immediate work must be recorded as deferred',
      );
    } finally {
      MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork = originalVisibilityRelease;
    }

    database.prepare(`
      UPDATE media_metadata
      SET ai_tool = 'test',
          auto_tags = '{"tagger":{"taglist":"done"},"kaloscope":{"taglist":"done"}}',
          postprocess_status = 'pending'
      WHERE composite_hash = ?
    `).run(uniqueImageResult.compositeHash);
    database.exec(`
      CREATE TRIGGER fail_history_visibility_release
      BEFORE UPDATE OF postprocess_status ON media_metadata
      WHEN OLD.composite_hash = '${uniqueImageResult.compositeHash}' AND NEW.postprocess_status = 'ready'
      BEGIN
        SELECT RAISE(ABORT, 'forced visibility failure');
      END
    `);
    const partialImagePath = path.join(tempBasePath, 'valid-image-partial.png');
    fs.writeFileSync(partialImagePath, pngBytes);
    const partialImageId = insertUnhashed(partialImagePath, pngBytes.length);
    const partialResult = await processMediaFile({
      id: partialImageId, original_file_path: partialImagePath, folder_id: folder.id,
      mime_type: 'image/png', file_type: 'image',
    });
    database.exec('DROP TRIGGER fail_history_visibility_release');
    assert.deepEqual(
      { stage: partialResult.stage, status: partialResult.status, retryable: partialResult.retryable },
      { stage: 'visibility', status: 'failed', retryable: false },
      'a post-link visibility failure must not claim an impossible unhashed retry',
    );
    assert.equal(
      (database.prepare('SELECT composite_hash FROM image_files WHERE id = ?').get(partialImageId) as { composite_hash: string }).composite_hash,
      uniqueImageResult.compositeHash,
      'the partial-failure row must retain its successful hash link',
    );

    const autoTagSkipped = MediaPostprocessCoordinator.triggerAutoTagProcessing(
      uniqueImageResult.compositeHash!,
      uniqueImagePath,
      { triggerAutoTag: false },
    );
    assert.deepEqual(
      { stage: autoTagSkipped.stage, status: autoTagSkipped.status },
      { stage: 'auto-tag', status: 'skipped' },
    );
    const { autoTagScheduler } = await import('../services/autoTagScheduler');
    const originalAutoTagTrigger = autoTagScheduler.triggerManualProcessing;
    autoTagScheduler.triggerManualProcessing = async () => {
      throw new Error('forced auto-tag failure');
    };
    try {
      const scheduledAutoTag = MediaPostprocessCoordinator.triggerAutoTagProcessing(
        uniqueImageResult.compositeHash!,
        uniqueImagePath,
        {},
      );
      assert.equal(scheduledAutoTag.status, 'scheduled');
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setImmediate(resolve));
      assert.deepEqual(
        { stage: scheduledAutoTag.stage, status: scheduledAutoTag.status, retryable: scheduledAutoTag.retryable },
        { stage: 'auto-tag', status: 'scheduled', retryable: false },
        'an asynchronously rejected auto-tag task must not mutate its already-returned scheduling snapshot',
      );
    } finally {
      autoTagScheduler.triggerManualProcessing = originalAutoTagTrigger;
    }

    const savedMediaResult = await BackgroundProcessorService.processSavedMediaFile(uniqueImagePath, {
      folderId: folder.id,
      mimeType: 'image/png',
      triggerAutoTag: false,
      quiet: true,
    });
    assert.equal(savedMediaResult.status, 'already_processed');
    assert.equal(
      BackgroundProcessorService.getLastProcessingStageResult()?.stages
        .find((stage) => stage.stage === 'auto-tag')?.status,
      'skipped',
      'the public saved-media facade must retain its internal auto-tag stage result',
    );

    for (let index = 0; index < 60; index += 1) {
      insertUnhashed(path.join(tempBasePath, `stress-missing-${index}.png`), 1);
    }
    MediaProcessingDiagnostics.resetForTests();
    const firstStressBatchPromise = BackgroundProcessorService.processUnhashedImages({ quietIfIdle: true });
    assert.equal(BackgroundProcessorService.isProcessing(), true);
    BackgroundProcessorService.forceStop();
    assert.equal(BackgroundProcessorService.isProcessing(), false, 'forceStop must remain a flag-only stop');
    const firstStressBatch = await firstStressBatchPromise;
    assert.deepEqual(firstStressBatch, { processed: 50, duplicates: 0, errors: 0, unique: 0 });
    const stressDeadline = Date.now() + 5_000;
    while (BackgroundProcessorService.getUnprocessedCount() > 0 && Date.now() < stressDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(BackgroundProcessorService.getUnprocessedCount(), 0, 'the scheduled follow-up batch must drain 60 rows');
    assert.equal(BackgroundProcessorService.getLastBatchStageResults().length, 10);
    assert.ok(
      BackgroundProcessorService.getLastBatchStageResults().every((result) => result.stage === 'file-access'),
      'batch diagnostics must retain the final batch stage results',
    );

    const maintenanceLock = (await import('../services/systemMaintenanceLockService')).SystemMaintenanceLockService
      .acquireExclusive({ owner: 'media-contract', reason: 'verify', message: 'verify' });
    try {
      assert.deepEqual(
        await BackgroundProcessorService.processUnhashedImages({ quietIfIdle: true }),
        { processed: 0, duplicates: 0, errors: 0, unique: 0 },
      );
    } finally {
      maintenanceLock.release();
    }

    const batchOrchestratorSource = source('src/services/backgroundProcessorService.ts');
    assert.doesNotMatch(
      batchOrchestratorSource,
      /FileDiscoveryService|WatchedFolderService|fs\.promises\.stat|INSERT OR IGNORE INTO image_files/,
      'the batch facade must not regain saved-file registration ownership',
    );
    assert.match(
      batchOrchestratorSource,
      /return SavedMediaOrchestrator\.process\(filePath, options\)/,
      'the public saved-media method must delegate to its extracted orchestrator',
    );

    reportVerificationSuccess('✅ Media processing contracts verified (invalid/valid/duplicate/partial/stress/batch stages)');
  } finally {
    closeUserSettingsDatabase?.();
    closeMainDatabase?.();
    try {
      fs.rmSync(tempBasePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch (error) {
      // Windows can retain an ffprobe/sharp handle briefly after the animated-file
      // smoke. The OS temp directory remains safe to reclaim later.
      console.warn('⚠️ Media contract temp cleanup deferred:', error instanceof Error ? error.message : error);
    }
  }
}

main().catch((error) => {
  console.error('Invalid media processing contract verification failed:', error);
  process.exit(1);
});
