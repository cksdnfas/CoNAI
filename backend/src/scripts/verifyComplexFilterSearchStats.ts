import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ComplexFilter } from '@conai/shared';

const runtimeBase = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-complex-filter-'));
process.env.RUNTIME_BASE_PATH = runtimeBase;

type SeedImage = {
  hash: string;
  aiTool: string;
  modelName: string;
  prompt: string;
  firstSeenDate: string;
};

async function main() {
  const { db, closeDatabase } = await import('../database/init');
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
        mime_type TEXT
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
      ) VALUES (?, ?, ?, '', ?, '', '', '{}', NULL, 0.1, ?, ?, 100, 64, 64)
    `);

    const insertFile = db.prepare(`
      INSERT INTO image_files (id, composite_hash, original_file_path, file_status, file_type, file_size, mime_type)
      VALUES (?, ?, ?, 'active', 'image', 100, 'image/png')
    `);

    function seedImage(index: number, image: SeedImage) {
      insertMetadata.run(
        image.hash,
        image.aiTool,
        image.modelName,
        image.prompt,
        image.firstSeenDate,
        `${image.hash}.png`
      );
      insertFile.run(index, image.hash, `/tmp/${image.hash}.png`);
    }

    seedImage(1, {
      hash: 'hash-visible-cat',
      aiTool: 'NovelAI',
      modelName: 'Model A',
      prompt: 'cat bright',
      firstSeenDate: '2026-01-01T00:00:00.000Z',
    });
    seedImage(2, {
      hash: 'hash-visible-dog',
      aiTool: 'NovelAI',
      modelName: 'Model A',
      prompt: 'dog muted',
      firstSeenDate: '2026-01-02T00:00:00.000Z',
    });
    seedImage(3, {
      hash: 'hash-comfy-cat',
      aiTool: 'ComfyUI',
      modelName: 'Model B',
      prompt: 'cat bright',
      firstSeenDate: '2026-01-03T00:00:00.000Z',
    });
    seedImage(4, {
      hash: 'hash-excluded-cat',
      aiTool: 'NovelAI',
      modelName: 'Model A',
      prompt: 'cat excluded',
      firstSeenDate: '2026-01-04T00:00:00.000Z',
    });

    const filter: ComplexFilter = {
      exclude_group: [
        { category: 'positive_prompt', type: 'prompt_contains', value: 'excluded' },
      ],
      or_group: [
        { category: 'positive_prompt', type: 'prompt_contains', value: 'cat' },
      ],
      and_group: [
        { category: 'basic', type: 'model_name', value: 'Model A' },
      ],
    };

    const result = await ComplexFilterService.executeComplexSearch(
      filter,
      { ai_tool: 'NovelAI' },
      { page: 1, limit: 10, sortBy: 'first_seen_date', sortOrder: 'ASC' }
    );

    assert.equal(result.total, 1, 'final result should keep only scoped, non-excluded matches');
    assert.deepEqual(
      result.images.map((image) => image.composite_hash),
      ['hash-visible-cat']
    );
    assert.equal(result.stats?.excluded_count, 1, 'exclude CTE count should reflect matching scoped rows');
    assert.equal(result.stats?.or_matched_count, 2, 'OR CTE count should include scoped cat rows before exclusion');
    assert.equal(result.stats?.and_matched_count, 3, 'AND CTE count should include scoped Model A rows');
    assert.equal(result.stats?.final_result_count, 1);
    assert.ok((result.stats?.execution_time_ms ?? -1) >= 0);

    const scopedNoGroup = await ComplexFilterService.executeComplexSearch(
      {},
      { ai_tool: 'ComfyUI' },
      { page: 1, limit: 10, sortBy: 'first_seen_date', sortOrder: 'ASC' }
    );

    assert.equal(scopedNoGroup.total, 1, 'basic scope must apply when no filter groups exist');
    assert.equal(scopedNoGroup.images[0]?.composite_hash, 'hash-comfy-cat');
    assert.equal(scopedNoGroup.stats?.excluded_count, 0);
    assert.equal(scopedNoGroup.stats?.or_matched_count, 0);
    assert.equal(scopedNoGroup.stats?.and_matched_count, 0);

    const scopedIds = await ComplexFilterService.executeComplexSearchIds({}, { ai_tool: 'ComfyUI' });
    assert.deepEqual(scopedIds, ['hash-comfy-cat'], 'ID-only search should share final scope behavior');

    console.log('✅ Complex filter search scope/stats contracts passed');
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
