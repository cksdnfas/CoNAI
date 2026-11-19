import './support/testTemp'
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
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

  await t.test('shutdown drains the active video copy without claiming queued work', async () => {
    const hashes = ['da'.repeat(32), 'db'.repeat(32)];
    const original = path.join(root, 'uploads', 'shutdown.mp4');
    const queuedOriginal = path.join(root, 'uploads', 'shutdown-queued.mp4');
    fs.writeFileSync(original, Buffer.alloc(128, 4));
    fs.copyFileSync(original, queuedOriginal);
    const folder = main.db.prepare('SELECT id FROM watched_folders LIMIT 1').get() as { id: number };
    for (const [index, hash] of hashes.entries()) {
      main.db.prepare('INSERT INTO media_metadata (composite_hash) VALUES (?)').run(hash);
      main.db.prepare(`INSERT INTO image_files (composite_hash, original_file_path, folder_id, file_size, file_type, mime_type, file_status)
        VALUES (?, ?, ?, 128, 'video', 'video/mp4', 'active')`).run(hash, index === 0 ? original : queuedOriginal, folder.id);
    }
    let release!: () => void;
    let entered!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const transcode = t.mock.method(VideoOptimizationService, 'transcodeToMp4', async (_source: string, target: string) => {
      entered();
      await barrier;
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, Buffer.alloc(32));
      return { outputPath: target, fileSize: 32, mimeType: 'video/mp4' };
    });
    try {
      await optimization.enqueue(hashes[0], original);
      await started;
      await optimization.enqueue(hashes[1], queuedOriginal);
      let drained = false;
      const stopping = optimization.stopAndDrain().then(() => { drained = true; });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(drained, false, 'shutdown must wait for the active write');
      release();
      await stopping;
      assert.ok(optimization.getPlaybackPath(hashes[0]));
      await optimization.enqueue(hashes[1], queuedOriginal);
      await new Promise((resolve) => setImmediate(resolve));
      const queued = main.db.prepare('SELECT status, attempts FROM generated_video_optimizations WHERE composite_hash = ?').get(hashes[1]);
      assert.deepEqual(queued, { status: 'pending', attempts: 0 });
      assert.equal(transcode.mock.callCount(), 1);
      assert.deepEqual(fs.readFileSync(original), Buffer.alloc(128, 4));
    } finally {
      release();
      await waitFor(() => !(main.db.prepare("SELECT 1 FROM generated_video_optimizations WHERE status = 'processing'").get()));
      transcode.mock.restore();
    }
  });

  await t.test('a generated video the background batch registers mid-ingest completes as that existing item', async () => {
    const { BackgroundProcessorService } = await import('../src/services/backgroundProcessorService');
    const { VideoProcessor } = await import('../src/services/videoProcessor');
    const { VideoFrameExtractor } = await import('../src/services/videoFrameExtractor');
    const bytes = Buffer.alloc(256, 7);
    const hash = crypto.createHash('md5').update(bytes).digest('hex');
    const source = path.join(root, 'temp', 'comfyui_race.mp4');
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, bytes);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let probes = 0;
    // The generation's own probe stalls after its duplicate check; the batch's probe of the same row answers at once.
    const probe = t.mock.method(VideoProcessor, 'extractMetadata', async () => {
      probes += 1;
      if (probes === 1) await barrier;
      return { duration: 1, width: 64, height: 32, fps: 24, video_codec: 'av1', audio_codec: null, bitrate: 1, format: 'mp4', extractedAt: new Date().toISOString() };
    });
    const poster = t.mock.method(VideoFrameExtractor, 'generatePosterThumbnail', async () => 'thumbnails/race.webp');
    const enqueue = t.mock.method(optimization, 'enqueue', async () => {});
    const historyId = await GenerationHistoryService.createComfyUIHistory({ workflowId: 1, workflowName: 'video' });
    try {
      const saving = GenerationHistoryService.processAndUploadGeneratedFile(historyId, source, 'comfyui', { sourceMimeType: 'video/mp4' });
      await waitFor(() => probes === 1);
      const batch = await BackgroundProcessorService.processUnhashedImages();
      assert.deepEqual([batch.processed, batch.errors], [1, 0]);
      release();
      await saving;
      const record = HistoryQueryRepository.findAllWithMetadata({ ids: [historyId] })[0];
      assert.equal(record.generation_status, 'completed');
      assert.equal(record.actual_composite_hash, hash);
      assert.equal((main.db.prepare('SELECT COUNT(*) AS count FROM media_metadata WHERE composite_hash = ?').get(hash) as { count: number }).count, 1);
      const files = main.db.prepare('SELECT original_file_path FROM image_files WHERE composite_hash = ?').all(hash) as Array<{ original_file_path: string }>;
      assert.equal(files.length, 1);
      assert.deepEqual(fs.readFileSync(files[0].original_file_path), bytes);
      assert.deepEqual(enqueue.mock.calls.map((call) => call.arguments[0]), [hash]);
    } finally {
      release();
      probe.mock.restore();
      poster.mock.restore();
      enqueue.mock.restore();
    }
  });

  await t.test('a generated image the background batch registers mid-ingest is extracted and prompt-collected once', async () => {
    const { BackgroundProcessorService } = await import('../src/services/backgroundProcessorService');
    const { ThumbnailGenerator } = await import('../src/utils/thumbnailGenerator');
    let releaseThumbnail!: () => void;
    let releaseExtraction!: () => void;
    const thumbnailBarrier = new Promise<void>((resolve) => { releaseThumbnail = resolve; });
    const extractionBarrier = new Promise<void>((resolve) => { releaseExtraction = resolve; });
    let thumbnails = 0;
    let extractions = 0;
    // The generation's thumbnail stalls after its duplicate check, so the batch inserts and links the same row first.
    const thumbnail = t.mock.method(ThumbnailGenerator, 'generateThumbnail', async () => {
      thumbnails += 1;
      if (thumbnails === 1) await thumbnailBarrier;
      return 'thumbnails/race.webp';
    });
    // The batch's own extraction is still running when the generation hits the conflict.
    const extract = t.mock.method(MetadataExtractor, 'extractMetadata', async () => {
      extractions += 1;
      if (extractions === 1) await extractionBarrier;
      return { ai_info: { ai_tool: 'NovelAI', prompt: 'race prompt' }, extractedAt: new Date().toISOString() };
    });
    const collect = t.mock.method(BackgroundQueueService, 'addPromptCollectionTask', () => {});
    const historyId = await GenerationHistoryService.createNAIHistory({ model: 'test' });
    let batch: Promise<unknown> | undefined;
    try {
      const buffer = await sharp({ create: { width: 24, height: 24, channels: 4, background: '#9a3c21' } }).png().toBuffer();
      const saving = GenerationHistoryService.processAndUploadImage(historyId, buffer, 'novelai');
      await waitFor(() => thumbnails === 1);
      const batching = BackgroundProcessorService.processUnhashedImages();
      batch = batching;
      await waitFor(() => extractions === 1);
      releaseThumbnail();
      await saving;
      releaseExtraction();
      const result = await batching;
      assert.deepEqual([result.processed, result.errors], [1, 0]);
      await waitFor(() => !BackgroundQueueService.getQueueStatus().processing);
      const record = HistoryQueryRepository.findAllWithMetadata({ ids: [historyId] })[0];
      assert.equal(record.generation_status, 'completed');
      assert.ok(record.actual_composite_hash);
      assert.equal((main.db.prepare('SELECT COUNT(*) AS count FROM image_files WHERE composite_hash = ?').get(record.actual_composite_hash) as { count: number }).count, 1);
      assert.equal(extractions, 1);
      assert.deepEqual(collect.mock.calls.map((call) => call.arguments[1]), [record.actual_composite_hash]);
    } finally {
      releaseThumbnail();
      releaseExtraction();
      await batch?.catch(() => undefined);
      await waitFor(() => !BackgroundQueueService.getQueueStatus().processing);
      thumbnail.mock.restore();
      extract.mock.restore();
      collect.mock.restore();
    }
  });

  await t.test('a freed encoder slot goes to the waiting encoder, never to a newcomer', async () => {
    const previous = process.env.CONAI_VIDEO_ENCODER_CONCURRENCY;
    process.env.CONAI_VIDEO_ENCODER_CONCURRENCY = '1';
    const slots = VideoOptimizationService as unknown as { acquireEncoderSlot(): Promise<() => void> };
    let active = 0;
    let peak = 0;
    const encode = async () => {
      const release = await slots.acquireEncoderSlot();
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setImmediate(resolve));
      active -= 1;
      release();
    };
    try {
      const first = await slots.acquireEncoderSlot();
      const waiting = encode();
      first();
      // Arrives in the same tick the slot frees, before the woken waiter resumes.
      const newcomer = encode();
      await Promise.all([waiting, newcomer]);
      assert.equal(peak, 1);
    } finally {
      if (previous === undefined) delete process.env.CONAI_VIDEO_ENCODER_CONCURRENCY;
      else process.env.CONAI_VIDEO_ENCODER_CONCURRENCY = previous;
    }
  });

  await t.test('repeated artifact descriptors hash an unchanged file once and a changed file again', async () => {
    const { McpArtifactService } = await import('../src/services/mcpArtifactService');
    const { GraphExecutionArtifactModel } = await import('../src/models/GraphExecutionArtifact');
    const file = path.join(root, 'artifacts', 'descriptor.mp4');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.alloc(256 * 1024, 5));
    const artifacts = t.mock.method(GraphExecutionArtifactModel, 'findByIds', () => [{ id: 1, execution_id: 7, storage_path: file }] as never);
    const createReadStream = fs.createReadStream;
    let fullReads = 0;
    const reads = t.mock.method(fs, 'createReadStream', ((...args: Parameters<typeof fs.createReadStream>) => {
      if (path.resolve(String(args[0])) === file) fullReads += 1;
      return createReadStream(...args);
    }) as typeof fs.createReadStream);
    try {
      const builds = 20;
      const first = await McpArtifactService.createGraphDescriptor(1, 'http://localhost');
      for (let index = 1; index < builds; index += 1) {
        assert.equal((await McpArtifactService.createGraphDescriptor(1, 'http://localhost'))?.sha256, first?.sha256);
      }
      assert.equal(first?.sha256, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
      assert.equal(fullReads, 1, `${builds} builds of an unchanged file hash it once`);
      // Same size, new content and modification time.
      fs.writeFileSync(file, Buffer.alloc(256 * 1024, 6));
      const later = new Date(fs.statSync(file).mtimeMs + 5_000);
      fs.utimesSync(file, later, later);
      const changed = await McpArtifactService.createGraphDescriptor(1, 'http://localhost');
      assert.equal(fullReads, 2);
      assert.equal(changed?.sha256, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
      t.diagnostic(`${builds} descriptor builds of an unchanged file: 1 full-file hash`);
    } finally {
      reads.mock.restore();
      artifacts.mock.restore();
    }
  });
});
