import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DATA_REMATCH_EXCLUDED_FILE_TYPES,
  DATA_REMATCH_HASH_REFERENCE_TABLES,
  DATA_REMATCH_SUPPORTED_FILE_TYPES,
  HASH_REGENERATION_BLOCKED_PIPELINES,
  HASH_REGENERATION_WARNINGS,
  isDataRematchSupportedFileType,
  normalizeDataRematchOptions,
} from '../services/dataRematchService';

function assertThrowsMessage(fn: () => unknown, fragment: string) {
  assert.throws(fn, (error) => error instanceof Error && error.message.includes(fragment));
}

const hashOptions = normalizeDataRematchOptions({ hash: true, confirmHashRegeneration: true }, { requireHashConfirmation: true });
assert.deepEqual(hashOptions, { thumbnail: false, metadata: false, hash: true });

assertThrowsMessage(
  () => normalizeDataRematchOptions({ hash: true, thumbnail: true, confirmHashRegeneration: true }, { requireHashConfirmation: true }),
  '단독',
);
assertThrowsMessage(
  () => normalizeDataRematchOptions({ hash: true }, { requireHashConfirmation: true }),
  '확인',
);
assertThrowsMessage(
  () => normalizeDataRematchOptions({}),
  '하나 이상',
);

assert.equal(isDataRematchSupportedFileType('image'), true);
assert.equal(isDataRematchSupportedFileType('animated'), true);
assert.equal(isDataRematchSupportedFileType('video'), false);
assert.deepEqual(DATA_REMATCH_SUPPORTED_FILE_TYPES, ['image', 'animated']);
assert.deepEqual(DATA_REMATCH_EXCLUDED_FILE_TYPES, ['video']);

assert.ok(HASH_REGENERATION_BLOCKED_PIPELINES.includes('auto-tag-extraction'));
assert.ok(HASH_REGENERATION_BLOCKED_PIPELINES.includes('artist-extraction'));
assert.ok(HASH_REGENERATION_WARNINGS.some((warning) => warning.includes('자동 태그') && warning.includes('작가')));

for (const table of [
  'media_metadata',
  'image_files',
  'image_groups',
  'auto_folder_group_images',
  'image_models',
  'civitai_temp_urls',
  'image_metadata_edit_revisions',
  'api_generation_history',
]) {
  assert.ok(DATA_REMATCH_HASH_REFERENCE_TABLES.includes(table as (typeof DATA_REMATCH_HASH_REFERENCE_TABLES)[number]), `missing rematch table: ${table}`);
}

const serviceSource = readFileSync(resolve(process.cwd(), 'src/services/dataRematchService.ts'), 'utf8');
for (const table of ['image_groups', 'auto_folder_group_images', 'image_models', 'civitai_temp_urls', 'image_metadata_edit_revisions']) {
  assert.ok(serviceSource.includes(`this.remapHashRefTableRows('${table}', oldHash, newHash)`), `hash regeneration must remap ${table}`);
}
assert.ok(serviceSource.includes('UPDATE OR IGNORE api_generation_history'), 'hash regeneration must remap generation-history links');
assert.ok(serviceSource.includes('UPDATE OR IGNORE ${quoteIdentifier(tableName)}'), 'hash regeneration must remap existing relation rows onto the new hash');
assert.ok(serviceSource.includes('DELETE FROM ${quoteIdentifier(tableName)}'), 'hash regeneration must remove only old-hash rows left after remap conflicts');
assert.ok(serviceSource.includes('중복 충돌만 해제'), 'hash regeneration warning must describe conflict-only detachment');
assert.equal(serviceSource.includes('deleteHashRefTableRows'), false, 'hash regeneration must not use delete-only rematching');
assert.equal(serviceSource.includes('deleteApiGenerationHistory'), false, 'hash regeneration must not delete generation history without remapping first');

console.log('✅ Data rematch backend contracts verified');
