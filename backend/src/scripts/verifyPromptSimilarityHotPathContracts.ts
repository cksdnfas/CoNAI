import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readSource(relativePath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8');
}

const serviceSource = readSource('src/services/promptSimilarityService.ts');
const migrationSource = readSource('src/database/migrations/024_add_prompt_similarity_candidate_indexes.ts');

const findStart = serviceSource.indexOf('static findSimilarByCompositeHash');
assert.notEqual(findStart, -1, 'findSimilarByCompositeHash should exist');
const hydrateStart = serviceSource.indexOf('private static hydratePromptMatches', findStart);
assert.notEqual(hydrateStart, -1, 'hydratePromptMatches should exist after prompt search');

const findSource = serviceSource.slice(findStart, hydrateStart);
const rowsStart = findSource.indexOf('const rows = db.prepare');
assert.notEqual(rowsStart, -1, 'prompt similarity should prepare a candidate query');
const rowsEnd = findSource.indexOf(').all(compositeHash', rowsStart);
assert.notEqual(rowsEnd, -1, 'prompt similarity candidate query should execute from composite hash');
const candidateQuerySource = findSource.slice(rowsStart, rowsEnd);

assert.doesNotMatch(
  candidateQuerySource,
  /\bim\.prompt\b|\bim\.negative_prompt\b|\bim\.auto_tags\b|pos_prompt_normalized|neg_prompt_normalized|auto_prompt_normalized/,
  'prompt similarity candidates must not load large prompt or normalized text blobs',
);
assert.doesNotMatch(
  candidateQuerySource,
  /watched_folders|wf\.folder_name|original_file_path|thumbnail_path|file_size/i,
  'prompt similarity candidates should defer full metadata/file hydration until final matches',
);
assert.doesNotMatch(
  candidateQuerySource,
  /GROUP BY im\.composite_hash/,
  'prompt similarity candidates should avoid temp group-by trees on the hot path',
);
assert.match(
  candidateQuerySource,
  /EXISTS \([\s\S]*FROM image_files if[\s\S]*if\.composite_hash = im\.composite_hash[\s\S]*if\.file_status = 'active'/,
  'prompt similarity candidates should require active files without duplicate-producing joins',
);
assert.match(
  candidateQuerySource,
  /im\.prompt_similarity_algorithm = \?/,
  'prompt similarity candidates should use prepared fields for the active algorithm',
);
assert.match(
  candidateQuerySource,
  /im\.prompt_similarity_version = \?/,
  'prompt similarity candidates should use prepared fields for the active version',
);
assert.match(
  findSource,
  /ImageSafetyService\.buildVisibleScoreCondition\('im\.rating_score'\)/,
  'prompt similarity candidates should respect hidden-rating visibility',
);
assert.match(
  findSource,
  /MediaPostprocessVisibilityService\.buildReadyCondition\('im'\)/,
  'prompt similarity candidates should respect postprocess readiness',
);
assert.match(
  findSource,
  /buildPromptCandidateFingerprintCondition\(activeFields\)/,
  'prompt similarity candidates should require usable prepared fingerprints',
);
assert.match(
  findSource,
  /for \(const fieldName of activeFields\)/,
  'prompt similarity scoring should only calculate fields active on the source image',
);
assert.match(
  findSource,
  /buildInactiveFieldScores\(settings\)/,
  'prompt similarity should preserve inactive field score shape without calculating every field',
);

const hydrateSource = serviceSource.slice(hydrateStart);
assert.match(
  hydrateSource,
  /SELECT\s+im\.\*/s,
  'prompt similarity should still hydrate final matches with full metadata',
);
assert.match(
  hydrateSource,
  /LEFT JOIN watched_folders wf/,
  'prompt similarity final hydration should preserve folder metadata',
);
assert.match(
  migrationSource,
  /idx_prompt_similarity_pos_candidates/,
  'prompt similarity positive candidates should have a covering candidate index',
);
assert.match(
  migrationSource,
  /idx_prompt_similarity_neg_candidates/,
  'prompt similarity negative candidates should have a covering candidate index',
);
assert.match(
  migrationSource,
  /idx_prompt_similarity_auto_candidates/,
  'prompt similarity auto candidates should have a covering candidate index',
);

console.log('✅ Prompt similarity hot-path contracts verified');
