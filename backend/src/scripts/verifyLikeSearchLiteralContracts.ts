import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ComplexFilter } from '@conai/shared';
import { cleanPromptTerm } from '@conai/shared';

const runtimeBase = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-like-search-'));
process.env.RUNTIME_BASE_PATH = runtimeBase;

type SeedImage = {
  id: number;
  hash: string;
  modelName: string;
  prompt: string;
  negativePrompt?: string;
  loraModels?: string;
};

async function main() {
  const { db, closeDatabase } = await import('../database/init');
  const { ImageSearchModel } = await import('../models/Image/ImageSearchModel');
  const { ComplexFilterService } = await import('../services/complexFilterService');

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
        ai_tool TEXT,
        model_name TEXT,
        lora_models TEXT,
        prompt TEXT,
        negative_prompt TEXT,
        character_prompt_text TEXT,
        raw_nai_parameters TEXT,
        auto_tags TEXT,
        rating_score REAL,
        first_seen_date TEXT,
        filename TEXT,
        file_size INTEGER,
        width INTEGER,
        height INTEGER
      );

      CREATE TABLE image_files (
        id INTEGER PRIMARY KEY,
        composite_hash TEXT NOT NULL,
        original_file_path TEXT,
        file_status TEXT NOT NULL,
        file_type TEXT,
        file_size INTEGER,
        mime_type TEXT,
        folder_id INTEGER
      );

      CREATE TABLE image_groups (
        group_id INTEGER NOT NULL,
        composite_hash TEXT NOT NULL,
        collection_type TEXT
      );

      CREATE TABLE groups (
        id INTEGER PRIMARY KEY,
        name TEXT,
        color TEXT
      );
    `);

    db.prepare(`
      INSERT INTO rating_weights (id, general_weight, sensitive_weight, questionable_weight, explicit_weight)
      VALUES (1, 1, 1, 1, 1)
    `).run();

    db.prepare(`
      INSERT INTO rating_tiers (id, tier_name, min_score, max_score, tier_order, feed_visibility)
      VALUES (1, 'Visible', 0, NULL, 1, 'show')
    `).run();

    const insertMetadata = db.prepare(`
      INSERT INTO media_metadata (
        composite_hash,
        ai_tool,
        model_name,
        lora_models,
        prompt,
        negative_prompt,
        character_prompt_text,
        raw_nai_parameters,
        auto_tags,
        rating_score,
        first_seen_date,
        filename,
        file_size,
        width,
        height
      ) VALUES (?, 'NovelAI', ?, ?, ?, ?, '', '{}', NULL, 0.1, '2026-01-01T00:00:00.000Z', ?, 100, 64, 64)
    `);

    const insertFile = db.prepare(`
      INSERT INTO image_files (id, composite_hash, original_file_path, file_status, file_type, file_size, mime_type, folder_id)
      VALUES (?, ?, ?, 'active', 'image', 100, 'image/png', NULL)
    `);

    function seedImage(image: SeedImage) {
      insertMetadata.run(
        image.hash,
        image.modelName,
        image.loraModels ?? '',
        image.prompt,
        image.negativePrompt ?? '',
        `${image.hash}.png`
      );
      insertFile.run(image.id, image.hash, `/tmp/${image.hash}.png`);
    }

    seedImage({
      id: 1,
      hash: 'hash-literal-percent',
      modelName: 'Model 100% precise',
      prompt: 'literal 100% prompt',
      negativePrompt: 'avoid bad_value',
      loraModels: 'lora_needle',
    });
    seedImage({
      id: 2,
      hash: 'hash-percent-broadened',
      modelName: 'Model 100x precise',
      prompt: 'literal 100x prompt',
      negativePrompt: 'avoid badXvalue',
      loraModels: 'loraXneedle',
    });
    seedImage({
      id: 3,
      hash: 'hash-escaped-bracket-prompt',
      modelName: 'Model escaped prompt',
      prompt: 'crow \\(la+ darknesss\\), on head',
    });
    seedImage({
      id: 4,
      hash: 'hash-weighted-lora-prompt',
      modelName: 'Model weighted lora prompt',
      prompt: '<lora:weighted_unit_probe:0.8>, on head',
    });

    const imageSearch = await ImageSearchModel.advancedSearch(
      { search_text: '100%', model_name: '100%' },
      1,
      10,
      'upload_date',
      'ASC'
    );

    assert.deepEqual(
      imageSearch.images.map((image) => image.composite_hash),
      ['hash-literal-percent'],
      'image search should treat % as a literal character'
    );
    assert.equal(imageSearch.total, 1);

    const negativeSearchIds = await ImageSearchModel.searchCompositeHashes({ negative_text: 'bad_' });
    assert.deepEqual(
      negativeSearchIds,
      ['hash-literal-percent'],
      'image negative prompt search should treat _ as a literal character'
    );

    const promptContainsFilter: ComplexFilter = {
      and_group: [
        { category: 'positive_prompt', type: 'prompt_contains', value: '100%' },
      ],
    };

    const complexPrompt = await ComplexFilterService.executeComplexSearch(
      promptContainsFilter,
      undefined,
      { page: 1, limit: 10, sortBy: 'first_seen_date', sortOrder: 'ASC' }
    );

    assert.deepEqual(
      complexPrompt.images.map((image) => image.composite_hash),
      ['hash-literal-percent'],
      'complex prompt contains should treat % as a literal character'
    );

    const loraFilter: ComplexFilter = {
      and_group: [
        { category: 'basic', type: 'lora_model', value: 'lora_' },
      ],
    };

    const complexLora = await ComplexFilterService.executeComplexSearch(
      loraFilter,
      { model_name: '100%' },
      { page: 1, limit: 10, sortBy: 'first_seen_date', sortOrder: 'ASC' }
    );

    assert.deepEqual(
      complexLora.images.map((image) => image.composite_hash),
      ['hash-literal-percent'],
      'complex model/lora filters should treat LIKE wildcards as literals'
    );

    assert.equal(
      cleanPromptTerm('crow \\(la+ darknesss\\)'),
      'crow (la+ darknesss)',
      'prompt collection cleanup should unescape literal brackets without stripping non-weight parentheses'
    );
    assert.equal(
      cleanPromptTerm('stocking_(psg)'),
      'stocking_(psg)',
      'prompt collection cleanup should preserve non-weight tag parentheses'
    );
    assert.equal(
      cleanPromptTerm('(머리:1.2)'),
      '머리',
      'prompt collection cleanup should remove explicit prompt weights for dedupe'
    );

    const escapedBracketPromptFilter: ComplexFilter = {
      and_group: [
        { category: 'positive_prompt', type: 'prompt_contains', value: 'crow (la+ darknesss)' },
      ],
    };

    const escapedBracketPrompt = await ComplexFilterService.executeComplexSearch(
      escapedBracketPromptFilter,
      undefined,
      { page: 1, limit: 10, sortBy: 'first_seen_date', sortOrder: 'ASC' }
    );

    assert.deepEqual(
      escapedBracketPrompt.images.map((image) => image.composite_hash),
      ['hash-escaped-bracket-prompt'],
      'complex prompt contains should match escaped prompt brackets without deleting literal parentheses'
    );

    const weightedLoraPromptFilter: ComplexFilter = {
      and_group: [
        { category: 'positive_prompt', type: 'prompt_contains', value: '<lora:weighted_unit_probe>' },
      ],
    };

    const weightedLoraPrompt = await ComplexFilterService.executeComplexSearch(
      weightedLoraPromptFilter,
      undefined,
      { page: 1, limit: 10, sortBy: 'first_seen_date', sortOrder: 'ASC' }
    );

    assert.deepEqual(
      weightedLoraPrompt.images.map((image) => image.composite_hash),
      ['hash-weighted-lora-prompt'],
      'complex prompt contains should match weighted LoRA prompts when search omits the weight'
    );

    console.log('✅ LIKE search literal contracts passed');
  } finally {
    closeDatabase();
    fs.rmSync(runtimeBase, { recursive: true, force: true });
  }
}

void main().catch((error) => {
  console.error(error);
  fs.rmSync(runtimeBase, { recursive: true, force: true });
  process.exit(1);
});

