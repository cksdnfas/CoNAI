import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';

test('generated previews precede enrichment and video copies preserve the original identity', { timeout: 60_000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-generated-media-'));
  process.env.RUNTIME_BASE_PATH = root;
  for (const part of ['DATABASE', 'UPLOADS', 'LOGS', 'TEMP', 'SAVE', 'CANVAS', 'ARTIFACTS', 'MODELS', 'CUSTOM_NODES', 'RECYCLE_BIN']) {
    process.env[`RUNTIME_${part}_DIR`] = path.join(root, part.toLowerCase());
  }
  const main = await import('../src/database/init');
  await main.initializeDatabase();
  const user = await import('../src/database/userSettingsDb');
  user.initializeUserSettingsDb();
  (await import('../src/database/apiGenerationDb')).initializeApiGenerationDb();
  const { settingsService } = await import('../src/services/settingsService');
  const settings = settingsService.loadSettings();
  t.mock.method(settingsService, 'loadSettings', () => ({ ...settings,
    tagger: { ...settings.tagger, enabled: false },
    kaloscope: { ...settings.kaloscope, enabled: false },
    videoOptimization: { ...settings.videoOptimization, enabled: true, applyToGeneratedOutputs: true },
  }));
  const { BackgroundQueueService } = await import('../src/services/backgroundQueue');
  const { MetadataExtractor } = await import('../src/services/metadata');
  const { ImageSimilarityService } = await import('../src/services/imageSimilarity');
  const { GenerationHistoryService } = await import('../src/services/generationHistoryService');
  const { HistoryQueryRepository } = await import('../src/repositories/history/HistoryQueryRepository');
  const { MediaMetadataFileQueries } = await import('../src/models/Image/MediaMetadataFileQueries');
  const { GeneratedVideoOptimizationService: optimization } = await import('../src/services/generatedVideoOptimizationService');
  const { VideoOptimizationService } = await import('../src/services/videoOptimizationService');
  const { subscribeToRuntimeEvents } = await import('../src/services/runtime-events/runtimeEventBus');
  const events: Array<{ name: string; payload: unknown }> = [];
  const unsubscribe = subscribeToRuntimeEvents((event) => events.push(event));
  const waitFor = async (predicate: () => boolean) => {
    const deadline = Date.now() + 5_000;
    while (!predicate()) {
      assert.ok(Date.now() < deadline, 'background work did not settle');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  t.after(async () => {
    unsubscribe();
    user.closeUserSettingsDb();
    main.closeDatabase();
    await new Promise<void>(async (resolve) => (await import('../src/utils/logger')).logger.close(resolve));
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('conai-generated-media-'));
    await fs.promises.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  await t.test('history and thumbnail exist while metadata is blocked, hashing runs once, and readiness emits a refresh', async () => {
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let started = false;
    const extract = t.mock.method(MetadataExtractor, 'extractMetadata', async () => {
      started = true;
      await barrier;
      return { ai_info: {}, extractedAt: new Date().toISOString() };
    });
    const hashes = t.mock.method(ImageSimilarityService, 'generateImageHashes');
    const historyId = await GenerationHistoryService.createNAIHistory({ model: 'test' });
    try {
      const buffer = await sharp({ create: { width: 32, height: 32, channels: 4, background: '#345678' } }).png().toBuffer();
      await GenerationHistoryService.processAndUploadImage(historyId, buffer, 'novelai');
      await waitFor(() => started);
      const record = HistoryQueryRepository.findAllWithMetadata({ ids: [historyId] })[0];
      assert.equal(record.generation_status, 'completed');
      assert.equal(record.postprocess_status, 'pending');
      assert.ok(record.actual_composite_hash);
      assert.equal(hashes.mock.callCount(), 1);
      assert.equal(MediaMetadataFileQueries.findByHashWithFile(record.actual_composite_hash!), null);
      const preview = MediaMetadataFileQueries.findByHashWithFile(record.actual_composite_hash!, { includePending: true });
      assert.ok(preview.thumbnail_path);
      const eventCount = events.length;
      release();
      await waitFor(() => !BackgroundQueueService.getQueueStatus().processing);
      assert.ok(MediaMetadataFileQueries.findByHashWithFile(record.actual_composite_hash!));
      assert.ok(events.slice(eventCount).some((event) => event.name === 'history.record.status'));
    } finally {
      release();
      await waitFor(() => !BackgroundQueueService.getQueueStatus().processing);
      extract.mock.restore();
      hashes.mock.restore();
    }
  });

  await t.test('optimization is detached, leased, and never replaces the canonical original', async () => {
    const hash = 'b8'.repeat(32);
    const original = path.join(root, 'uploads', 'original.mp4');
    fs.writeFileSync(original, Buffer.alloc(128, 1));
    const folder = main.db.prepare('SELECT id FROM watched_folders LIMIT 1').get() as { id: number };
    main.db.prepare('INSERT INTO media_metadata (composite_hash) VALUES (?)').run(hash);
    main.db.prepare(`INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_size, file_type, mime_type, file_status)
      VALUES (?, ?, ?, 128, 'video', 'video/mp4', 'active')`).run(hash, original, folder.id);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let started = false;
    const transcode = t.mock.method(VideoOptimizationService, 'transcodeToMp4', async (_source: string, target: string) => {
      started = true;
      await barrier;
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, Buffer.alloc(32, 2));
      return { outputPath: target, fileSize: 32, mimeType: 'video/mp4' };
    });
    const state = () => main.db.prepare('SELECT status FROM generated_video_optimizations WHERE composite_hash = ?').get(hash) as { status: string };
    try {
      await optimization.enqueue(hash, original);
      await waitFor(() => started);
      assert.equal(state().status, 'processing');
      assert.equal(optimization.getPlaybackPath(hash), null);
      assert.deepEqual(fs.readFileSync(original), Buffer.alloc(128, 1));
      release();
      await waitFor(() => state().status === 'completed');
      assert.ok(optimization.getPlaybackPath(hash));
      assert.equal(optimization.playbackUrl(hash, '/owner/file'), '/owner/file?variant=optimized');
      assert.deepEqual(fs.readFileSync(original), Buffer.alloc(128, 1));
      assert.equal((main.db.prepare('SELECT composite_hash FROM image_files WHERE original_file_path = ?').get(original) as { composite_hash: string }).composite_hash, hash);
      await optimization.enqueue(hash, original);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(transcode.mock.callCount(), 1, 're-registering does not transcode the same media again');
    } finally {
      release();
      await waitFor(() => state().status !== 'processing');
      transcode.mock.restore();
    }
  });

  await t.test('an interrupted video job resumes and encoding failure never removes its original', async () => {
    const hash = 'c9'.repeat(32);
    const original = path.join(root, 'uploads', 'retry.mp4');
    fs.writeFileSync(original, Buffer.alloc(64, 3));
    const stat = fs.statSync(original);
    const folder = main.db.prepare('SELECT id FROM watched_folders LIMIT 1').get() as { id: number };
    main.db.prepare('INSERT INTO media_metadata (composite_hash) VALUES (?)').run(hash);
    main.db.prepare(`INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_size, file_type, mime_type, file_status)
      VALUES (?, ?, ?, 64, 'video', 'video/mp4', 'active')`).run(hash, original, folder.id);
    main.db.prepare(`INSERT INTO generated_video_optimizations
      (composite_hash, source_path, source_size, source_mtime, crf, audio_bitrate, status, lease_until)
      VALUES (?, ?, ?, ?, 23, 128, 'processing', 0)`).run(hash, original, stat.size, stat.mtimeMs);
    const transcode = t.mock.method(VideoOptimizationService, 'transcodeToMp4', async () => { throw new Error('test encoder failure'); });
    const state = () => main.db.prepare('SELECT status, attempts, last_error FROM generated_video_optimizations WHERE composite_hash = ?').get(hash) as { status: string; attempts: number; last_error: string };
    try {
      await optimization.enqueue(hash, original);
      await waitFor(() => state().attempts === 1 && state().status === 'pending');
      assert.match(state().last_error, /test encoder failure/);
      main.db.prepare('UPDATE generated_video_optimizations SET attempts = 2, lease_until = 0 WHERE composite_hash = ?').run(hash);
      await optimization.enqueue(hash, original);
      await waitFor(() => state().status === 'failed');
      assert.equal(optimization.getPlaybackPath(hash), null);
      assert.deepEqual(fs.readFileSync(original), Buffer.alloc(64, 3));
      assert.equal(transcode.mock.callCount(), 2);
    } finally {
      transcode.mock.restore();
    }
  });
});
