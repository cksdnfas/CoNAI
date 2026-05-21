import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const metadataModelSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/models/Image/MediaMetadataModel.ts'),
  'utf8',
);

assert.match(
  metadataModelSource,
  /function buildSuggestionSearchFilter\(columnExpression: string, normalizedQuery: string\)[\s\S]*?if \(normalizedQuery\.length === 0\) \{[\s\S]*?return \{ sql: '', params: \[\] \}/,
  'empty search-option suggestion queries should skip per-row LOWER/LIKE filtering entirely',
);
assert.doesNotMatch(
  metadataModelSource,
  /\? = '' OR LOWER\(/,
  'search-option suggestion SQL must not keep the empty-query OR guard that forces LOWER() into the hot path',
);

const runtimeBase = fs.mkdtempSync(path.join(os.tmpdir(), 'conai-search-options-'));
process.env.RUNTIME_BASE_PATH = runtimeBase;

async function main() {
  const { db, closeDatabase } = await import('../database/init');
  const { MediaMetadataModel } = await import('../models/Image/MediaMetadataModel');

  try {
    db.exec(`
      CREATE TABLE media_metadata (
        composite_hash TEXT PRIMARY KEY,
        model_name TEXT,
        lora_models TEXT
      );
    `);

    const insertMetadata = db.prepare(`
      INSERT INTO media_metadata (composite_hash, model_name, lora_models)
      VALUES (?, ?, ?)
    `);

    insertMetadata.run('hash-model-literal-percent', 'Model 100% precise', JSON.stringify(['lora_needle']));
    insertMetadata.run('hash-model-wildcard-percent', 'Model 100x precise', JSON.stringify(['loraXneedle']));
    insertMetadata.run('hash-model-extra', 'Other model', JSON.stringify(['other_lora']));

    const modelSuggestions = MediaMetadataModel.searchModelSuggestions('100%', 10);
    assert.deepEqual(
      modelSuggestions.map((item) => item.value),
      ['Model 100% precise'],
      'model suggestions should treat % as a literal character'
    );

    const loraSuggestions = MediaMetadataModel.searchLoraSuggestions('lora_', 10);
    assert.deepEqual(
      loraSuggestions.map((item) => item.value),
      ['lora_needle'],
      'LoRA suggestions should treat _ as a literal character'
    );

    assert.doesNotThrow(() => MediaMetadataModel.searchModelSuggestions('', 1.9));
    assert.equal(
      MediaMetadataModel.searchModelSuggestions('', 1.9).length,
      1,
      'direct model suggestion limits should be floored before SQLite binding'
    );

    assert.doesNotThrow(() => MediaMetadataModel.searchLoraSuggestions('', Number.NaN));
    assert.equal(
      MediaMetadataModel.searchLoraSuggestions('', Number.NaN).length,
      3,
      'invalid direct LoRA suggestion limits should fall back instead of reaching SQLite'
    );

    console.log('✅ search option suggestion contracts passed');
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
