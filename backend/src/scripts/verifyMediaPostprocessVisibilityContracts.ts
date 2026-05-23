import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ComplexFilter } from '@conai/shared';

const runtimeBase = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-postprocess-visibility-'));
process.env.RUNTIME_BASE_PATH = runtimeBase;

async function main() {
  const { db, closeDatabase } = await import('../database/init');
  const { initializeUserSettingsDb, closeUserSettingsDb } = await import('../database/userSettingsDb');
  const { initializeApiGenerationDb } = await import('../database/apiGenerationDb');
  const { MediaMetadataModel } = await import('../models/Image/MediaMetadataModel');
  const { ImageSearchModel } = await import('../models/Image/ImageSearchModel');
  const { ImageSimilarityModel } = await import('../models/Image/ImageSimilarityModel');
  const { ComplexFilterService } = await import('../services/complexFilterService');
  const { findImagesByGroupWithFilesQuery } = await import('../models/GroupImageQueries');
  const { MediaPostprocessVisibilityService } = await import('../services/mediaPostprocessVisibilityService');
  const { BackgroundProcessorService } = await import('../services/backgroundProcessorService');
  const { settingsService } = await import('../services/settingsService');
  const { AutoTagsComposeService } = await import('../services/autoTagsComposeService');
  const { GenerationHistoryModel } = await import('../models/GenerationHistory');

  try {
    db.exec(`
      CREATE TABLE rating_weights (
        id INTEGER PRIMARY KEY,
        general_weight REAL NOT NULL,
        sensitive_weight REAL NOT NULL,
        questionable_weight REAL NOT NULL,
        explicit_weight REAL NOT NULL,
        updated_at TEXT
      );

      CREATE TABLE rating_tiers (
        id INTEGER PRIMARY KEY,
        tier_name TEXT NOT NULL,
        min_score REAL NOT NULL,
        max_score REAL,
        tier_order INTEGER NOT NULL,
        color TEXT,
        feed_visibility TEXT NOT NULL DEFAULT 'show'
      );

      CREATE TABLE media_metadata (
        composite_hash TEXT PRIMARY KEY,
        perceptual_hash TEXT,
        dhash TEXT,
        ahash TEXT,
        color_histogram TEXT,
        width INTEGER,
        height INTEGER,
        thumbnail_path TEXT,
        ai_tool TEXT,
        model_name TEXT,
        lora_models TEXT,
        steps INTEGER,
        cfg_scale REAL,
        sampler TEXT,
        seed INTEGER,
        scheduler TEXT,
        prompt TEXT,
        negative_prompt TEXT,
        denoise_strength REAL,
        generation_time REAL,
        batch_size INTEGER,
        batch_index INTEGER,
        auto_tags TEXT,
        duration REAL,
        fps REAL,
        video_codec TEXT,
        audio_codec TEXT,
        bitrate INTEGER,
        rating_score REAL,
        model_references TEXT,
        character_prompt_text TEXT,
        raw_nai_parameters TEXT,
        first_seen_date TEXT,
        metadata_updated_date TEXT,
        postprocess_status TEXT NOT NULL DEFAULT 'ready',
        postprocess_completed_at TEXT
      );

      CREATE TABLE image_files (
        id INTEGER PRIMARY KEY,
        composite_hash TEXT,
        original_file_path TEXT,
        file_status TEXT NOT NULL,
        file_type TEXT,
        file_size INTEGER,
        mime_type TEXT,
        folder_id INTEGER,
        file_modified_date TEXT,
        last_verified_date TEXT,
        scan_date TEXT
      );

      CREATE TABLE image_groups (
        group_id INTEGER NOT NULL,
        composite_hash TEXT NOT NULL,
        collection_type TEXT,
        order_index INTEGER DEFAULT 0,
        added_date TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE groups (
        id INTEGER PRIMARY KEY,
        name TEXT,
        color TEXT
      );

      CREATE TABLE watched_folders (
        id INTEGER PRIMARY KEY,
        folder_name TEXT
      );
    `);
    initializeUserSettingsDb();
    initializeApiGenerationDb();

    db.prepare(`
      INSERT INTO rating_weights (id, general_weight, sensitive_weight, questionable_weight, explicit_weight)
      VALUES (1, 1, 1, 1, 1)
    `).run();
    db.prepare(`
      INSERT INTO rating_tiers (id, tier_name, min_score, max_score, tier_order, feed_visibility)
      VALUES (1, 'Visible', 0, NULL, 1, 'show')
    `).run();
    db.prepare(`INSERT INTO groups (id, name, color) VALUES (1, 'Group', '#fff')`).run();

    const insertMetadata = db.prepare(`
      INSERT INTO media_metadata (
        composite_hash, perceptual_hash, dhash, ahash, color_histogram,
        width, height, thumbnail_path, ai_tool, model_name, lora_models,
        steps, cfg_scale, sampler, seed, scheduler, prompt, negative_prompt,
        denoise_strength, generation_time, batch_size, batch_index, auto_tags,
        duration, fps, video_codec, audio_codec, bitrate, rating_score,
        model_references, character_prompt_text, raw_nai_parameters,
        first_seen_date, metadata_updated_date, postprocess_status, postprocess_completed_at
      ) VALUES (
        ?, '0000000000000000', '0000000000000000', '0000000000000000', '{}', 64, 64, 'thumb.webp', 'NovelAI', 'model', '["shared-lora"]',
        20, 5, 'sampler', 123, 'scheduler', 'shared prompt', '',
        NULL, NULL, NULL, NULL, ?,
        NULL, NULL, NULL, NULL, NULL, 0.1,
        NULL, '', '{}', ?, ?, ?, ?
      )
    `);
    const insertFile = db.prepare(`
      INSERT INTO image_files (id, composite_hash, original_file_path, file_status, file_type, file_size, mime_type, folder_id, scan_date)
      VALUES (?, ?, ?, 'active', 'image', 100, 'image/png', NULL, ?)
    `);
    const insertGroupImage = db.prepare(`
      INSERT INTO image_groups (group_id, composite_hash, collection_type, order_index, added_date)
      VALUES (1, ?, 'manual', ?, ?)
    `);

    const seed = (
      hash: string,
      id: number,
      status: 'ready' | 'pending',
      day: string,
      autoTagsJson: string | null = '{"tagger":{"taglist":"shared"}}'
    ) => {
      const date = `2026-01-${day}T00:00:00.000Z`;
      insertMetadata.run(hash, autoTagsJson, date, date, status, status === 'ready' ? date : null);
      insertFile.run(id, hash, `/tmp/${hash}.png`, date);
      insertGroupImage.run(hash, id, date);
    };

    seed('ready-hash', 1, 'ready', '01');
    seed('pending-hash', 2, 'pending', '02');

    const readyHistoryId = GenerationHistoryModel.create({
      service_type: 'novelai',
      generation_status: 'completed',
      nai_model: 'model',
      composite_hash: 'ready-hash',
    });
    const pendingHistoryId = GenerationHistoryModel.create({
      service_type: 'novelai',
      generation_status: 'completed',
      nai_model: 'model',
      composite_hash: 'pending-hash',
    });
    GenerationHistoryModel.updateImagePaths(readyHistoryId, { compositeHash: 'ready-hash' });
    GenerationHistoryModel.updateImagePaths(pendingHistoryId, { compositeHash: 'pending-hash' });

    const generationHistoryRecords = GenerationHistoryModel.findAllWithMetadata({ service_type: 'novelai', limit: 10 });
    const historyByHash = new Map(generationHistoryRecords.map((record) => [record.composite_hash, record]));
    assert.equal(
      historyByHash.get('ready-hash')?.actual_composite_hash,
      'ready-hash',
      'generation history lists should resolve ready media metadata'
    );
    assert.equal(
      historyByHash.get('pending-hash')?.actual_composite_hash ?? null,
      null,
      'generation history lists must not expose pending postprocessed media as display-ready'
    );
    assert.equal(
      GenerationHistoryModel.findByIdWithMetadata(readyHistoryId)?.actual_composite_hash,
      'ready-hash',
      'generation history detail should resolve ready media metadata'
    );
    assert.equal(
      GenerationHistoryModel.findByIdWithMetadata(pendingHistoryId)?.actual_composite_hash ?? null,
      null,
      'generation history detail must not expose pending postprocessed media as display-ready'
    );

    const list = MediaMetadataModel.findAllWithFiles({ page: 1, limit: 10, sortOrder: 'ASC' });
    assert.deepEqual(
      list.items.map((image) => image.composite_hash),
      ['ready-hash'],
      'gallery list must hide media until postprocess_status is ready'
    );
    assert.equal(list.total, 1);

    const cursorList = MediaMetadataModel.findAllWithFilesCursor({ limit: 10, sortOrder: 'ASC' });
    assert.deepEqual(
      cursorList.items.map((image) => image.composite_hash),
      ['ready-hash'],
      'cursor gallery list must hide pending postprocessed media'
    );
    assert.equal(cursorList.total, 1);

    const basicSearch = await ImageSearchModel.advancedSearch(
      { search_text: 'shared' },
      1,
      10,
      'upload_date',
      'ASC'
    );
    assert.deepEqual(
      basicSearch.images.map((image) => image.composite_hash),
      ['ready-hash'],
      'basic image search must hide pending postprocessed media'
    );
    assert.equal(basicSearch.total, 1);

    const searchHashes = await ImageSearchModel.searchCompositeHashes({ search_text: 'shared' });
    assert.deepEqual(searchHashes, ['ready-hash'], 'search hash results must hide pending postprocessed media');

    const dateRange = MediaMetadataModel.findByDateRange(
      '2026-01-01T00:00:00.000Z',
      '2026-01-31T23:59:59.999Z',
      1,
      10
    );
    assert.deepEqual(
      dateRange.items.map((image) => image.composite_hash),
      ['ready-hash'],
      'date-range lists must hide pending postprocessed media'
    );
    assert.equal(dateRange.total, 1);

    assert.deepEqual(
      MediaMetadataModel.searchModelSuggestions('model', 10),
      [{ value: 'model', count: 1 }],
      'model suggestions must ignore pending postprocessed media'
    );
    assert.deepEqual(
      MediaMetadataModel.searchLoraSuggestions('shared-lora', 10),
      [{ value: 'shared-lora', count: 1 }],
      'LoRA suggestions must ignore pending postprocessed media'
    );

    const filter: ComplexFilter = {
      and_group: [
        { category: 'positive_prompt', type: 'prompt_contains', value: 'shared' },
      ],
    };
    const complexSearch = await ComplexFilterService.executeComplexSearch(
      filter,
      undefined,
      { page: 1, limit: 10, sortBy: 'first_seen_date', sortOrder: 'ASC' }
    );
    assert.deepEqual(
      complexSearch.images.map((image) => image.composite_hash),
      ['ready-hash'],
      'complex search must hide pending postprocessed media'
    );
    assert.equal(complexSearch.total, 1);

    const groupImages = findImagesByGroupWithFilesQuery(1, 1, 10);
    assert.deepEqual(
      groupImages.images.map((image) => image.composite_hash),
      ['ready-hash'],
      'group image lists must hide pending postprocessed media'
    );
    assert.equal(groupImages.total, 1);

    const duplicateMatches = await ImageSimilarityModel.findDuplicates('ready-hash', { includeMetadata: false });
    assert.deepEqual(
      duplicateMatches.map((match) => (match.image as unknown as { composite_hash: string }).composite_hash),
      [],
      'similarity/duplicate candidate lists must hide pending postprocessed media'
    );

    const readPostprocessStatus = (hash: string): string | null => {
      const row = db.prepare(`
        SELECT postprocess_status
        FROM media_metadata
        WHERE composite_hash = ?
      `).get(hash) as { postprocess_status: string } | undefined;
      return row?.postprocess_status ?? null;
    };

    const defaultSettings = settingsService.loadSettings();

    settingsService.saveSettings({
      ...defaultSettings,
      tagger: { ...defaultSettings.tagger, enabled: true, autoTagOnUpload: false },
      kaloscope: { ...defaultSettings.kaloscope, enabled: false, autoTagOnUpload: false },
    });
    assert.equal(
      MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork('pending-hash'),
      true,
      'enabled tagger must not hold visibility when autoTagOnUpload is disabled'
    );
    assert.equal(readPostprocessStatus('pending-hash'), 'ready');

    seed('tagger-wait-hash', 3, 'pending', '03', null);
    settingsService.saveSettings({
      ...defaultSettings,
      tagger: { ...defaultSettings.tagger, enabled: true, autoTagOnUpload: true },
      kaloscope: { ...defaultSettings.kaloscope, enabled: false, autoTagOnUpload: false },
    });
    assert.equal(
      MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork('tagger-wait-hash'),
      false,
      'auto tag enabled on upload should keep a new row pending until tagger output exists'
    );
    assert.equal(readPostprocessStatus('tagger-wait-hash'), 'pending');

    db.prepare(`
      UPDATE media_metadata
      SET auto_tags = ?
      WHERE composite_hash = ?
    `).run('{"version":2,"tagger":{"general":{"blue sky":0.9},"rating":{"general":0.9}}}', 'tagger-wait-hash');
    assert.equal(
      MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork('tagger-wait-hash'),
      true,
      'tagger output should release pending postprocess visibility'
    );
    assert.equal(readPostprocessStatus('tagger-wait-hash'), 'ready');

    seed('tagger-failed-hash', 6, 'pending', '06', AutoTagsComposeService.mergeTaggerFailure(null, 'tagger failed'));
    assert.equal(
      MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork('tagger-failed-hash'),
      true,
      'failed tagger output should count as finished post-processing and release visibility'
    );
    assert.equal(readPostprocessStatus('tagger-failed-hash'), 'ready');

    seed('artist-wait-hash', 4, 'pending', '04');
    settingsService.saveSettings({
      ...defaultSettings,
      tagger: { ...defaultSettings.tagger, enabled: false, autoTagOnUpload: false },
      kaloscope: { ...defaultSettings.kaloscope, enabled: true, autoTagOnUpload: true },
    });
    assert.equal(
      MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork('artist-wait-hash'),
      false,
      'artist extraction enabled on upload should keep a new row pending until kaloscope output exists'
    );
    db.prepare(`
      UPDATE media_metadata
      SET auto_tags = ?
      WHERE composite_hash = ?
    `).run('{"version":2,"kaloscope":{"artists":{"artist":0.8}}}', 'artist-wait-hash');
    assert.equal(
      MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork('artist-wait-hash'),
      true,
      'kaloscope artist output should release pending postprocess visibility'
    );
    assert.equal(readPostprocessStatus('artist-wait-hash'), 'ready');

    seed('artist-failed-hash', 7, 'pending', '07', AutoTagsComposeService.mergeKaloscopeFailure(null, 'kaloscope failed', 'runtime'));
    assert.equal(
      MediaPostprocessVisibilityService.markReadyIfNoPendingImmediateWork('artist-failed-hash'),
      true,
      'failed kaloscope output should count as finished post-processing and release visibility'
    );
    assert.equal(readPostprocessStatus('artist-failed-hash'), 'ready');

    seed('disabled-release-hash', 5, 'pending', '05');
    settingsService.saveSettings({
      ...defaultSettings,
      tagger: { ...defaultSettings.tagger, enabled: false, autoTagOnUpload: false },
      kaloscope: { ...defaultSettings.kaloscope, enabled: false, autoTagOnUpload: false },
    });
    assert.equal(
      MediaPostprocessVisibilityService.markReadyRowsWithoutPendingImmediateWork(),
      1,
      'turning off optional auto processors should release pending rows that no longer have required work'
    );
    assert.equal(readPostprocessStatus('disabled-release-hash'), 'ready');

    const duplicateVideoContent = Buffer.from('duplicate video payload');
    const duplicateVideoPath = path.join(runtimeBase, 'duplicate-existing.mp4');
    fs.writeFileSync(duplicateVideoPath, duplicateVideoContent);
    const duplicateVideoHash = crypto.createHash('md5').update(duplicateVideoContent).digest('hex');
    const duplicateVideoDate = '2026-01-06T00:00:00.000Z';
    insertMetadata.run(
      duplicateVideoHash,
      '{"tagger":{"taglist":"shared"}}',
      duplicateVideoDate,
      duplicateVideoDate,
      'pending',
      null
    );

    const duplicateVideoResult = await BackgroundProcessorService.processSavedMediaFile(duplicateVideoPath, {
      folderId: 1,
      mimeType: 'video/mp4',
      triggerAutoTag: false,
      quiet: true,
    });
    assert.equal(duplicateVideoResult.compositeHash, duplicateVideoHash);
    assert.equal(
      readPostprocessStatus(duplicateVideoHash),
      'ready',
      'existing duplicate video rows should be released when no optional auto post-processing is required'
    );

    console.log('✅ Media postprocess visibility contracts passed');
  } finally {
    closeUserSettingsDb();
    closeDatabase();
    fs.rmSync(runtimeBase, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  fs.rmSync(runtimeBase, { recursive: true, force: true });
  process.exit(1);
});
